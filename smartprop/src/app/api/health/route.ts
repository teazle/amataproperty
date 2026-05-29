import { createClient } from '@supabase/supabase-js';
import { NextRequest,NextResponse } from 'next/server';

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