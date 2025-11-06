/**
 * API Endpoint for Sending Manual Messages
 * Sends manual messages via WhatsApp and updates conversation history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../../../workers/supa';
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
        { 
          error: 'Outreach record not found',
          details: fetchError?.message || 'Could not find outreach record with the provided ID'
        },
        { status: 404 }
      );
    }

    // Send WhatsApp message
    try {
      const phoneNumber = outreachRecord.agents.phone;
      if (!phoneNumber) {
        return NextResponse.json(
          { 
            error: 'No phone number found for agent',
            details: `Agent ${outreachRecord.agents.name || outreachRecord.agents.id} does not have a phone number configured`
          },
          { status: 400 }
        );
      }

      // Check WAHA configuration
      const WAHA_URL = process.env.WAHA_URL;
      if (!WAHA_URL) {
        console.error('WAHA_URL environment variable is not set');
        return NextResponse.json(
          { 
            error: 'WhatsApp service not configured',
            details: 'WAHA_URL environment variable is missing. Please configure it in your .env file.'
          },
          { status: 503 }
        );
      }

      // Normalize phone number (ensure it starts with country code)
      const normalizedPhone = phoneNumber.startsWith('65') ? phoneNumber : `65${phoneNumber}`;
      
      console.log(`Attempting to send WhatsApp message to ${normalizedPhone} via ${WAHA_URL}`);
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
        // Message was sent successfully, but database update failed
        // Return a warning but still indicate success
        return NextResponse.json({
          message: 'Message sent successfully, but failed to update database',
          messageId: sendResult.messageId,
          timestamp: newMessage.timestamp,
          warning: 'Database update failed. Message was sent but status may not be updated correctly.',
          error: updateError.message
        }, { status: 200 }); // Still return 200 since message was sent
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

  } catch (error: any) {
    console.error('Error in send manual message API:', error);
    
    // Handle JSON parsing errors
    if (error instanceof SyntaxError || error.message?.includes('JSON')) {
      return NextResponse.json(
        { 
          error: 'Invalid request format',
          details: 'Request body must be valid JSON'
        },
        { status: 400 }
      );
    }
    
    // Handle network/connection errors
    if (error instanceof TypeError && error.message?.includes('fetch')) {
      return NextResponse.json(
        { 
          error: 'Failed to connect to WhatsApp service',
          details: 'Check if WAHA_URL is configured correctly and WAHA service is running'
        },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    );
  }
}
