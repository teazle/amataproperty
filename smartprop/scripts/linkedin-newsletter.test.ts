import { describe, expect, test } from 'bun:test';

import {
  isSingaporeLinkedInLocation,
  renderLinkedInNewsletterMessage,
  shouldSuppressNewsletterRecipient,
  validateApprovedLinkedInNewsletterBatch,
} from '../src/lib/linkedin/newsletter';

describe('LinkedIn newsletter outreach helpers', () => {
  test('accepts Singapore LinkedIn locations and rejects non-Singapore locations', () => {
    expect(isSingaporeLinkedInLocation('Singapore')).toBe(true);
    expect(isSingaporeLinkedInLocation('Singapore, Singapore')).toBe(true);
    expect(isSingaporeLinkedInLocation('Central Region, Singapore')).toBe(true);

    expect(isSingaporeLinkedInLocation('Kuala Lumpur, Malaysia')).toBe(false);
    expect(isSingaporeLinkedInLocation('')).toBe(false);
    expect(isSingaporeLinkedInLocation(null)).toBe(false);
  });

  test('renders a short LinkedIn DM from the approved OpenClaw newsletter batch', () => {
    const message = renderLinkedInNewsletterMessage({
      template: 'Hi {firstName}, sharing this week\'s {newsletterTitle}: {newsletterUrl}',
      recipientName: 'MRS TAN AH KOW',
      newsletterTitle: 'ViewProperty.ai Weekly Valuation Update',
      newsletterUrl: 'https://viewproperty.ai/p?ref=linkedin',
    });

    expect(message).toBe(
      'Hi Mrs Tan, sharing this week\'s ViewProperty.ai Weekly Valuation Update: https://viewproperty.ai/p?ref=linkedin',
    );
    expect(message.length).toBeLessThanOrEqual(700);
  });

  test('rejects unapproved OpenClaw batches before LinkedIn sending', () => {
    expect(() =>
      validateApprovedLinkedInNewsletterBatch({
        campaignSlug: '2026-06-02-singapore-newsletter',
        newsletterTitle: 'ViewProperty.ai Weekly Valuation Update',
        newsletterUrl: 'https://viewproperty.ai/p?ref=linkedin',
        linkedinMessageTemplate: 'Hi {firstName}, {newsletterUrl}',
        recipients: [],
      }),
    ).toThrow('approvedBy is required');
  });

  test('suppresses recent newsletter DMs to the same profile', () => {
    const now = new Date('2026-06-02T12:00:00.000Z');

    expect(
      shouldSuppressNewsletterRecipient({
        lastSentAt: '2026-05-20T12:00:00.000Z',
        now,
        suppressionDays: 90,
      }),
    ).toBe(true);

    expect(
      shouldSuppressNewsletterRecipient({
        lastSentAt: '2026-01-01T12:00:00.000Z',
        now,
        suppressionDays: 90,
      }),
    ).toBe(false);
  });
});
