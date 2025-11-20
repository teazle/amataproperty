import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

/**
 * DELETE /api/linkedin/messages
 * Delete LinkedIn message(s)
 * Query params:
 *   - id: Delete a single message by ID
 *   - all: Delete all messages (value should be "true")
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    
    const id = searchParams.get('id');
    const deleteAll = searchParams.get('all') === 'true';
    
    if (deleteAll) {
      // Delete all messages
      // First, get all IDs to delete them
      const { data: allMessages, error: fetchError } = await supabase
        .from('linkedin_messages')
        .select('id');
      
      if (fetchError) {
        throw fetchError;
      }
      
      if (allMessages && allMessages.length > 0) {
        const ids = allMessages.map(m => m.id);
        const { error } = await supabase
          .from('linkedin_messages')
          .delete()
          .in('id', ids);
        
        if (error) {
          throw error;
        }
      }
      
      return NextResponse.json({
        success: true,
        message: 'All messages deleted successfully'
      });
    } else if (id) {
      // Delete a single message
      const { error } = await supabase
        .from('linkedin_messages')
        .delete()
        .eq('id', id);
      
      if (error) {
        throw error;
      }
      
      return NextResponse.json({
        success: true,
        message: 'Message deleted successfully'
      });
    } else {
      return NextResponse.json(
        { error: 'Missing required parameter: id or all=true' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('Error deleting LinkedIn message:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete message' },
      { status: 500 }
    );
  }
}

