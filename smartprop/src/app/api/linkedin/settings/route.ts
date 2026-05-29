import { refreshLinkedInScheduler } from '@/lib/linkedin/scheduler';
import { getLinkedInSettings,updateLinkedInSettings,type LinkedInSettings } from '@/lib/linkedin/tracker';
import { NextRequest,NextResponse } from 'next/server';

/**
 * GET /api/linkedin/settings
 * Get LinkedIn settings
 */
export async function GET(_request: NextRequest) {
  try {
    const settings = await getLinkedInSettings();
    
    if (!settings) {
      return NextResponse.json(
        { error: 'Settings not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error getting LinkedIn settings:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : String(error)) || 'Failed to get settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/linkedin/settings
 * Update LinkedIn settings
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input
    const updates: Partial<LinkedInSettings> = {};
    
    if (body.profile_url !== undefined) {
      if (body.profile_url && !body.profile_url.includes('linkedin.com')) {
        return NextResponse.json(
          { error: 'Profile URL must be a LinkedIn URL' },
          { status: 400 }
        );
      }
      updates.profile_url = body.profile_url || null;
    }
    
    if (body.company_url !== undefined) {
      if (body.company_url && !body.company_url.includes('linkedin.com')) {
        return NextResponse.json(
          { error: 'Company URL must be a LinkedIn URL' },
          { status: 400 }
        );
      }
      updates.company_url = body.company_url;
    }
    
    if (body.daily_limit !== undefined) {
      const limit = parseInt(body.daily_limit);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        return NextResponse.json(
          { error: 'Daily limit must be between 1 and 100' },
          { status: 400 }
        );
      }
      updates.daily_limit = limit;
    }
    
    if (body.messages_per_job !== undefined) {
      const limit = parseInt(body.messages_per_job);
      if (isNaN(limit) || limit < 1 || limit > 500) {
        return NextResponse.json(
          { error: 'Messages per job must be between 1 and 500' },
          { status: 400 }
        );
      }
      updates.messages_per_job = limit;
    }
    
    if (body.min_delay !== undefined) {
      const delay = parseInt(body.min_delay);
      if (isNaN(delay) || delay < 1000 || delay > 30000) {
        return NextResponse.json(
          { error: 'Min delay must be between 1000 and 30000 ms' },
          { status: 400 }
        );
      }
      updates.min_delay = delay;
    }
    
    if (body.max_delay !== undefined) {
      const delay = parseInt(body.max_delay);
      if (isNaN(delay) || delay < 1000 || delay > 60000) {
        return NextResponse.json(
          { error: 'Max delay must be between 1000 and 60000 ms' },
          { status: 400 }
        );
      }
      updates.max_delay = delay;
    }
    
    if (body.message_template_profile !== undefined) {
      if (typeof body.message_template_profile !== 'string') {
        return NextResponse.json(
          { error: 'Profile template must be a string' },
          { status: 400 }
        );
      }
      updates.message_template_profile = body.message_template_profile;
    }
    
    if (body.message_template_company !== undefined) {
      if (typeof body.message_template_company !== 'string') {
        return NextResponse.json(
          { error: 'Company template must be a string' },
          { status: 400 }
        );
      }
      updates.message_template_company = body.message_template_company;
    }
    
    if (body.enabled !== undefined) {
      updates.enabled = Boolean(body.enabled);
    }
    
    if (body.auto_run_schedule !== undefined) {
      updates.auto_run_schedule = body.auto_run_schedule || null;
    }
    
    if (body.timezone !== undefined) {
      updates.timezone = body.timezone;
    }
    
    const updated = await updateLinkedInSettings(updates);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 }
      );
    }

    await refreshLinkedInScheduler();

    return NextResponse.json({
      success: true,
      settings: updated
    });
  } catch (error) {
    console.error('Error updating LinkedIn settings:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : String(error)) || 'Failed to update settings' },
      { status: 500 }
    );
  }
}
