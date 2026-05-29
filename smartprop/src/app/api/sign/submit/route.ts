import { sendTemplate } from '@/lib/wa/send';
import { createClient } from '@supabase/supabase-js';
import { NextRequest,NextResponse } from 'next/server';
import { PDFDocument,rgb,StandardFonts } from 'pdf-lib';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface SignSubmitRequest {
  aid: string;
  lid: string;
  commissionSplit: string;
  buyerRequirements: string;
  listingUrl: string;
}

/**
 * POST /api/sign/submit
 * Handles co-broking agreement submission
 */
export async function POST(request: NextRequest) {
  try {
    const body: SignSubmitRequest = await request.json();
    const { aid, lid, commissionSplit, buyerRequirements, listingUrl } = body;

    // Validate required fields
    if (!aid || !lid || !buyerRequirements || !listingUrl) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get current timestamp for Singapore timezone
    const signedAt = new Date().toISOString();

    // 1. Generate PDF
    const pdfBuffer = await generateAgreementPDF({
      agentId: aid,
      listingId: lid,
      commissionSplit,
      buyerRequirements,
      listingUrl,
      signedAt
    });

    // 2. Store PDF in Supabase Storage
    const pdfUrl = await storePDF(pdfBuffer, `agreement-${aid}-${lid}-${Date.now()}.pdf`);

    // 3. Save to cobroke_agreements table
    const { data: agreement, error: dbError } = await supabase
      .from('cobroke_agreements')
      .insert({
        agent_id: aid,
        listing_url: listingUrl,
        buyer_requirements: buyerRequirements,
        commission_split: commissionSplit,
        pdf_url: pdfUrl,
        signed_at: signedAt
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json(
        { error: 'Failed to save agreement to database' },
        { status: 500 }
      );
    }

    // 4. Send WhatsApp notification
    try {
      await sendWhatsAppNotification(aid, listingUrl);
    } catch (waError) {
      console.error('WhatsApp notification failed:', waError);
      // Don't fail the entire request if WhatsApp fails
    }

    // 5. Generate summary HTML and return
    const summaryHtml = generateSummaryHTML({
      agreementId: agreement.id,
      agentId: aid,
      listingId: lid,
      commissionSplit,
      buyerRequirements,
      listingUrl,
      pdfUrl,
      signedAt
    });

    return new NextResponse(summaryHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    });

  } catch (error) {
    console.error('Error in /api/sign/submit:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate PDF agreement using pdf-lib
 */
async function generateAgreementPDF(data: {
  agentId: string;
  listingId: string;
  commissionSplit: string;
  buyerRequirements: string;
  listingUrl: string;
  signedAt: string;
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width: _width, height } = page.getSize();
  const margin = 50;
  let yPosition = height - margin;

  // Title
  page.drawText('Co-broking Agreement', {
    x: margin,
    y: yPosition,
    size: 24,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  yPosition -= 40;

  // Agreement details
  const details = [
    ['Agreement ID:', data.agentId],
    ['Listing ID:', data.listingId],
    ['Commission Split:', data.commissionSplit],
    ['Listing URL:', data.listingUrl],
    ['Signed At:', new Date(data.signedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })],
  ];

  details.forEach(([label, value]) => {
    page.drawText(label, {
      x: margin,
      y: yPosition,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    page.drawText(value, {
      x: margin + 120,
      y: yPosition,
      size: 12,
      font: font,
      color: rgb(0, 0, 0),
    });
    yPosition -= 20;
  });

  yPosition -= 20;

  // Buyer Requirements section
  page.drawText('Buyer Requirements:', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  yPosition -= 20;

  // Split buyer requirements into multiple lines if needed
  const words = data.buyerRequirements.split(' ');
  const maxCharsPerLine = 80;
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + word).length > maxCharsPerLine && currentLine.length > 0) {
      page.drawText(currentLine, {
        x: margin,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0),
      });
      yPosition -= 15;
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  }
  
  if (currentLine.length > 0) {
    page.drawText(currentLine, {
      x: margin,
      y: yPosition,
      size: 12,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Store PDF in Supabase Storage
 */
async function storePDF(pdfBuffer: Buffer, filename: string): Promise<string> {
  // Upload to Supabase Storage
  const { data: _data, error } = await supabase.storage
    .from('agreements')
    .upload(filename, pdfBuffer, {
      contentType: 'application/pdf',
    });

  if (error) {
    console.error('Storage error:', error);
    throw new Error('Failed to store PDF');
  }

  const { data: { publicUrl } } = supabase.storage
    .from('agreements')
    .getPublicUrl(filename);

  return publicUrl;
}

/**
 * Send WhatsApp notification after successful submission
 */
async function sendWhatsAppNotification(agentId: string, listingUrl: string): Promise<void> {
  // Get agent phone number from database
  const { data: agent, error } = await supabase
    .from('agents')
    .select('phone')
    .eq('id', agentId)
    .single();

  if (error || !agent) {
    console.error('Failed to fetch agent phone:', error);
    return;
  }

  // Send WhatsApp message
  const result = await sendTemplate(
    agent.phone,
    'agreement_received',
    ['Co-broking Agreement', listingUrl]
  );

  if (!result.success) {
    console.error('WhatsApp send failed:', result.error);
  }
}

/**
 * Generate minimal HTML summary
 */
function generateSummaryHTML(data: {
  agreementId: string;
  agentId: string;
  listingId: string;
  commissionSplit: string;
  buyerRequirements: string;
  listingUrl: string;
  pdfUrl: string;
  signedAt: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agreement Submitted</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            background-color: #f9fafb;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e5e7eb;
        }
        .success-icon {
            font-size: 48px;
            color: #10b981;
            margin-bottom: 10px;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #f3f4f6;
        }
        .detail-label {
            font-weight: 600;
            color: #374151;
        }
        .detail-value {
            color: #6b7280;
            text-align: right;
            max-width: 60%;
            word-break: break-all;
        }
        .pdf-link {
            display: inline-block;
            background: #3b82f6;
            color: white;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
        }
        .pdf-link:hover {
            background: #2563eb;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="success-icon">✅</div>
            <h1>Agreement Submitted Successfully</h1>
            <p>Your co-broking agreement has been processed and saved.</p>
        </div>

        <div class="detail-row">
            <span class="detail-label">Agreement ID:</span>
            <span class="detail-value">${data.agreementId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Agent ID:</span>
            <span class="detail-value">${data.agentId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Listing ID:</span>
            <span class="detail-value">${data.listingId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Commission Split:</span>
            <span class="detail-value">${data.commissionSplit}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Listing URL:</span>
            <span class="detail-value"><a href="${data.listingUrl}" target="_blank">View Listing</a></span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Signed At:</span>
            <span class="detail-value">${new Date(data.signedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</span>
        </div>

        <div style="margin-top: 30px;">
            <a href="${data.pdfUrl}" class="pdf-link" target="_blank">
                📄 Download PDF Agreement
            </a>
        </div>

        <div class="footer">
            <p>A WhatsApp notification has been sent to the agent.</p>
            <p>Next step: Schedule a property viewing time.</p>
        </div>
    </div>
</body>
</html>
  `;
}
