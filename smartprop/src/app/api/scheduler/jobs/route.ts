/**
 * API Routes for Scheduled Jobs Management
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { getScheduler, reloadScheduler } from '@/lib/scheduler/scraper-scheduler';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * GET /api/scheduler/jobs
 * List all scheduled jobs
 */
export async function GET(request: NextRequest) {
  try {
    const { data: jobs, error } = await supabase
      .from('scheduled_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ jobs: jobs || [] });
  } catch (error) {
    console.error('Error fetching scheduled jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/scheduler/jobs
 * Create a new scheduled job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, platform, cron_expression, timezone, config, enabled } = body;

    // Validation
    if (!name || !platform || !cron_expression || !config) {
      return NextResponse.json(
        { error: 'Missing required fields: name, platform, cron_expression, config' },
        { status: 400 }
      );
    }

    if (!['propertyguru', 'edgeprop'].includes(platform)) {
      return NextResponse.json(
        { error: 'Invalid platform. Must be "propertyguru" or "edgeprop"' },
        { status: 400 }
      );
    }

    // Validate cron expression
    if (!cron.validate(cron_expression)) {
      return NextResponse.json(
        { error: `Invalid cron expression: ${cron_expression}` },
        { status: 400 }
      );
    }

    // Validate config based on platform
    if (platform === 'propertyguru') {
      if (!config.districts || !Array.isArray(config.districts) || config.districts.length === 0) {
        return NextResponse.json(
          { error: 'PropertyGuru scraper requires districts array' },
          { status: 400 }
        );
      }
      if (!config.pages || config.pages < 1 || config.pages > 100) {
        return NextResponse.json(
          { error: 'Pages must be between 1 and 100' },
          { status: 400 }
        );
      }
    } else {
      if (!config.pages || config.pages < 1 || config.pages > 100) {
        return NextResponse.json(
          { error: 'Pages must be between 1 and 100' },
          { status: 400 }
        );
      }
    }

    // Calculate next run time
    const tempTask = cron.schedule(cron_expression, () => {}, {
      timezone: timezone || 'Asia/Singapore',
      name: 'temp',
    });
    const nextRun = tempTask.getNextRun() || new Date();
    tempTask.destroy();

    // Insert into database
    const { data: job, error } = await supabase
      .from('scheduled_jobs')
      .insert({
        name,
        platform,
        cron_expression,
        timezone: timezone || 'Asia/Singapore',
        config,
        enabled: enabled !== undefined ? enabled : true,
        next_run_at: nextRun.toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reload scheduler to pick up new job
    if (job.enabled) {
      try {
        await reloadScheduler();
      } catch (reloadError) {
        console.error('Failed to reload scheduler after creating job:', reloadError);
        // Don't fail the request, job is created in DB
      }
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error('Error creating scheduled job:', error);
    return NextResponse.json(
      { error: 'Failed to create scheduled job' },
      { status: 500 }
    );
  }
}

