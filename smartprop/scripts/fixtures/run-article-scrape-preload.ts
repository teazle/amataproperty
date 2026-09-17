import { mock } from 'bun:test';
import { writeFileSync } from 'node:fs';

const mode = process.env.ARTICLE_CLI_FIXTURE_MODE;

const supabaseChain = {
  from: () => supabaseChain,
  update: () => supabaseChain,
  eq: () => supabaseChain,
  lt: () => supabaseChain,
  select: async () => ({ data: [], error: null }),
};

mock.module('@supabase/supabase-js', () => ({
  createClient: () => supabaseChain,
}));

export const createScrapeSession = async () => 'fixture-session';
export const completeScrapeSession = async (_sessionId: string, status: string) => {
  await Promise.resolve();
  writeFileSync('fixture-session.json', JSON.stringify({ status }));
  console.log(`[fixture] complete:${status}`);
};

export const parseArticleContentBackfillLimit = (value: string | undefined) => Number.parseInt(value || '4', 10);
export const backfillMissingArticleContent = async () => {
  if (mode === 'error') throw new Error('fixture backfill failure');
  setInterval(() => {}, 60_000);
  return { attempted: 4, saved: 2, failed: 2 };
};

export const scrapeEdgeProp = async () => {
  await Promise.resolve();
  writeFileSync('fixture-scraper.json', 'completed');
  return [];
};
