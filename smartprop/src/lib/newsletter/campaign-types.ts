export interface NewsletterValuationRow {
  project_name: string | null;
  low_sgd: number | string | null;
  mid_sgd: number | string | null;
  high_sgd: number | string | null;
  comparables_count: number | string | null;
  as_of: string | null;
  expires_at: string;
}

export interface NewsletterValuationSnapshot {
  basis: 'project-level';
  lowSgd: number | null;
  midSgd: number | null;
  highSgd: number | null;
  comparablesCount: number;
  asOf: string | null;
}

export type CampaignTransportResult =
  | { outcome: 'accepted'; messageId: string }
  | { outcome: 'rejected'; retryable: boolean; error: string; statusCode?: number }
  | { outcome: 'unknown'; error: string }
  | { outcome: 'blocked'; error: string };
