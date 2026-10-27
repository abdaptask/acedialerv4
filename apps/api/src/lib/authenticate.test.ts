// Token-scope enforcement, through a real Fastify + @fastify/jwt instance.
//
// Run: npm run test -w apps/api

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { authenticate } from './authenticate.js';

async function server() {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', authenticate);
  const ok = async () => ({ ok: true });
  app.get('/me/follow-ups', { onRequest: [app.authenticate] }, ok);
  app.get('/me/follow-ups/count', { onRequest: [app.authenticate] }, ok);
  app.post('/me/follow-ups/done', { onRequest: [app.authenticate] }, ok);
  app.delete('/me/follow-ups/done', { onRequest: [app.authenticate] }, ok);
  app.get('/auth/me', { onRequest: [app.authenticate] }, ok);
  app.post('/messages', { onRequest: [app.authenticate] }, ok);
  app.get('/reports/follow-ups', { onRequest: [app.authenticate] }, ok);
  await app.ready();
  return app;
}

test('a full token reaches everything, a scoped one only its allowlist', async () => {
  const app = await server();
  const full = app.jwt.sign({ sub: 1, email: 'a@x', isAdmin: true });
  const ext = app.jwt.sign({ sub: 1, email: 'a@x', isAdmin: false, scope: 'ext' });
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` } }).then((r) => r.statusCode);

  for (const [m, u] of [['GET', '/me/follow-ups'], ['GET', '/auth/me'], ['POST', '/messages']] as const) {
    assert.equal(await call(m, u, full), 200, `full ${m} ${u}`);
  }
  assert.equal(await call('GET', '/me/follow-ups', ext), 200);
  assert.equal(await call('GET', '/me/follow-ups/count', ext), 200);
  assert.equal(await call('POST', '/me/follow-ups/done', ext), 200);
  assert.equal(await call('DELETE', '/me/follow-ups/done', ext), 200);
  assert.equal(await call('GET', '/auth/me', ext), 403);
  assert.equal(await call('POST', '/messages', ext), 403);
  assert.equal(await call('GET', '/reports/follow-ups', ext), 403);
  await app.close();
});

test('an unknown scope is refused everywhere, and no token is still a 401', async () => {
  const app = await server();
  const odd = app.jwt.sign({ sub: 1, email: 'a@x', isAdmin: false, scope: 'admin' });
  const r = await app.inject({ method: 'GET', url: '/me/follow-ups', headers: { authorization: `Bearer ${odd}` } });
  assert.equal(r.statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/me/follow-ups' })).statusCode, 401);
  await app.close();
});
