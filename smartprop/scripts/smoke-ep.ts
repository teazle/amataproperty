import { spawn } from 'child_process';

const child = spawn('bun', ['src/workers/ep.live.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    HEADLESS: process.env.HEADLESS || 'true',
    EP_MAX_PAGES: process.env.EP_MAX_PAGES || '1',
    EP_MAX_LISTINGS: process.env.EP_MAX_LISTINGS || '1',
    SCRAPER_DRY_RUN: '1',
    SCRAPER_SMOKE_TEST: '1',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
