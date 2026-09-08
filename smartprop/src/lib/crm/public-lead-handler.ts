import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { crmPublicLeadSchema } from './validation';
import { getPublicOrigin } from '@/lib/public-origin';

const defaultAllowedOrigins = [
  'https://viewproperty.ai',
  'https://www.viewproperty.ai',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const PER_IP_PROJECT_LIMIT = 5;
const PER_IP_PROJECT_WINDOW_MS = 10 * 60 * 1000;
const PER_PROJECT_LIMIT = 30;
const PER_PROJECT_WINDOW_MS = 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 5_000;

type RateLimitRule = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export class PublicLeadRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = MAX_RATE_LIMIT_KEYS,
  ) {}

  check(clientIp: string, projectSlug: string): number | null {
    const timestamp = this.now();
    this.prune(timestamp);

    const rules: RateLimitRule[] = [
      {
        key: `ip:${clientIp}:project:${projectSlug}`,
        limit: PER_IP_PROJECT_LIMIT,
        windowMs: PER_IP_PROJECT_WINDOW_MS,
      },
      {
        key: `project:${projectSlug}`,
        limit: PER_PROJECT_LIMIT,
        windowMs: PER_PROJECT_WINDOW_MS,
      },
    ];

    for (const rule of rules) {
      const bucket = this.buckets.get(rule.key);
      if (bucket && bucket.resetAt > timestamp && bucket.count >= rule.limit) {
        return Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
      }
    }

    for (const rule of rules) {
      const current = this.buckets.get(rule.key);
      if (!current || current.resetAt <= timestamp) {
        this.ensureCapacity();
        this.buckets.set(rule.key, { count: 1, resetAt: timestamp + rule.windowMs });
        continue;
      }

      current.count += 1;
      this.buckets.delete(rule.key);
      this.buckets.set(rule.key, current);
    }

    return null;
  }

  private prune(timestamp: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= timestamp) {
        this.buckets.delete(key);
      }
    }
  }

  private ensureCapacity() {
    while (this.buckets.size >= this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.buckets.delete(oldestKey);
    }
  }
}

export type PublicLeadHandlerDependencies = {
  getSupabaseClient: typeof getSupabaseClient;
  limiter: PublicLeadRateLimiter;
};

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

function hasFilledHoneypot(body: unknown) {
  return Boolean(
    body &&
    typeof body === 'object' &&
    'website' in body &&
    typeof body.website === 'string' &&
    body.website.trim(),
  );
}

function getClientIp(request: NextRequest) {
  // Production Nginx must overwrite X-Real-IP from the connection address. Requests
  // that bypass that trusted proxy share this conservative bucket instead of trusting X-Forwarded-For.
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

const defaultDependencies: PublicLeadHandlerDependencies = {
  getSupabaseClient,
  limiter: new PublicLeadRateLimiter(),
};

export function createPublicLeadPostHandler(overrides: Partial<PublicLeadHandlerDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);

    if (!isAllowedOrigin(origin)) {
      return NextResponse.json(
        { success: false, error: 'Origin is not allowed' },
        { status: 403, headers: corsHeaders },
      );
    }

    try {
      const body = await request.json();
      if (hasFilledHoneypot(body)) {
        return NextResponse.json({ success: true }, { headers: corsHeaders });
      }

      const payload = crmPublicLeadSchema.parse(body);
      const retryAfterSeconds = dependencies.limiter.check(getClientIp(request), payload.projectSlug);
      if (retryAfterSeconds !== null) {
        return NextResponse.json(
          { success: false, error: 'Too many lead requests. Please try again later.' },
          {
            status: 429,
            headers: { ...corsHeaders, 'Retry-After': String(retryAfterSeconds) },
          },
        );
      }

      const supabase = dependencies.getSupabaseClient();
      const { data: project, error: projectError } = await supabase
        .from('crm_projects')
        .select('id, title')
        .eq('slug', payload.projectSlug)
        .eq('is_active', true)
        .single();

      if (projectError || !project) {
        return NextResponse.json(
          { success: false, error: 'Unknown project' },
          { status: 400, headers: corsHeaders },
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
          { status: 500, headers: corsHeaders },
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
        { headers: corsHeaders },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      return NextResponse.json(
        { success: false, error: message },
        { status: 400, headers: corsHeaders },
      );
    }
  };
}

export function createPublicLeadOptionsHandler() {
  return async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get('origin');

    if (!isAllowedOrigin(origin)) {
      return new NextResponse(null, { status: 403 });
    }

    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  };
}
