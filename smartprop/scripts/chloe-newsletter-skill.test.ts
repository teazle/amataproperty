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
    expect(normalizedSkill).toContain('Chloe must not manually send newsletter messages');
  });

  test('teaches dry-run interpretation, reporting, and escalation', () => {
    expect(normalizedSkill).toContain('selected count and blocker');
    expect(normalizedSkill).toContain('excluded mobile-ineligible contacts as counts and reasons');
    expect(normalizedSkill).toContain('exact message body');
    expect(normalizedSkill).toContain('WAHA is not exactly `WORKING`');
    expect(normalizedSkill).toContain('current approved valuation');
    expect(normalizedSkill).toContain('valuation is missing or expired');
  });

  test('teaches the restricted valuation research workflow and send boundary', () => {
    expect(normalizedSkill).toContain('Restricted valuation research workflow');
    expect(normalizedSkill).toContain('`queue --json`');
    expect(normalizedSkill).toContain('heartbeat');
    expect(normalizedSkill).toContain('two independent registered sources');
    expect(normalizedSkill).toContain('JSON evidence over standard input');
    expect(normalizedSkill).toContain('`complete`');
    expect(normalizedSkill).toContain('report only counts and blockers');
    expect(normalizedSkill).toContain('must not send WhatsApp from this research job');
    expect(normalizedSkill).toContain('must not select recipients');
    expect(normalizedSkill).toContain('must not run SQL');
    expect(normalizedSkill).toContain('must not update the valuation cache manually');
    expect(normalizedSkill).toContain('must not invent values or extend expiry dates');
    expect(normalizedSkill).toContain('must not print lead PII');
  });
});
