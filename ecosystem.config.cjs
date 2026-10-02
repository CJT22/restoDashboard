/**
 * PM2 ecosystem for restoDashboard.
 * - resto-dashboard-api: Express backend (server/index.ts via tsx) on port 3510
 * - resto-dashboard:     Vite frontend on port 3520, proxies /api -> 3510
 *   (package.json's `dev` uses 3500, but marketadmin-dashboard already owns it)
 *
 * Start both:      pm2 start ecosystem.config.cjs
 * Start API only:  pm2 start ecosystem.config.cjs --only resto-dashboard-api
 */
module.exports = {
  apps: [
    {
      name: 'resto-dashboard-api',
      cwd: __dirname,
      script: 'node_modules/.bin/tsx',
      args: 'server/index.ts',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3510,
        ADMIN_API_BASE_URL: 'http://localhost:2000',
        ADMIN_BRANCH_ID: 3,
        NO_PROXY: '127.0.0.1,::1,localhost',
        no_proxy: '127.0.0.1,::1,localhost',
      },
      out_file: './logs/api-out.log',
      error_file: './logs/api-err.log',
    },
    {
      name: 'resto-dashboard',
      cwd: __dirname,
      script: 'node_modules/.bin/vite',
      args: '--port 3520 --strictPort --host 0.0.0.0',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      out_file: './logs/out.log',
      error_file: './logs/err.log',
    },
  ],
};
