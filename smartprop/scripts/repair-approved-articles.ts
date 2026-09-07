/** One-off, exact-cohort data maintenance. This does not deploy or restart the app. */
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { planApprovedArticleRepair } from './article-repair-guard';
import { conditionalArticleRepair } from './article-repair-write';
import type { ArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';

const BACKUP = '/root/smartprop-article-recovery-20260907-xx7sPB/before.json';
const BACKUP_SHA = '3c91a0e42f0d068115980d7dc40e233945c514bee5de5c7522077de57d9269b2';
const EXTRACTOR_SHA = 'e3c1f7453633f93da3f2b24a886230e4cd8fa0e7e7cafc78216610f1331e970f';
type Row = Record<string, unknown> & { id: string; article_id: string; updated_at: string };
type Article = { id: string; nid: string; path: string; title: string };
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

async function main() {
  if (hostname() !== 'vmi3201429' || readFileSync('/etc/machine-id', 'utf8').trim() !== 'bfb5b1b8859546f9aac39a4c5bafa616') {
    throw new Error('Wrong target identity');
  }
  if (process.cwd() !== '/opt/smartprop/app/smartprop') throw new Error('Wrong serving directory');
  const raw = readFileSync(BACKUP);
  if (digest(raw) !== BACKUP_SHA) throw new Error('Backup checksum mismatch');
  const backup = JSON.parse(raw.toString()) as { approvedIds: string[]; rows: Row[]; articles: Article[] };
  const ids = new Set(backup.approvedIds);
  if (ids.size !== 399 || backup.approvedIds.length !== 399 || backup.rows.length !== 399 || backup.articles.length !== 399 ||
    new Set(backup.rows.map(row => row.article_id)).size !== 399 || new Set(backup.rows.map(row => row.id)).size !== 399 ||
    new Set(backup.articles.map(article => article.id)).size !== 399 ||
    backup.rows.some(row => !ids.has(row.article_id)) || backup.articles.some(article => !ids.has(article.id))) {
    throw new Error('Exact approved cohort mismatch');
  }
  const mode = process.env.ARTICLE_REPAIR_MODE ?? 'dry-run';
  const offset = Number(process.env.ARTICLE_REPAIR_OFFSET ?? '0');
  const count = Number(process.env.ARTICLE_REPAIR_COUNT ?? '1');
  const concurrency = Number(process.env.ARTICLE_REPAIR_CONCURRENCY ?? '1');
  if (!['dry-run', 'apply'].includes(mode) || !Number.isInteger(offset) || offset < 0 ||
    !Number.isInteger(count) || count < 1 || offset + count > 399 || ![1, 2].includes(concurrency)) {
    throw new Error('Invalid bounded invocation');
  }
  const extractorPath = `${process.cwd()}/src/lib/scraper/edgeprop-content-scraper.ts`;
  if (digest(readFileSync(extractorPath)) !== EXTRACTOR_SHA) throw new Error('Serving extractor changed');
  const { scrapeArticleContent } = await import(extractorPath) as {
    scrapeArticleContent: (path: string, nid: string) => Promise<ArticleContent | null>;
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Database configuration absent');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const runDir = mkdtempSync('/root/smartprop-article-recovery-20260907-run-');
  const journal = `${runDir}/outcomes.jsonl`;
  writeFileSync(journal, '', { mode: 0o600, flag: 'wx' });
  const selected = [...backup.rows].sort((a, b) => a.article_id.localeCompare(b.article_id)).slice(offset, offset + count);
  let next = 0;
  let stopped = false;
  let rejected = 0;
  let attempted = 0;
  let updated = 0;
  let ready = 0;
  let skipped = 0;
  const record = (entry: Record<string, unknown>) => {
    const result = { at: new Date().toISOString(), ...entry };
    appendFileSync(journal, JSON.stringify(result) + '\n');
    console.log(JSON.stringify(result));
  };
  record({ status: 'started', mode, offset, count, concurrency, runDir, backupSha256: BACKUP_SHA, extractorSha256: EXTRACTOR_SHA });
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!stopped && next < selected.length) {
      const original = selected[next++];
      const article = backup.articles.find(item => item.id === original.article_id)!;
      attempted++;
      try {
        const { data: current, error } = await client.from('article_full_content').select('*').eq('id', original.id).maybeSingle();
        if (error) throw new Error(error.message);
        const { data: currentArticle, error: articleError } = await client.from('scraped_articles').select('id,nid,title,path').eq('id', article.id).maybeSingle();
        if (articleError) throw new Error(articleError.message);
        if (!current || stable(current) !== stable(original) || stable(currentArticle) !== stable(article)) {
          skipped++;
          record({ articleId: article.id, status: 'skip', reason: 'snapshot_or_metadata_changed' });
          continue;
        }
        const content = await scrapeArticleContent(article.path, article.nid);
        const plan = planApprovedArticleRepair({ backup: original, current, article, content });
        if (plan.status === 'skip') {
          skipped++;
          rejected++;
          record({ articleId: article.id, status: 'skip', reason: plan.reason, extractedTitle: content?.title ?? null });
          if (rejected >= 3) stopped = true;
          continue;
        }
        rejected = 0;
        ready++;
        writeFileSync(`${runDir}/${article.id}.replacement.json`, JSON.stringify({ article, content, patch: plan.patch }), { mode: 0o600, flag: 'wx' });
        if (mode === 'dry-run') {
          record({ articleId: article.id, status: 'ready_no_write', title: content?.title, words: plan.patch.word_count, excerpt: plan.patch.text_content.slice(0, 220) });
          continue;
        }
        if (stopped) {
          skipped++;
          record({ articleId: article.id, status: 'skip', reason: 'other_lane_stopped' });
          continue;
        }
        const result = await conditionalArticleRepair(client, original, plan.patch);
        if (result.status !== 'updated') {
          skipped++;
          record({ articleId: article.id, status: 'skip', reason: result.status });
          continue;
        }
        updated++;
        // An independent read must return the repaired body, not just a successful PATCH status.
        const { data: after, error: afterError } = await client.from('article_full_content').select('*').eq('id', original.id).single();
        if (afterError) throw new Error(afterError.message);
        for (const field of Object.keys(plan.patch)) {
          const expected = plan.patch[field as keyof typeof plan.patch];
          const matches = field === 'scraped_at'
            ? new Date(after[field]).getTime() === new Date(expected as string | Date).getTime()
            : stable(after[field]) === stable(expected);
          if (!matches) throw new Error(`Readback mismatch: ${field}`);
        }
        if (after.id !== original.id || after.article_id !== original.article_id || after.created_at !== original.created_at || after.updated_at === original.updated_at) {
          throw new Error('Readback identity or update-trigger mismatch');
        }
        writeFileSync(`${runDir}/${article.id}.after.json`, JSON.stringify(after), { mode: 0o600, flag: 'wx' });
        record({ articleId: article.id, status: 'updated_readback_verified', title: content?.title, words: after.word_count, textSha256: digest(after.text_content), updatedAt: after.updated_at });
      } catch (error) {
        stopped = true;
        record({ articleId: article.id, status: 'stopped_error', message: error instanceof Error ? error.message : 'unknown' });
      }
    }
  }));
  const summary = { mode, offset, count, attempted, ready, updated, skipped, stopped, unattempted: selected.length - attempted, journalSha256: digest(readFileSync(journal)), runDir };
  writeFileSync(`${runDir}/summary.json`, JSON.stringify(summary), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: 'finished', ...summary }));
  if (stopped) process.exitCode = 2;
}

if (import.meta.main) await main();
