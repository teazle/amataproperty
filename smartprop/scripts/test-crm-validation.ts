import assert from 'node:assert/strict';
import {
  crmLeadUpdateSchema,
  crmPublicLeadSchema,
  isCrmLeadStatus,
} from '../src/lib/crm/validation';
import {
  normalizeCrmImportRows,
  parseDelimitedLeadText,
} from '../src/lib/crm/import-normalizer';

const validPayload = {
  projectSlug: 'river-modern',
  propertyTitle: 'River Modern at River Valley Green',
  sourcePath: '/luxe-realty/river-modern',
  name: 'Jane Buyer',
  phone: '+65 9123 4567',
  email: 'jane@example.com',
  message: 'I would like more information.',
  website: '',
};

assert.equal(crmPublicLeadSchema.parse(validPayload).email, 'jane@example.com');
assert.equal(crmPublicLeadSchema.parse({ ...validPayload, email: ' JANE@EXAMPLE.COM ' }).email, 'jane@example.com');
assert.throws(() => crmPublicLeadSchema.parse({ ...validPayload, email: 'not-an-email' }));
assert.throws(() => crmPublicLeadSchema.parse({ ...validPayload, website: 'spam-site' }));
assert.throws(() => crmPublicLeadSchema.parse({ ...validPayload, phone: '' }));

assert.equal(isCrmLeadStatus('qualified'), true);
assert.equal(isCrmLeadStatus('archived'), false);
assert.equal(crmLeadUpdateSchema.parse({ status: 'won', priority: 'high' }).status, 'won');
assert.throws(() => crmLeadUpdateSchema.parse({ status: 'archived' }));

const normalizedRows = normalizeCrmImportRows(
  [
    {
      full_name: ' Jane Buyer ',
      mobile: '9123 4567',
      email_address: ' JANE@EXAMPLE.COM ',
      project_slug: 'river-modern',
      property_interest: 'River Modern',
      inquiry_message: 'Looking for a 3 bedder',
      lead_status: 'qualified',
      priority: 'High',
      lead_source: 'OpenClaw',
      source_url: 'https://example.com/leads/1',
    },
    {
      normalized_name: '',
      normalized_phone: '',
      normalized_email: '',
      notes: 'No usable contact fields',
    },
  ],
  { defaultProjectSlug: 'general-luxe' }
);

assert.equal(normalizedRows.valid[0].name, 'Jane Buyer');
assert.equal(normalizedRows.valid[0].phone, '+6591234567');
assert.equal(normalizedRows.valid[0].email, 'jane@example.com');
assert.equal(normalizedRows.valid[0].projectSlug, 'river-modern');
assert.equal(normalizedRows.valid[0].propertyTitle, 'River Modern');
assert.equal(normalizedRows.valid[0].message, 'Looking for a 3 bedder');
assert.equal(normalizedRows.valid[0].status, 'qualified');
assert.equal(normalizedRows.valid[0].priority, 'high');
assert.equal(normalizedRows.valid[0].sourcePath, 'openclaw://import');
assert.equal(normalizedRows.valid[0].sourceUrl, 'https://example.com/leads/1');
assert.equal(normalizedRows.skipped[0].reason, 'Missing name and contact');

const parsedCsv = parseDelimitedLeadText('Name,WhatsApp,Email\nBuyer Two,8123 4567,buyer2@example.com\n');
assert.deepEqual(parsedCsv, [
  {
    Name: 'Buyer Two',
    WhatsApp: '8123 4567',
    Email: 'buyer2@example.com',
  },
]);

console.log('CRM validation tests passed');
