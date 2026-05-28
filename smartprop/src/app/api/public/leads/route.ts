import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { crmPublicLeadSchema } from '@/lib/crm/validation';
import { getPublicOrigin } from '@/lib/public-origin';

const defaultAllowedOrigins = [
  'https://viewproperty.ai',
  'https://www.viewproperty.ai',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function getAllowedOrigins() {
  const configured = process.env.CRM_ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured?.length ? configured : defaultAllowedOrigins;
}

function isAllowedOrigin(origin: string | null) {
  return !origin || getAllowedOrigins().includes(origin);
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');

  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (!isAllowedOrigin(origin)) {
    return NextResponse.json(
      { success: false, error: 'Origin is not allowed' },
      { status: 403, headers: corsHeaders }
    );
  }

  try {
    const payload = crmPublicLeadSchema.parse(await request.json());
    const supabase = getSupabaseClient();

    const { data: project, error: projectError } = await supabase
      .from('crm_projects')
      .select('id, title')
      .eq('slug', payload.projectSlug)
      .eq('is_active', true)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: 'Unknown project' },
        { status: 400, headers: corsHeaders }
      );
    }

    const sourceUrl = new URL(payload.sourcePath, getPublicOrigin(request)).toString();
    const { data: lead, error: leadError } = await supabase
      .from('crm_leads')
      .insert({
        project_id: project.id,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        message: payload.message,
        property_title: payload.propertyTitle,
        source_path: payload.sourcePath,
        source_url: sourceUrl,
        status: 'new',
        priority: 'normal',
      })
      .select('id')
      .single();

    if (leadError || !lead) {
      console.error('[CRM] Failed to create lead:', leadError);
      return NextResponse.json(
        { success: false, error: 'Failed to create lead' },
        { status: 500, headers: corsHeaders }
      );
    }

    const { error: activityError } = await supabase
      .from('crm_lead_activities')
      .insert({
        lead_id: lead.id,
        type: 'created',
        note: `Lead submitted from ${project.title}.`,
        metadata: {
          projectSlug: payload.projectSlug,
          sourcePath: payload.sourcePath,
        },
        created_by: 'system',
      });

    if (activityError) {
      console.error('[CRM] Failed to create initial activity:', activityError);
    }

    return NextResponse.json(
      { success: true, leadId: lead.id },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400, headers: corsHeaders }
    );
  }
}
