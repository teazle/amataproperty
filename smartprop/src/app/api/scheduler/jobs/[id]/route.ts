/**
 * API Routes for Individual Scheduled Job Operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { getScheduler, reloadScheduler } from '@/lib/scheduler/scraper-scheduler';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * PATCH /api/scheduler/jobs/[id]
 * Update a scheduled job
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, platform, cron_expression, timezone, config, enabled } = body;

    // Get existing job
    const { data: existingJob, error: fetchError } = await supabase
      .from('scheduled_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existingJob) {
      return NextResponse.json(
        { error: 'Scheduled job not found' },
        { status: 404 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (platform !== undefined) {
      if (!['propertyguru', 'edgeprop'].includes(platform)) {
        return NextResponse.json(
          { error: 'Invalid platform. Must be "propertyguru" or "edgeprop"' },
          { status: 400 }
        );
      }
      updates.platform = platform;
    }
    if (cron_expression !== undefined) {
      // Validate cron expression
      if (!cron.validate(cron_expression)) {
        return NextResponse.json(
          { error: `Invalid cron expression: ${cron_expression}` },
          { status: 400 }
        );
      }
      updates.cron_expression = cron_expression;
    }
    if (timezone !== undefined) updates.timezone = timezone;
    if (config !== undefined) updates.config = config;
    if (enabled !== undefined) updates.enabled = enabled;

    // Calculate next run time if cron or timezone changed
    if (cron_expression !== undefined || timezone !== undefined) {
      const finalCron = cron_expression || existingJob.cron_expression;
      const finalTimezone = timezone || existingJob.timezone;
      const tempTask = cron.schedule(finalCron, () => {}, {
        timezone: finalTimezone,
        name: 'temp',
      });
      const nextRun = tempTask.getNextRun() || new Date();
      tempTask.destroy();
      updates.next_run_at = nextRun.toISOString();
    }

    // Update in database
    const { data: job, error } = await supabase
      .from('scheduled_jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reload scheduler to pick up changes
    try {
      await reloadScheduler();
    } catch (reloadError) {
      console.error('Failed to reload scheduler after updating job:', reloadError);
      // Don't fail the request, job is updated in DB
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Error updating scheduled job:', error);
    return NextResponse.json(
      { error: 'Failed to update scheduled job' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/scheduler/jobs/[id]
 * Delete a scheduled job
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Remove from scheduler
    const scheduler = getScheduler();
    scheduler.removeSchedule(id);

    // Delete from database
    const { error } = await supabase
      .from('scheduled_jobs')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting scheduled job:', error);
    return NextResponse.json(
      { error: 'Failed to delete scheduled job' },
      { status: 500 }
    );
  }
}
