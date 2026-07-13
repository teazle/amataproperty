import type { SupabaseClient } from '@supabase/supabase-js';

import { aggregateProjectValuation } from './valuation';
import { normalizeSingaporeRecipient } from './recipient';
import { buildOperatorReportRows } from './operator-report';
import type {
  CampaignCandidate,
  CampaignRun,
  NewsletterAttempt,
  NewsletterIssue,
} from './campaign-runner';
import type {
  CampaignTransportResult,
  NewsletterValuationRow,
  NewsletterValuationSnapshot,
} from './campaign-types';

export interface FinalizeAttemptInput {
  attemptId: string;
  result: CampaignTransportResult;
}

export interface OperatorReport {
  id: string;
  operatorKey: string;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'unknown';
}

export interface TestSendInput {
  issueId: string;
  sourceLeadId: string;
  sourcePhone: string;
  overridePhone: string;
  recipientName: string;
  renderedBody: string;
  valuation: NewsletterValuationSnapshot;
  isTest: true;
}

export interface RecoveryRecord {
  kind: 'accepted-crm-finalization-failure';
  runId: string;
  attemptId: string;
  providerMessageId: string;
  recipientKey: string;
  error: string;
  recordedAt: string;
}

export interface CampaignStore {
  resolveIssue(issueId?: string): Promise<NewsletterIssue>;
  claimToday(claimToken: string): Promise<CampaignRun>;
  listAttempts(runId: string): Promise<NewsletterAttempt[]>;
  recoverAbandoned(runId: string, olderThan: Date): Promise<number>;
  recoverStaleReports(runId: string, olderThan: Date): Promise<number>;
  selectCandidates(issue: NewsletterIssue, limit: number, referenceTime?: Date): Promise<CampaignCandidate[]>;
  selectCandidate(issue: NewsletterIssue, leadId: string): Promise<CampaignCandidate | null>;
  queueAttempt(
    run: CampaignRun,
    candidate: CampaignCandidate,
    claimToken: string,
    body: string,
  ): Promise<NewsletterAttempt | 'suppressed'>;
  startAttempt(
    attempt: NewsletterAttempt,
    run: CampaignRun,
    slotNo: number,
    claimToken: string,
  ): Promise<NewsletterAttempt | 'suppressed'>;
  finalizeAttempt(input: FinalizeAttemptInput): Promise<void>;
  queueOperatorReports(runId: string, operators: string[]): Promise<OperatorReport[]>;
  startReport(id: string): Promise<boolean>;
  finalizeReport(id: string, result: CampaignTransportResult): Promise<void>;
  heartbeat(runId: string): Promise<void>;
  finishRun(runId: string, blocker: string | null): Promise<CampaignRun>;
  markRecoveryRequired(runId: string, blocker: string): Promise<void>;
  recordAcceptedRecovery(attemptId: string, providerMessageId: string, error: string): Promise<void>;
  createTestSend(input: TestSendInput): Promise<string>;
  finalizeTestSend(id: string, result: CampaignTransportResult): Promise<void>;
  resolveUnknown(sendId: string, resolver: string, resolution: 'sent' | 'failed', reason: string): Promise<void>;
}

interface DatabaseError {
  code?: string;
  message: string;
}

function fail(error: DatabaseError | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

function issueFromRow(row: Record<string, unknown>): NewsletterIssue {
  const featured = Array.isArray(row.featured_projects) ? row.featured_projects : [];
  return {
    id: String(row.id),
    slug: String(row.slug),
    status: row.status === 'sending' ? 'sending' : 'approved',
    featuredProjects: featured.flatMap((value) => {
      if (!value || typeof value !== 'object' || !('title' in value)) return [];
      const title = String((value as { title: unknown }).title).trim();
      return title ? [{ title }] : [];
    }),
    audienceProjectSlug: typeof row.audience_project_slug === 'string'
      ? row.audience_project_slug
      : null,
  };
}

function runFromRow(row: Record<string, unknown>, issueSlug = 'unknown'): CampaignRun {
  return {
    id: String(row.id),
    runDate: String(row.run_date),
    issueId: String(row.issue_id),
    issueSlug,
    status: row.status as CampaignRun['status'],
    selectedCount: Number(row.selected_count || 0),
    attemptedCount: Number(row.attempted_count || 0),
    sentCount: Number(row.sent_count || 0),
    failedCount: Number(row.failed_count || 0),
    unknownCount: Number(row.unknown_count || 0),
    skippedCount: Number(row.skipped_count || 0),
    blocker: typeof row.blocker === 'string' ? row.blocker : null,
    reportError: typeof row.report_error === 'string' ? row.report_error : null,
  };
}

function attemptFromRow(row: Record<string, unknown>): NewsletterAttempt {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    leadId: typeof row.lead_id === 'string' ? row.lead_id : null,
    slotNo: row.slot_no === null || row.slot_no === undefined ? null : Number(row.slot_no),
    recipientName: String(row.recipient_name || 'Unknown'),
    recipientKey: String(row.recipient_key || row.phone),
    renderedBody: String(row.rendered_body),
    status: row.status as NewsletterAttempt['status'],
    attemptNo: row.attempt_no === null || row.attempt_no === undefined ? null : Number(row.attempt_no),
    retryable: row.retryable === true,
  };
}

async function paginatedRows(
  load: (from: number, to: number) => Promise<{ data: unknown[] | null; error: DatabaseError | null }>,
  operation: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = 200;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await load(from, from + pageSize - 1);
    fail(error, operation);
    const page = (data || []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function createCampaignStore(client: SupabaseClient): CampaignStore {
  async function issueSlug(issueId: string): Promise<string> {
    const { data, error } = await client.from('newsletter_issues').select('slug').eq('id', issueId).single();
    fail(error, 'load newsletter issue slug');
    return String(data?.slug || 'unknown');
  }

  return {
    async resolveIssue(issueId) {
      let query = client
        .from('newsletter_issues')
        .select('id,slug,status,audience_project_slug,featured_projects,approved_at,created_at');
      query = issueId
        ? query.eq('id', issueId)
        : query.in('status', ['approved', 'sending'])
          .order('approved_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(1);
      const { data, error } = await query.maybeSingle();
      fail(error, 'resolve newsletter issue');
      if (!data) throw new Error('No approved or sending newsletter issue is available.');
      return issueFromRow(data);
    },

    async claimToday(claimToken) {
      const { data, error } = await client.rpc('claim_newsletter_run', { p_claim_token: claimToken });
      fail(error, 'claim newsletter run');
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) throw new Error('claim_newsletter_run returned no run.');
      return runFromRow(row, row.issue_id ? await issueSlug(String(row.issue_id)) : 'none');
    },

    async listAttempts(runId) {
      const { data, error } = await client
        .from('newsletter_sends')
        .select('id,run_id,lead_id,slot_no,recipient_name,recipient_key,phone,rendered_body,status,attempt_no,retryable')
        .eq('run_id', runId)
        .eq('is_test', false)
        .order('slot_no', { ascending: true });
      fail(error, 'list newsletter attempts');
      return (data || []).map((row) => attemptFromRow(row));
    },

    async recoverAbandoned(runId, olderThan) {
      const { data, error } = await client
        .from('newsletter_sends')
        .select('id')
        .eq('run_id', runId)
        .eq('status', 'sending')
        .lt('attempt_started_at', olderThan.toISOString())
        .order('attempt_started_at', { ascending: true })
        .order('id', { ascending: true });
      fail(error, 'find abandoned newsletter attempts');
      for (const row of data || []) {
        const finalized = await client.rpc('finalize_newsletter_attempt', {
          p_send_id: row.id,
          p_provider_outcome: 'unknown',
          p_provider_message_id: null,
          p_error: 'runner restarted before provider outcome was finalized',
          p_retryable: false,
        });
        fail(finalized.error, 'recover abandoned newsletter attempt');
      }
      return data?.length || 0;
    },

    async selectCandidates(issue, limit, referenceTime = new Date()) {
      if (!issue.audienceProjectSlug) return [];
      const projectResult = await client
        .from('crm_projects')
        .select('id,title')
        .eq('slug', issue.audienceProjectSlug)
        .eq('is_active', true)
        .maybeSingle();
      fail(projectResult.error, 'resolve campaign audience project');
      if (!projectResult.data) return [];
      const project = projectResult.data;

      const [leads, sends, suppressions, valuations] = await Promise.all([
        paginatedRows(async (from, to) => {
          const result = await client.from('crm_leads')
            .select('id,name,phone,phone_e164,property_title,lead_code,priority,created_at,status,opt_out_at')
            .eq('project_id', project.id)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        }, 'paginate campaign CRM leads'),
        paginatedRows(async (from, to) => {
          const result = await client.from('newsletter_sends')
            .select('id,recipient_key,status,retryable,attempt_started_at')
            .eq('issue_id', issue.id)
            .eq('is_test', false)
            .order('recipient_key', { ascending: true })
            .order('attempt_started_at', { ascending: true, nullsFirst: true })
            .order('id', { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        }, 'paginate prior campaign attempts'),
        paginatedRows(async (from, to) => {
          const result = await client.from('newsletter_suppressions')
            .select('recipient_key')
            .order('recipient_key', { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        }, 'paginate newsletter suppressions'),
        paginatedRows(async (from, to) => {
          const result = await client.from('propnex_valuations')
            .select('id,project_name,low_sgd,mid_sgd,high_sgd,comparables_count,as_of,expires_at')
            .gt('expires_at', referenceTime.toISOString())
            .order('project_name', { ascending: true })
            .order('expires_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        }, 'paginate newsletter valuations'),
      ]);

      const valuation = aggregateProjectValuation(
        String(project.title),
        valuations as unknown as NewsletterValuationRow[],
        referenceTime,
      );
      if (!valuation) return [];
      const suppressed = new Set(suppressions.map((row) => String(row.recipient_key)));
      const attemptsByRecipient = new Map<string, Record<string, unknown>[]>();
      for (const send of sends) {
        const key = typeof send.recipient_key === 'string' ? send.recipient_key : '';
        if (!key) continue;
        attemptsByRecipient.set(key, [...(attemptsByRecipient.get(key) || []), send]);
      }
      const priorityOrder = { high: 0, normal: 1, low: 2 } as const;

      return leads.flatMap((lead): CampaignCandidate[] => {
        const recipientKey = normalizeSingaporeRecipient(String(lead.phone_e164 || lead.phone || ''));
        const priority = lead.priority === 'high' || lead.priority === 'low' ? lead.priority : 'normal';
        const prior = recipientKey ? attemptsByRecipient.get(recipientKey) || [] : [];
        const attemptCount = prior.filter((send) => send.attempt_started_at !== null).length;
        const hasBlockingAttempt = prior.some((send) =>
          ['queued', 'sending', 'sent', 'unknown'].includes(String(send.status)) ||
          (send.status === 'failed' && send.retryable !== true));
        if (!recipientKey || suppressed.has(recipientKey) || lead.opt_out_at || lead.status === 'lost' ||
            !lead.lead_code || hasBlockingAttempt || attemptCount >= 3) return [];
        return [{
          id: String(lead.id),
          name: String(lead.name),
          recipientKey,
          propertyTitle: String(lead.property_title),
          leadCode: String(lead.lead_code),
          priority,
          createdAt: String(lead.created_at),
          attemptCount,
          valuation,
        }];
      }).sort((left, right) => {
        const leftRetry = left.attemptCount > 0 ? 0 : 1;
        const rightRetry = right.attemptCount > 0 ? 0 : 1;
        return leftRetry - rightRetry || priorityOrder[left.priority] - priorityOrder[right.priority] ||
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
      }).slice(0, limit);
    },

    async selectCandidate(issue, leadId) {
      const candidates = await this.selectCandidates(issue, Number.MAX_SAFE_INTEGER);
      return candidates.find((candidate) => candidate.id === leadId) || null;
    },

    async queueAttempt(run, candidate, claimToken, body) {
      const { data, error } = await client.rpc('queue_newsletter_attempt', {
        p_run_id: run.id,
        p_lead_id: candidate.id,
        p_claim_token: claimToken,
        p_rendered_body: body,
        p_valuation_snapshot: candidate.valuation,
      });
      if (error?.code === '42501' || error?.message.toLowerCase().includes('suppressed')) return 'suppressed';
      fail(error, 'queue newsletter attempt');
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) throw new Error('queue_newsletter_attempt returned no attempt.');
      return attemptFromRow(row);
    },

    async startAttempt(attempt, _run, slotNo, claimToken) {
      const { data, error } = await client.rpc('start_newsletter_attempt', {
        p_send_id: attempt.id,
        p_slot_no: slotNo,
        p_claim_token: claimToken,
      });
      if (error?.code === '42501') return 'suppressed';
      fail(error, 'start newsletter attempt');
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) throw new Error('start_newsletter_attempt returned no attempt.');
      if (row.status === 'opted_out') return 'suppressed';
      return attemptFromRow(row);
    },

    async finalizeAttempt({ attemptId, result }) {
      const outcome = result.outcome === 'accepted' ? 'sent'
        : result.outcome === 'unknown' ? 'unknown' : 'failed';
      const finalized = await client.rpc('finalize_newsletter_attempt', {
        p_send_id: attemptId,
        p_provider_outcome: outcome,
        p_provider_message_id: result.outcome === 'accepted' ? result.messageId : null,
        p_error: result.outcome === 'accepted' ? null : result.error,
        p_retryable: result.outcome === 'rejected' ? result.retryable : result.outcome === 'blocked',
      });
      fail(finalized.error, 'finalize newsletter attempt and CRM');
    },

    async recoverStaleReports(runId, olderThan) {
      const { data, error } = await client.rpc('recover_stale_newsletter_operator_reports', {
        p_run_id: runId,
        p_before: olderThan.toISOString(),
      });
      fail(error, 'recover stale newsletter operator reports');
      const row = Array.isArray(data) ? data[0] : data;
      if (typeof row === 'number') return row;
      if (row && typeof row === 'object' && 'count' in row) return Number(row.count || 0);
      return Number(row || 0);
    },

    async queueOperatorReports(runId, operators) {
      const runResult = await client.from('newsletter_runs').select('*').eq('id', runId).single();
      fail(runResult.error, 'load run for operator reports');
      const run = runFromRow(runResult.data, await issueSlug(String(runResult.data.issue_id)));
      const attemptResult = await client.from('newsletter_sends')
        .select('id,run_id,lead_id,slot_no,recipient_name,recipient_key,phone,rendered_body,status,attempt_no,retryable')
        .eq('run_id', runId)
        .eq('is_test', false)
        .order('slot_no', { ascending: true });
      fail(attemptResult.error, 'load attempts for operator reports');
      const drafts = buildOperatorReportRows(run, (attemptResult.data || []).map(attemptFromRow), operators);
      const existingResult = await client.from('newsletter_operator_reports').select('*').eq('run_id', runId);
      fail(existingResult.error, 'load operator report ledger');
      const existing = existingResult.data || [];
      for (const draft of drafts) {
        const found = existing.some((row) => row.operator_key === draft.operatorKey &&
          row.kind === draft.kind && (row.send_id || null) === draft.sendId);
        if (found) continue;
        const inserted = await client.from('newsletter_operator_reports').insert({
          run_id: runId,
          operator_key: draft.operatorKey,
          kind: draft.kind,
          send_id: draft.sendId,
          body: draft.body,
          status: 'queued',
        });
        fail(inserted.error, 'queue operator report');
      }
      const queued = await client.from('newsletter_operator_reports')
        .select('id,operator_key,body,status')
        .eq('run_id', runId)
        .eq('status', 'queued')
        .order('created_at', { ascending: true });
      fail(queued.error, 'load queued operator reports');
      return (queued.data || []).map((row) => ({
        id: String(row.id),
        operatorKey: String(row.operator_key),
        body: String(row.body),
        status: row.status as OperatorReport['status'],
      }));
    },

    async startReport(id) {
      const result = await client.from('newsletter_operator_reports')
        .update({ status: 'sending', attempt_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'queued')
        .select('id');
      fail(result.error, 'start operator report');
      return (result.data?.length || 0) === 1;
    },

    async finalizeReport(id, result) {
      const status = result.outcome === 'accepted' ? 'sent'
        : result.outcome === 'unknown' ? 'unknown' : 'failed';
      const update = await client.from('newsletter_operator_reports').update({
        status,
        provider_message_id: result.outcome === 'accepted' ? result.messageId : null,
        error: result.outcome === 'accepted' ? null : result.error,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'sending').select('id,run_id').single();
      fail(update.error, 'finalize operator report');
      if (!update.data) throw new Error('finalize operator report: report is not sending.');
      if (result.outcome !== 'accepted') {
        const reportError = result.outcome === 'unknown'
          ? `operator report outcome unknown: ${result.error}`
          : `operator report failed: ${result.error}`;
        const runUpdate = await client.from('newsletter_runs').update({
          report_error: reportError,
          updated_at: new Date().toISOString(),
        }).eq('id', update.data.run_id);
        fail(runUpdate.error, 'record operator report error');
      }
    },

    async heartbeat(runId) {
      const timestamp = new Date().toISOString();
      const result = await client.from('newsletter_runs')
        .update({ last_heartbeat_at: timestamp, updated_at: timestamp })
        .eq('id', runId);
      fail(result.error, 'heartbeat newsletter run');
    },

    async finishRun(runId, blocker) {
      const attempts = await this.listAttempts(runId);
      const update = await client.from('newsletter_runs').update({
        status: blocker ? 'blocked' : 'completed',
        blocker,
        selected_count: attempts.length,
        attempted_count: attempts.filter((attempt) => !['queued', 'opted_out', 'skipped'].includes(attempt.status)).length,
        sent_count: attempts.filter((attempt) => attempt.status === 'sent').length,
        failed_count: attempts.filter((attempt) => attempt.status === 'failed').length,
        unknown_count: attempts.filter((attempt) => attempt.status === 'unknown').length,
        skipped_count: attempts.filter((attempt) => ['opted_out', 'skipped'].includes(attempt.status)).length,
        completed_at: blocker ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', runId).select('*').single();
      fail(update.error, 'finish newsletter run');
      return runFromRow(update.data, await issueSlug(String(update.data.issue_id)));
    },

    async markRecoveryRequired(runId, blocker) {
      const update = await client.from('newsletter_runs').update({
        status: 'failed',
        blocker,
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', runId);
      fail(update.error, 'mark newsletter run recovery required');
    },

    async recordAcceptedRecovery(attemptId, providerMessageId, error) {
      const result = await client.rpc('record_accepted_newsletter_recovery', {
        p_send_id: attemptId,
        p_provider_message_id: providerMessageId,
        p_error: error,
      });
      fail(result.error, 'record accepted newsletter recovery');
    },

    async createTestSend(input) {
      const result = await client.rpc('create_newsletter_test_send', {
        p_issue_id: input.issueId,
        p_lead_id: input.sourceLeadId,
        p_override_phone: input.overridePhone,
        p_rendered_body: input.renderedBody,
        p_valuation_snapshot: input.valuation,
      });
      fail(result.error, 'create newsletter test-send ledger');
      const row = (Array.isArray(result.data) ? result.data[0] : result.data) as Record<string, unknown> | null;
      if (!row) throw new Error('create_newsletter_test_send returned no row.');
      return String(row.id);
    },

    async finalizeTestSend(id, result) {
      const outcome = result.outcome === 'accepted' ? 'sent'
        : result.outcome === 'unknown' ? 'unknown' : 'failed';
      const finalized = await client.rpc('finalize_newsletter_test_send', {
        p_send_id: id,
        p_provider_outcome: outcome,
        p_provider_message_id: result.outcome === 'accepted' ? result.messageId : null,
        p_error: result.outcome === 'accepted' ? null : result.error,
        p_retryable: result.outcome === 'rejected' ? result.retryable : result.outcome === 'blocked',
      });
      fail(finalized.error, 'finalize newsletter test-send ledger');
    },

    async resolveUnknown(sendId, resolver, resolution, reason) {
      const result = await client.rpc('resolve_newsletter_unknown', {
        p_send_id: sendId,
        p_resolver: resolver,
        p_resolution: resolution,
        p_reason: reason,
      });
      fail(result.error, 'resolve unknown newsletter attempt');
    },
  };
}
