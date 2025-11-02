/**
 * WhatsApp Template Messaging via WAHA
 * Handles sending template messages through WAHA API
 */

interface SendTemplateResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface WAHATemplateResponse {
  id: string;
  timestamp: number;
  from: string;
  to: string;
}

/**
 * Send a WhatsApp template message via WAHA
 * @param to - Recipient phone number (e.g., "6591234567" for Singapore)
 * @param templateName - Name of the template to send
 * @param parameters - Array of parameters to fill template placeholders
 * @returns Promise with success status and message ID
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  parameters: string[] = []
): Promise<SendTemplateResponse> {
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

  const url = `${WAHA_URL}/api/sendTemplate`;
  
  const payload = {
    session: WAHA_SESSION,
    chatId,
    template: {
      name: templateName,
      language: {
        code: 'en'
      },
      components: parameters.length > 0 ? [
        {
          type: 'body',
          parameters: parameters.map(param => ({
            type: 'text',
            text: param
          }))
        }
      ] : []
    }
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
      console.error('WAHA API error sending template:', errorData);
      return {
        success: false,
        error: errorData.error || `WAHA API request failed: ${response.status}`,
      };
    }

    const data: WAHATemplateResponse = await response.json();
    console.log(`✅ WhatsApp template message sent to ${to} (Template: ${templateName}, ID: ${data.id})`);
    
    return {
      success: true,
      messageId: data.id,
    };
  } catch (error: unknown) {
    console.error('Error sending WhatsApp template message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
