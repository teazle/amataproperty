type ContactIdentity = { name?: string | null; messageHref?: string | null };
type LinkIdentity = { href?: string | null; ariaLabel?: string | null; textContent?: string | null };

function normalizedComposeUrl(href: string | null | undefined): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://www.linkedin.com');
    if (url.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname)) return null;
    if (url.username || url.password || url.port || !url.pathname.startsWith('/messaging/')) return null;
    url.hostname = 'www.linkedin.com';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.searchParams.sort();
    return url;
  } catch {
    return null;
  }
}

export function composeLinkMatchesContact(link: LinkIdentity, contact: ContactIdentity, linkedinId?: string | null): boolean {
  const actual = normalizedComposeUrl(link.href);
  if (!actual) return false;
  if (contact.messageHref) {
    const captured = normalizedComposeUrl(contact.messageHref);
    return captured !== null && captured.href === actual.href;
  }
  // A display name or an ID substring cannot prove which recipient will receive a send.
  if (!linkedinId) return false;
  const recipients = actual.searchParams.getAll('recipient');
  if (recipients.length) return recipients.length === 1 && recipients[0] === linkedinId;
  try {
    return actual.pathname.split('/').some(segment => decodeURIComponent(segment) === linkedinId);
  } catch {
    return false;
  }
}
