/** Public retrieval only: no database client, credentials, sends, proxies, or solver. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { scrapeArticleContent, type ArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';
import { planApprovedArticleRepair } from './article-repair-guard';

const backupFile = '/Users/vincent/propertydemo/.superpowers/sdd/2026-09-06-smartprop-recovery-plan/articles-before-20260907.json';
const raw = readFileSync(backupFile);
const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
if (sha256(raw) !== '3c91a0e42f0d068115980d7dc40e233945c514bee5de5c7522077de57d9269b2') throw new Error('Approved backup checksum mismatch');
const backup = JSON.parse(raw.toString()) as {
  rows: (Record<string, unknown> & { article_id: string })[];
  articles: { id: string; title: string; nid: string; path: string }[];
};
const offset = Number(process.env.ARTICLE_PREPARE_OFFSET ?? '3');
const count = Number(process.env.ARTICLE_PREPARE_COUNT ?? '1');
if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || offset + count > 399) throw new Error('Invalid bounded selection');
const selected = [...backup.articles].sort((a, b) => a.id.localeCompare(b.id)).slice(offset, offset + count);
const dir = mkdtempSync('/private/tmp/chloe-article-prepared-20260907-');
const file = `${dir}/prepared.json`;
const input: { schema: 1; articles: { article_id: string; content: ArticleContent }[] } = { schema: 1, articles: [] };
const outcomes: Record<string, unknown>[] = [];
let rejected = 0;
const browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 15000 });
const context = await browser.newContext();
try {
  for (const article of selected) {
    const original = backup.rows.find(row => row.article_id === article.id);
    const content = await scrapeArticleContent(article.path, article.nid, { context });
    const plan = planApprovedArticleRepair({ backup: original, current: original, article, content });
    const result = { at: new Date().toISOString(), articleId: article.id, status: plan.status, reason: plan.status === 'skip' ? plan.reason : null, title: content?.title, words: content?.word_count };
    outcomes.push(result);
    console.log(JSON.stringify(result));
    if (plan.status === 'ready' && content) {
      input.articles.push({ article_id: article.id, content });
      writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
      rejected = 0;
    } else {
      rejected++;
      if (rejected >= 3) break;
    }
  }
} finally {
  await context.close();
  await browser.close();
  writeFileSync(`${dir}/outcomes.json`, JSON.stringify(outcomes), { mode: 0o600 });
}
console.log(JSON.stringify({ status: 'finished', dbWrites: 0, offset, count, attempted: outcomes.length, accepted: input.articles.length, file: input.articles.length ? file : null, sha256: input.articles.length ? sha256(readFileSync(file)) : null, browserClosed: true }));
