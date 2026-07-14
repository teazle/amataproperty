export interface NewsletterValuationRow {
  id?: string | null;
  project_slug?: string | null;
  project_name: string | null;
  low_sgd: number | string | null;
  mid_sgd: number | string | null;
  high_sgd: number | string | null;
  comparables_count: number | string | null;
  as_of: string | null;
  expires_at: string;
  fetched_at?: string | null;
  evidence_status?: string | null;
  evidence_contract_version?: string | null;
  evidence_item_id?: string | null;
  validated_confidence?: string | null;
}

export interface NewsletterValuationSnapshot {
  basis: 'project-level';
  lowSgd: number | null;
  midSgd: number | null;
  highSgd: number | null;
  comparablesCount: number;
  asOf: string | null;
  evidenceItemId: string;
  valuationId: string;
  projectSlug: string;
  evidenceContractVersion: 'chloe-valuation-v1';
  confidence: 'medium' | 'high';
}

export class ValuationPreparationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValuationPreparationBlockedError';
  }
}

export type CampaignTransportResult =
  | { outcome: 'accepted'; messageId: string }
  | { outcome: 'rejected'; retryable: boolean; error: string; statusCode?: number }
  | { outcome: 'unknown'; error: string }
  | { outcome: 'blocked'; error: string };

export function countEffectiveSelections(
  attempts: Array<{ status: string; slotNo: number | null }>,
): number {
  return attempts.filter((attempt) =>
    !(['opted_out', 'skipped'].includes(attempt.status) && attempt.slotNo === null)).length;
}
