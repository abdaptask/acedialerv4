// pm2 process file for the local full-stack deployment behind
// dialer.aptask.com (nginx on this host + reverse proxy on 192.168.1.95).
// Env comes from the repo-root .env via Node 20's --env-file flag.
const ENV_FILE = `${__dirname}/.env`;

module.exports = {
  apps: [
    {
      name: 'ace-api',
      script: 'apps/api/dist/main.js',
      cwd: __dirname,
      node_args: `--env-file=${ENV_FILE}`,
      env: { PORT: 3000, NODE_ENV: 'production' },
    },
    {
      name: 'ace-socket',
      script: 'apps/socket/dist/main.js',
      cwd: __dirname,
      node_args: `--env-file=${ENV_FILE}`,
      env: { PORT: 3001, NODE_ENV: 'production' },
    },
    {
      name: 'ace-webhooks',
      script: 'apps/webhooks/dist/main.js',
      cwd: __dirname,
      node_args: `--env-file=${ENV_FILE}`,
      env: { PORT: 3002, NODE_ENV: 'production' },
    },
    {
      // Web frontend — pm2's built-in static server (SPA mode), same
      // pattern as agents.aptask.com (frontend on its own port, the
      // reverse proxy on 192.168.1.95 points straight at it).
      name: 'ace-web',
      script: 'serve',
      env: {
        PM2_SERVE_PATH: `${__dirname}/apps/web/dist`,
        PM2_SERVE_PORT: 3010,
        PM2_SERVE_SPA: 'true',
      },
    },
  ],
};
