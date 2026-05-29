/**
 * API Endpoint for Sending Manual Messages
 * Sends manual messages via WhatsApp and updates conversation history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { sendWhatsAppMessage } from '@/lib/wa/waha';

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

      // Normalize phone number (ensure it starts with country code)
      const normalizedPhone = phoneNumber.startsWith('65') ? phoneNumber : `65${phoneNumber}`;
      
      const sendResult = await sendWhatsAppMessage(normalizedPhone, message);
      
      if (!sendResult.success) {
        return NextResponse.json(
          { error: 'Failed to send WhatsApp message', details: sendResult.error },
          { status: 500 }
        );
      }

      // Update conversation history
      const conversationHistory = Array.isArray(outreachRecord.conversation_history)
        ? outreachRecord.conversation_history
        : (typeof outreachRecord.conversation_history === 'string'
          ? JSON.parse(outreachRecord.conversation_history)
          : []);

      const newMessage = {
        role: 'user',
        message: message,
        timestamp: new Date().toISOString(),
        messageId: sendResult.messageId || `manual_${Date.now()}`
      };

      conversationHistory.push(newMessage);

      // Update the outreach record
      const { error: updateError } = await supabase
        .from('outreach')
        .update({
          conversation_history: conversationHistory,
          last_message_at: new Date().toISOString(),
          status: 'sent' // Update status to sent
        })
        .eq('id', outreachId);

      if (updateError) {
        console.error('Error updating conversation history:', updateError);
        // Don't fail the request since the message was sent successfully
      }

      return NextResponse.json({
        message: 'Message sent successfully',
        messageId: sendResult.messageId,
        timestamp: newMessage.timestamp
      });

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
