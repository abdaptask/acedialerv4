// Shape of GET /reports. Mirrors apps/api/src/reports/{compute,reports.routes}.ts
// by hand — apps may not share TS modules (CLAUDE.md §1.4), so a field
// added there must be added here.

export interface PersonMetrics {
  userId: number;
  callsOut: number;
  connectedOut: number;
  callsIn: number;
  answeredIn: number;
  unansweredIn: number;
  declinedIn: number;
  callerHungUpIn: number;
  rangOutIn: number;
  noAnswerOut: number;
  rejectedOut: number;
  otherFailedOut: number;
  talkSec: number;
  avgTalkSec: number;
  medianTalkSec: number;
  connected: number;
  shortCalls: number;
  conversations: number;
  likelyDrops: number;
  confirmedDrops: number;
  qualityMeasured: number;
  poorQuality: number;
  failedDials: number;
  invalidNumbers: number;
  busyOut: number;
  missedReturnable: number;
  missedReturned: number;
  medianCallbackSec: number | null;
  smsSent: number;
  smsReceived: number;
  smsDelivered: number;
  smsFailed: number;
  smsRepliable: number;
  smsReplied: number;
  medianReplySec: number | null;
  mms: number;
  segments: number;
  threads: number;
  scheduledTotal: number;
  scheduledPending: number;
  scheduledSent: number;
  scheduledFailed: number;
  scheduledCanceled: number;
  campaigns: number;
  voicemails: number;
  voicemailsHeard: number;
  voicemailsCalledBack: number;
  medianListenSec: number | null;
  uniqueReached: number;
  newContacts: number;
  multiTouch: number;
  favoritesAdded: number;
  activeDays: number;
  firstCallMin: number | null;
  lastCallMin: number | null;
  billedMinutes: number;
  costVoice: number;
  costSms: number;
  cost: number;
}

export type PrevMetrics = Pick<
  PersonMetrics,
  | 'callsOut' | 'connected' | 'talkSec' | 'avgTalkSec' | 'shortCalls' | 'likelyDrops' | 'confirmedDrops'
  | 'callsIn' | 'answeredIn' | 'unansweredIn' | 'missedReturnable' | 'missedReturned'
  | 'smsSent' | 'smsReceived' | 'smsFailed' | 'smsReplied' | 'smsRepliable' | 'voicemails' | 'voicemailsHeard'
  | 'uniqueReached' | 'conversations' | 'cost'
>;

export interface PersonRow extends PersonMetrics {
  name: string;
  email: string;
  isActive: boolean;
  prev: PrevMetrics | null;
}

export interface DailyPoint {
  date: string;
  outbound: number;
  inbound: number;
  connected: number;
  answeredIn: number;
  talkSec: number;
  smsSent: number;
  smsReceived: number;
}

export interface ReportsPayload {
  range: { from: string; to: string; days: number; prevFrom: string; prevTo: string; tz: string };
  generatedAt: string;
  scope: { userId: number | null; isAdmin: boolean };
  users: Array<{ id: number; name: string; email: string; isActive: boolean }>;
  totals: PersonMetrics;
  prevTotals: PersonMetrics;
  people: PersonRow[];
  daily: DailyPoint[];
  /** [weekday 0=Mon..6=Sun][hour 0..23], Eastern time. */
  heatmap: number[][];
  callLength: Array<{ label: string; minSec: number; count: number }>;
  longestCalls: Array<{ userId: number; direction: string; lastFour: string; talkSec: number; startedAt: string }>;
  inbound: {
    total: number;
    answered: number;
    callerHungUp: number;
    rangOut: number;
    declined: number;
    blocked: number;
    other: number;
    wentToVoicemail: number;
    byHour: Array<{ hour: number; total: number; unanswered: number }>;
    repeatUnreached: Array<{ userId: number; number: string; attempts: number; lastAt: string }>;
  };
  outbound: {
    total: number;
    connected: number;
    noAnswer: number;
    busy: number;
    invalidNumber: number;
    rejected: number;
    failed: number;
  };
  quality: { endReasons: Array<{ reason: string; count: number }>; measuredCalls: number };
  sms: { failureReasons: Array<{ code: string; title: string; count: number }>; byHour: number[] };
  scheduledUpcoming: Array<{ id: number; userId: number; toNumber: string; scheduledFor: string; campaignId: number | null }>;
  campaigns: Array<{
    id: number; userId: number; createdAt: string; total: number; sent: number; failed: number;
    pending: number; canceled: number; skipped: number;
  }>;
  cost: {
    pricing: { inboundPerMin: number; outboundPerMin: number; perSms: number; didMonthly: number };
    voice: number;
    sms: number;
    lines: number;
    total: number;
    ownedLines: number;
    projectedMonthly: number;
    byLine: Array<{ lineId: number; userId: number | null; didNumber: string; label: string; calls: number; minutes: number; cost: number }>;
  };
  adoption: {
    latestVersion: string | null;
    versions: Array<{ version: string; users: number }>;
    platforms: Array<{ platform: string; users: number }>;
    features: Array<{ key: string; label: string; users: number }>;
    people: Array<{
      userId: number;
      appVersion: string | null;
      platform: string | null;
      lastSeenAt: string | null;
      lastLoginAt: string | null;
      onLatest: boolean;
      features: string[];
    }>;
  };
  /** Only present on one person's report. */
  callLog: CallLog | null;
  /** Only present on one person's report. Records only — never message text. */
  textLog: TextLog | null;
}

export interface TextLogEntry {
  at: string;
  direction: 'inbound' | 'outbound';
  number: string;
  name: string | null;
  status: 'received' | 'delivered' | 'failed' | 'sent';
  statusLabel: string;
  failReason: string | null;
  /** Billed parts (outbound only). */
  parts: number | null;
  hasMedia: boolean;
}

export interface TextThread {
  number: string;
  name: string | null;
  sent: number;
  received: number;
  failed: number;
  firstAt: string;
  lastAt: string;
  awaitingReply: boolean;
}

export interface TextLog {
  total: number;
  truncated: boolean;
  messages: TextLogEntry[];
  threads: TextThread[];
}

export interface CallLogEntry {
  startedAt: string;
  direction: 'inbound' | 'outbound';
  number: string;
  name: string | null;
  outcome: string;
  outcomeLabel: string;
  answered: boolean;
  talkSec: number;
  line: string | null;
}

export interface CallLogNumber {
  number: string;
  name: string | null;
  out: number;
  in: number;
  connected: number;
  unanswered: number;
  talkSec: number;
  lastAt: string;
}

export interface CallLog {
  total: number;
  truncated: boolean;
  calls: CallLogEntry[];
  numbers: CallLogNumber[];
  distinctNumbers: number;
}
