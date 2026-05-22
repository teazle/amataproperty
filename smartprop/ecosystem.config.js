module.exports = {
  apps: [
    {
      name: 'smartprop',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      cwd: '/opt/smartprop/app/smartprop',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1',
      },
      error_file: '/opt/smartprop/logs/smartprop-error.log',
      out_file: '/opt/smartprop/logs/smartprop-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      watch: false,
      // Add restart controls to prevent infinite restart loops
      min_uptime: '30s',        // Process must run for at least 30s to be considered stable
      max_restarts: 15,          // Maximum 15 restarts within the restart window
      restart_delay: 10000,      // Wait 10 seconds between restarts
      exp_backoff_restart_delay: 100, // Exponential backoff starting at 100ms
    },
    {
      name: 'scraper-worker',
      script: 'bun',
      args: 'src/lib/queue/scraper-worker.ts',
      interpreter: 'none',
      cwd: '/opt/smartprop/app/smartprop',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PATH: `${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
      },
      // Note: Environment variables are loaded from .env.local by the worker code itself
      error_file: '/opt/smartprop/logs/scraper-worker-error.log',
      out_file: '/opt/smartprop/logs/scraper-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '2G',
      watch: false,
      // Add restart delay to prevent rapid restart loops
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
