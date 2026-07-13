import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const skillPath = join(import.meta.dir, '..', '..', 'openclaw-skills', 'smartprop-crm', 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');
const normalizedSkill = skill.replace(/\s+/g, ' ');

describe('Chloe WhatsApp newsletter skill', () => {
  test('teaches mobile-only lead preparation and automatic selection', () => {
    expect(normalizedSkill).toContain('Mobile-only lead preparation');
    expect(normalizedSkill).toContain('`+658XXXXXXX` or `+659XXXXXXX`');
    expect(normalizedSkill).toContain('landline');
    expect(normalizedSkill).toContain('runner automatically selects up to five eligible recipients');
    expect(normalizedSkill).toContain('Do not manually choose the five recipients');
  });

  test('teaches dry-run interpretation, reporting, and escalation', () => {
    expect(normalizedSkill).toContain('selected count and blocker');
    expect(normalizedSkill).toContain('excluded mobile-ineligible contacts as counts and reasons');
    expect(normalizedSkill).toContain('exact message body');
    expect(normalizedSkill).toContain('WAHA is not exactly `WORKING`');
    expect(normalizedSkill).toContain('current approved valuation');
  });
});
