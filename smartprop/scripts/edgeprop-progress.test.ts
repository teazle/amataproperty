import { describe, expect, test } from 'bun:test';
import * as runtimeState from '../src/lib/scraper/runtime-state';

type ProgressWriter = (
  db: { from: (table: string) => { update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> } } },
  jobId: string,
  progress: {
    currentPage: number;
    totalPages: number;
    listingsProcessed: number;
    stats: Record<string, number>;
  },
) => Promise<void>;

const persistScraperJobProgress = (runtimeState as unknown as {
  persistScraperJobProgress: ProgressWriter;
}).persistScraperJobProgress;

function strictScraperJobsClient(error: unknown = null) {
  const writes: Array<{ values: Record<string, unknown>; id: string }> = [];
  const columns = new Set(['status', 'current_page', 'total_pages', 'listings_processed', 'stats']);

  return {
    writes,
    client: {
      from(table: string) {
        expect(table).toBe('scraper_jobs');
        return {
          update(values: Record<string, unknown>) {
            const unknownColumns = Object.keys(values).filter((column) => !columns.has(column));
            return {
              async eq(column: string, id: string) {
                expect(column).toBe('id');
                if (unknownColumns.length > 0) {
                  return { error: { message: `column ${unknownColumns[0]} does not exist` } };
                }
                writes.push({ values, id });
                return { error };
              },
            };
          },
        };
      },
    },
  };
}

describe('EdgeProp scraper progress persistence', () => {
  test('persists advancing progress using only scraper_jobs flat columns', async () => {
    const fixture = strictScraperJobsClient();

    await persistScraperJobProgress(fixture.client, 'edgeprop-job-1', {
      currentPage: 4,
      totalPages: 12,
      listingsProcessed: 23,
      stats: { totalSuccess: 18, totalSkippedNoPhone: 3, totalErrors: 2 },
    });

    expect(fixture.writes).toEqual([{
      id: 'edgeprop-job-1',
      values: {
        status: 'running',
        current_page: 4,
        total_pages: 12,
        listings_processed: 23,
        stats: { totalSuccess: 18, totalSkippedNoPhone: 3, totalErrors: 2 },
      },
    }]);
  });

  test('surfaces a returned database error instead of claiming progress was stored', async () => {
    const fixture = strictScraperJobsClient({ message: "Could not find the 'progress' column" });

    await expect(persistScraperJobProgress(fixture.client, 'edgeprop-job-2', {
      currentPage: 5,
      totalPages: 12,
      listingsProcessed: 28,
      stats: { totalSuccess: 22, totalSkippedNoPhone: 3, totalErrors: 3 },
    })).rejects.toThrow("Could not find the 'progress' column");
  });
});
