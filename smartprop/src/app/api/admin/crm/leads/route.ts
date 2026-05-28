import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { isCrmLeadStatus } from '@/lib/crm/validation';

const SORTABLE_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'last_activity_at',
  'follow_up_at',
  'name',
  'status',
  'priority',
  'property_title',
]);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');
    const status = searchParams.get('status');
    const search = searchParams.get('search')?.trim();

    const sortByParam = searchParams.get('sortBy') || 'created_at';
    const sortBy = SORTABLE_COLUMNS.has(sortByParam) ? sortByParam : 'created_at';
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const requestedSize = Number(searchParams.get('pageSize') || DEFAULT_PAGE_SIZE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('crm_leads')
      .select('*, crm_projects(*)', { count: 'exact' })
      .order(sortBy, { ascending: sortDir === 'asc', nullsFirst: false })
      .range(from, to);

    if (project && project !== 'all') {
      const { data: projectRow, error: projectError } = await supabase
        .from('crm_projects')
        .select('id')
        .eq('slug', project)
        .single();

      if (projectError || !projectRow) {
        return NextResponse.json({ leads: [], total: 0, page, pageSize });
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

    const { data: leads, error, count } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      leads: (leads || []).map((lead) => ({ ...lead, activities: [] })),
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[CRM] Failed to fetch leads:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CRM leads' },
      { status: 500 }
    );
  }
}
