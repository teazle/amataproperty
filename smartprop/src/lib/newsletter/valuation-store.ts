import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ValidatedValuationEvidence,
  ValuationEvidenceContext,
} from './valuation-evidence';

export type ValuationRunStatus = 'running' | 'completed' | 'quiet' | 'blocked' | 'failed';
export type ValuationItemStatus = 'accepted' | 'rejected' | 'blocked' | 'failed';

export interface ValuationQueueCandidate {
  itemId: string;
  projectSlug: string;
  projectTitle: string;
  location: string;
  propertyType: string;
  tenure: string;
  areaDistribution: Array<{ areaSqft: number; count: number }>;
  candidateCount: number;
  reason: 'missing' | 'expired' | 'unsupported';
}

export interface ValuationQueue {
  runId: string;
  leaseToken: string;
  issueId: string | null;
  issueSlug: string | null;
  runDate: string;
  status: ValuationRunStatus;
  deadlineSgt: '09:20';
  blocker: string | null;
  candidates: ValuationQueueCandidate[];
}

export interface ValuationRunResult {
  runId: string;
  status: ValuationRunStatus;
  candidateCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  blockedCount?: number;
  failedCount?: number;
  lastHeartbeatAt?: string;
}

export interface ValuationItemResult {
  runId: string;
  itemId: string;
  status: ValuationItemStatus;
  cacheValuationId?: string | null;
}

export interface ValuationGate {
  healthy: boolean;
  reason?: string | null;
  issueId?: string | null;
  runId?: string | null;
  status?: ValuationRunStatus | null;
}

export interface ValuationProjectProfile {
  location: string;
  propertyType: string;
  tenure: string;
  areaDistribution: Array<{ areaSqft: number; count: number }>;
}

export type RecordedValuationOutcome =
  | { kind: 'accepted'; evidence: ValidatedValuationEvidence }
  | { kind: 'rejected'; errorCode: string; errorDetail: string; evidenceHash: string | null }
  | { kind: 'blocked'; reason: string; attemptedSources: string[] }
  | { kind: 'failed'; reason: string; retryable: boolean };

export interface ValuationStore {
  claimQueue(): Promise<ValuationQueue>;
  heartbeat(runId: string, leaseToken: string): Promise<ValuationRunResult>;
  importItem(runId: string, itemId: string, leaseToken: string, outcome: RecordedValuationOutcome): Promise<ValuationItemResult>;
  complete(runId: string, leaseToken: string): Promise<ValuationRunResult>;
  loadGate(issueId: string): Promise<ValuationGate>;
  setProjectProfile(projectSlug: string, profile: ValuationProjectProfile): Promise<void>;
}

interface DatabaseError { message: string }

function dataOrThrow<T>(data: unknown, error: DatabaseError | null, operation: string): T {
  if (error) throw new Error(`${operation} failed`);
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (value === null || value === undefined) throw new Error(`${operation} returned no data`);
  return value as T;
}

export function createValuationStore(
  client: SupabaseClient,
  workerId: string,
  sourceRevision: string,
): ValuationStore {
  return {
    async claimQueue() {
      const { data, error } = await client.rpc('claim_newsletter_valuation_run', {
        p_worker_id: workerId,
        p_source_revision: sourceRevision,
      });
      return dataOrThrow<ValuationQueue>(data, error, 'claim valuation queue');
    },
    async heartbeat(runId, leaseToken) {
      const { data, error } = await client.rpc('heartbeat_newsletter_valuation_run', {
        p_run_id: runId,
        p_lease_token: leaseToken,
      });
      return dataOrThrow<ValuationRunResult>(data, error, 'heartbeat valuation run');
    },
    async importItem(runId, itemId, leaseToken, outcome) {
      const { data, error } = await client.rpc('record_newsletter_valuation_item', {
        p_run_id: runId,
        p_item_id: itemId,
        p_lease_token: leaseToken,
        p_outcome: outcome,
      });
      return dataOrThrow<ValuationItemResult>(data, error, 'record valuation item');
    },
    async complete(runId, leaseToken) {
      const { data, error } = await client.rpc('complete_newsletter_valuation_run', {
        p_run_id: runId,
        p_lease_token: leaseToken,
      });
      return dataOrThrow<ValuationRunResult>(data, error, 'complete valuation run');
    },
    async loadGate(issueId) {
      const { data, error } = await client.rpc('get_newsletter_valuation_gate', {
        p_issue_id: issueId,
      });
      return dataOrThrow<ValuationGate>(data, error, 'load valuation gate');
    },
    async setProjectProfile(projectSlug, profile) {
      const { data, error } = await client
        .from('crm_projects')
        .update({
          valuation_location: profile.location,
          valuation_property_type: profile.propertyType,
          valuation_tenure: profile.tenure,
          valuation_area_distribution: profile.areaDistribution,
          valuation_profile_updated_at: new Date().toISOString(),
        })
        .eq('slug', projectSlug)
        .select('id')
        .single();
      dataOrThrow(data, error, 'set valuation project profile');
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('valuation item context is invalid');
  }
  return value as Record<string, unknown>;
}

export async function loadValuationEvidenceContext(
  client: SupabaseClient,
  runId: string,
  itemId: string,
  now: Date,
): Promise<ValuationEvidenceContext> {
  const { data, error } = await client
    .from('newsletter_valuation_items')
    .select('id,run_id,project_slug,project_profile,newsletter_valuation_runs!inner(run_date,worker_id,source_revision)')
    .eq('id', itemId)
    .eq('run_id', runId)
    .single();
  const row = dataOrThrow<Record<string, unknown>>(data, error, 'load valuation item context');
  const profile = asRecord(row.project_profile);
  const joinedValue = row.newsletter_valuation_runs;
  const joined = asRecord(Array.isArray(joinedValue) ? joinedValue[0] : joinedValue);
  const areaValue = profile.areaDistribution;
  if (!Array.isArray(areaValue)) throw new Error('valuation item area profile is invalid');
  const areaDistribution = areaValue.map((entry) => {
    const item = asRecord(entry);
    return { areaSqft: Number(item.areaSqft), count: Number(item.count) };
  });
  return {
    projectSlug: String(row.project_slug),
    projectTitle: String(profile.projectTitle),
    location: String(profile.location),
    propertyType: String(profile.propertyType),
    tenure: String(profile.tenure),
    areaDistribution,
    runDate: String(joined.run_date),
    now,
    agentIdentity: String(joined.worker_id),
    sourceRevision: String(joined.source_revision),
  };
}
