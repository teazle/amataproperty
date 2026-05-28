import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { isCrmLeadStatus } from '@/lib/crm/validation';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');
    const status = searchParams.get('status');
    const search = searchParams.get('search')?.trim();

    let query = supabase
      .from('crm_leads')
      .select('*, crm_projects(*)')
      .order('created_at', { ascending: false })
      .limit(250);

    if (project && project !== 'all') {
      const { data: projectRow, error: projectError } = await supabase
        .from('crm_projects')
        .select('id')
        .eq('slug', project)
        .single();

      if (projectError || !projectRow) {
        return NextResponse.json({ leads: [] });
      }

      query = query.eq('project_id', projectRow.id);
    }

    if (status && status !== 'all' && isCrmLeadStatus(status)) {
      query = query.eq('status', status);
    }

    if (search) {
      const pattern = `%${search.replace(/[%_]/g, '')}%`;
      query = query.or(`name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},property_title.ilike.${pattern}`);
    }

    const { data: leads, error } = await query;

    if (error) {
      throw error;
    }

    const leadIds = (leads || []).map((lead) => lead.id);
    const activitiesByLead = new Map<string, unknown[]>();

    if (leadIds.length > 0) {
      const { data: activities, error: activityError } = await supabase
        .from('crm_lead_activities')
        .select('*')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false });

      if (activityError) {
        throw activityError;
      }

      for (const activity of activities || []) {
        const existing = activitiesByLead.get(activity.lead_id) || [];
        existing.push(activity);
        activitiesByLead.set(activity.lead_id, existing);
      }
    }

    return NextResponse.json({
      leads: (leads || []).map((lead) => ({
        ...lead,
        activities: activitiesByLead.get(lead.id) || [],
      })),
    });
  } catch (error) {
    console.error('[CRM] Failed to fetch leads:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CRM leads' },
      { status: 500 }
    );
  }
}
