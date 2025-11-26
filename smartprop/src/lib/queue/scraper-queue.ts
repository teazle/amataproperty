import dns from 'node:dns';
import { config } from 'dotenv';
import path from 'path';
import { PgBoss, type Queue, type StopOptions } from 'pg-boss';
import { SCRAPER_DLQ_NAME, SCRAPER_QUEUE_NAME, type ScraperJobPayload } from './queue-types';

// Load environment variables from .env.local
// This is needed for the standalone worker process (not part of Next.js)
config({
  path: path.resolve(process.cwd(), '.env.local'),
  override: false, // Don't override existing env vars
});

let bossInstance: PgBoss | null = null;
let bossPromise: Promise<PgBoss> | null = null;
let shuttingDown = false;

// Force IPv4 resolution if IPv6 fails in your environment (e.g., EC2 without IPv6 route)
if (process.env.PG_FORCE_IPV4 !== 'false') {
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch (err) {
    console.warn('[pg-boss] Could not set DNS result order to ipv4first', err);
  }
}

// If SSL verification is disabled, also disable global TLS verification for this process.
// This is a last-resort fix for SELF_SIGNED_CERT_IN_CHAIN on some EC2 images.
if (process.env.PG_SSL_REJECT_UNAUTHORIZED === 'false') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function getConnectionString(): string {
  // Prefer PG_BOSS_DATABASE_URL if explicitly set
  if (process.env.PG_BOSS_DATABASE_URL) {
    return process.env.PG_BOSS_DATABASE_URL;
  }

  // Use DATABASE_URL if set (direct Postgres connection string)
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Fallback to SUPABASE_DB_URL if set
  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }

  // Auto-construct from Supabase URL if we have the password
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseDbPassword = process.env.SUPABASE_DB_PASSWORD;
  
  if (supabaseUrl && supabaseDbPassword) {
    // Extract project ref from Supabase URL (e.g., https://pfdsmpfgwbbeijdzevpu.supabase.co -> pfdsmpfgwbbeijdzevpu)
    const urlMatch = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
    if (urlMatch) {
      const projectRef = urlMatch[1];
      const encodedPassword = encodeURIComponent(supabaseDbPassword);
      
      // Use connection pooler (port 6543) which is more reliable and supports IPv4
      // Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
      // For ap-southeast-1 (Singapore), use: aws-0-ap-southeast-1.pooler.supabase.com
      // Pooler is preferred over direct connection for better reliability and IPv4 support
      const connectionString = `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require`;
      
      console.log(`[pg-boss] Auto-constructed connection string using Supabase pooler (IPv4-compatible)`);
      return connectionString;
    }
  }

  // Provide helpful error message
  const hasSupabaseUrl = !!supabaseUrl;
  const hasPassword = !!supabaseDbPassword;
  
  let errorMessage = 'Missing database connection string for pg-boss.\n\n';
  
  if (hasSupabaseUrl && !hasPassword) {
    errorMessage += `You have NEXT_PUBLIC_SUPABASE_URL set (${supabaseUrl}), but need to also set SUPABASE_DB_PASSWORD.\n\n`;
    errorMessage += `To fix this:\n`;
    errorMessage += `1. Get your database password from: Supabase Dashboard → Settings → Database → Database password\n`;
    errorMessage += `2. Add to .env.local: SUPABASE_DB_PASSWORD=your-database-password\n\n`;
    errorMessage += `pg-boss will automatically construct the connection string from NEXT_PUBLIC_SUPABASE_URL.\n`;
  } else if (!hasSupabaseUrl) {
    errorMessage += `Options:\n`;
    errorMessage += `1. Set DATABASE_URL with your Supabase Postgres connection string\n`;
    errorMessage += `2. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD (auto-constructs connection)\n`;
    errorMessage += `3. Set PG_BOSS_DATABASE_URL for a dedicated connection\n\n`;
    errorMessage += `To get your Supabase Postgres connection string:\n`;
    errorMessage += `- Go to Supabase Dashboard → Settings → Database\n`;
    errorMessage += `- Copy the "Connection string" (URI format)\n`;
  }

  throw new Error(errorMessage);
}

// Remove any sslmode parameter so PgBoss uses the provided ssl config instead of the URI
function stripSslMode(connectionString: string): string {
  const stripped = connectionString.replace(/[?&]sslmode=[^&]*/gi, '');
  // Remove trailing ? or & if left behind
  return stripped.replace(/[?&]$/, '');
}

async function createBoss(): Promise<PgBoss> {
  // Use existing DATABASE_URL connection and specify jobqueue schema
  // pg-boss will automatically create tables in the jobqueue schema
  let connectionString = stripSslMode(getConnectionString());
  const sslRejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
  const sslCa = process.env.PG_SSL_CA;
  
  // For pooler connections, use sslmode=prefer (allows fallback) and configure SSL options
  // Note: Supabase pooler requires SSL but certificate chain validation may fail
  if (connectionString.includes('pooler.supabase.com')) {
    // Remove existing sslmode if present and set to prefer
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
    const separator = connectionString.includes('?') ? '&' : '?';
    connectionString += `${separator}sslmode=prefer`;
  }
  
  // Configure PgBoss with connection string
  // SSL options are handled via connection string parameters (sslmode=prefer)
  const sslConfig =
    sslRejectUnauthorized && !sslCa
      ? undefined
      : {
          rejectUnauthorized: sslRejectUnauthorized,
          ...(sslCa ? { ca: sslCa } : {}),
        };

  const boss = new PgBoss({
    connectionString,
    schema: process.env.PG_BOSS_SCHEMA || 'jobqueue', // Uses dedicated jobqueue schema
    application_name: 'smartprop-scraper-worker',
    max: Number(process.env.PG_BOSS_POOL_MAX || 5),
    newJobCheckIntervalSeconds: Number(process.env.PG_BOSS_POLL_INTERVAL || 5),
    monitorIntervalSeconds: Number(process.env.PG_BOSS_MONITOR_INTERVAL || 60),
    maintenanceIntervalSeconds: Number(process.env.PG_BOSS_MAINTENANCE_INTERVAL || 300),
    // SSL configuration for Supabase pooler
    // Note: ssl: true enables SSL, but certificate validation is controlled by this object (not URI sslmode)
    ssl: sslConfig,
  });

  boss.on('error', (error) => {
    console.error('[pg-boss] error', error);
  });

  boss.on('warning', (warning) => {
    console.warn('[pg-boss] warning', warning);
  });

  await boss.start();
  await ensureScraperQueues(boss);
  return boss;
}

export async function getBoss(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;
  if (bossPromise) return bossPromise;

  bossPromise = createBoss()
    .then((boss) => {
      bossInstance = boss;
      registerShutdown();
      return boss;
    })
    .catch((error) => {
      bossPromise = null;
      throw error;
    });

  return bossPromise;
}

function registerShutdown() {
  const shutdown = async () => {
    await stopBoss({ graceful: true, timeout: 10000 });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export async function stopBoss(options?: StopOptions): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    const boss = bossInstance ?? (bossPromise ? await bossPromise : null);
    if (!boss) return;

    await boss.stop(options);
    bossInstance = null;
    bossPromise = null;
  } finally {
    shuttingDown = false;
  }
}

export async function ensureScraperQueues(boss?: PgBoss): Promise<void> {
  const client = boss ?? (await getBoss());
  const queueConfig: Queue = {
    name: SCRAPER_QUEUE_NAME,
    policy: 'singleton',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: Number(process.env.SCRAPER_EXPIRE_SECONDS || 3600),
    deleteAfterSeconds: Number(process.env.SCRAPER_DELETE_AFTER || 86400),
    deadLetter: SCRAPER_DLQ_NAME,
  };

  await client.createQueue(queueConfig.name, queueConfig);
  await client.createQueue(SCRAPER_DLQ_NAME);
}

export async function enqueueScraperJob(
  payload: ScraperJobPayload
): Promise<{ success: true; bossJobId: string } | { success: false; error: string }> {
  try {
    const boss = await getBoss();
    await ensureScraperQueues(boss);

    const bossJobId = await boss.send<ScraperJobPayload>(SCRAPER_QUEUE_NAME, payload, {
      priority: payload.priority,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: Number(process.env.SCRAPER_EXPIRE_SECONDS || 3600),
      singletonSeconds: Number(process.env.SCRAPER_SINGLETON_SECONDS || 5),
      singletonKey: payload.idempotencyKey,
      keepUntil: Number(process.env.SCRAPER_KEEP_UNTIL || 86400), // seconds to retain for idempotency
    });

    return { success: true, bossJobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[pg-boss] failed to enqueue scraper job:', message);
    return { success: false, error: message };
  }
}
