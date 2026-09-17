import { describe, expect, test } from 'bun:test';

import { createScraperWorkerShutdown } from '../src/lib/queue/scraper-worker-lifecycle';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function observeOutput(expected: string, getOutput: () => string) {
  const deadline = Date.now() + 2_000;
  while (!getOutput().includes(expected) && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(getOutput()).toContain(expected);
}

describe('scraper worker shutdown', () => {
  test('SIGINT waits for an active job before the owned subprocess exits', async () => {
    const child = Bun.spawn(['bun', 'scripts/fixtures/scraper-worker-signal-fixture.ts'], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = '';
    let reading = true;
    const consume = (async () => {
      while (reading) {
        const { done, value } = await reader.read();
        if (done) return;
        output += decoder.decode(value, { stream: true });
      }
    })();
    let exited = false;
    void child.exited.then(() => {
      exited = true;
    });

    try {
      await observeOutput('ready', () => output);
      child.kill('SIGINT');
      await observeOutput('offWork:scraper-jobs:main-worker:true', () => output);
      await observeOutput('offWork:scraper-jobs-dlq:dlq-worker:true', () => output);

      expect(output).not.toContain('stopBoss');
      expect(exited).toBe(false);

      child.kill('SIGINT');
      await Bun.sleep(25);
      expect(output.match(/offWork:scraper-jobs:main-worker:true/g)).toHaveLength(1);

      expect(await child.exited).toBe(0);
      expect(output).toContain('stopBoss');
    } finally {
      if (!exited) child.kill('SIGKILL');
      reading = false;
      await consume;
    }
  });

  test('stops both workers before waiting for active work and stopping Boss', async () => {
    const activeJob = deferred();
    const calls: string[] = [];
    const shutdown = createScraperWorkerShutdown({
      workers: [
        { name: 'scraper-jobs', id: 'main-worker' },
        { name: 'scraper-jobs-dlq', id: 'dlq-worker' },
      ],
      offWork: async (name, options) => {
        calls.push(`offWork:${name}:${options.id}:${options.wait}`);
        if (name === 'scraper-jobs') await activeJob.promise;
      },
      stopBoss: async () => {
        calls.push('stopBoss');
      },
    });

    const draining = shutdown();
    await Bun.sleep(10);

    expect(calls).toEqual([
      'offWork:scraper-jobs:main-worker:true',
      'offWork:scraper-jobs-dlq:dlq-worker:true',
    ]);

    activeJob.resolve();
    await draining;

    expect(calls).toEqual([
      'offWork:scraper-jobs:main-worker:true',
      'offWork:scraper-jobs-dlq:dlq-worker:true',
      'stopBoss',
    ]);
  });

  test('shares an in-progress drain across duplicate shutdown signals', async () => {
    const activeJob = deferred();
    let offWorkCalls = 0;
    const shutdown = createScraperWorkerShutdown({
      workers: [{ name: 'scraper-jobs', id: 'main-worker' }],
      offWork: async () => {
        offWorkCalls += 1;
        await activeJob.promise;
      },
      stopBoss: async () => {},
    });

    const first = shutdown();
    const second = shutdown();
    expect(second).toBe(first);
    expect(offWorkCalls).toBe(1);

    activeJob.resolve();
    await first;
  });

  test('does not stop Boss after a worker drain failure', async () => {
    let stopBossCalls = 0;
    const shutdown = createScraperWorkerShutdown({
      workers: [{ name: 'scraper-jobs', id: 'main-worker' }],
      offWork: async () => {
        throw new Error('worker drain failed');
      },
      stopBoss: async () => {
        stopBossCalls += 1;
      },
    });

    await expect(shutdown()).rejects.toThrow('worker drain failed');
    expect(stopBossCalls).toBe(0);
  });
});
