import { describe, expect, test } from 'bun:test';

import {
  ScraperProcessExitError,
  buildScraperChildEnvironment,
  buildScheduledEnqueueTelemetry,
  cleanEdgePropPropertyTitle,
  settleScraperJobOutcome,
} from '../src/lib/queue/scraper-outcome';

function fakeDependencies(options: {
  run?: () => Promise<void>;
  read?: () => Promise<{
    status: string;
    listingsProcessed?: number | null;
    stats?: Record<string, unknown> | null;
    errorMessage?: string | null;
  }>;
  fail?: (message: string) => Promise<void>;
} = {}) {
  const failed: string[] = [];
  return {
    failed,
    dependencies: {
      run: options.run ?? (async () => {}),
      read: options.read ?? (async () => ({ status: 'completed', listingsProcessed: 1 })),
      markFailed: async (message: string) => {
        failed.push(message);
        await options.fail?.(message);
      },
    },
  };
}

describe('scraper job outcome contract', () => {
  test('rejects exit 0 when the child persisted a failed state without overwriting it', async () => {
    const fake = fakeDependencies({
      read: async () => ({ status: 'failed', listingsProcessed: 0, errorMessage: 'authentication rejected' }),
    });

    await expect(settleScraperJobOutcome(fake.dependencies)).rejects.toThrow('persisted failed');
    expect(fake.failed).toEqual([]);
  });

  test('rejects a zero-output completed child and marks the business job failed', async () => {
    const fake = fakeDependencies({
      read: async () => ({ status: 'completed', listingsProcessed: 0, stats: { totalSuccess: 0 } }),
    });

    await expect(settleScraperJobOutcome(fake.dependencies)).rejects.toThrow('no confirmed output');
    expect(fake.failed).toHaveLength(1);
  });

  test('acknowledges a completed child only when persisted output is positive', async () => {
    const fake = fakeDependencies({
      read: async () => ({ status: 'completed', listingsProcessed: 2, stats: { totalSuccess: 1 } }),
    });

    await expect(settleScraperJobOutcome(fake.dependencies)).resolves.toEqual({ acknowledged: true, status: 'completed' });
    expect(fake.failed).toEqual([]);
  });

  test('acknowledges exit 78 only after recording the operator-action failure', async () => {
    const fake = fakeDependencies({
      run: async () => {
        throw new ScraperProcessExitError(78, 'PropertyGuru authentication requires operator action');
      },
    });

    await expect(settleScraperJobOutcome(fake.dependencies)).resolves.toEqual({ acknowledged: true, status: 'failed' });
    expect(fake.failed).toEqual(['Operator action required: PropertyGuru authentication requires operator action']);
  });

  test('throws transient child errors so pg-boss can retry them', async () => {
    const transient = new Error('browser crashed');
    const fake = fakeDependencies({ run: async () => { throw transient; } });

    await expect(settleScraperJobOutcome(fake.dependencies)).rejects.toBe(transient);
    expect(fake.failed).toEqual(['browser crashed']);
  });

  test('does not acknowledge an outcome when querying or recording it fails', async () => {
    const queryFailure = fakeDependencies({ read: async () => { throw new Error('read unavailable'); } });
    await expect(settleScraperJobOutcome(queryFailure.dependencies)).rejects.toThrow('read unavailable');

    const updateFailure = fakeDependencies({
      read: async () => ({ status: 'completed', listingsProcessed: 0 }),
      fail: async () => { throw new Error('write unavailable'); },
    });
    await expect(settleScraperJobOutcome(updateFailure.dependencies)).rejects.toThrow('write unavailable');
  });

  test('forwards configured PropertyGuru price limits to the child environment', () => {
    const env = buildScraperChildEnvironment('propertyguru', {
      district: 'D09',
      pages: 3,
      minPrice: 1_250_000,
      maxPrice: 2_750_000,
    }, 'job-9', {});

    expect(env.PG_DISTRICTS).toBe('09');
    expect(env.PG_MIN_PRICE).toBe('1250000');
    expect(env.PG_MAX_PRICE).toBe('2750000');
  });

  test('labels a schedule enqueue as pending instead of scraper success', () => {
    expect(buildScheduledEnqueueTelemetry(2)).toEqual({
      lastRunStatus: null,
      lastError: 'Enqueued 2 scraper jobs; completion pending in scraper job history.',
    });
  });

  test('removes EdgeProp rental-volume widgets without stripping a legitimate title', () => {
    expect(cleanEdgePropPropertyTitle('PARK COLONIAL Rental Volume 41%')).toBe('PARK COLONIAL');
    expect(cleanEdgePropPropertyTitle('THE SAIL @ MARINA BAY Rental Volume: 1,159 transactions')).toBe('THE SAIL @ MARINA BAY');
    expect(cleanEdgePropPropertyTitle('THE RENTAL VOLUME')).toBe('THE RENTAL VOLUME');
  });
});
