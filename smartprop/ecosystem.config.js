module.exports = {
  apps: [
    {
      name: 'smartprop',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/opt/smartprop/app/smartprop',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/opt/smartprop/logs/smartprop-error.log',
      out_file: '/opt/smartprop/logs/smartprop-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      watch: false,
    },
    {
      name: 'scraper-worker',
      script: 'bun',
      args: 'src/lib/queue/scraper-worker.ts',
      cwd: '/opt/smartprop/app/smartprop',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PATH: `${process.env.HOME || '/home/ec2-user'}/.bun/bin:${process.env.PATH}`,
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

