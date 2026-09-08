type OutreachProcessStats = {
  reconciliationRequired?: unknown;
  reconciliationErrors?: unknown;
  reconciliationOutreachIds?: unknown;
};

export type ReconciliationNotice = {
  count: number;
  outreachIds: string[];
  errors: string[];
};

export function reconciliationNotice(stats: OutreachProcessStats | undefined): ReconciliationNotice | null {
  const count = typeof stats?.reconciliationRequired === 'number' && stats.reconciliationRequired > 0
    ? stats.reconciliationRequired
    : 0;
  if (count === 0) return null;

  const errors = Array.isArray(stats?.reconciliationErrors)
    ? stats.reconciliationErrors.filter((error): error is string => typeof error === 'string')
    : [];
  const outreachIds = Array.isArray(stats?.reconciliationOutreachIds)
    ? Array.from(new Set(stats.reconciliationOutreachIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    : [];

  return { count, outreachIds, errors };
}
