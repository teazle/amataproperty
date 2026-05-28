import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: projects, error } = await supabase
      .from('crm_projects')
      .select('*')
      .order('title', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ projects: projects || [] });
  } catch (error) {
    console.error('[CRM] Failed to fetch projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CRM projects' },
      { status: 500 }
    );
  }
}
