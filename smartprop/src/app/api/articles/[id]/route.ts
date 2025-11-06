import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getArticleContent } from '@/lib/db/article-content';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase env not configured');
    const supabase = createClient(supabaseUrl, serviceKey);
    const { id } = await params;
    const { data: article, error: articleError } = await supabase
      .from('scraped_articles')
      .select('*')
      .eq('id', id)
      .single();

    if (articleError) throw articleError;

    const fullContent = await getArticleContent(id);

    return NextResponse.json({ article, fullContent });
  } catch (error: any) {
    console.error('Error fetching article:', error);
    return NextResponse.json(
      { error: 'Failed to fetch article' },
      { status: 500 }
    );
  }
}
