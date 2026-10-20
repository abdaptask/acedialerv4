// The `app.authenticate` hook every protected route runs.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EXTENSION_SCOPE, extensionMayCall } from './extensionAuth.js';

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorised' });
    return;
  }
  // A scoped token (the browser extension's) is closed everywhere except its
  // allowlist, so a route added tomorrow can't leak to it by default. Any
  // scope we don't recognise is refused outright.
  const scope = (request.user as { scope?: string } | undefined)?.scope;
  if (scope !== undefined && !(scope === EXTENSION_SCOPE && extensionMayCall(request.method, request.routeOptions.url))) {
    reply.code(403).send({ error: 'forbidden_for_token_scope' });
  }
}
