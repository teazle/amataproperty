import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getArticleContent } from '@/lib/db/article-content';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: article, error: articleError } = await supabase
      .from('scraped_articles')
      .select('*')
      .eq('id', id)
      .single();

    if (articleError) throw articleError;

    const fullContent = await getArticleContent(id);

    return NextResponse.json({ article, fullContent });
  } catch (error) {
    console.error('Error fetching article:', error);
    return NextResponse.json(
      { error: 'Failed to fetch article' },
      { status: 500 }
    );
  }
}
