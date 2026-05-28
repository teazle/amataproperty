import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { crmActivityCreateSchema } from '@/lib/crm/validation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const payload = crmActivityCreateSchema.parse(await request.json());
    const supabase = getSupabaseClient();

    const { data: activity, error } = await supabase
      .from('crm_lead_activities')
      .insert({
        lead_id: id,
        type: payload.type,
        note: payload.note,
        metadata: payload.followUpAt ? { followUpAt: payload.followUpAt } : {},
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    const leadUpdate: Record<string, string> = {
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (payload.followUpAt) {
      leadUpdate.follow_up_at = payload.followUpAt;
    }

    await supabase
      .from('crm_leads')
      .update(leadUpdate)
      .eq('id', id);

    return NextResponse.json({ activity });
  } catch (error) {
    console.error('[CRM] Failed to create activity:', error);
    const message = error instanceof Error ? error.message : 'Failed to create activity';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
