import { describe, expect, test } from 'bun:test';

async function runHeartbeatFixture(mode: 'success' | 'error' | 'overlap') {
  const fixture = `
    const { startHeartbeat } = await import('./src/lib/queue/scraper-worker.ts?heartbeat-test');
    const callbacks = new Map();
    const delays = [];
    const writes = [];
    const warnings = [];
    let nextId = 0;
    const scheduler = {
      setInterval(callback, delay) {
        const id = nextId++;
        callbacks.set(id, callback);
        delays.push(delay);
        return id;
      },
      clearInterval(id) {
        callbacks.delete(id);
      },
    };
    const error = ${mode === 'success' ? 'null' : "{ code: '42703', message: 'column missing' }"};
    let resolvePending;
    const pending = ${mode === 'overlap'}
      ? new Promise((resolve) => { resolvePending = () => resolve({ error }); })
      : null;
    const client = {
      from(table) {
        return {
          update(values) {
            return {
              eq(_column, id) {
                writes.push({ table, values, id });
                return pending ?? Promise.resolve({ error });
              },
            };
          },
        };
      },
    };
    const tick = async () => Promise.all([...callbacks.values()].map((callback) => callback()));
    const heartbeat = startHeartbeat('job-1', {
      client,
      scheduler,
      intervalMs: 25,
      now: () => new Date('2026-09-18T00:00:00.000Z'),
      warn: (...args) => warnings.push(args),
    });
    const firstTick = tick();
    const secondTick = ${mode === 'overlap'} ? tick() : null;
    const writesWhilePending = writes.length;
    if (resolvePending) resolvePending();
    await firstTick;
    if (secondTick) await secondTick;
    const writesAfterFirstTick = writes.length;
    await tick();
    const writesAfterSecondTick = writes.length;
    heartbeat.stop();
    await tick();
    console.log(JSON.stringify({ delays, writes, warnings, writesWhilePending, writesAfterFirstTick, writesAfterSecondTick }));
  `;
  const child = Bun.spawn(['bun', '--eval', fixture], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
      SUPABASE_SERVICE_ROLE: 'test-service-role',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(stderr).toBe('');
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as {
    delays: number[];
    writes: Array<{ table: string; values: Record<string, string>; id: string }>;
    warnings: unknown[][];
    writesWhilePending: number;
    writesAfterFirstTick: number;
    writesAfterSecondTick: number;
  };
}

describe('scraper worker heartbeat', () => {
  test('a timer tick persists the existing last-updated timestamp and stop clears the timer', async () => {
    const result = await runHeartbeatFixture('success');

    expect(result.delays).toEqual([25]);
    expect(result.writesAfterFirstTick).toBe(1);
    expect(result.writesAfterSecondTick).toBe(2);
    expect(result.writes).toEqual([
      {
        table: 'scraper_jobs',
        values: { last_updated_at: '2026-09-18T00:00:00.000Z' },
        id: 'job-1',
      },
      {
        table: 'scraper_jobs',
        values: { last_updated_at: '2026-09-18T00:00:00.000Z' },
        id: 'job-1',
      },
    ]);
  });

  test('a returned database error warns once and disables future heartbeat writes', async () => {
    const result = await runHeartbeatFixture('error');

    expect(result.writesAfterFirstTick).toBe(1);
    expect(result.writesAfterSecondTick).toBe(1);
    expect(result.warnings).toEqual([[
      '[ScraperWorker] Heartbeat failed',
      { code: '42703', message: 'column missing' },
    ]]);
  });

  test('overlapping ticks keep one pending write and warn once when it fails', async () => {
    const result = await runHeartbeatFixture('overlap');

    expect(result.writesWhilePending).toBe(1);
    expect(result.writesAfterFirstTick).toBe(1);
    expect(result.writesAfterSecondTick).toBe(1);
    expect(result.warnings).toEqual([[
      '[ScraperWorker] Heartbeat failed',
      { code: '42703', message: 'column missing' },
    ]]);
  });
});
