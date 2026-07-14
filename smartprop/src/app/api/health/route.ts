import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { NextRequest,NextResponse } from 'next/server';

import {
  deriveNewsletterHealth,
  deriveValuationPreparationHealth,
  normalizeSourceRevision,
  parseNewsletterFreshnessMinutes,
  parseValuationFreshnessMinutes,
  type NewsletterRunHealthSnapshot,
  type RedactedValuationLocalFailure,
  type ValuationPreparationRunSnapshot,
} from '@/lib/newsletter/newsletter-health';
import { getWAHAHeaders, getWAHAReadiness } from '@/lib/wa/waha';

const SOURCE_REVISION_PATH = process.env.SMARTPROP_DEPLOY_SOURCE_REVISION_PATH || '/opt/smartprop/app/smartprop/.deploy-source-revision';
const VALUATION_LOCAL_STATUS_PATH = process.env.SMARTPROP_VALUATION_LOCAL_STATUS_PATH ||
  '/var/lib/smartprop/newsletter-valuation-status.json';

async function readSourceRevision(): Promise<string | null> {
  try {
    const revision = (await readFile(SOURCE_REVISION_PATH, 'utf8')).trim();
    return normalizeSourceRevision(revision);
  } catch {
    return null;
  }
}

async function readValuationLocalFailure(): Promise<{
  failure: RedactedValuationLocalFailure | null;
  dataError: boolean;
}> {
  try {
    const value = JSON.parse(await readFile(VALUATION_LOCAL_STATUS_PATH, 'utf8')) as Record<string, unknown>;
    const commands = new Set(['queue', 'heartbeat', 'import', 'complete', 'set-project-profile']);
    if (value.status !== 'failed' || !commands.has(String(value.command)) ||
        value.errorCode !== 'database_error' || value.message !== 'database operation failed' ||
        typeof value.recordedAt !== 'string' || Number.isNaN(Date.parse(value.recordedAt))) {
      return { failure: null, dataError: true };
    }
    return { failure: {
        status: 'failed',
        command: value.command as RedactedValuationLocalFailure['command'],
        recordedAt: value.recordedAt,
        errorCode: 'database_error',
        message: 'database operation failed',
      }, dataError: false };
  } catch (error) {
    return {
      failure: null,
      dataError: (error as NodeJS.ErrnoException).code !== 'ENOENT',
    };
  }
}

// Health check endpoint for load balancer
export async function GET(_request: NextRequest) {
  const startTime = Date.now();
  const checks: Record<string, unknown> = {};
  let overallStatus = 'healthy';

  try {
    // Check database connectivity
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!
      );
      
      const { data: _data, error } = await supabase
        .from('listings')
        .select('id')
        .limit(1);
      
      checks.database = {
        status: error ? 'unhealthy' : 'healthy',
        responseTime: Date.now() - startTime,
        error: error?.message
      };
      
      if (error) overallStatus = 'degraded';
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      overallStatus = 'unhealthy';
    }

    // Check WAHA service connectivity
    try {
      const wahaUrl = process.env.WAHA_URL || 'http://localhost:3030';
      const wahaResponse = await fetch(`${wahaUrl}/api/sessions`, {
        method: 'GET',
        headers: getWAHAHeaders({ 'Content-Type': 'application/json' }),
        signal: AbortSignal.timeout(5000)
      });
      
      checks.waha = {
        status: wahaResponse.ok ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - startTime,
        statusCode: wahaResponse.status
      };
      
      if (!wahaResponse.ok) overallStatus = 'degraded';
    } catch (error) {
      checks.waha = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Connection failed'
      };
      overallStatus = 'degraded';
    }

    // Campaign status is intentionally no-PII and does not alter generic health semantics.
    try {
      const newsletterClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const [runResult, sendResult, reportResult, wahaReadiness, sourceRevision] = await Promise.all([
        newsletterClient
          .from('newsletter_runs')
          .select('run_date,status,attempted_count,sent_count,unknown_count,last_heartbeat_at,completed_at,blocker')
          .order('run_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        newsletterClient
          .from('newsletter_sends')
          .select('completed_at')
          .eq('is_test', false)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        newsletterClient
          .from('newsletter_operator_reports')
          .select('completed_at')
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        getWAHAReadiness(),
        readSourceRevision(),
      ]);
      const row = runResult.data as Record<string, unknown> | null;
      const latestRun: NewsletterRunHealthSnapshot | null = row ? {
        runDate: String(row.run_date),
        status: String(row.status),
        attempted: Number(row.attempted_count || 0),
        accepted: Number(row.sent_count || 0),
        unknown: Number(row.unknown_count || 0),
        heartbeatAt: typeof row.last_heartbeat_at === 'string' ? row.last_heartbeat_at : null,
        completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
        blocker: typeof row.blocker === 'string' ? row.blocker : null,
      } : null;
      checks.newsletter = deriveNewsletterHealth({
        enabled: process.env.SMARTPROP_NEWSLETTER_ENABLED === '1',
        sourceRevision,
        wahaReady: wahaReadiness.sessionStatus === 'WORKING',
        latestRun,
        latestFinalizedSendAt: typeof sendResult.data?.completed_at === 'string' ? sendResult.data.completed_at : null,
        latestFinalizedReportAt: typeof reportResult.data?.completed_at === 'string' ? reportResult.data.completed_at : null,
        freshnessMinutes: parseNewsletterFreshnessMinutes(process.env.SMARTPROP_NEWSLETTER_FRESHNESS_MINUTES),
        dataError: Boolean(runResult.error || sendResult.error || reportResult.error),
      });
    } catch {
      checks.newsletter = deriveNewsletterHealth({
        enabled: process.env.SMARTPROP_NEWSLETTER_ENABLED === '1',
        sourceRevision: await readSourceRevision(),
        wahaReady: false,
        latestRun: null,
        latestFinalizedSendAt: null,
        latestFinalizedReportAt: null,
        freshnessMinutes: parseNewsletterFreshnessMinutes(process.env.SMARTPROP_NEWSLETTER_FRESHNESS_MINUTES),
        dataError: true,
      });
    }

    // Valuation preparation is separate from provider-send health and contains no lead PII.
    try {
      const valuationClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const rollingCutoff = new Date(Date.now() - (30 * 86_400_000)).toISOString();
      const [valuationRunResult, rollingItemsResult, localStatus] = await Promise.all([
        valuationClient
          .from('newsletter_valuation_runs')
          .select('id,run_date,status,source_revision,candidate_count,project_count,accepted_count,rejected_count,blocked_count,failed_count,last_heartbeat_at,last_meaningful_work_at,completed_at,blocker')
          .order('run_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        valuationClient
          .from('newsletter_valuation_items')
          .select('status,recorded_at')
          .in('status', ['accepted', 'rejected', 'blocked', 'failed'])
          .gte('recorded_at', rollingCutoff),
        readValuationLocalFailure(),
      ]);
      const runRow = valuationRunResult.data as Record<string, unknown> | null;
      const currentItemsResult = runRow
        ? await valuationClient
          .from('newsletter_valuation_items')
          .select('status,cache_valuation_id')
          .eq('run_id', String(runRow.id))
        : { data: [], error: null };
      const currentItems = (currentItemsResult.data || []) as Array<Record<string, unknown>>;
      const cacheIds = currentItems
        .filter((item) => item.status === 'accepted' && typeof item.cache_valuation_id === 'string')
        .map((item) => String(item.cache_valuation_id));
      const cacheResult = cacheIds.length
        ? await valuationClient
          .from('propnex_valuations')
          .select('id,fetched_at,evidence_status,evidence_contract_version,validated_confidence,expires_at')
          .in('id', cacheIds)
          .eq('evidence_status', 'accepted')
          .eq('evidence_contract_version', 'chloe-valuation-v1')
          .in('validated_confidence', ['medium', 'high'])
          .gt('expires_at', new Date().toISOString())
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        : { data: null, error: null };
      const run: ValuationPreparationRunSnapshot | null = runRow ? {
        runDate: String(runRow.run_date),
        status: String(runRow.status),
        candidateCount: Number(runRow.candidate_count || 0),
        projectCount: Number(runRow.project_count || 0),
        acceptedCount: Number(runRow.accepted_count || 0),
        rejectedCount: Number(runRow.rejected_count || 0),
        blockedCount: Number(runRow.blocked_count || 0),
        failedCount: Number(runRow.failed_count || 0),
        lastHeartbeatAt: typeof runRow.last_heartbeat_at === 'string' ? runRow.last_heartbeat_at : null,
        lastMeaningfulWorkAt: typeof runRow.last_meaningful_work_at === 'string'
          ? runRow.last_meaningful_work_at
          : null,
        completedAt: typeof runRow.completed_at === 'string' ? runRow.completed_at : null,
        blocker: typeof runRow.blocker === 'string' ? runRow.blocker : null,
      } : null;
      const rollingItems = (rollingItemsResult.data || []) as Array<Record<string, unknown>>;
      checks.newsletterValuation = deriveValuationPreparationHealth({
        enabled: process.env.SMARTPROP_VALUATION_ENABLED === '1',
        sourceRevision: typeof runRow?.source_revision === 'string' ? runRow.source_revision :
          (process.env.VALUATION_SOURCE_REVISION?.trim() || null),
        currentRun: run,
        newestAcceptedCacheAt: typeof cacheResult.data?.fetched_at === 'string'
          ? cacheResult.data.fetched_at
          : null,
        latestLocalFailure: localStatus.failure,
        rollingAcceptedImports: rollingItems.filter((item) => item.status === 'accepted').length,
        rollingCompletedItems: rollingItems.length,
        freshnessMinutes: parseValuationFreshnessMinutes(process.env.SMARTPROP_VALUATION_FRESHNESS_MINUTES),
        dataError: Boolean(
          valuationRunResult.error || rollingItemsResult.error ||
          currentItemsResult.error || cacheResult.error || localStatus.dataError
        ),
      });
    } catch {
      checks.newsletterValuation = deriveValuationPreparationHealth({
        enabled: process.env.SMARTPROP_VALUATION_ENABLED === '1',
        sourceRevision: process.env.VALUATION_SOURCE_REVISION?.trim() || null,
        currentRun: null,
        newestAcceptedCacheAt: null,
        latestLocalFailure: (await readValuationLocalFailure()).failure,
        rollingAcceptedImports: 0,
        rollingCompletedItems: 0,
        freshnessMinutes: parseValuationFreshnessMinutes(process.env.SMARTPROP_VALUATION_FRESHNESS_MINUTES),
        dataError: true,
      });
    }

    // Check environment variables
    const requiredEnvVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE',
      'GROQ_API_KEY'
    ];
    
    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    checks.environment = {
      status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
      missingVariables: missingEnvVars
    };
    
    if (missingEnvVars.length > 0) overallStatus = 'unhealthy';

    // Check memory usage
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      };
      
      checks.memory = {
        status: memUsageMB.heapUsed < 1000 ? 'healthy' : 'warning',
        usage: memUsageMB
      };
    }

    const responseTime = Date.now() - startTime;
    
    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks
    };

    // Return appropriate HTTP status code
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;

    return NextResponse.json(healthData, { status: statusCode });

  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
      checks
    }, { status: 503 });
  }
}
