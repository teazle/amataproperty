import { describe, expect, test } from 'bun:test';

import { composeNewsletter } from '../src/lib/newsletter/compose';

const baseInput = {
  lead: {
    name: 'MRS TAN',
    propertyTitle: 'Cavendish Park, Pine Grove',
    leadCode: 'vp123abc',
  },
  valuation: {
    lowSgd: 1_550_000,
    midSgd: 1_600_000,
    highSgd: 1_650_000,
    comparablesCount: 4,
    asOf: '2026-06-01',
  },
  featuredProjects: [{ title: 'Upperhouse' }],
  featuredUrlBase: 'https://viewproperty.ai/p',
};

describe('composeNewsletter', () => {
  test('asks whether the owner wants to buy, sell, refinance, call, or coffee', () => {
    const body = composeNewsletter(baseInput);

    expect(body).toContain('Current indicative market valuation');
    expect(body).toContain('SGD 1.55M to SGD 1.65M');
    expect(body).toContain('Reply BUY if you are looking for your next place.');
    expect(body).toContain('Reply SELL if you want to understand your selling options.');
    expect(body).toContain('Reply REFI if you are not buying or selling now but want to review refinancing.');
    expect(body).toContain('Reply CALL or COFFEE if you prefer to go through it directly.');
    expect(body).toContain('Reply STOP and I will stop.');
  });

  test('does not render a send-ready newsletter without a valuation', () => {
    expect(() =>
      composeNewsletter({
        ...baseInput,
        valuation: {
          lowSgd: null,
          midSgd: null,
          highSgd: null,
          comparablesCount: null,
          asOf: null,
        },
      }),
    ).toThrow('A send-ready valuation newsletter requires a valuation range or midpoint.');
  });
});
