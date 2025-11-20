import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

/**
 * GET /api/linkedin/history
 * Get LinkedIn message history
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    
    const status = searchParams.get('status');
    const messageType = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    let query = supabase
      .from('linkedin_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (messageType) {
      query = query.eq('message_type', messageType);
    }
    
    const { data, error, count } = await query;
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({
      success: true,
      messages: data || [],
      total: count || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error('Error getting LinkedIn history:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get history' },
      { status: 500 }
    );
  }
}

