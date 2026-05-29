/**
 * API Endpoint for Individual Conversation Management
 * Provides operations for specific conversation by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseClient();
    const { id } = await params;
    const conversationId = id;

    const { data: record, error } = await supabase
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
      .eq('id', conversationId)
      .single();

    if (error) {
      console.error('Error fetching conversation:', error);
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Transform data to match frontend expectations
    const conversation = {
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
    };

    return NextResponse.json({ conversation });

  } catch (error) {
    console.error('Error in conversation API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { id } = await params;
    const conversationId = id;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('outreach')
      .update(body)
      .eq('id', conversationId)
      .select()
      .single();

    if (error) {
      console.error('Error updating conversation:', error);
      return NextResponse.json(
        { error: 'Failed to update conversation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ conversation: data });

  } catch (error) {
    console.error('Error in conversation PUT API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
