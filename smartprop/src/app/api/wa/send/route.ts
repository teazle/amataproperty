import { sendApiText } from '@/lib/wa/api-text';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/wa/send
 * Send WhatsApp messages via the configured customer transport
 * 
 * Body Examples:
 * 
 * 1. Send simple text message:
 * {
 *   "to": "6591234567",
 *   "text": "Hello there!"
 * }
 * 
 * 2. Send co-broking inquiry (auto-generates message):
 * {
 *   "to": "6591234567",
 *   "type": "co_broking_inquiry",
 *   "agentName": "John Tan",
 *   "propertyTitle": "Beautiful 3BR Condo in District 9",
 *   "propertyUrl": "https://propertyguru.com.sg/listing/123"
 * }
 * 
 * 3. Send viewing request (follow-up after co-broking agreement) - NOW HANDLED BY AI:
 * Note: Viewing requests are now handled automatically by AI natural conversation
 * after the agent responds to the co-broking inquiry. No manual viewing_request needed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, text, type, agentName, propertyTitle, propertyUrl } = body;

    // Validate required fields
    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to' },
        { status: 400 }
      );
    }

    // Handle co-broking inquiry type
    if (type === 'co_broking_inquiry') {
      if (!agentName || !propertyTitle || !propertyUrl) {
        return NextResponse.json(
          { error: 'Missing fields for co-broking inquiry: agentName, propertyTitle, propertyUrl' },
          { status: 400 }
        );
      }
    }
    // Handle viewing request type (DEPRECATED - now handled by AI natural conversation)
    else if (type === 'viewing_request') {
      return NextResponse.json(
        { error: 'viewing_request type is deprecated. Viewing requests are now handled automatically by AI natural conversation after co-broking inquiry.' },
        { status: 400 }
      );
    } 
    // Handle simple text message
    else {
      if (!text) {
        return NextResponse.json(
          { error: 'Missing required field: text' },
          { status: 400 }
        );
      }
    }

    const result = await sendApiText({
      to,
      text,
      type,
      agentName,
      propertyTitle,
      propertyUrl,
    });

    if (result.outcome !== 'accepted' || !result.messageId.trim()) {
      return NextResponse.json(
        {
          error: 'WhatsApp provider outcome requires manual review',
          outcome: result.outcome === 'accepted' ? 'unknown' : result.outcome,
          retryable: false,
          details: result.outcome === 'accepted'
            ? 'customer transport accepted a send without a message id'
            : result.error,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      messageText: result.messageText,
    });
  } catch (error) {
    console.error('Error in /api/wa/send:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
