// v0.10.22 — Phase 2 of the "Migrate Existing User to New Dialer" flow.
//
// After a DID is re-bound to the user's ACE connection in Telnyx, this
// function pulls the last 30 days of call + SMS history from Telnyx for
// that number and inserts it into ACE's Call + Message tables. The user
// opens Recents / Messages and sees their history reconstructed.
//
// Design:
//   - Fire-and-forget from the migrate endpoint (Promise<void>, never throws).
//   - Best-effort: if Telnyx's detail-records API isn't available on the
//     account tier, we log + bail. We don't fail the migration.
//   - Dedupe via the unique constraints on Call.telnyxCallId and
//     Message.telnyxMessageId — Prisma's createMany({ skipDuplicates: true })
//     handles overlap with rows already in the table (e.g. if the user had
//     this number partly working via ACE before formally migrating).
//   - Voicemails NOT included — Pulse-side voicemails are in Pulse's DB,
//     not Telnyx. Telnyx may have call recordings but not voicemail audio
//     specifically; out of scope for this phase.
//
// Why fire-and-forget vs synchronous?
//   - 30 days of CDRs for a busy number can be 500-2000+ records.
//   - Telnyx's paginated fetch + insert can take 10-30+ seconds.
//   - Blocking the migration HTTP response on that gives admins a bad UX:
//     they'd see a spinner that looks broken. Better to return immediately
//     and let the backfill stream rows in during the next minute.

import { prisma } from '@ace/db';
import * as telnyx from '../telnyx/numbers.js';

interface BackfillResult {
  callsInserted: number;
  callsSkipped: number;
  messagesInserted: number;
  messagesSkipped: number;
  errors: string[];
}

type LogFn = (obj: Record<string, unknown>, msg: string) => void;
const noopLog: LogFn = () => undefined;

/**
 * Pull 30d of voice + SMS history for `didNumber` from Telnyx and insert
 * into ACE's Call + Message tables. Fire-and-forget — never throws.
 */
export async function backfillMigratedDidHistory(
  args: {
    userId: number;
    userDidId: number;
    didNumber: string;          // E.164
    daysBack?: number;          // default 30
  },
  log: LogFn = noopLog,
): Promise<BackfillResult> {
  const daysBack = args.daysBack ?? 30;
  const result: BackfillResult = {
    callsInserted: 0,
    callsSkipped: 0,
    messagesInserted: 0,
    messagesSkipped: 0,
    errors: [],
  };

  log({ ...args }, '[backfill] start');

  const startTime = new Date(Date.now() - daysBack * 86400_000).toISOString();
  const endTime = new Date().toISOString();

  // ─── Voice CDRs via async Telnyx Reports API ──────────────────────────
  //
  // Sync /v2/detail_records doesn't support phone filtering — verified
  // empirically (it returned 0 even when CSV export had 61 rows for the
  // same number/window). The async usage-report API DOES support filtering
  // and is what powers Telnyx Portal's "Export CSV" button.
  try {
    const voiceCsv = await fetchCdrCsvViaReport(args.didNumber, startTime, endTime, log);
    if (voiceCsv) {
      const rows = parseCsvRows(voiceCsv);
      const callRows = rows
        .map((r) => mapTelnyxCsvRowToCall(r, args.userId, args.userDidId))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      log({ count: callRows.length, didNumber: args.didNumber }, '[backfill] voice fetched');

      if (callRows.length > 0) {
        const before = result.callsInserted;
        try {
          const inserted = await prisma.call.createMany({
            data: callRows,
            skipDuplicates: true,
          });
          result.callsInserted += inserted.count;
          result.callsSkipped += callRows.length - inserted.count;
        } catch (e) {
          result.errors.push(`call createMany: ${e instanceof Error ? e.message : String(e)}`);
        }
        log(
          { inserted: result.callsInserted - before, total: callRows.length },
          '[backfill] voice inserted',
        );
      }
    } else {
      log({ didNumber: args.didNumber }, '[backfill] voice report unavailable — skipping');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`voice fetch: ${msg}`);
    log({ err: msg }, '[backfill] voice failed');
  }

  // ─── SMS MDRs via async Telnyx Reports API ────────────────────────────
  try {
    const smsCsv = await fetchMdrCsvViaReport(args.didNumber, startTime, endTime, log);
    if (smsCsv) {
      const rows = parseCsvRows(smsCsv);
      const msgRows = rows
        .map((r) => mapTelnyxCsvRowToMessage(r, args.userId, args.userDidId, args.didNumber))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      log({ count: msgRows.length, didNumber: args.didNumber }, '[backfill] sms fetched');

      if (msgRows.length > 0) {
        const before = result.messagesInserted;
        try {
          const inserted = await prisma.message.createMany({
            data: msgRows,
            skipDuplicates: true,
          });
          result.messagesInserted += inserted.count;
          result.messagesSkipped += msgRows.length - inserted.count;
        } catch (e) {
          result.errors.push(`message createMany: ${e instanceof Error ? e.message : String(e)}`);
        }
        log(
          { inserted: result.messagesInserted - before, total: msgRows.length },
          '[backfill] sms inserted',
        );
      }
    } else {
      log({ didNumber: args.didNumber }, '[backfill] sms report unavailable — skipping');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`sms fetch: ${msg}`);
    log({ err: msg }, '[backfill] sms failed');
  }

  log({ result }, '[backfill] done');
  return result;
}

// ─── Async Telnyx Report helpers ────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 60;            // 60 × 3s = 3 minutes max wait

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Request a CDR report from Telnyx, poll until done, download the CSV.
 * Returns null on any failure (best-effort — we never throw).
 */
async function fetchCdrCsvViaReport(
  phoneNumber: string,
  startTime: string,
  endTime: string,
  log: LogFn,
): Promise<string | null> {
  const create = await telnyx.requestCdrReport({ startTime, endTime, phoneNumber });
  if (!create.ok || !create.data?.data?.id) {
    log({ status: create.status, error: create.error }, '[backfill] CDR report create failed');
    return null;
  }
  const reportId = create.data.data.id;
  log({ reportId, phoneNumber }, '[backfill] CDR report requested');

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const status = await telnyx.getCdrReportStatus(reportId);
    if (!status.ok || !status.data?.data) continue;
    const st = status.data.data.status;
    if (st === 'COMPLETE' || st === 'COMPLETED') {
      const url = status.data.data.report_url;
      if (!url) {
        log({ reportId }, '[backfill] CDR report complete but no URL');
        return null;
      }
      log({ reportId, attempt: i + 1 }, '[backfill] CDR report complete, downloading');
      return telnyx.downloadReportCsv(url);
    }
    if (st === 'FAILED') {
      log({ reportId }, '[backfill] CDR report FAILED');
      return null;
    }
  }
  log({ reportId }, '[backfill] CDR report timed out');
  return null;
}

async function fetchMdrCsvViaReport(
  phoneNumber: string,
  startTime: string,
  endTime: string,
  log: LogFn,
): Promise<string | null> {
  const create = await telnyx.requestMdrReport({ startTime, endTime, phoneNumber });
  if (!create.ok || !create.data?.data?.id) {
    log({ status: create.status, error: create.error }, '[backfill] MDR report create failed');
    return null;
  }
  const reportId = create.data.data.id;
  log({ reportId, phoneNumber }, '[backfill] MDR report requested');

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const status = await telnyx.getMdrReportStatus(reportId);
    if (!status.ok || !status.data?.data) continue;
    const st = status.data.data.status;
    if (st === 'COMPLETE' || st === 'COMPLETED') {
      const url = status.data.data.report_url;
      if (!url) {
        log({ reportId }, '[backfill] MDR report complete but no URL');
        return null;
      }
      log({ reportId, attempt: i + 1 }, '[backfill] MDR report complete, downloading');
      return telnyx.downloadReportCsv(url);
    }
    if (st === 'FAILED') {
      log({ reportId }, '[backfill] MDR report FAILED');
      return null;
    }
  }
  log({ reportId }, '[backfill] MDR report timed out');
  return null;
}

// ─── CSV parsing (reused logic from admin.routes.ts CSV upload) ─────────

function parseCsvRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j] ?? '';
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQuotes = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function mapTelnyxCsvRowToCall(
  row: Record<string, string>,
  userId: number,
  userDidId: number,
) {
  const telnyxCallId = (row['Call UUID'] || row['Unique CDR ID'] || '').trim();
  const fromNumber = (row['Originating Number'] || '').trim();
  const toNumber = (row['Terminating number'] || row['Full Terminating number'] || '').trim();
  const startStr = (row['Start Timestamp(UTC)'] || row['Start Timestamp'] || '').trim();
  if (!telnyxCallId || !fromNumber || !toNumber || !startStr) return null;

  const direction = (row['Direction'] || '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
  const startedAt = new Date(startStr.replace(' ', 'T') + 'Z');
  const answeredStr = (row['Answer Timestamp'] || '').trim();
  const answeredAt = answeredStr ? new Date(answeredStr.replace(' ', 'T') + 'Z') : null;
  const endedStr = (row['End Timestamp'] || '').trim();
  const endedAt = endedStr ? new Date(endedStr.replace(' ', 'T') + 'Z') : null;
  const durationSeconds = parseInt(row['Call duration'] || '0', 10) || 0;
  const hangupCause = (row['Hangup cause'] || '').trim() || null;

  let status: string;
  if (durationSeconds > 0) status = 'completed';
  else if (direction === 'inbound') status = 'missed';
  else status = 'failed';

  return {
    userId,
    telnyxCallId,
    direction,
    fromNumber,
    toNumber,
    status,
    startedAt,
    answeredAt,
    endedAt,
    durationSeconds,
    hangupCause,
    userDidId,
  };
}

function mapTelnyxCsvRowToMessage(
  row: Record<string, string>,
  userId: number,
  userDidId: number,
  ourDidE164: string,
) {
  const telnyxMessageId = (row['Message ID'] || row['MessageID'] || row['ID'] || row['Unique MDR ID'] || '').trim();
  const fromNumber = (row['From'] || row['Originating Number'] || '').trim();
  const toNumber = (row['To'] || row['Terminating number'] || '').trim();
  const tsStr = (row['Created At'] || row['Start Timestamp'] || row['Sent At'] || '').trim();
  if (!telnyxMessageId || !fromNumber || !toNumber) return null;

  const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);
  const ourLast10 = last10(ourDidE164);
  let direction = (row['Direction'] || '').toLowerCase();
  if (direction !== 'inbound' && direction !== 'outbound') {
    direction = last10(fromNumber) === ourLast10 ? 'outbound' : 'inbound';
  }
  const threadKey = direction === 'outbound' ? toNumber : fromNumber;
  const body = (row['Body'] || row['Text'] || '').trim();
  const statusRaw = (row['Status'] || '').toLowerCase().trim();
  const status = ['queued', 'sent', 'delivered', 'failed', 'received'].includes(statusRaw)
    ? statusRaw
    : direction === 'inbound' ? 'received' : 'delivered';
  const sentAt = tsStr ? new Date(tsStr.replace(' ', 'T') + 'Z') : null;

  return {
    userId,
    telnyxMessageId,
    threadKey,
    direction,
    fromNumber,
    toNumber,
    body,
    mediaUrls: [],
    status,
    sentAt,
    deliveredAt: status === 'delivered' && sentAt ? sentAt : null,
    userDidId,
  };
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapVoiceCdrToCallRow(
  c: telnyx.TelnyxVoiceCdr,
  userId: number,
  userDidId: number,
) {
  const telnyxCallId = c.id ?? c.call_id;
  if (!telnyxCallId || !c.from || !c.to || !c.started_at) return null;

  const durationSec = typeof c.duration === 'string'
    ? parseInt(c.duration, 10) || 0
    : (c.duration ?? 0);

  // Map Telnyx direction to our schema. Telnyx uses "inbound" / "outbound";
  // our schema uses the same strings.
  const direction = c.direction === 'inbound' ? 'inbound' : 'outbound';

  // Status: completed if answered + had duration; missed if inbound w/ 0 dur.
  let status: string;
  if (durationSec > 0) status = 'completed';
  else if (direction === 'inbound') status = 'missed';
  else status = 'failed';

  // Override with Telnyx's hangup_cause when available
  if (c.status) status = c.status;

  return {
    userId,
    telnyxCallId,
    direction,
    fromNumber: c.from,
    toNumber: c.to,
    status,
    startedAt: new Date(c.started_at),
    answeredAt: c.answered_at ? new Date(c.answered_at) : null,
    endedAt: c.ended_at ? new Date(c.ended_at) : null,
    durationSeconds: durationSec,
    hangupCause: c.hangup_cause ?? null,
    hangupSource: c.hangup_source ?? null,
    recordingUrl: c.recording_url ?? null,
    userDidId,
  };
}

function mapSmsMdrToMessageRow(
  m: telnyx.TelnyxSmsMdr,
  userId: number,
  userDidId: number,
  ourDidE164: string,
) {
  if (!m.id) return null;

  // Extract `from` phone number (Telnyx returns either string or object).
  const fromNumber = typeof m.from === 'string'
    ? m.from
    : m.from?.phone_number ?? '';
  // Extract `to` — first recipient only (Telnyx returns array).
  const toRaw = m.to;
  const toNumber = typeof toRaw === 'string'
    ? toRaw
    : Array.isArray(toRaw)
      ? toRaw[0]?.phone_number ?? ''
      : '';
  if (!fromNumber || !toNumber) return null;

  // Direction: outbound if WE sent it (from is our DID).
  // Telnyx sometimes returns "outbound-api" / "outbound" / "inbound" —
  // normalize against our DID instead of trusting Telnyx's string.
  const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);
  const ourLast10 = last10(ourDidE164);
  const direction = last10(fromNumber) === ourLast10 ? 'outbound' : 'inbound';

  // threadKey = the OTHER party's number (regardless of direction).
  const threadKey = direction === 'outbound' ? toNumber : fromNumber;

  // Status mapping. Telnyx values we've seen: 'delivered', 'sent',
  // 'failed', 'received'. Our schema uses queued | sent | delivered | failed | received.
  const statusRaw = (m.status ?? '').toLowerCase();
  const status = ['queued', 'sent', 'delivered', 'failed', 'received'].includes(statusRaw)
    ? statusRaw
    : direction === 'inbound' ? 'received' : 'delivered';

  // Timestamp: prefer sent_at, fall back to received_at.
  const tsStr = m.sent_at ?? m.received_at;
  const sentAt = tsStr ? new Date(tsStr) : null;
  const deliveredAt = status === 'delivered' && tsStr ? new Date(tsStr) : null;

  return {
    userId,
    telnyxMessageId: m.id,
    threadKey,
    direction,
    fromNumber,
    toNumber,
    body: m.text ?? '',
    mediaUrls: m.media_urls ?? [],
    status,
    sentAt,
    deliveredAt,
    userDidId,
  };
}
