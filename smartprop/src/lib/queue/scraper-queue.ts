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

async function getConnectionString(): Promise<string> {
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

      // Use Supavisor session mode pooler (port 5432) for IPv4 compatibility
      // Session mode is compatible with pg-boss and supports IPv4
      // Format: postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-[N]-[REGION].pooler.supabase.com:5432/postgres
      // Reference: https://supabase.com/docs/guides/database/connecting-to-postgres
      //
      // IMPORTANT: The pooler endpoint format varies by region (aws-0, aws-1, etc.)
      // For ap-southeast-1, the correct format is aws-1-ap-southeast-1
      // Get the exact connection string from Supabase Dashboard → Connect → Session pooler
      const region = process.env.SUPABASE_REGION || 'ap-southeast-1'; // Default to ap-southeast-1 (Singapore)

      // Determine the correct pooler endpoint based on region
      // ap-southeast-1 uses aws-1, other regions may use aws-0
      const poolerEndpoint = region === 'ap-southeast-1'
        ? 'aws-1-ap-southeast-1'
        : `aws-0-${region}`;

      // Construct pooler connection string
      // Note: Username format is postgres.[PROJECT-REF] for Supavisor
      // Add connection timeout and keepalive parameters to prevent timeouts
      const connectTimeout = process.env.PG_CONNECT_TIMEOUT || '30'; // 30 seconds default
      const keepalive = process.env.PG_KEEPALIVE !== 'false'; // Enable keepalive by default
      const keepaliveIdle = process.env.PG_KEEPALIVE_IDLE || '60000'; // 60 seconds
      const keepaliveInterval = process.env.PG_KEEPALIVE_INTERVAL || '10000'; // 10 seconds

      const connectionString = `postgresql://postgres.${projectRef}:${encodedPassword}@${poolerEndpoint}.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=${connectTimeout}${keepalive ? `&keepalive=1&keepalive_idle=${keepaliveIdle}&keepalive_interval=${keepaliveInterval}` : ''}`;

      console.log(`[pg-boss] Auto-constructed connection string using Supavisor session mode pooler (${poolerEndpoint}, IPv4-compatible)`);
      console.log(`[pg-boss] Connection settings: timeout=${connectTimeout}s, keepalive=${keepalive}`);
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

// Parse connection string into individual parameters for better control
function parseConnectionString(connectionString: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  // Handle IPv6 addresses in brackets (e.g., [2406:da18:...])
  // URL parser needs brackets removed for hostname
  const url = new URL(connectionString);
  let host = url.hostname;

  // If hostname is wrapped in brackets (IPv6), remove them
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  return {
    host: host,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || 'postgres',
  };
}

async function createBoss(): Promise<PgBoss> {
  // Get connection string and parse it into individual parameters
  // Using individual parameters gives us better control over SSL and connection options
  const connectionString = await getConnectionString();
  const sslRejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
  const sslCa = process.env.PG_SSL_CA;

  // Parse connection string
  const connParams = parseConnectionString(connectionString);
  const isPooler = connParams.host.includes('pooler.supabase.com');

  // Configure SSL options
  // sslRejectUnauthorized=true means reject unauthorized certs (default), false means don't reject
  // For pooler connections, always configure SSL with rejectUnauthorized based on env var
  // For direct connections, use SSL with proper validation unless explicitly disabled
  const sslConfig = isPooler
    ? {
        rejectUnauthorized: sslRejectUnauthorized, // Use env var value directly
        ...(sslCa ? { ca: sslCa } : {}),
      }
    : sslRejectUnauthorized && !sslCa
      ? true // Use SSL with default validation
      : {
          rejectUnauthorized: sslRejectUnauthorized,
          ...(sslCa ? { ca: sslCa } : {}),
        };

  console.log(`[pg-boss] Connecting to ${connParams.host}:${connParams.port} (${isPooler ? 'pooler' : 'direct'})`);

  // Reduce pool size to avoid connection exhaustion with Supavisor
  // Session mode pooler has limits per user+db+mode combination
  // Using 3 connections instead of 5 to leave room for other services
  const poolMax = Number(process.env.PG_BOSS_POOL_MAX || 3);

  const boss = new PgBoss({
    host: connParams.host,
    port: connParams.port,
    user: connParams.user,
    password: connParams.password,
    database: connParams.database,
    schema: process.env.PG_BOSS_SCHEMA || 'jobqueue', // Uses dedicated jobqueue schema
    application_name: 'smartprop-scraper-worker',
    max: poolMax, // Reduced from 5 to 3 to avoid connection exhaustion with Supavisor
    monitorIntervalSeconds: Number(process.env.PG_BOSS_MONITOR_INTERVAL || 60),
    maintenanceIntervalSeconds: Number(process.env.PG_BOSS_MAINTENANCE_INTERVAL || 300),
    // SSL configuration
    ssl: sslConfig,
    // Note: Connection timeout and keepalive are configured via connection string parameters
    // See getConnectionString() for connect_timeout, keepalive, keepalive_idle, keepalive_interval
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

  // Create dead letter queue first (must exist before being referenced)
  await client.createQueue(SCRAPER_DLQ_NAME);

  // Then create main queue with dead letter reference
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
}

export async function enqueueScraperJob(
  payload: ScraperJobPayload
): Promise<{ success: true; bossJobId: string } | { success: false; error: string }> {
  try {
    const boss = await getBoss();
    await ensureScraperQueues(boss);

    const bossJobId = await boss.send(SCRAPER_QUEUE_NAME, payload, {
      priority: payload.priority,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: Number(process.env.SCRAPER_EXPIRE_SECONDS || 3600),
      singletonSeconds: Number(process.env.SCRAPER_SINGLETON_SECONDS || 5),
      singletonKey: payload.idempotencyKey,
      keepUntil: Number(process.env.SCRAPER_KEEP_UNTIL || 86400), // seconds to retain for idempotency
    });

    if (!bossJobId) {
      return { success: false, error: 'pg-boss did not return a job id' };
    }

    return { success: true, bossJobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[pg-boss] failed to enqueue scraper job:', message);
    return { success: false, error: message };
  }
}
