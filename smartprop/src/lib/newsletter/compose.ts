/**
 * Property Valuation Newsletter — message composer.
 *
 * Pure function. No I/O. Given a lead, a valuation, the featured-projects
 * list, and a tracking code, returns the exact WhatsApp body to send.
 *
 * Copy rules updated with the user on 2026-06-01:
 *   - Plain text only. No emoji, no markdown asterisks, no bullet symbols.
 *   - Reply-word CTAs: BUY, SELL, REFI, CALL, COFFEE, STOP.
 *   - One short URL with ?ref=<leadCode> for click tracking.
 *   - STOP footer.
 *   - Do not render send-ready copy without a supported valuation.
 */

export interface NewsletterLeadInput {
  name: string;
  propertyTitle: string;
  leadCode: string;
}

export interface NewsletterValuationInput {
  /** SGD low estimate. May be null when PropNex couldn't value the unit. */
  lowSgd: number | null;
  midSgd: number | null;
  highSgd: number | null;
  comparablesCount: number | null;
  /** ISO date (yyyy-mm-dd) of when the valuation was effective. */
  asOf: string | null;
}

export interface NewsletterFeaturedProject {
  title: string;
}

export interface ComposeNewsletterInput {
  lead: NewsletterLeadInput;
  valuation: NewsletterValuationInput;
  featuredProjects: NewsletterFeaturedProject[];
  /** e.g. "https://viewproperty.ai/p" — leadCode is appended as ?ref=… */
  featuredUrlBase: string;
  /** First name shown in the sign-off. Defaults to "Jeremy". */
  senderName?: string;
  /** Reply keyword that triggers opt-out. Defaults to "STOP". */
  unsubKeyword?: string;
}

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'MDM', 'DR', 'PROF']);

function titleCase(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Greeting used as "Hi <X>,". Handles Singaporean name patterns:
 *   "MRS TAN"          -> "Mrs Tan"   (honorific + surname)
 *   "JIMMY (LH)"       -> "Jimmy"
 *   "TAN AH KOW"       -> "Tan"       (first token; SG names lead with surname)
 *   "Unknown Lead"     -> "there"
 *   ""                 -> "there"
 */
function greetingName(fullName: string): string {
  const cleaned = (fullName || '').trim();
  if (!cleaned || /^unknown(\s|$)/i.test(cleaned)) return 'there';

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'there';

  const first = tokens[0].toUpperCase().replace(/[^A-Z]/g, '');
  if (HONORIFICS.has(first) && tokens.length > 1) {
    return `${titleCase(tokens[0])} ${titleCase(tokens[1])}`;
  }
  if (HONORIFICS.has(first)) return 'there';
  return titleCase(tokens[0]);
}

function formatSgd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `SGD ${m.toFixed(m >= 10 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `SGD ${k.toFixed(0)}K`;
  }
  return `SGD ${Math.round(value).toLocaleString('en-SG')}`;
}

function formatAsOf(asOf: string | null): string {
  if (!asOf) return 'recent transactions';
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildValuationLine(v: NewsletterValuationInput): string {
  const low = formatSgd(v.lowSgd);
  const high = formatSgd(v.highSgd);
  const asOf = formatAsOf(v.asOf);

  if (low && high && low !== high) {
    const comps = v.comparablesCount && v.comparablesCount > 0
      ? ` Based on ${v.comparablesCount} recent ${v.comparablesCount === 1 ? 'transaction' : 'transactions'}.`
      : '';
    return `Current indicative market valuation as of ${asOf}: ${low} to ${high}.${comps}`;
  }

  const mid = formatSgd(v.midSgd);
  if (mid) {
    return `Current indicative market valuation as of ${asOf}: around ${mid}.`;
  }

  throw new Error('A send-ready valuation newsletter requires a valuation range or midpoint.');
}

export function composeNewsletter(input: ComposeNewsletterInput): string {
  const senderName = input.senderName || 'Jeremy';
  const unsub = (input.unsubKeyword || 'STOP').toUpperCase();
  const fname = greetingName(input.lead.name);

  const valuationLine = buildValuationLine(input.valuation);

  const projectsBlock = input.featuredProjects.length > 0
    ? input.featuredProjects.map((p, i) => `${i + 1}. ${p.title}`).join('\n')
    : '';

  const trackingUrl = `${input.featuredUrlBase.replace(/\/$/, '')}?ref=${encodeURIComponent(input.lead.leadCode)}`;

  const lines: string[] = [];
  lines.push(`Hi ${fname},`);
  lines.push('');
  lines.push(`${senderName} here from ViewProperty.ai. Quick update on your property.`);
  lines.push('');
  lines.push(input.lead.propertyTitle);
  lines.push(valuationLine);
  lines.push('');
  lines.push('Are you looking to buy or sell property this year?');
  lines.push('');
  lines.push('1. Reply BUY if you are looking for your next place.');
  lines.push('2. Reply SELL if you want to understand your selling options.');
  lines.push('3. Reply REFI if you are not buying or selling now but want to review refinancing.');
  lines.push('4. Reply CALL or COFFEE if you prefer to go through it directly.');

  if (projectsBlock) {
    lines.push('');
    lines.push('This week on ViewProperty.ai:');
    lines.push(projectsBlock);
    lines.push(trackingUrl);
  }

  lines.push('');
  lines.push(`Not interested in these updates? Reply ${unsub} and I will stop.`);
  lines.push('');
  lines.push(`— ${senderName}`);
  lines.push('ViewProperty.ai');

  return lines.join('\n');
}
