import { spawn } from 'child_process';

const child = spawn('bun', ['src/workers/pg.districts.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    HEADLESS: process.env.HEADLESS || 'true',
    PG_DISTRICTS: process.env.PG_DISTRICTS || '09',
    PG_MAX_PAGES: process.env.PG_MAX_PAGES || '1',
    PG_MAX_LISTINGS: process.env.PG_MAX_LISTINGS || '1',
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
