// pm2 process definitions for the three ACE Dialer Node services.
//
//   pm2 startOrReload ecosystem.config.cjs --update-env
//
// Secrets are NOT hardcoded here. This file reads the repo-root .env
// (untracked) at pm2 launch and injects those vars into each service's
// environment. The services themselves don't use dotenv — pm2 is the
// only thing that loads .env, so .env stays the single source of truth.

const fs = require('node:fs');
const path = require('node:path');

const REPO_DIR = __dirname;

// Minimal .env parser: KEY=VALUE per line, # comments skipped, surrounding
// quotes stripped. Splits on the FIRST '=' so values may contain '='.
function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const shared = loadEnv(path.join(REPO_DIR, '.env'));

// NODE_ENV=production for all services unless overridden in .env.
const base = { NODE_ENV: 'production', ...shared };

module.exports = {
  apps: [
    {
      name: 'ace-api',
      cwd: path.join(REPO_DIR, 'apps', 'api'),
      script: 'dist/main.js',
      env: { ...base, PORT: '3000' },
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: 'ace-webhooks',
      cwd: path.join(REPO_DIR, 'apps', 'webhooks'),
      script: 'dist/main.js',
      // Port 3002 matches the default in apps/webhooks/src/main.ts.
      env: { ...base, PORT: '3002' },
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: 'ace-socket',
      cwd: path.join(REPO_DIR, 'apps', 'socket'),
      script: 'dist/main.js',
      // Port 3001 matches the default in apps/socket/src/main.ts.
      env: { ...base, PORT: '3001' },
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
