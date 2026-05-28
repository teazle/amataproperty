import AdmZip from 'adm-zip';
import {
  CrmLeadPriority,
  CrmLeadStatus,
  crmLeadPriorities,
  crmLeadStatuses,
} from './validation';

export type RawLeadRow = Record<string, unknown>;

export type NormalizedCrmImportLead = {
  rowNumber: number;
  name: string;
  phone: string;
  email: string;
  message: string;
  propertyTitle: string;
  projectSlug: string;
  sourcePath: string;
  sourceUrl: string | null;
  status: CrmLeadStatus;
  priority: CrmLeadPriority;
  assignedTo: string | null;
  followUpAt: string | null;
  externalId: string | null;
  source: string;
  originalRow: RawLeadRow;
};

export type SkippedCrmImportLead = {
  rowNumber: number;
  reason: string;
  originalRow: RawLeadRow;
};

type NormalizeOptions = {
  defaultProjectSlug?: string;
};

const fieldAliases = {
  name: [
    'name',
    'fullname',
    'contactname',
    'clientname',
    'customername',
    'leadname',
    'buyername',
    'normalizedname',
  ],
  phone: [
    'phone',
    'phonenumber',
    'mobile',
    'mobilenumber',
    'whatsapp',
    'whatsappnumber',
    'contactnumber',
    'telephone',
    'normalizedphone',
    'normalizedmobile',
  ],
  email: ['email', 'emailaddress', 'emailaddr', 'normalizedemail'],
  message: [
    'message',
    'inquiry',
    'inquirymessage',
    'notes',
    'note',
    'remarks',
    'requirements',
    'normalizedmessage',
  ],
  propertyTitle: [
    'propertytitle',
    'propertyinterest',
    'interestedproperty',
    'property',
    'project',
    'projectname',
    'listing',
    'listingtitle',
  ],
  projectSlug: ['projectslug', 'project_slug', 'slug'],
  sourcePath: ['sourcepath', 'source_path', 'sourcepage', 'pagepath'],
  sourceUrl: ['sourceurl', 'source_url', 'url', 'leadurl', 'profileurl'],
  status: ['status', 'leadstatus', 'pipelinestatus', 'stage'],
  priority: ['priority', 'leadpriority'],
  assignedTo: ['assignedto', 'assigned_to', 'agent', 'owner', 'handledby'],
  followUpAt: ['followupat', 'follow_up_at', 'nextfollowup', 'nextfollowupdate'],
  externalId: ['id', 'leadid', 'externalid', 'openclawid', 'recordid'],
  source: ['source', 'leadsource', 'channel', 'origin'],
} as const;

function keyOf(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function valueToString(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function pick(row: RawLeadRow, aliases: readonly string[]) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => keyOf(key) === alias);
    if (found) {
      const value = valueToString(found[1]);
      if (value) return value;
    }
  }
  return '';
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function normalizePhone(value: string) {
  const original = value.trim();
  if (!original) return '';
  const digits = original.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 8) return `+65${digits}`;
  if (digits.length === 10 && digits.startsWith('65')) return `+${digits}`;
  if (original.startsWith('+')) return `+${digits}`;
  return digits;
}

function normalizeProjectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeStatus(value: string): CrmLeadStatus {
  const key = keyOf(value);
  const direct = crmLeadStatuses.find((status) => keyOf(status) === key);
  if (direct) return direct;

  if (['warm', 'qualifiedlead', 'highintent', 'interested'].includes(key)) return 'qualified';
  if (['called', 'replied', 'followedup', 'responded'].includes(key)) return 'contacted';
  if (['viewing', 'appointmentscheduled', 'viewingscheduled', 'sitevisit'].includes(key)) return 'viewing_scheduled';
  if (['deal', 'negotiation', 'proposal'].includes(key)) return 'offer';
  if (['closed', 'closedwon', 'converted'].includes(key)) return 'won';
  if (['closedlost', 'dead', 'notinterested', 'invalid'].includes(key)) return 'lost';

  return 'new';
}

function normalizePriority(value: string): CrmLeadPriority {
  const key = keyOf(value);
  const direct = crmLeadPriorities.find((priority) => keyOf(priority) === key);
  if (direct) return direct;
  if (['hot', 'urgent', 'important'].includes(key)) return 'high';
  if (['cold', 'weak'].includes(key)) return 'low';
  return 'normal';
}

function normalizeIsoDate(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeCrmImportRows(rows: RawLeadRow[], options: NormalizeOptions = {}) {
  const valid: NormalizedCrmImportLead[] = [];
  const skipped: SkippedCrmImportLead[] = [];
  const defaultProjectSlug = options.defaultProjectSlug || 'general-luxe';

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = pick(row, fieldAliases.name) || '';
    const phone = normalizePhone(pick(row, fieldAliases.phone));
    const email = normalizeEmail(pick(row, fieldAliases.email));

    if (!name && !phone && !email) {
      skipped.push({ rowNumber, reason: 'Missing name and contact', originalRow: row });
      return;
    }

    if (!phone && !email) {
      skipped.push({ rowNumber, reason: 'Missing contact', originalRow: row });
      return;
    }

    const propertyTitle = pick(row, fieldAliases.propertyTitle) || 'General Luxe Realty Inquiry';
    const explicitProjectSlug = normalizeProjectSlug(pick(row, fieldAliases.projectSlug));
    const inferredProjectSlug = explicitProjectSlug || normalizeProjectSlug(propertyTitle);
    const source = pick(row, fieldAliases.source) || 'OpenClaw';
    const message = pick(row, fieldAliases.message) || `Imported lead from ${source}.`;

    valid.push({
      rowNumber,
      name: name || 'Unknown Lead',
      phone,
      email,
      message,
      propertyTitle,
      projectSlug: inferredProjectSlug || defaultProjectSlug,
      sourcePath: pick(row, fieldAliases.sourcePath) || 'openclaw://import',
      sourceUrl: pick(row, fieldAliases.sourceUrl) || null,
      status: normalizeStatus(pick(row, fieldAliases.status)),
      priority: normalizePriority(pick(row, fieldAliases.priority)),
      assignedTo: pick(row, fieldAliases.assignedTo) || null,
      followUpAt: normalizeIsoDate(pick(row, fieldAliases.followUpAt)),
      externalId: pick(row, fieldAliases.externalId) || null,
      source,
      originalRow: row,
    });
  });

  return { valid, skipped };
}

export function parseDelimitedLeadText(text: string, delimiter?: string) {
  const inferredDelimiter = delimiter || (text.includes('\t') ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === inferredDelimiter && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);

  const [headers = [], ...body] = rows;
  const normalizedHeaders = headers.map((header, index) => header || `column_${index + 1}`);
  return body.map((values) =>
    normalizedHeaders.reduce<RawLeadRow>((record, header, index) => {
      record[header] = values[index] || '';
      return record;
    }, {})
  );
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getColumnIndex(cellRef: string, fallback: number) {
  const letters = cellRef.match(/[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return fallback;
  return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function readZipText(zip: AdmZip, path: string) {
  const entry = zip.getEntry(path);
  return entry ? entry.getData().toString('utf8') : '';
}

function readSharedStrings(zip: AdmZip) {
  const xml = readZipText(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];

  return Array.from(xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)).map((match) => {
    const textParts = Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((part) => decodeXml(part[1]));
    return textParts.join('');
  });
}

export function parseXlsxLeadRows(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const sharedStrings = readSharedStrings(zip);
  const sheetXml = readZipText(zip, 'xl/worksheets/sheet1.xml');

  if (!sheetXml) {
    throw new Error('Could not read the first worksheet');
  }

  const matrix: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let fallbackColumn = 0;

    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const ref = attributes.match(/\sr="([^"]+)"/)?.[1] || '';
      const type = attributes.match(/\st="([^"]+)"/)?.[1] || '';
      const columnIndex = getColumnIndex(ref, fallbackColumn);
      fallbackColumn = columnIndex + 1;

      let value = '';
      if (type === 'inlineStr') {
        value = decodeXml(Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((part) => part[1]).join(''));
      } else {
        const rawValue = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || '';
        value = type === 's' ? sharedStrings[Number(rawValue)] || '' : decodeXml(rawValue);
      }

      row[columnIndex] = value.trim();
    }

    if (row.some((value) => value)) matrix.push(row);
  }

  const [headers = [], ...body] = matrix;
  const normalizedHeaders = headers.map((header, index) => header || `column_${index + 1}`);
  return body.map((values) =>
    normalizedHeaders.reduce<RawLeadRow>((record, header, index) => {
      record[header] = values[index] || '';
      return record;
    }, {})
  );
}
