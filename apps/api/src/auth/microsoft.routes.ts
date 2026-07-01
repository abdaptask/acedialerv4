// Microsoft Entra ID SSO routes.
//
// Implements OAuth 2.0 Authorization Code flow with PKCE via @azure/msal-node.
// The web app drives the OAuth dance client-side; this backend only handles
// the secret-bearing code-exchange step.
//
// Flow (web app):
//   1. User clicks "Sign in with Microsoft"
//   2. Web app generates state + PKCE verifier, redirects to Microsoft's
//      authorize endpoint with redirect_uri = the web app's own
//      /auth/microsoft/callback page.
//   3. Microsoft redirects back to that page with ?code=...&state=...
//   4. Web app verifies state, POSTs { code, redirectUri, codeVerifier } to
//      this endpoint.
//   5. We exchange the code for tokens (MSAL validates the id_token
//      signature against Microsoft's JWKS for us), extract email + oid,
//      look the user up in Postgres, mint our own JWT, return it.
//
// Auto-provision is OFF: SSO users must be invited by an admin first.
// A user who signs in but doesn't exist in our DB gets a 403 with a clear
// "ask your admin" message — they are NOT silently auto-created.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConfidentialClientApplication, PublicClientApplication } from '@azure/msal-node';
import { prisma } from '@ace/db';
import { config, isProtectedAdmin } from '../config.js';

const ExchangeSchema = z.object({
  code: z.string().min(1),
  // Allow https:// (web) AND custom schemes like ace-dialer:// (Electron).
  redirectUri: z.string().min(1).refine(
    (v) => /^(https?|[a-z][a-z0-9+.-]*):\/\//i.test(v),
    { message: 'redirectUri must be an absolute URL with a scheme' },
  ),
  // PKCE verifier. Strongly recommended (web app must send it); MSAL allows
  // omission for backward-compat but we'll require it once the web side is
  // wired. For now mark optional so the route doesn't reject early.
  codeVerifier: z.string().optional(),
});

type AnyMsalClient = ConfidentialClientApplication | PublicClientApplication;

/** Picks the right MSAL client based on the redirect URI.
 *
 * Azure registers redirect URIs under platforms:
 *   - "Web" platform (https URLs) → confidential client, sends client_secret
 *   - "Mobile and desktop" platform (custom schemes like ace-dialer://) →
 *     public client, PKCE-only, NO client_secret allowed
 *
 * Sending a client_secret for a custom-scheme redirect URI registered as
 * public causes Microsoft to return AADSTS9002326 / AADSTS7000218 errors.
 * Branch here so each flow uses the right client class. */
function getMsalClient(redirectUri: string): AnyMsalClient | null {
  if (!config.msClientId || !config.msTenantId) return null;
  const authority = `https://login.microsoftonline.com/${config.msTenantId}`;
  // Custom URL schemes (ace-dialer://) → public client.
  if (!/^https?:\/\//i.test(redirectUri)) {
    return new PublicClientApplication({
      auth: { clientId: config.msClientId, authority },
    });
  }
  // https:// redirect → confidential client. Requires the secret.
  if (!config.msClientSecret) return null;
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.msClientId,
      authority,
      clientSecret: config.msClientSecret,
    },
  });
}

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

interface IdTokenClaims {
  oid?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
}

export async function microsoftAuthRoutes(app: FastifyInstance) {
  // POST /auth/microsoft/exchange — trade the OAuth auth code for our JWT.
  app.post('/auth/microsoft/exchange', async (request, reply) => {
    const parsed = ExchangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }
    const { code, redirectUri, codeVerifier } = parsed.data;

    // Pick the right MSAL client class based on whether this is a web
    // (https) redirect or an Electron custom-scheme (ace-dialer://) redirect.
    const msal = getMsalClient(redirectUri);
    if (!msal) {
      return reply.code(501).send({
        error: 'sso_not_configured',
        message: 'Microsoft SSO is not configured on this server. Contact admin.',
      });
    }

    let tokenResp;
    try {
      tokenResp = await msal.acquireTokenByCode({
        code,
        scopes: ['openid', 'profile', 'email', 'User.Read'],
        redirectUri,
        codeVerifier,
      });
    } catch (e) {
      app.log.warn({ err: e }, '[ms-sso] token exchange failed');
      return reply.code(401).send({
        error: 'token_exchange_failed',
        detail: e instanceof Error ? e.message : 'unknown',
      });
    }

    if (!tokenResp || !tokenResp.idTokenClaims) {
      return reply.code(401).send({ error: 'no_id_token' });
    }

    const claims = tokenResp.idTokenClaims as IdTokenClaims;
    const email = (claims.preferred_username ?? claims.email ?? '').toLowerCase();
    const oid = claims.oid ?? '';
    const fullName = claims.name ?? '';

    if (!email || !oid) {
      return reply.code(401).send({
        error: 'missing_claims',
        need: ['oid', 'preferred_username|email'],
      });
    }

    // Look the user up. Prefer azureOid (immutable) over email (can be
    // renamed by Microsoft tenant admins).
    let user = await prisma.user.findFirst({
      where: { OR: [{ azureOid: oid }, { email }] },
    });

    // Auto-provision is OFF — require admin invitation first.
    if (!user) {
      app.log.info({ email, oid }, '[ms-sso] unknown user attempted SSO');
      return reply.code(403).send({
        error: 'not_invited',
        message: 'Your account has not been provisioned. Ask your admin to invite you.',
      });
    }

    // Protected super-admins can never lose admin or be locked out. Force-heal
    // their flags BEFORE the isActive gate below, so a stray demotion/deactivation
    // (or direct-DB drift) is self-corrected on their next sign-in rather than
    // locking them out. Can only grant — never removes anyone's access.
    if (isProtectedAdmin(user.email) && (!user.isAdmin || !user.isActive)) {
      app.log.warn(
        { email: user.email, wasAdmin: user.isAdmin, wasActive: user.isActive },
        '[ms-sso] restoring protected super-admin flags',
      );
      user = await prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: true, isActive: true },
      });
    }

    if (!user.isActive) {
      return reply.code(403).send({
        error: 'account_disabled',
        message: 'Your account has been deactivated. Contact your admin.',
      });
    }

    // First-time SSO for an existing local user: link their azureOid so
    // future logins match on the immutable id. Backfill firstName/lastName
    // from Microsoft's profile if we don't have them yet.
    if (!user.azureOid) {
      const nameParts = fullName.split(' ');
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          azureOid: oid,
          provider: 'microsoft',
          lastLoginAt: new Date(),
          firstName: user.firstName ?? nameParts[0] ?? null,
          lastName: user.lastName ?? nameParts.slice(1).join(' ') ?? null,
        },
      });
      // Audit-log the binding so we can trace which dialer account got
      // wired up to which Entra ID identity.
      await prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          targetUserId: user.id,
          action: 'user.sso_first_signin',
          metadata: { email, oid, name: fullName },
        },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    }

    // Mint our JWT — identical shape to /auth/login so the rest of the API
    // is auth-source-agnostic.
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    };
    const token = await reply.jwtSign(payload);

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: user.isAdmin,
        sipUsername: user.sipUsername,
        sipPassword: user.sipPassword,
        didNumber: user.didNumber,
      },
    });
  });

  // GET /auth/microsoft/config — small public helper so the web client can
  // discover the tenant + client ID without requiring a fresh build for
  // every value change. NEVER returns the client secret.
  app.get('/auth/microsoft/config', async () => {
    return {
      clientId: config.msClientId || null,
      tenantId: config.msTenantId || null,
      enabled: Boolean(config.msClientId && config.msTenantId && config.msClientSecret),
    };
  });
}
