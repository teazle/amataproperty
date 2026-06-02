import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local', quiet: true });
loadDotenv({ path: '.env', quiet: true });

const SGT_TIME_ZONE = 'Asia/Singapore';
const DEFAULT_APP_URL = 'http://127.0.0.1:3000';
const DEFAULT_WAHA_URL = 'http://127.0.0.1:3030';
const DEFAULT_WAHA_SESSION = 'default';
const OPENCLAW_CHANNEL = 'whatsapp';
const OPENCLAW_ACCOUNT = 'default';

type AnyRow = Record<string, any>;

type CliOptions = {
  date?: string;
  json: boolean;
  send: boolean;
  dryRun: boolean;
  output?: string;
};

type CountMap = Record<string, number>;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    send: false,
    dryRun: process.env.DRY_RUN === '1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') {
      options.date = argv[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--send') {
      options.send = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--output') {
      options.output = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error('--date must be in yyyy-mm-dd format');
  }

  return options;
}

function sgtDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SGT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function previousSgtDate(): string {
  return sgtDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

function sgtRange(date: string): { startUtc: string; endUtc: string } {
  const [year, month, day] = date.split('-').map(Number);
  const startMs = Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
  };
}

function formatSgt(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: SGT_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function countBy(rows: AnyRow[], key: string): CountMap {
  return rows.reduce<CountMap>((acc, row) => {
    const value = String(row[key] ?? 'unknown');
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function sum(rows: AnyRow[], key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function safeJson<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return await response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function runCommand(command: string, args: string[], timeoutMs = 5000): string | null {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

function parsePm2(): Array<{ name: string; status: string }> {
  const output = runCommand('pm2', ['jlist']);
  const rows = output ? safeJson<any[]>(output) : null;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    name: row.name,
    status: row.pm2_env?.status ?? 'unknown',
  }));
}

function parseDocker(): Array<{ name: string; status: string }> {
  const output = runCommand('docker', ['ps', '--format', '{{json .}}']);
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => safeJson<any>(line))
    .filter(Boolean)
    .map((row) => ({
      name: row.Names ?? row.names ?? 'unknown',
      status: row.Status ?? row.status ?? 'unknown',
    }));
}

function parseLinkedInLikeArtifacts(range: { startUtc: string; endUtc: string }) {
  const dir = '/root/.openclaw/workspace/artifacts/linkedin-daily-review';
  if (!existsSync(dir)) {
    return [];
  }

  const start = new Date(range.startUtc).getTime();
  const end = new Date(range.endUtc).getTime();

  return readdirSync(dir)
    .filter((name) => name.startsWith('like-feed-') && name.endsWith('.json'))
    .map((name) => {
      const fullPath = join(dir, name);
      const json = safeJson<any>(readFileSync(fullPath, 'utf8')) ?? {};
      const startedAt = json.startedAt ? new Date(json.startedAt).getTime() : NaN;
      return {
        path: fullPath,
        startedAt: json.startedAt,
        finishedAt: json.finishedAt,
        targetLikes: Number(json.targetLikes ?? 0),
        counts: json.counts ?? {},
        errors: Array.isArray(json.errors) ? json.errors : [],
        inRange: Number.isFinite(startedAt) && startedAt >= start && startedAt < end,
      };
    })
    .filter((item) => item.inRange);
}

function getRecipients(): string[] {
  const raw = process.env.SMARTPROP_DAILY_REPORT_TO || process.env.DAILY_REPORT_TO || '';
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function buildReport(options: CliOptions) {
  const reportDate = options.date || previousSgtDate();
  const range = sgtRange(reportDate);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials in environment');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const [scheduledJobs, scraperJobs, articleSessions, linkedinMessages, linkedinDailyStats, waMessages, outreachCreated, outreachReplied] = await Promise.all([
    supabase.from('scheduled_jobs').select('name,platform,enabled,last_run_at,next_run_at,last_run_status,last_error').order('name'),
    supabase
      .from('scraper_jobs')
      .select('platform,status,listings_processed,stats,started_at,completed_at,last_updated_at,error_message,current_district')
      .gte('last_updated_at', range.startUtc)
      .lt('last_updated_at', range.endUtc)
      .order('last_updated_at', { ascending: false }),
    supabase
      .from('scrape_sessions')
      .select('source,status,pages_scraped,articles_scraped,unique_articles,duplicates_found,error_message,started_at,completed_at')
      .gte('started_at', range.startUtc)
      .lt('started_at', range.endUtc)
      .order('started_at', { ascending: false }),
    supabase
      .from('linkedin_messages')
      .select('contact_name,status,sent_at,error_message,created_at,updated_at')
      .gte('created_at', range.startUtc)
      .lt('created_at', range.endUtc)
      .order('created_at', { ascending: false }),
    supabase
      .from('linkedin_daily_stats')
      .select('date,messages_sent,messages_failed,contacts_processed,created_at,updated_at')
      .gte('created_at', range.startUtc)
      .lt('created_at', range.endUtc)
      .order('created_at', { ascending: false }),
    supabase
      .from('wa_messages')
      .select('direction,phone,occurred_at,created_at')
      .gte('occurred_at', range.startUtc)
      .lt('occurred_at', range.endUtc)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('outreach')
      .select('status,channel,created_at,first_message_sent_at,last_message_at,replied_at')
      .gte('created_at', range.startUtc)
      .lt('created_at', range.endUtc),
    supabase
      .from('outreach')
      .select('status,channel,created_at,first_message_sent_at,last_message_at,replied_at')
      .gte('replied_at', range.startUtc)
      .lt('replied_at', range.endUtc),
  ]);

  const queryErrors = [
    scheduledJobs.error,
    scraperJobs.error,
    articleSessions.error,
    linkedinMessages.error,
    linkedinDailyStats.error,
    waMessages.error,
    outreachCreated.error,
    outreachReplied.error,
  ].filter(Boolean);

  if (queryErrors.length > 0) {
    throw new Error(queryErrors.map((error) => error?.message).join('; '));
  }

  const appUrl = process.env.SMARTPROP_APP_URL || DEFAULT_APP_URL;
  const wahaUrl = process.env.WAHA_URL || DEFAULT_WAHA_URL;
  const wahaSession = process.env.WAHA_SESSION || DEFAULT_WAHA_SESSION;

  const [appHealth, wahaSessionStatus] = await Promise.all([
    fetchJson(`${appUrl}/api/health`),
    fetchJson(`${wahaUrl}/api/sessions/${wahaSession}`),
  ]);

  const pm2 = parsePm2();
  const docker = parseDocker();
  const linkedinLikes = parseLinkedInLikeArtifacts(range);

  const scraperRows = scraperJobs.data ?? [];
  const linkedinRows = linkedinMessages.data ?? [];
  const waRows = waMessages.data ?? [];
  const outreachRows = outreachCreated.data ?? [];
  const outreachReplyRows = outreachReplied.data ?? [];

  const scraperByPlatform = Object.entries(
    scraperRows.reduce<Record<string, { jobs: number; listings: number; statuses: CountMap; errors: string[] }>>((acc, row) => {
      const platform = String(row.platform ?? 'unknown');
      acc[platform] ??= { jobs: 0, listings: 0, statuses: {}, errors: [] };
      acc[platform].jobs += 1;
      acc[platform].listings += Number(row.listings_processed ?? 0);
      const status = String(row.status ?? 'unknown');
      acc[platform].statuses[status] = (acc[platform].statuses[status] ?? 0) + 1;
      if (row.error_message) acc[platform].errors.push(String(row.error_message));
      return acc;
    }, {})
  ).map(([platform, value]) => ({ platform, ...value }));

  const linkedinFailures = linkedinRows
    .filter((row) => row.status === 'failed' || row.error_message)
    .slice(0, 6)
    .map((row) => ({
      contact: row.contact_name || 'unknown',
      error: row.error_message || row.status,
    }));

  const allErrors = [
    ...scraperRows.filter((row) => row.error_message).map((row) => `${row.platform}: ${row.error_message}`),
    ...linkedinFailures.map((row) => `LinkedIn ${row.contact}: ${row.error}`),
    ...(appHealth?.error ? [`App health: ${appHealth.error}`] : []),
    ...(wahaSessionStatus?.error ? [`WAHA: ${wahaSessionStatus.error}`] : []),
  ];

  const unhealthyPm2 = pm2.filter((row) => row.status !== 'online');
  const wahaReady =
    wahaSessionStatus?.status === 'WORKING' ||
    Boolean(wahaSessionStatus?.me?.id && wahaSessionStatus?.engine?.state === 'CONNECTED');

  const verdict =
    allErrors.length === 0 && unhealthyPm2.length === 0 && (!wahaSessionStatus || wahaReady)
      ? 'OK'
      : 'Needs attention';

  const report = {
    reportDate,
    range,
    generatedAt: new Date().toISOString(),
    verdict,
    currentHealth: {
      app: appHealth?.status ?? appHealth?.healthy ?? appHealth?.error ?? 'unknown',
      waha: {
        ready: wahaReady,
        status: wahaSessionStatus?.status ?? 'unknown',
        engine: wahaSessionStatus?.engine?.state,
        me: wahaSessionStatus?.me?.id,
      },
      pm2,
      docker: docker.filter((row) => /smartprop|waha|flare/i.test(row.name)),
    },
    scheduledJobs: scheduledJobs.data ?? [],
    scrapers: {
      totalJobs: scraperRows.length,
      byPlatform: scraperByPlatform,
      statuses: countBy(scraperRows, 'status'),
      listingsProcessed: sum(scraperRows, 'listings_processed'),
    },
    articleSessions: {
      total: articleSessions.data?.length ?? 0,
      statuses: countBy(articleSessions.data ?? [], 'status'),
      articlesScraped: sum(articleSessions.data ?? [], 'articles_scraped'),
      uniqueArticles: sum(articleSessions.data ?? [], 'unique_articles'),
    },
    linkedin: {
      messages: {
        total: linkedinRows.length,
        statuses: countBy(linkedinRows, 'status'),
        failures: linkedinFailures,
      },
      dailyStats: linkedinDailyStats.data ?? [],
      likes: linkedinLikes.map((item) => ({
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        targetLikes: item.targetLikes,
        counts: item.counts,
        errors: item.errors,
      })),
    },
    whatsapp: {
      messages: {
        total: waRows.length,
        directions: countBy(waRows, 'direction'),
      },
      outreachCreated: {
        total: outreachRows.length,
        statuses: countBy(outreachRows, 'status'),
      },
      outreachReplies: outreachReplyRows.length,
    },
    errors: allErrors.slice(0, 12),
  };

  return report;
}

function formatCounts(counts: CountMap): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key} ${value}`).join(', ');
}

function formatReport(report: Awaited<ReturnType<typeof buildReport>>): string {
  const lines: string[] = [];
  const pm2Summary = report.currentHealth.pm2.length
    ? report.currentHealth.pm2.map((row) => `${row.name}:${row.status}`).join(', ')
    : 'unavailable';
  const dockerSummary = report.currentHealth.docker.length
    ? report.currentHealth.docker.map((row) => `${row.name}:${row.status}`).join('; ')
    : 'unavailable';

  lines.push(`SmartProp Daily Run Report - ${report.reportDate} SGT`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push('');
  lines.push(`Current health: app=${report.currentHealth.app}; WAHA=${report.currentHealth.waha.status}/${report.currentHealth.waha.engine ?? 'n/a'}; PM2=${pm2Summary}`);
  lines.push(`Containers: ${dockerSummary}`);
  lines.push('');
  lines.push('Scheduled jobs:');
  for (const job of report.scheduledJobs) {
    lines.push(`- ${job.name} (${job.platform ?? 'n/a'}): enabled=${job.enabled}; last=${job.last_run_status ?? 'n/a'} at ${formatSgt(job.last_run_at)}; next=${formatSgt(job.next_run_at)}`);
    if (job.last_error) lines.push(`  error: ${String(job.last_error).slice(0, 180)}`);
  }
  if (report.scheduledJobs.length === 0) lines.push('- none found');
  lines.push('');
  lines.push(`Scrapers: ${report.scrapers.totalJobs} jobs; statuses=${formatCounts(report.scrapers.statuses)}; listings=${report.scrapers.listingsProcessed}`);
  for (const item of report.scrapers.byPlatform) {
    lines.push(`- ${item.platform}: jobs=${item.jobs}; listings=${item.listings}; statuses=${formatCounts(item.statuses)}; errors=${item.errors.length}`);
  }
  lines.push(`Article scrapers: sessions=${report.articleSessions.total}; statuses=${formatCounts(report.articleSessions.statuses)}; articles=${report.articleSessions.articlesScraped}; unique=${report.articleSessions.uniqueArticles}`);
  lines.push('');
  lines.push(`LinkedIn messages: total=${report.linkedin.messages.total}; statuses=${formatCounts(report.linkedin.messages.statuses)}`);
  if (report.linkedin.messages.failures.length > 0) {
    lines.push('LinkedIn failures:');
    for (const failure of report.linkedin.messages.failures) {
      lines.push(`- ${failure.contact}: ${String(failure.error).slice(0, 160)}`);
    }
  }
  if (report.linkedin.likes.length > 0) {
    for (const likeRun of report.linkedin.likes) {
      lines.push(`LinkedIn likes: target=${likeRun.targetLikes}; counts=${formatCounts(likeRun.counts)}; errors=${likeRun.errors.length}`);
    }
  } else {
    lines.push('LinkedIn likes: no artifact found for this SGT day');
  }
  lines.push('');
  lines.push(`WhatsApp/outreach: wa_messages=${report.whatsapp.messages.total} (${formatCounts(report.whatsapp.messages.directions)}); outreach_created=${report.whatsapp.outreachCreated.total}; replies=${report.whatsapp.outreachReplies}`);
  if (report.errors.length > 0) {
    lines.push('');
    lines.push('Attention items:');
    for (const error of report.errors) {
      lines.push(`- ${String(error).slice(0, 180)}`);
    }
  }

  return lines.join('\n');
}

function sendViaOpenClaw(text: string, recipients: string[], dryRun: boolean) {
  if (recipients.length === 0) {
    throw new Error('SMARTPROP_DAILY_REPORT_TO or DAILY_REPORT_TO must be set before sending');
  }

  for (const target of recipients) {
    if (dryRun) {
      console.log(`[dry-run] would send report to ${target}`);
      continue;
    }
    const output = runCommand('openclaw', [
      'message',
      'send',
      '--channel',
      OPENCLAW_CHANNEL,
      '--account',
      OPENCLAW_ACCOUNT,
      '--target',
      target,
      '--message',
      text,
      '--json',
    ], 60000);
    if (!output) {
      throw new Error(`OpenClaw delivery failed for ${target}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport(options);
  const text = formatReport(report);

  if (options.output) {
    writeFileSync(options.output, text, 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify({ report, text }, null, 2));
  } else {
    console.log(text);
  }

  if (options.send) {
    sendViaOpenClaw(text, getRecipients(), options.dryRun);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
