// Centralised env-var loading. Missing required vars cause a fast failure
// on boot rather than a confusing runtime crash later.

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),
  logLevel: optional('LOG_LEVEL', 'info'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '24h'),
  allowedOrigins: optional('ALLOWED_ORIGINS', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Telnyx server-side API
  telnyxApiKey: optional('TELNYX_API_KEY'),
  telnyxMessagingProfileId: optional('TELNYX_MESSAGING_PROFILE_ID'),
  // Call Control Application "connection_id" — needed to originate calls via
  // POST /v2/calls. Look this up in the Telnyx portal under Voice → Programmable
  // Voice → Call Control Apps → <your app> → API ID.
  telnyxCcConnectionId: optional('TELNYX_CC_CONNECTION_ID'),
  // ACE's call-event webhook endpoint. Used by:
  //   • createCredentialConnection (new connections route events here)
  //   • patchConnectionWebhook (the "repoint webhook" toggle in the invite
  //     modal flips Pulse user connections from pulse-old.aptask.com → here)
  // Default matches the URL on the existing `ace-dialer` Credential
  // Connection in Telnyx. Override in the repo-root `.env` on the host.
  telnyxWebhookUrl: optional(
    'TELNYX_WEBHOOK_URL',
    'https://dialer.aptask.com/webhooks/telnyx/calls',
  ),

  // v0.9.7 — Template Credential Connection used to clone settings (outbound
  // voice profile, channel limits, codecs, anchorsite, etc.) onto every NEW
  // connection we create during the invite flow. The "currently-working" DID
  // is +17322001305 (Abdulla's number); its credential connection has the
  // proven-good config. Either set the DID and we look up its connection_id,
  // or set TELNYX_TEMPLATE_CONNECTION_ID directly to skip the lookup.
  telnyxTemplateConnectionDid: optional('TELNYX_TEMPLATE_CONNECTION_DID', '+17322001305'),
  telnyxTemplateConnectionId: optional('TELNYX_TEMPLATE_CONNECTION_ID'),

  // v0.10.100 — Telnyx Voice API Application ID for the "ACE Voicemail"
  // app (created in Mission Control → Voice API Applications). Used by
  // the admin migration endpoint (POST /admin/users/:id/migrate-voicemail)
  // to re-bind a user's DIDs from their SIP credential to this app, so
  // inbound calls flow through our /webhooks/telnyx/voicemail-cc handler
  // (ring softphone → fall to custom voicemail on no-answer).
  // Find the ID in Mission Control: Voice → Voice API Apps → ACE Voicemail
  // → Application ID at the top of the Details tab.
  telnyxVoicemailCcAppId: optional('TELNYX_VOICEMAIL_CC_APP_ID'),

  // Supabase Storage (for MMS uploads)
  supabaseUrl: optional('SUPABASE_URL'),
  supabaseServiceKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseMediaBucket: optional('SUPABASE_MEDIA_BUCKET', 'ace-media'),

  // JobDiva (Phase 5.5 — contact lookup)
  jobDivaBaseUrl: optional('JOBDIVA_BASE_URL'),
  jobDivaUsername: optional('JOBDIVA_USERNAME'),
  jobDivaPassword: optional('JOBDIVA_PASSWORD'),
  jobDivaClientId: optional('JOBDIVA_CLIENT_ID'),

  // Microsoft Entra ID SSO (Phase 7 — replacing email/password login).
  // - msClientId / msTenantId come from the App Registration in Azure Portal.
  // - msClientSecret is the "Value" of the client secret (NOT the Secret ID).
  // All three are required for /auth/microsoft/exchange to work; the route
  // returns 501 if any are missing.
  msClientId: optional('MS_CLIENT_ID'),
  msTenantId: optional('MS_TENANT_ID'),
  msClientSecret: optional('MS_CLIENT_SECRET'),

  // SendGrid — welcome emails for newly-invited users (Phase 8, Pulse→ACE).
  // - sendGridApiKey: "SG.xxxxxxxx..." from app.sendgrid.com → Settings → API Keys.
  //   Scope just "Mail Send" (don't grant broader perms).
  // - sendGridFromEmail: the verified sender. Must already be authenticated in
  //   SendGrid (Settings → Sender Authentication) or SendGrid will reject the
  //   send with a 403.
  // - sendGridFromName: display name shown in the recipient's inbox.
  // - aceSupportEmail: shown in the welcome email body ("Reply or contact <X>
  //   for help"). Defaults to the same as FROM but can be a real human inbox.
  sendGridApiKey: optional('SENDGRID_API_KEY'),
  sendGridFromEmail: optional('SENDGRID_FROM_EMAIL', 'noreply@aptask.com'),
  sendGridFromName: optional('SENDGRID_FROM_NAME', 'ACE Dialer'),
  aceSupportEmail: optional('ACE_SUPPORT_EMAIL', 'it@aptask.com'),

  // v0.9.13 — Cloudflare TURN failover for WebRTC audio when Telnyx TURN
  // can't reach a behind-NAT user. To enable:
  //   1. Sign in at dash.cloudflare.com → Calls → TURN
  //   2. Create a TURN application; copy the Key ID + API Token
  //   3. Set both env vars in the repo-root `.env` on the host, then `pm2 restart ace-api`
  // When unset, GET /turn-credentials returns an empty list and the client
  // falls back to Telnyx-TURN-only (which handles ~95% of NAT cases anyway).
  cloudflareTurnKeyId: optional('CLOUDFLARE_TURN_KEY_ID'),
  cloudflareTurnApiToken: optional('CLOUDFLARE_TURN_API_TOKEN'),

  // v0.10.216 — Deepgram, for voice-to-text SMS composition.
  //
  // Same key and same account the webhooks service already uses for
  // voicemail transcription (apps/webhooks/src/deepgram.ts) — this feature
  // adds no new vendor. When unset, POST /me/sms/transcribe returns 501 and
  // the composer hides its microphone button, so an unconfigured
  // environment degrades to "type it yourself" rather than erroring.
  deepgramApiKey: optional('DEEPGRAM_API_KEY'),

  // v0.10.216 — LLM for "Rewrite with AI" in the SMS composer.
  //
  // Runs on our OWN hardware by default: Qwen via Ollama on the DGX
  // (172.16.219.222:11434), reachable from this host in ~13ms with no VPN or
  // tunnel. No per-token cost, and no draft text ever leaves ApTask's network.
  //
  //   LLM_PROVIDER  'ollama' (default) | 'anthropic' | 'off'
  //   LLM_BASE_URL  Ollama root URL — NOT the /v1 path (see lib/llm.ts for
  //                 why the OpenAI-compatible endpoint is unusable here)
  //   LLM_MODEL     qwen3.5:9b is the measured best quality/latency trade
  //                 (~1.1s warm). qwen3:8b-nothink is faster but edits more
  //                 timidly. NB the internal migration guide's `qwen3:32b`
  //                 DOES NOT EXIST on the box — verify with
  //                 `curl http://172.16.219.222:11434/api/tags`.
  //   LLM_KEEP_ALIVE  How long Ollama holds the model in VRAM. A cold load
  //                 was measured at ~47s, so keeping it resident matters.
  //
  // Kill switch: set LLM_PROVIDER=off + `pm2 restart ace-api` and
  // POST /me/sms/rewrite returns 501 within seconds, with the composer hiding
  // its Rewrite button. No deploy needed.
  //
  // Privacy contract enforced in lib/smsRewrite.ts: the request carries the
  // draft text ONLY — no thread history, no contact name or number, no user
  // id, no account metadata — and neither the input nor the output is
  // logged or persisted anywhere.
  llmProvider: optional('LLM_PROVIDER', 'ollama'),
  llmBaseUrl: optional('LLM_BASE_URL', 'http://172.16.219.222:11434'),
  llmModel: optional('LLM_MODEL', 'qwen3.5:9b'),
  llmKeepAlive: optional('LLM_KEEP_ALIVE', '30m'),

  // Dormant fallback. ONLY used when LLM_PROVIDER=anthropic is set
  // explicitly, so a stray key in the environment can never start billing on
  // its own. Exists so a DGX outage is a one-env-var switch, not a deploy.
  anthropicApiKey: optional('ANTHROPIC_API_KEY'),
  anthropicModel: optional('ANTHROPIC_MODEL', 'claude-haiku-4-5'),

  // Protected super-admins. These emails can NEVER lose admin access:
  //   - On every login (SSO or local password) their is_admin + is_active are
  //     force-set true, so any accidental demotion / direct-DB drift / stale
  //     flag self-heals on their next sign-in.
  //   - The admin panel refuses to demote or deactivate them.
  // Comma-separated, case-insensitive. Defaults to the four founding admins so
  // the guarantee holds even if the env var is never set.
  protectedAdminEmails: optional(
    'PROTECTED_ADMIN_EMAILS',
    'abdulla@aptask.com,nileshd@aptask.com,ravindra@aptask.com,brijeshb@aptask.com',
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

/** True if `email` is a protected super-admin (see config.protectedAdminEmails). */
export function isProtectedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return config.protectedAdminEmails.includes(email.trim().toLowerCase());
}
