import { NextRequest, NextResponse } from 'next/server';

// Health check endpoint for load balancer
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const checks: Record<string, any> = {};
  let overallStatus = 'healthy';

  try {
    // Check database connectivity using Supabase REST with server-only env vars
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) {
        throw new Error('Missing SUPABASE_URL or service role key');
      }
      const dbStart = Date.now();
      const resp = await fetch(`${supabaseUrl}/rest/v1/listings?select=id&limit=1`, {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      } as any);

      if (resp.ok) {
        checks.database = {
          status: 'healthy',
          responseTime: Date.now() - dbStart,
          method: 'undici-rest'
        };
      } else {
        const text = await resp.text().catch(() => '');
        checks.database = {
          status: 'unhealthy',
          responseTime: Date.now() - dbStart,
          statusCode: resp.status,
          error: text || 'Non-2xx response from Supabase REST',
          method: 'undici-rest'
        };
        overallStatus = 'degraded';
      }
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
        headers: { 'Content-Type': 'application/json' },
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

    // Check environment variables
    const requiredEnvVars = [
      'SUPABASE_URL',
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