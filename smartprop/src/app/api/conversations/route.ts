/**
 * API Endpoint for Conversation Management
 * Provides CRUD operations for conversation data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    
    // Get query parameters
    const status = searchParams.get('status') || 'all';
    const phase = searchParams.get('phase') || 'all';
    const coBrokingStatus = searchParams.get('coBrokingStatus') || 'all';
    const searchTerm = searchParams.get('search') || '';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    let query = supabase
      .from('outreach')
      .select(`
        *,
        agents!inner(
          id,
          name,
          phone,
          email,
          agency,
          cea_reg_no
        ),
        listings!inner(
          id,
          title,
          price,
          district,
          property_type,
          url
        )
      `)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (phase !== 'all') {
      query = query.eq('conversation_phase', phase);
    }

    if (coBrokingStatus !== 'all') {
      query = query.eq('co_broking_status', coBrokingStatus);
    }

    if (searchTerm) {
      query = query.or(`
        agents.name.ilike.%${searchTerm}%,
        agents.phone.ilike.%${searchTerm}%,
        listings.title.ilike.%${searchTerm}%
      `);
    }

    const { data: outreachRecords, error } = await query;

    if (error) {
      console.error('Error fetching conversations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch conversations' },
        { status: 500 }
      );
    }

    // Transform data to match frontend expectations
    const conversations = (outreachRecords || []).map(record => ({
      id: record.id,
      agentId: record.agent_id,
      listingId: record.listing_id,
      agentName: record.agents.name,
      agentPhone: record.agents.phone,
      propertyTitle: record.listings.title,
      conversationHistory: Array.isArray(record.conversation_history) 
        ? record.conversation_history 
        : (typeof record.conversation_history === 'string'
          ? JSON.parse(record.conversation_history)
          : []),
      phase: {
        phase: record.conversation_phase || 'initial',
        objectives: {
          timeslotsReceived: record.viewing_timeslots ? true : false,
          timeslotsText: record.viewing_timeslots,
          coBrokingConfirmed: record.co_broking_status === 'willing' || record.co_broking_status === 'not_willing',
        }
      },
      coBrokingStatus: {
        status: record.co_broking_status || 'unknown',
        confirmed: record.co_broking_status === 'willing' || record.co_broking_status === 'not_willing',
        confirmedAt: record.co_broking_status ? record.last_message_at : undefined,
      },
      lastMessageAt: record.last_message_at || record.created_at,
      autoReplyCount: record.auto_reply_count || 0,
      deflectionCount: record.deflection_count || 0,
      daysElapsed: record.days_elapsed || 0,
      status: record.status,
      created_at: record.created_at,
    }));

    return NextResponse.json({
      conversations,
      total: conversations.length,
      hasMore: conversations.length === limit,
    });

  } catch (error) {
    console.error('Error in conversations API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, conversationId, updates } = body;

    const supabase = getSupabaseClient();

    switch (action) {
      case 'update_conversation':
        const { data, error } = await supabase
          .from('outreach')
          .update(updates)
          .eq('id', conversationId)
          .select()
          .single();

        if (error) {
          return NextResponse.json(
            { error: 'Failed to update conversation' },
            { status: 500 }
          );
        }

        return NextResponse.json({ conversation: data });

      case 'add_message':
        // Get current conversation
        const { data: currentConversation } = await supabase
          .from('outreach')
          .select('conversation_history')
          .eq('id', conversationId)
          .single();

        if (!currentConversation) {
          return NextResponse.json(
            { error: 'Conversation not found' },
            { status: 404 }
          );
        }

        // Add new message to history
        const conversationHistory = Array.isArray(currentConversation.conversation_history)
          ? currentConversation.conversation_history
          : (typeof currentConversation.conversation_history === 'string'
            ? JSON.parse(currentConversation.conversation_history)
            : []);

        conversationHistory.push({
          role: updates.role,
          message: updates.message,
          timestamp: updates.timestamp,
          messageId: updates.messageId,
        });

        // Update conversation
        const { data: updatedConversation, error: updateError } = await supabase
          .from('outreach')
          .update({
            conversation_history: conversationHistory,
            last_message_at: updates.timestamp,
          })
          .eq('id', conversationId)
          .select()
          .single();

        if (updateError) {
          return NextResponse.json(
            { error: 'Failed to add message' },
            { status: 500 }
          );
        }

        return NextResponse.json({ conversation: updatedConversation });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Error creating conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
