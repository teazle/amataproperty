import { expect, test } from 'bun:test';
import { composeLinkMatchesContact } from '../src/lib/linkedin/recipient-match';

const contact = { name: 'Same Name', messageHref: 'https://www.linkedin.com/messaging/compose/?recipient=right' };
test('query-encoded recipient mismatches fail closed even when the label matches', () => {
  expect(composeLinkMatchesContact({ href: 'https://www.linkedin.com/messaging/compose/?recipient=wrong', ariaLabel: 'Same Name' }, contact)).toBe(false);
});
test('query ordering and fragments do not change an exact captured recipient link', () => {
  expect(composeLinkMatchesContact({ href: '/messaging/compose/?b=2&recipient=right#section' }, { ...contact, messageHref: 'https://www.linkedin.com/messaging/compose?recipient=right&b=2' })).toBe(true);
});
test('invalid or external captured links cannot authorize a message', () => {
  expect(composeLinkMatchesContact({ href: 'https://evil.invalid/messaging/compose/?recipient=right' }, { ...contact, messageHref: 'https://evil.invalid/messaging/compose/?recipient=right' })).toBe(false);
  expect(composeLinkMatchesContact({ href: 'javascript:alert(1)' }, { ...contact, messageHref: 'javascript:alert(1)' })).toBe(false);
});
test('without a captured href, recipient identity must be exact, not a name or substring', () => {
  expect(composeLinkMatchesContact({ href: '/messaging/compose/?recipient=abc1234', ariaLabel: 'Same Name' }, { name: 'Same Name' }, 'abc123')).toBe(false);
  expect(composeLinkMatchesContact({ href: '/messaging/compose/?recipient=abc123' }, { name: 'Same Name' }, 'abc123')).toBe(true);
  expect(composeLinkMatchesContact({ href: '/messaging/compose/', ariaLabel: 'Same Name' }, { name: 'Same Name' })).toBe(false);
});
