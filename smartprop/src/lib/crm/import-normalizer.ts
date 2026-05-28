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
    'purchasers',
    'purchaser',
    'buyers',
    'buyer',
  ],
  phone: [
    'phone',
    'phonenumber',
    'mobile',
    'mobilenumber',
    'hp',
    'handphone',
    'whatsapp',
    'whatsappnumber',
    'contactnumber',
    'telephone',
    'purtel',
    'projtel',
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
    'location',
    'address',
    'propertyaddress',
    'projname',
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

// OpenClaw FSBO/FRBO column codes — single letters/short tags used in their
// inbound spreadsheets. Expanded into human-readable text in the lead message.
const propertyTypeLabels: Record<string, string> = {
  CO: 'Condo',
  CT: 'Cluster Terrace',
  TR: 'Terrace',
  BU: 'Bungalow',
  SD: 'Semi-Detached',
  PH: 'Penthouse',
  PW: 'Penthouse Walkup',
  AP: 'Apartment',
  WK: 'Walk-up',
};

function pickRaw(row: RawLeadRow, aliases: readonly string[]) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => keyOf(key) === alias);
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim() !== '') {
      return found[1];
    }
  }
  return undefined;
}

// Excel stores dates as serial numbers (days since 1899-12-30 UTC, with the
// 1900-leap-year bug baked in). Our XLSX parser reads raw cell values without
// applying date styles, so values arrive as "42545" rather than a real Date.
// Converts a value to a localized "01 Jan 2024" string, treating numeric
// strings in the plausible Excel-date range as serials.
function formatListingDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return value.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  const str = String(value).trim();
  if (!str) return null;

  let parsed: Date;
  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = Number(str);
    if (serial >= 20000 && serial <= 80000) {
      parsed = new Date(Math.round((serial - 25569) * 86_400_000));
    } else {
      return null;
    }
  } else {
    parsed = new Date(str);
  }

  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function buildOpenClawMessage(row: RawLeadRow, defaultSource: string): string {
  const pt = pickRaw(row, ['pt', 'propertytype']);
  const dt = pickRaw(row, ['dt', 'district']);
  const location = pickRaw(row, ['location', 'address']);
  const tnr = pickRaw(row, ['tnr', 'tenure']);
  const land = pickRaw(row, ['land']);
  const area = pickRaw(row, ['area']);
  const rb = pickRaw(row, ['rb', 'roomsbathrooms']);
  const psf = pickRaw(row, ['psf']);
  const price = pickRaw(row, ['price', 'priceasking', 'pricesgd']);
  const date = pickRaw(row, ['date', 'listingdate']);

  if (!pt && !location && !rb && !price && !psf && !area && !land) {
    return '';
  }

  const lines: string[] = [];
  const tag = `[${defaultSource}]`;
  const headerBits: string[] = [tag];
  if (pt) {
    const code = String(pt).toUpperCase().trim();
    headerBits.push(propertyTypeLabels[code] || code);
  }
  if (dt) headerBits.push(`D${String(dt).trim()}`);
  if (location) headerBits.push(String(location).trim());
  lines.push(headerBits.join(' · '));

  const specs: string[] = [];
  if (area) specs.push(`${String(area).trim()} sqft`);
  if (land) specs.push(`${String(land).trim()} sqft land`);
  if (rb) specs.push(String(rb).trim());
  if (tnr) {
    const tnrStr = String(tnr).trim();
    if (tnrStr.toUpperCase() === 'FH') specs.push('Freehold');
    else specs.push(`${tnrStr}-yr leasehold`);
  }
  if (specs.length) lines.push(specs.join(' · '));

  const priceBits: string[] = [];
  if (price && String(price).trim() !== '-') priceBits.push(`Asking ${String(price).trim()}`);
  if (psf && String(psf).trim() !== '-') priceBits.push(`${String(psf).trim()} psf`);
  if (priceBits.length) lines.push(priceBits.join(' · '));

  const listingDate = formatListingDate(date);
  if (listingDate) lines.push(`Listed ${listingDate}.`);

  return lines.join('\n');
}

// URA-caveats-style imports (".xls" transaction exports converted to CSV):
// each row is a unit purchase with Proj* columns describing the property and
// Pur* columns capturing the buyer's address at the time of purchase.
function buildCaveatsMessage(row: RawLeadRow, defaultSource: string): string {
  const projName = pickRaw(row, ['projname']);
  const contractDate = pickRaw(row, ['contractdate']);
  if (!projName || !contractDate) return '';

  const projBlk = pickRaw(row, ['projblk']);
  const projStreet = pickRaw(row, ['projstreet']);
  const projUnit = pickRaw(row, ['projunit', 'proju']);
  const projPostal = pickRaw(row, ['projpostal']);
  const amount = pickRaw(row, ['amount', 'price', 'pricesgd']);
  const area = pickRaw(row, ['area']);
  const purBlk = pickRaw(row, ['purblk']);
  const purStreet = pickRaw(row, ['purstreet']);
  const purUnit = pickRaw(row, ['purunit']);
  const purPostal = pickRaw(row, ['purpostal']);

  const lines: string[] = [];
  const headerBits: string[] = [`[${defaultSource}]`, String(projName).trim()];
  if (projUnit) headerBits.push(`#${String(projUnit).trim()}`);
  if (area) {
    const areaStr = String(area).trim();
    if (areaStr && areaStr !== '-') headerBits.push(`${areaStr} sqm`);
  }
  lines.push(headerBits.join(' · '));

  const txnBits: string[] = [];
  const purchaseDate = formatListingDate(contractDate);
  if (purchaseDate) txnBits.push(`Purchased ${purchaseDate}`);
  if (amount) {
    const amt = Number(String(amount).replace(/[^\d.]/g, ''));
    if (Number.isFinite(amt) && amt > 0) {
      txnBits.push(`for SGD ${amt.toLocaleString('en-SG')}`);
    }
  }
  if (txnBits.length) lines.push(txnBits.join(' ') + '.');

  const projAddrBits: string[] = [];
  if (projBlk) projAddrBits.push(String(projBlk).trim());
  if (projStreet) projAddrBits.push(String(projStreet).trim());
  if (projPostal) projAddrBits.push(`S${String(projPostal).trim()}`);
  if (projAddrBits.length) lines.push(`Project: ${projAddrBits.join(', ')}.`);

  const purAddrBits: string[] = [];
  if (purBlk) purAddrBits.push(String(purBlk).trim());
  if (purStreet) purAddrBits.push(String(purStreet).trim());
  if (purUnit) {
    const u = String(purUnit).trim();
    if (u && u !== '-') purAddrBits.push(`#${u}`);
  }
  if (purPostal) purAddrBits.push(`S${String(purPostal).trim()}`);
  if (purAddrBits.length) lines.push(`Buyer address: ${purAddrBits.join(', ')}.`);

  return lines.join('\n');
}

// OpenClaw names often have noise jammed on the end: a backup phone
// number ("MRS TAN 69660869"), a tag like "(LH)" for landlord, or both.
// Strip both so the contact display stays clean.
function cleanContactName(value: string): string {
  return value
    .replace(/\s+\+?\d[\d\s-]{5,}/g, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim();
}

export function normalizeCrmImportRows(rows: RawLeadRow[], options: NormalizeOptions = {}) {
  const valid: NormalizedCrmImportLead[] = [];
  const skipped: SkippedCrmImportLead[] = [];
  const defaultProjectSlug = options.defaultProjectSlug || 'general-luxe';

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rawName = pick(row, fieldAliases.name) || '';
    const name = cleanContactName(rawName);
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
    const explicitMessage = pick(row, fieldAliases.message);
    const message =
      explicitMessage ||
      buildCaveatsMessage(row, source) ||
      buildOpenClawMessage(row, source) ||
      `Imported lead from ${source}.`;

    valid.push({
      rowNumber,
      name: name || 'Unknown Lead',
      phone,
      email,
      message,
      propertyTitle,
      projectSlug: explicitProjectSlug || defaultProjectSlug || inferredProjectSlug,
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
