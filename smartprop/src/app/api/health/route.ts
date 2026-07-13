import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { NextRequest,NextResponse } from 'next/server';

import {
  deriveNewsletterHealth,
  normalizeSourceRevision,
  parseNewsletterFreshnessMinutes,
  type NewsletterRunHealthSnapshot,
} from '@/lib/newsletter/newsletter-health';
import { getWAHAHeaders, getWAHAReadiness } from '@/lib/wa/waha';

const SOURCE_REVISION_PATH = process.env.SMARTPROP_DEPLOY_SOURCE_REVISION_PATH || '/opt/smartprop/app/smartprop/.deploy-source-revision';

async function readSourceRevision(): Promise<string | null> {
  try {
    const revision = (await readFile(SOURCE_REVISION_PATH, 'utf8')).trim();
    return normalizeSourceRevision(revision);
  } catch {
    return null;
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
