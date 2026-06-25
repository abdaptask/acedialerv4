// OAuth 2.0 + PKCE helpers for the Microsoft Entra ID sign-in flow.
//
// PKCE (Proof Key for Code Exchange) lets a public client (web app, Electron
// app, native app) safely use the Authorization Code flow without holding
// a long-lived secret. The client generates a random "code verifier" on the
// sign-in page, hashes it to produce a "code challenge", sends the challenge
// to Microsoft along with the auth request, then sends the verifier with
// the code exchange. Microsoft confirms hash(verifier) == challenge.
//
// The verifier and state are stored in sessionStorage between the redirect
// to Microsoft and the redirect back. They're cleared after the callback
// page reads them.

const STATE_KEY = 'ace_ms_oauth_state';
const VERIFIER_KEY = 'ace_ms_oauth_verifier';

// Generate cryptographically random bytes and return them base64url-encoded
// without padding (the OAuth 2.0 PKCE spec requires URL-safe characters).
function randomBase64Url(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

function base64UrlEncode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest('SHA-256', data);
}

// Generate a fresh state + PKCE verifier/challenge pair and stash them in
// sessionStorage so the callback page can verify state and submit the
// verifier. Returns the values the caller needs to build the auth URL.
export async function startOAuthFlow(): Promise<{
  state: string;
  codeChallenge: string;
}> {
  // 32 bytes of entropy → 43-character base64url string (within PKCE spec).
  const state = randomBase64Url(16);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);

  return { state, codeChallenge };
}

// Read and clear the stashed state + verifier. The callback page calls this
// after verifying the `state` URL param matches the stashed state — that
// proves the callback came from the same browser tab that started the flow
// (CSRF protection).
export function consumeOAuthState(): {
  state: string | null;
  codeVerifier: string | null;
} {
  const state = sessionStorage.getItem(STATE_KEY);
  const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  return { state, codeVerifier };
}

// Build the Microsoft authorize URL. The web app navigates the browser
// here; Microsoft handles the login (with MFA / Conditional Access policies
// the tenant has configured) and redirects back to redirectUri with
// ?code=...&state=...
export function buildMicrosoftAuthUrl(args: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    // Force the account picker. This is a shared softphone often used on
    // machines where another ApTask employee is already signed into Microsoft;
    // without this, Microsoft silently reuses the cached session and the wrong
    // user gets logged in (with no way to switch). select_account always shows
    // the chooser so the operator picks their own identity.
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${args.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

// ── Phase 7: Electron-aware redirect URI selection ──
//
// Web browsers redirect to our own /auth/microsoft/callback page.
// Electron uses the custom ace-dialer:// protocol so the OS launches our
// app instead of trying to load the URL inside a webview. Whichever URI
// we use during /authorize MUST match what we send to /token in the
// exchange step — Microsoft validates them as a pair.
export function isElectron(): boolean {
  return Boolean((globalThis as { ace?: { isElectron?: boolean } }).ace?.isElectron);
}

export function getRedirectUri(): string {
  if (isElectron()) return 'ace-dialer://auth/callback';
  return `${window.location.origin}/auth/microsoft/callback`;
}
