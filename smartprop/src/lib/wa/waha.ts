/**
 * WAHA (WhatsApp HTTP API) Integration
 * Free, self-hosted WhatsApp messaging via REST API
 * Docs: https://waha.devlike.pro
 */

interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  messageText?: string;
  error?: string;
}

interface WAHAApiResponse {
  id: string;
  timestamp: number;
  from: string;
  to: string;
  body?: string;
}

interface PresenceResponse {
  success: boolean;
  error?: string;
}

type PresenceState = 'composing' | 'recording' | 'paused' | 'available';

/**
 * Send a WhatsApp text message via WAHA
 * @param to - Recipient phone number (e.g., "6591234567" for Singapore)
 * @param text - Message text to send
 * @returns Promise with success status and message ID
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string
): Promise<SendMessageResponse> {
  const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3000';
  const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

  if (!WAHA_URL) {
    console.error('Missing WAHA configuration: WAHA_URL');
    return {
      success: false,
      error: 'WAHA not configured',
    };
  }

  // Check session status before attempting to send
  try {
    const statusResponse = await fetch(`${WAHA_URL}/api/sessions/${WAHA_SESSION}`);
    if (statusResponse.ok) {
      const sessionData = await statusResponse.json();
      const sessionStatus = sessionData?.status;
      
      if (sessionStatus !== 'WORKING') {
        console.error(`WAHA session status is "${sessionStatus}", expected "WORKING"`);
        return {
          success: false,
          error: `WAHA session is not ready (status: ${sessionStatus}). Please authenticate via QR code at ${WAHA_URL} or wait for session to initialize.`,
        };
      }
    }
  } catch (error) {
    console.warn('Could not check WAHA session status:', error);
    // Continue anyway - let the send attempt fail if session is not ready
  }

  // Format phone number for WhatsApp (must end with @c.us)
  const chatId = to.includes('@') ? to : `${to}@c.us`;

  const url = `${WAHA_URL}/api/sendText`;
  
  const payload = {
    session: WAHA_SESSION,
    chatId,
    text,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('WAHA API error:', errorData);
      
      // Provide helpful error message for session status issues
      if (errorData.error?.includes('Session status') || errorData.status === 422) {
        return {
          success: false,
          error: `WAHA session is not ready. Please authenticate via QR code at ${WAHA_URL} or check session status.`,
        };
      }
      
      return {
        success: false,
        error: errorData.error || `WAHA API request failed: ${response.status}`,
      };
    }

    const data: WAHAApiResponse = await response.json();
    console.log(`✅ WhatsApp message sent to ${to} (ID: ${data.id})`);
    
    return {
      success: true,
      messageId: data.id,
      messageText: text,
    };
  } catch (error: unknown) {
    console.error('Error sending WhatsApp message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate initial co-broking inquiry message (Agent-to-Agent)
 * 
 * @param agentName - Listing agent's name (full name, will extract first name)
 * @param propertyTitle - Property title
 * @param propertyUrl - URL to the property listing
 * @returns Formatted message text
 */
export function generateCoBrokingInquiryMessage(
  agentName: string,
  propertyTitle: string,
  propertyUrl: string
): string {
  const buyerAgentName = process.env.BUYER_AGENT_NAME || 'Jeremy';
  
  // Extract first name only for graceful greeting
  const firstName = agentName.split(' ')[0];
  
  return `Hi ${firstName}, ${buyerAgentName} here

I have a buyer who is interested in your ${propertyTitle}.

Would you be open to co-broking?

🔗 ${propertyUrl}`;
}

// Note: The second message (viewing request) is now handled by AI natural conversation
// This function is kept for backward compatibility but should not be used in new flows
export function generateViewingRequestMessage(
  agentName: string,
  propertyTitle: string
): string {
  const buyerAgentName = process.env.BUYER_AGENT_NAME || 'Jeremy';
  
  // Extract first name only for graceful greeting
  const firstName = agentName.split(' ')[0];
  
  return `Hi ${firstName}

Great to hear you're open to co-broking.

What viewing times do you have available this week for the ${propertyTitle}?

Thanks`;
}

/**
 * Send initial co-broking inquiry to an agent
 * @param agentPhone - Agent's phone number
 * @param agentName - Agent's name
 * @param propertyTitle - Property title
 * @param propertyUrl - URL to the property listing
 * @returns Promise with success status and message ID
 */
export async function sendCoBrokingInquiry(
  agentPhone: string,
  agentName: string,
  propertyTitle: string,
  propertyUrl: string
): Promise<SendMessageResponse> {
  const message = generateCoBrokingInquiryMessage(
    agentName,
    propertyTitle,
    propertyUrl
  );
  
  return sendWhatsAppMessage(agentPhone, message);
}

// Note: The viewing request is now handled by AI natural conversation after co-broking inquiry
// This function is kept for backward compatibility but should not be used in new flows
export async function sendViewingRequest(
  agentPhone: string,
  agentName: string,
  propertyTitle: string
): Promise<SendMessageResponse> {
  const message = generateViewingRequestMessage(
    agentName,
    propertyTitle
  );
  
  return sendWhatsAppMessage(agentPhone, message);
}

/**
 * Parse viewing timeslots from agent reply
 * This is a simple parser - can be enhanced with AI/NLP later
 * @param replyText - Agent's reply text
 * @returns Parsed viewing timeslots or null
 */
export function parseViewingTimeslots(replyText: string): string | null {
  if (!replyText) return null;
  
  // Simple extraction - look for time patterns
  // This can be enhanced with more sophisticated parsing
  const timePatterns = [
    /\d{1,2}:\d{2}\s*(am|pm|AM|PM)/gi,
    /\d{1,2}\s*(am|pm|AM|PM)/gi,
    /(morning|afternoon|evening)/gi,
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
    /\d{1,2}\/\d{1,2}\/\d{2,4}/gi,
    /\d{1,2}-\d{1,2}-(20\d{2})/gi,
  ];
  
  let hasTimeInfo = false;
  for (const pattern of timePatterns) {
    if (pattern.test(replyText)) {
      hasTimeInfo = true;
      break;
    }
  }
  
  // If message contains time-related information, return the full text
  // Otherwise return null (might be an irrelevant reply)
  return hasTimeInfo ? replyText : null;
}

/**
 * Send presence status to a chat (typing indicator)
 * @param to - Recipient phone number (e.g., "6591234567" for Singapore)
 * @param state - Presence state: 'composing' (typing), 'recording', 'paused', 'available' (stopped)
 * @returns Promise with success status
 */
export async function sendPresence(
  to: string,
  state: PresenceState = 'composing'
): Promise<PresenceResponse> {
  const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3000';
  const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

  if (!WAHA_URL) {
    console.error('Missing WAHA configuration: WAHA_URL');
    return {
      success: false,
      error: 'WAHA not configured',
    };
  }

  // Format phone number for WhatsApp (must end with @c.us)
  const chatId = to.includes('@') ? to : `${to}@c.us`;

  const url = `${WAHA_URL}/api/${WAHA_SESSION}/presence`;
  
  const payload = {
    chatId,
    presence: state,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('WAHA Presence API error:', errorData);
      return {
        success: false,
        error: errorData.error || `WAHA Presence API request failed: ${response.status}`,
      };
    }

    console.log(`✅ Presence '${state}' sent to ${to}`);
    
    return {
      success: true,
    };
  } catch (error: unknown) {
    console.error('Error sending presence:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Start typing indicator (composing status)
 * @param to - Recipient phone number
 * @returns Promise with success status
 */
export async function startTyping(to: string): Promise<PresenceResponse> {
  return sendPresence(to, 'composing');
}

/**
 * Stop typing indicator (available status)
 * @param to - Recipient phone number
 * @returns Promise with success status
 */
export async function stopTyping(to: string): Promise<PresenceResponse> {
  return sendPresence(to, 'available');
}

/**
 * Send message with typing delay (WEBJS engine doesn't support typing indicator)
 * Simulates human-like typing behavior with delay only
 * @param to - Recipient phone number
 * @param text - Message text to send
 * @param typingDuration - How long to delay before sending (ms)
 * @returns Promise with success status and message ID
 */
export async function sendMessageWithTyping(
  to: string,
  text: string,
  typingDuration: number
): Promise<SendMessageResponse> {
  try {
    // Note: WEBJS engine doesn't support presence API (typing indicators)
    // So we just add a realistic delay to simulate human typing time
    console.log(`⌨️  Simulating human typing delay: ${typingDuration}ms`);
    
    // Wait for typing duration (simulates thinking + typing time)
    await new Promise(resolve => setTimeout(resolve, typingDuration));
    
    // Send the actual message
    return await sendWhatsAppMessage(to, text);
  } catch (error: unknown) {
    console.error('Error in sendMessageWithTyping:', error);
    // Fallback: send message immediately
    return await sendWhatsAppMessage(to, text);
  }
}
