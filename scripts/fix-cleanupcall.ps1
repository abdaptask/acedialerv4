# Apply the cleanupCall bug fix to apps/web/src/services/sip.ts.
# Safe to re-run — aborts if the target block isn't present exactly once.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$f = Join-Path $repoRoot 'apps\web\src\services\sip.ts'
$text = [System.IO.File]::ReadAllText($f)
$nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }

$old = @(
    '    // If a held call remains, promote it to active and unhold.'
    '    let promotedEvent: CallEvent | null = null;'
    '    if (!this.activeCallId && this.calls.size > 0) {'
    '      const next = Array.from(this.calls.values())[0];'
    '      this.activeCallId = next.id;'
    '      try {'
    '        next.session.unhold();'
    '      } catch { /* noop */ }'
    '      next.heldLocal = false;'
    '      if (next.audioEl) {'
    '        this.primaryAudioEl.srcObject = next.audioEl.srcObject;'
    '      }'
    "      promotedEvent = this.buildEvent(next, 'connected');"
    "      console.log('[sip] promoted held call to active:', next.id);"
    '    }'
) -join $nl

$new = @(
    '    // If a HELD call remains, promote it to active and unhold.'
    '    // Bug fix: previously this took the first call regardless of state,'
    "    // which falsely promoted still-ringing incoming calls to 'connected'"
    '    // when the active call ended. Only promote calls that were explicitly'
    '    // placed on hold (heldLocal === true). Ringing/incoming sessions are'
    '    // left alone so their natural lifecycle plays out.'
    '    let promotedEvent: CallEvent | null = null;'
    '    if (!this.activeCallId && this.calls.size > 0) {'
    '      const next = Array.from(this.calls.values()).find('
    '        (c) => c.heldLocal && c.id !== this.incomingCallId,'
    '      );'
    '      if (next) {'
    '        this.activeCallId = next.id;'
    '        try {'
    '          next.session.unhold();'
    '        } catch { /* noop */ }'
    '        next.heldLocal = false;'
    '        if (next.audioEl) {'
    '          this.primaryAudioEl.srcObject = next.audioEl.srcObject;'
    '        }'
    "        promotedEvent = this.buildEvent(next, 'connected');"
    "        console.log('[sip] promoted held call to active:', next.id);"
    '      }'
    '    }'
) -join $nl

$count = ([regex]::Matches($text, [regex]::Escape($old))).Count
if ($count -ne 1) {
    Write-Host "ABORT: found $count matches of the old block, expected exactly 1."
    Write-Host "File may have been modified or rolled back. Not touching it."
    exit 1
}

$text = $text.Replace($old, $new)
[System.IO.File]::WriteAllText($f, $text)
Write-Host "Replaced 1 block. New line count:" (Get-Content $f).Count
