type OutreachProcessStats = {
  reconciliationRequired?: unknown;
  reconciliationErrors?: unknown;
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
  const outreachIds = Array.from(new Set(errors.flatMap((error) => {
    const match = /^Outreach\s+([^\s]+)\s+requires reconciliation:/.exec(error);
    return match ? [match[1]] : [];
  })));

  return { count, outreachIds, errors };
}
