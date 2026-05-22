import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: path.resolve(process.cwd(), '.env'), override: false });
config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

const lockPath = path.join(process.cwd(), 'storage', 'article-scraper.lock');
const maxPages = Number.parseInt(process.env.ARTICLE_SCRAPE_PAGES || process.argv[2] || '1', 10);
const maxArticlesArg = process.env.ARTICLE_SCRAPE_MAX_ARTICLES || process.argv[3] || '5';
const maxArticles = maxArticlesArg === 'all' ? undefined : Number.parseInt(maxArticlesArg, 10);
const staleSessionHours = Number.parseInt(process.env.ARTICLE_STALE_SESSION_HOURS || '2', 10);
const scrapeMethod = process.env.ARTICLE_SCRAPE_METHOD || 'metadata';

function ensureEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(raw) as { pid?: number; startedAt?: string };
    const ageMs = lock.startedAt ? Date.now() - Date.parse(lock.startedAt) : 0;

    if (lock.pid && isProcessRunning(lock.pid) && ageMs < 2 * 60 * 60 * 1000) {
      throw new Error(`article scraper already running with pid ${lock.pid}`);
    }

    fs.unlinkSync(lockPath);
  }

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
  );
}

function releaseLock() {
  if (!fs.existsSync(lockPath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(raw) as { pid?: number };
    if (lock.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    fs.unlinkSync(lockPath);
  }
}

async function cleanupStaleSessions() {
  const supabase = createClient(
    ensureEnv('NEXT_PUBLIC_SUPABASE_URL'),
    ensureEnv('SUPABASE_SERVICE_ROLE'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const cutoff = new Date(Date.now() - staleSessionHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('scrape_sessions')
    .update({
      status: 'stopped',
      completed_at: new Date().toISOString(),
      error_message: `stale running session auto-stopped after ${staleSessionHours}h`,
    })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id');

  if (error) {
    throw error;
  }

  if (data?.length) {
    console.log(`[articles] cleaned ${data.length} stale running session(s)`);
  }
}

async function main() {
  if (!Number.isFinite(maxPages) || maxPages < 1) {
    throw new Error('ARTICLE_SCRAPE_PAGES must be a positive number');
  }

  if (maxArticles !== undefined && (!Number.isFinite(maxArticles) || maxArticles < 1)) {
    throw new Error('ARTICLE_SCRAPE_MAX_ARTICLES must be a positive number or "all"');
  }

  acquireLock();
  await cleanupStaleSessions();

  const db = await import('../src/lib/db/articles');

  const sessionId = await db.createScrapeSession();
  console.log(
    `[articles] started session ${sessionId}; method=${scrapeMethod}; pages=${maxPages}; maxArticles=${maxArticles ?? 'all'}`,
  );

  try {
    let articles: unknown[] = [];

    if (scrapeMethod === 'mcp') {
      const { scrapeEdgePropMCP } = await import('../src/lib/scraper/edgeprop-mcp-scraper');
      articles = await scrapeEdgePropMCP(
        maxPages,
        (progress) => {
          console.log(`[articles] ${progress.status}: ${progress.message}`);
        },
        sessionId,
        true,
        maxArticles,
      );
    } else {
      const { scrapeEdgeProp } = await import('../src/lib/scraper/edgeprop-scraper');
      articles = await scrapeEdgeProp(
        maxPages,
        (progress) => {
          console.log(`[articles] ${progress.status}: ${progress.message || ''}`);
        },
        sessionId,
      );
    }

    await db.completeScrapeSession(sessionId, 'completed');
    console.log(`[articles] completed session ${sessionId}; scraped=${articles.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.completeScrapeSession(sessionId, 'error', message).catch((dbError) => {
      console.error('[articles] failed to mark session error:', dbError);
    });
    throw error;
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  console.error('[articles] failed:', error);
  releaseLock();
  process.exit(1);
});
