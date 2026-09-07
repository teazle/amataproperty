import type { SupabaseClient } from '@supabase/supabase-js';

export async function conditionalArticleRepair(
  client: Pick<SupabaseClient, 'from'>,
  snapshot: { id: string; article_id: string; updated_at: string },
  patch: Record<string, unknown>,
): Promise<{ status: 'updated' | 'concurrent-change'; row?: Record<string, unknown> }> {
  const { data, error } = await client.from('article_full_content')
    .update(patch)
    .eq('id', snapshot.id)
    .eq('article_id', snapshot.article_id)
    .eq('updated_at', snapshot.updated_at)
    .select('*');
  if (error) throw new Error(error.message);
  if (!data?.length) return { status: 'concurrent-change' };
  if (data.length !== 1) throw new Error('Unexpected conditional update cardinality');
  return { status: 'updated', row: data[0] };
}
