import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { crmLeadUpdateSchema, formatCrmStatus } from '@/lib/crm/validation';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    const { data: lead, error: leadError } = await supabase
      .from('crm_leads')
      .select('*, crm_projects(*)')
      .eq('id', id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const { data: activities, error: activityError } = await supabase
      .from('crm_lead_activities')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false });

    if (activityError) {
      throw activityError;
    }

    return NextResponse.json({
      lead: { ...lead, activities: activities || [] },
    });
  } catch (error) {
    console.error('[CRM] Failed to fetch lead:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lead' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const payload = crmLeadUpdateSchema.parse(await request.json());
    const supabase = getSupabaseClient();

    const { data: existingLead, error: existingError } = await supabase
      .from('crm_leads')
      .select('id, status, priority, assigned_to, follow_up_at')
      .eq('id', id)
      .single();

    if (existingError || !existingLead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const updateData: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };

    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.priority !== undefined) updateData.priority = payload.priority;
    if (payload.assignedTo !== undefined) updateData.assigned_to = payload.assignedTo;
    if (payload.followUpAt !== undefined) updateData.follow_up_at = payload.followUpAt;

    const { data: lead, error: updateError } = await supabase
      .from('crm_leads')
      .update(updateData)
      .eq('id', id)
      .select('*, crm_projects(*)')
      .single();

    if (updateError) {
      throw updateError;
    }

    const activities = [];
    if (payload.status && payload.status !== existingLead.status) {
      activities.push({
        lead_id: id,
        type: 'status_change',
        note: `Status changed from ${formatCrmStatus(existingLead.status)} to ${formatCrmStatus(payload.status)}.`,
        metadata: {
          from: existingLead.status,
          to: payload.status,
        },
      });
    }

    if (payload.followUpAt && payload.followUpAt !== existingLead.follow_up_at) {
      activities.push({
        lead_id: id,
        type: 'follow_up_scheduled',
        note: `Follow-up scheduled for ${new Date(payload.followUpAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}.`,
        metadata: {
          followUpAt: payload.followUpAt,
        },
      });
    }

    if (activities.length > 0) {
      const { error: activityError } = await supabase
        .from('crm_lead_activities')
        .insert(activities);

      if (activityError) {
        console.error('[CRM] Failed to write update activities:', activityError);
      }
    }

    const { data: allActivities } = await supabase
      .from('crm_lead_activities')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false });

    return NextResponse.json({ lead: { ...lead, activities: allActivities || [] } });
  } catch (error) {
    console.error('[CRM] Failed to update lead:', error);
    const message = error instanceof Error ? error.message : 'Failed to update lead';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
