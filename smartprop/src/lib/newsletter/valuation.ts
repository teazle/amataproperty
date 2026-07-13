import type {
  NewsletterValuationRow,
  NewsletterValuationSnapshot,
} from './campaign-types';

function normalizeProjectName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function finitePositive(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function newestAsOf(rows: NewsletterValuationRow[]): string | null {
  let newest: { time: number; value: string } | null = null;
  for (const row of rows) {
    if (!row.as_of) continue;
    const time = new Date(row.as_of).getTime();
    if (!Number.isFinite(time) || (newest && newest.time >= time)) continue;
    newest = { time, value: row.as_of };
  }
  return newest?.value ?? null;
}

export function aggregateProjectValuation(
  projectTitle: string,
  rows: NewsletterValuationRow[],
  now: Date,
): NewsletterValuationSnapshot | null {
  const normalizedTitle = normalizeProjectName(projectTitle);
  if (!normalizedTitle || !Number.isFinite(now.getTime())) return null;

  const supported = rows.filter((row) => {
    const normalizedProject = normalizeProjectName(row.project_name || '');
    const projectMatches = normalizedProject.length > 0 && (
      normalizedProject.includes(normalizedTitle) || normalizedTitle.includes(normalizedProject)
    );
    const expiresAt = new Date(row.expires_at).getTime();
    const low = finitePositive(row.low_sgd);
    const high = finitePositive(row.high_sgd);
    const hasCompleteRange = low !== null && high !== null;
    const hasRange = hasCompleteRange && low <= high;
    const hasInvertedRange = hasCompleteRange && low > high;
    const hasMidpoint = finitePositive(row.mid_sgd) !== null;

    return projectMatches && Number.isFinite(expiresAt) && expiresAt > now.getTime() &&
      !hasInvertedRange && (hasRange || hasMidpoint);
  });

  if (supported.length === 0) return null;

  const ranges = supported.flatMap((row) => {
    const low = finitePositive(row.low_sgd);
    const high = finitePositive(row.high_sgd);
    return low !== null && high !== null ? [{ low, high }] : [];
  });
  const midpoints = supported.flatMap((row) => {
    const midpoint = finitePositive(row.mid_sgd);
    return midpoint === null ? [] : [midpoint];
  });
  const comparablesCount = supported.reduce((total, row) => {
    const count = finitePositive(row.comparables_count);
    return total + (count === null ? 0 : Math.floor(count));
  }, 0);

  return {
    basis: 'project-level',
    lowSgd: ranges.length > 0 ? Math.min(...ranges.map((range) => range.low)) : null,
    midSgd: median(midpoints),
    highSgd: ranges.length > 0 ? Math.max(...ranges.map((range) => range.high)) : null,
    comparablesCount,
    asOf: newestAsOf(supported),
  };
}
