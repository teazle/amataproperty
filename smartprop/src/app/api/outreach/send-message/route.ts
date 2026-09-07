/**
 * API Endpoint for Sending Manual Messages
 * Sends manual messages via WhatsApp and updates conversation history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { createCustomerTextTransport } from '@/lib/wa/customer-transport';
import { finalizeManualOutreachSend } from '@/lib/wa/manual-outreach';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { outreachId, message } = body;

    if (!outreachId || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: outreachId and message' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get the outreach record with agent details
    const { data: outreachRecord, error: fetchError } = await supabase
      .from('outreach')
      .select(`
        *,
        agents!inner(
          id,
          name,
          phone,
          email
        )
      `)
      .eq('id', outreachId)
      .single();

    if (fetchError || !outreachRecord) {
      console.error('Error fetching outreach record:', fetchError);
      return NextResponse.json(
        { error: 'Outreach record not found' },
        { status: 404 }
      );
    }

    // Send WhatsApp message
    try {
      const phoneNumber = outreachRecord.agents.phone;
      if (!phoneNumber) {
        return NextResponse.json(
          { error: 'No phone number found for agent' },
          { status: 400 }
        );
      }

      const finalized = await finalizeManualOutreachSend({
        outreachId,
        phone: phoneNumber,
        message,
        conversationHistory: Array.isArray(outreachRecord.conversation_history)
          ? outreachRecord.conversation_history
          : (typeof outreachRecord.conversation_history === 'string'
            ? JSON.parse(outreachRecord.conversation_history)
            : []),
        transport: createCustomerTextTransport(),
        persist: async (data) => supabase.from('outreach').update(data).eq('id', outreachId),
      });

      if (finalized.outcome !== 'accepted') {
        return NextResponse.json(
          {
            error: 'WhatsApp provider outcome requires manual review',
            outcome: finalized.outcome,
            retryable: false,
            details: finalized.error,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        message: finalized.reconciliationWarning
          ? 'Message accepted; conversation reconciliation required'
          : 'Message accepted successfully',
        messageId: finalized.messageId,
        timestamp: finalized.timestamp,
        ...(finalized.reconciliationWarning ? { reconciliationWarning: finalized.reconciliationWarning } : {}),
      }, { status: finalized.reconciliationWarning ? 202 : 200 });

    } catch (waError) {
      console.error('WhatsApp send error:', waError);
      return NextResponse.json(
        { error: 'Failed to send WhatsApp message', details: waError instanceof Error ? waError.message : 'Unknown error' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error in send manual message API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
