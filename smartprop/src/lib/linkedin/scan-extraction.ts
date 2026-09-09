import {
  isSingaporeLinkedInLocation,
  type LinkedInNewsletterRecipientInput,
} from './newsletter';

export type LinkedInResultCardSnapshot = {
  name: string;
  profileUrl: string;
  location: string | null;
  headline: string | null;
};

// Self-contained on purpose: this function is serialized by page.evaluate,
// so it must not reference module-scope bindings.
export function collectLinkedInResultCards(): LinkedInResultCardSnapshot[] {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('main li, main [role="listitem"], .reusable-search__result-container'));
  return cards.map((card) => {
    const profileLink = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))
      .find((link) => link.href && !link.href.includes('/search/results/people'));
    const lines = (card.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const name = profileLink?.innerText?.split('\n')[0]?.trim() || lines[0] || '';
    const location = lines.find((line) => /singapore/i.test(line)) || null;
    const headline = lines.find((line) => line !== name && line !== location) || null;
    return {
      name,
      profileUrl: profileLink?.href || '',
      location,
      headline,
    };
  });
}

export function normalizeLinkedInProfileUrl(rawUrl: string): string {
  const url = new URL(rawUrl, 'https://www.linkedin.com');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '/');
}

export function dedupeSingaporeResultCards(
  snapshots: LinkedInResultCardSnapshot[],
): LinkedInNewsletterRecipientInput[] {
  const deduped = new Map<string, LinkedInNewsletterRecipientInput>();
  for (const candidate of snapshots) {
    if (!candidate.profileUrl || !candidate.name) continue;
    if (!isSingaporeLinkedInLocation(candidate.location)) continue;
    const profileUrl = normalizeLinkedInProfileUrl(candidate.profileUrl);
    deduped.set(profileUrl, {
      name: candidate.name,
      profileUrl,
      location: candidate.location,
      headline: candidate.headline,
    });
  }

  return Array.from(deduped.values());
}

// Counts raw identifiable profiles (name + profile URL) before Singapore
// filtering, so a legitimately all-non-Singapore page is not misread as a
// selector failure.
export function identifiableProfileCount(snapshots: LinkedInResultCardSnapshot[]): number {
  return snapshots.filter((snapshot) => Boolean(snapshot.profileUrl && snapshot.name)).length;
}

// Self-contained for page.evaluate, like collectLinkedInResultCards: counts
// genuinely visible /in/ anchors in main results, including anchors outside
// matched cards. Tripwire signal for selector drift. The visibility probe is
// duplicated in linkedInResultsReady because these functions serialize
// independently for the browser context.
export function countVisibleResultProfileLinks(): number {
  let visibleCount = 0;
  const links = document.querySelectorAll<HTMLElement>('main a[href*="/in/"]');
  for (const link of links) {
    const style = window.getComputedStyle(link);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = link.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    visibleCount += 1;
  }
  return visibleCount;
}

// Self-contained for page.waitForFunction: ready only once a supported card
// renders a genuinely visible profile link, or main shows an explicit
// no-results state. Bare li without profile links never satisfies readiness.
export function linkedInResultsReady(): boolean {
  const main = document.querySelector('main');
  if (!main) return false;
  const cards = main.querySelectorAll<HTMLElement>('li, [role="listitem"], .reusable-search__result-container');
  for (const card of cards) {
    const links = card.querySelectorAll<HTMLElement>('a[href*="/in/"]');
    for (const link of links) {
      const style = window.getComputedStyle(link);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = link.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      return true;
    }
  }
  const bodyText = document.body?.innerText || '';
  return /no results|0 results/i.test(bodyText.slice(0, 2000));
}

export function extractionMismatchDiagnostic(input: {
  pageNumber: number;
  extractedProfileCount: number;
  visibleProfileCount: number;
}): string | null {
  if (input.extractedProfileCount > 0 || input.visibleProfileCount === 0) return null;
  return `linkedin scan page ${input.pageNumber}: extracted 0 identifiable profiles while ${input.visibleProfileCount} profile links are visible in main; result-card selectors no longer match the rendered LinkedIn layout`;
}
