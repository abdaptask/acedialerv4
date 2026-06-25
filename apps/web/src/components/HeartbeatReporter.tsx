// v0.10.101 - Device heartbeat reporter. Mounts once at the app root.
// Generates a stable deviceId, reports platform + appVersion to
// /me/heartbeat on mount + focus + every 60s. If response signals
// forceUpdate, triggers Electron's autoUpdater.checkForUpdatesAndNotify().

import { useEffect, useRef } from 'react';
import { sendHeartbeat } from '../api';

const DEVICE_ID_KEY = 'ace_device_id';

// v0.10.138 — QA-012 — In-memory fallback so even if BOTH storage tiers
// throw (private browsing with locked-down quotas), at least the same
// module instance reuses the same id for the lifetime of the tab.
let memoryDeviceId: string | null = null;

function getOrCreateDeviceId(): string {
  // Tier 1: localStorage (persists across sessions on a normal browser).
  try {
    const id = localStorage.getItem(DEVICE_ID_KEY);
    if (id && id.length >= 8) return id;
  } catch { /* localStorage unavailable, fall through */ }
  // Tier 2: sessionStorage (persists for the tab in Incognito too).
  try {
    const id = sessionStorage.getItem(DEVICE_ID_KEY);
    if (id && id.length >= 8) {
      // Best-effort: also write back to localStorage in case it recovers.
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* noop */ }
      memoryDeviceId = id;
      return id;
    }
  } catch { /* sessionStorage unavailable */ }
  // Tier 3: in-module memory.
  if (memoryDeviceId) return memoryDeviceId;
  // Generate a fresh id and persist to whichever tier accepts the write.
  const fresh = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  memoryDeviceId = fresh;
  try { localStorage.setItem(DEVICE_ID_KEY, fresh); } catch { /* noop */ }
  try { sessionStorage.setItem(DEVICE_ID_KEY, fresh); } catch { /* noop */ }
  return fresh;
}

function detectPlatform(): string {
  if (typeof window === 'undefined') return 'unknown';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.ace?.isElectron) {
    const p = w.aceDesktop?.platform;
    if (p === 'win32') return 'electron-win';
    if (p === 'darwin') return 'electron-mac';
    if (p === 'linux') return 'electron-linux';
    return 'electron';
  }
  return 'web';
}

function detectOsLabel(): string {
  try {
    return navigator.userAgent.slice(0, 200);
  } catch {
    return '';
  }
}

declare const __APP_VERSION__: string | undefined;

function getAppVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const declared = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
  return (w.ace?.appVersion as string | undefined) || declared || '0.0.0';
}

export default function HeartbeatReporter() {
  const deviceIdRef = useRef<string>(getOrCreateDeviceId());
  const lastForceTriggerRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function beat() {
      if (cancelled) return;
      const token = sessionStorage.getItem('ace_token');
      if (!token) return;
      try {
        const r = await sendHeartbeat(token, {
          deviceId: deviceIdRef.current,
          platform: detectPlatform(),
          appVersion: getAppVersion(),
          osLabel: detectOsLabel(),
        });
        if (r.forceUpdate && r.forceUpdateRequestedAt && r.forceUpdateRequestedAt !== lastForceTriggerRef.current) {
          lastForceTriggerRef.current = r.forceUpdateRequestedAt;
          // v0.10.205 - Dispatch a window event that ForceUpdateModal listens
          // for. The modal owns the entire install lifecycle (download UI,
          // active-call deferral, install, ack). We no longer ack here -
          // acking before the install completed dismissed the prompt while
          // the install was still in flight.
          console.info('[heartbeat] admin requested force-update - dispatching ace:force-update-required');
          try {
            window.dispatchEvent(new CustomEvent('ace:force-update-required', {
              detail: {
                deviceId: deviceIdRef.current,
                requestedAt: r.forceUpdateRequestedAt,
              },
            }));
          } catch (e) {
            console.warn('[heartbeat] dispatch failed', e);
          }
        }
      } catch (e) {
        console.debug('[heartbeat] failed', e);
      }
    }

    const initialTimer = setTimeout(beat, 1000);
    const intervalTimer = setInterval(beat, 60_000);
    const onFocus = () => { void beat(); };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return null;
}
