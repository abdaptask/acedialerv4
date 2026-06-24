#!/usr/bin/env python3
"""Telnyx phantom-contact audit across all users on the account.

Uses Telnyx's async CDR report API (the same flow Mission Control uses):
  1. POST /v2/legacy_reporting/batch_detail_records/voice with
     start_time, end_time, call_types=[1] (inbound only).
  2. Poll GET /v2/legacy_reporting/batch_detail_records/voice/{id}
     until status == 2 (Complete).
  3. Download the CSV from report_url.
  4. Group by Call UUID, count fork legs per inbound call_session.
  5. Per-user table: inbound success rate + avg legs/call. Phantom
     flag = avg legs > 1.5.

REQUIREMENTS
  Python 3.8+
  TELNYX_API_KEY in env or ORIGINAL.env in cwd.

USAGE
  cd C:\\Users\\asheikh\\Documents\\Claude\\Projects\\Dialer\\acedialerv4
  python scripts\\telnyx_phantom_contacts_audit.py

OUTPUT (in ./telnyx_audit_output/)
  - report_<id>.csv               raw CDR data from Telnyx
  - per_user_summary.csv          phantom-pattern analysis per user
  - phantom_contacts_report.md    readable top-25 summary

The script takes 1-5 minutes total (report generation is server-side
and Telnyx polls it; we just wait for "complete").
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_BASE = "https://api.telnyx.com/v2"
DAYS = 14
OUT_DIR = Path("telnyx_audit_output")

POLL_INTERVAL_SEC = 8
POLL_MAX_ATTEMPTS = 75  # 75 × 8s = 10 minutes


def load_api_key() -> str:
    key = os.environ.get("TELNYX_API_KEY")
    if key:
        return key.strip()
    for env_file in ["ORIGINAL.env", ".env", "apps/api/.env"]:
        p = Path(env_file)
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith("TELNYX_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERROR: TELNYX_API_KEY not found (env or ORIGINAL.env/.env/apps/api/.env)",
          file=sys.stderr)
    sys.exit(1)


def http_request(method: str, path: str, api_key: str,
                 body: dict | None = None) -> dict:
    url = f"{API_BASE}/{path.lstrip('/')}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="ignore")
        print(f"HTTP {e.code} on {method} {url}\n  body: {body_text[:400]}",
              file=sys.stderr)
        raise


def download_to(url: str, dest: Path) -> None:
    print(f"  downloading {url[:80]}{'...' if len(url) > 80 else ''}")
    with urllib.request.urlopen(url, timeout=300) as resp:
        dest.write_bytes(resp.read())
    print(f"  wrote {dest} ({dest.stat().st_size:,} bytes)")


def main() -> int:
    api_key = load_api_key()
    OUT_DIR.mkdir(exist_ok=True)

    end_time = datetime.now(timezone.utc).replace(microsecond=0)
    start_time = (end_time - timedelta(days=DAYS)).replace(microsecond=0)
    fmt = "%Y-%m-%dT%H:%M:%SZ"

    # 1. Create the CDR report request.
    print(f"Creating CDR report: {start_time.strftime(fmt)} → "
          f"{end_time.strftime(fmt)}, inbound only...")
    create_body = {
        "start_time": start_time.strftime(fmt),
        "end_time": end_time.strftime(fmt),
        # call_types: 1 = Inbound, 2 = Outbound. Only need inbound for the
        # phantom-contact pattern (multiple legs forked on incoming INVITE).
        "call_types": [1],
        # record_types: 1 = Complete, 2 = Incomplete, 3 = Errors.
        # We want ALL of them since failed forks ARE the evidence.
        "record_types": [1, 2, 3],
        "report_name": "phantom-contact-audit",
        "source": "calls",
        "timezone": "UTC",
        "include_all_metadata": True,
    }
    create_resp = http_request(
        "POST",
        "legacy_reporting/batch_detail_records/voice",
        api_key,
        body=create_body,
    )
    report = create_resp.get("data", {})
    report_id = report.get("id")
    if not report_id:
        print(f"ERROR: no report id in response: {create_resp}", file=sys.stderr)
        return 1
    print(f"  report id = {report_id}  status = {report.get('status')}")

    # 2. Poll.
    print(f"Polling for completion (every {POLL_INTERVAL_SEC}s, up to "
          f"{POLL_INTERVAL_SEC * POLL_MAX_ATTEMPTS // 60} minutes)...")
    report_url = None
    for attempt in range(1, POLL_MAX_ATTEMPTS + 1):
        time.sleep(POLL_INTERVAL_SEC)
        poll_resp = http_request(
            "GET",
            f"legacy_reporting/batch_detail_records/voice/{report_id}",
            api_key,
        )
        rep = poll_resp.get("data", {})
        status = rep.get("status")
        # status: 1=Pending, 2=Complete, 3=Failed, 4=Expired
        status_name = {1: "Pending", 2: "Complete", 3: "Failed",
                       4: "Expired"}.get(status, f"Unknown ({status})")
        print(f"  attempt {attempt:>2}: status={status_name}")
        if status == 2:
            report_url = rep.get("report_url")
            break
        if status in (3, 4):
            print(f"ERROR: report ended in status {status_name}", file=sys.stderr)
            return 1
    if not report_url:
        print("ERROR: report did not complete within polling window",
              file=sys.stderr)
        return 1

    # 3. Download the CSV.
    csv_path = OUT_DIR / f"report_{report_id}.csv"
    download_to(report_url, csv_path)

    # 4. Parse the CSV and compute fork pattern.
    print("Analyzing CDR rows...")
    sessions = defaultdict(list)  # call_uuid -> [row, ...]
    total_rows = 0
    with csv_path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1
            # The CDR CSV (Telnyx Mission Control format) uses these headers:
            #   "Call UUID", "Sip call-id", "Direction", "Hangup cause",
            #   "Hangup code", "Full Terminating number",
            #   "Terminating number", "Call duration", "Billable time", ...
            # Group by Call UUID — that's what ties multiple forked legs
            # of a single inbound call together.
            call_uuid = (row.get("Call UUID") or row.get("Unique CDR ID") or
                         "").strip()
            if call_uuid:
                sessions[call_uuid].append(row)

    print(f"  {total_rows} inbound CDR rows in {len(sessions)} unique sessions")

    # User identification: the terminating number on the FIRST row of the
    # session. For credential-routed calls this is the SIP username
    # (e.g., "acesaifali1b0npa"). The DID is in "Terminating number".
    # We want to group by the credential username when present (that's
    # what shows the fork pattern), falling back to the DID.
    def user_key(rows):
        for r in rows:
            full = (r.get("Full Terminating number") or "").strip()
            if full and not full.startswith("+"):
                # Credential username form (no leading +).
                return full
        # Fall back to the DID on the originator-cancel row, or first row.
        for r in rows:
            term = (r.get("Terminating number") or "").strip()
            if term:
                return term
        return "(unknown)"

    per_user = defaultdict(lambda: {
        "inbound_sessions": 0,
        "successful_sessions": 0,
        "total_legs": 0,
        "fork_sessions": 0,
        "sample_caller": "",
    })

    for sid, rows in sessions.items():
        u = user_key(rows)
        legs = len(rows)
        # "Successful" = at least one leg with hangup_cause NORMAL_CLEARING
        # AND non-zero call duration (otherwise it could be a cancelled leg).
        def is_answered(r):
            cause = (r.get("Hangup cause") or "").strip()
            try:
                dur = int(r.get("Call duration") or 0)
            except (TypeError, ValueError):
                dur = 0
            return cause == "NORMAL_CLEARING" and dur > 0

        success = any(is_answered(r) for r in rows)
        pu = per_user[u]
        pu["inbound_sessions"] += 1
        pu["total_legs"] += legs
        if legs > 1:
            pu["fork_sessions"] += 1
        if success:
            pu["successful_sessions"] += 1
        if not pu["sample_caller"]:
            pu["sample_caller"] = (rows[0].get("Originating Number") or "").strip()

    # 5. Write per-user summary.
    summary_rows = []
    for user, s in per_user.items():
        if s["inbound_sessions"] == 0:
            continue
        fail_pct = round(
            100 * (s["inbound_sessions"] - s["successful_sessions"]) /
            s["inbound_sessions"], 1)
        avg_legs = round(s["total_legs"] / s["inbound_sessions"], 2)
        fork_pct = round(100 * s["fork_sessions"] / s["inbound_sessions"], 1)
        phantom = "YES" if avg_legs > 1.5 else "no"
        summary_rows.append([
            user,
            s["inbound_sessions"],
            s["successful_sessions"],
            fail_pct,
            avg_legs,
            fork_pct,
            phantom,
            s["sample_caller"],
        ])

    # Sort: phantom YES first, then by failure rate desc, then by volume desc.
    summary_rows.sort(key=lambda r: (-(r[6] == "YES"), -r[3], -r[1]))

    summary_csv = OUT_DIR / "per_user_summary.csv"
    with summary_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "user_identifier",
            "inbound_sessions",
            "successful_sessions",
            "failure_rate_pct",
            "avg_legs_per_session",
            "fork_session_pct",
            "phantom_flag",
            "sample_caller",
        ])
        for r in summary_rows:
            w.writerow(r)
    print(f"  wrote {summary_csv}")

    # 6. Markdown report.
    md = OUT_DIR / "phantom_contacts_report.md"
    with md.open("w", encoding="utf-8") as f:
        f.write("# Telnyx phantom-contact audit\n\n")
        f.write(f"**Window:** last {DAYS} days "
                f"({start_time.date()} → {end_time.date()}, UTC)\n\n")
        f.write(f"**Total inbound CDR rows:** {total_rows}\n")
        f.write(f"**Total unique call sessions:** {len(sessions)}\n\n")
        affected = [r for r in summary_rows if r[6] == "YES"]
        f.write(
            f"## {len(affected)} of {len(summary_rows)} users flagged as "
            f"phantom-contact affected (avg legs/session > 1.5)\n\n"
        )
        f.write("Top 25, sorted phantom-first then by failure rate:\n\n")
        f.write("| User | Inbound | Success | Fail % | Avg legs | Forked % | "
                "Phantom |\n")
        f.write("|---|---|---|---|---|---|---|\n")
        for r in summary_rows[:25]:
            f.write(
                f"| {r[0]} | {r[1]} | {r[2]} | {r[3]}% | {r[4]} | {r[5]}% | "
                f"{r[6]} |\n"
            )
        if affected:
            f.write("\n## All affected users (raw)\n\n")
            f.write("| User | Inbound | Fail % | Avg legs |\n")
            f.write("|---|---|---|---|\n")
            for r in affected:
                f.write(f"| {r[0]} | {r[1]} | {r[3]}% | {r[4]} |\n")
    print(f"  wrote {md}")

    print("\nDone. Send these back for analysis:")
    print(f"  {summary_csv}")
    print(f"  {md}")
    print(f"  {csv_path}  (large, optional)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
