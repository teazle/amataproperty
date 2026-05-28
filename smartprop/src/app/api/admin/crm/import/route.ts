import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import {
  NormalizedCrmImportLead,
  normalizeCrmImportRows,
  parseDelimitedLeadText,
  parseXlsxLeadRows,
} from '@/lib/crm/import-normalizer';

export const runtime = 'nodejs';

type CrmProjectRow = {
  id: string;
  slug: string;
  title: string;
};

function keyOf(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() || '' : '';
}

async function parseFileRows(file: File) {
  const extension = getFileExtension(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (extension === 'csv' || extension === 'tsv') {
    return parseDelimitedLeadText(buffer.toString('utf8'), extension === 'tsv' ? '\t' : ',');
  }

  if (extension === 'xlsx' || extension === 'xlsm') {
    return parseXlsxLeadRows(buffer);
  }

  throw new Error('Upload an Excel, CSV, or TSV file');
}

function resolveProject(lead: NormalizedCrmImportLead, projects: CrmProjectRow[], fallbackProject: CrmProjectRow) {
  const slugKey = keyOf(lead.projectSlug);
  const titleKey = keyOf(lead.propertyTitle);

  return (
    projects.find((project) => keyOf(project.slug) === slugKey) ||
    projects.find((project) => keyOf(project.title) === titleKey) ||
    projects.find((project) => titleKey.includes(keyOf(project.slug)) || titleKey.includes(keyOf(project.title))) ||
    fallbackProject
  );
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const defaultProjectSlug = String(formData.get('defaultProjectSlug') || 'general-luxe');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A lead file is required' }, { status: 400 });
    }

    const rows = await parseFileRows(file);
    const normalized = normalizeCrmImportRows(rows, { defaultProjectSlug });
    const supabase = getSupabaseClient();

    const { data: projects, error: projectsError } = await supabase
      .from('crm_projects')
      .select('id, slug, title')
      .eq('is_active', true);

    if (projectsError) throw projectsError;

    const projectRows = (projects || []) as CrmProjectRow[];
    const fallbackProject =
      projectRows.find((project) => project.slug === defaultProjectSlug) ||
      projectRows.find((project) => project.slug === 'general-luxe') ||
      projectRows[0];

    if (!fallbackProject) {
      return NextResponse.json({ error: 'No active CRM project is configured' }, { status: 400 });
    }

    const emails = uniqueValues(normalized.valid.map((lead) => lead.email));
    const phones = uniqueValues(normalized.valid.map((lead) => lead.phone));
    const duplicateKeys = new Set<string>();

    if (emails.length > 0) {
      const { data: emailMatches, error: emailError } = await supabase
        .from('crm_leads')
        .select('email')
        .in('email', emails);

      if (emailError) throw emailError;
      for (const match of emailMatches || []) {
        if (match.email) duplicateKeys.add(`email:${String(match.email).toLowerCase()}`);
      }
    }

    if (phones.length > 0) {
      const { data: phoneMatches, error: phoneError } = await supabase
        .from('crm_leads')
        .select('phone')
        .in('phone', phones);

      if (phoneError) throw phoneError;
      for (const match of phoneMatches || []) {
        if (match.phone) duplicateKeys.add(`phone:${String(match.phone)}`);
      }
    }

    const seenInFile = new Set<string>();
    const importable: NormalizedCrmImportLead[] = [];
    const skipped = [...normalized.skipped];
    let duplicateCount = 0;

    for (const lead of normalized.valid) {
      const dedupeKey = lead.email ? `email:${lead.email}` : `phone:${lead.phone}`;
      if (duplicateKeys.has(dedupeKey) || seenInFile.has(dedupeKey)) {
        duplicateCount += 1;
        skipped.push({
          rowNumber: lead.rowNumber,
          reason: 'Duplicate contact',
          originalRow: lead.originalRow,
        });
        continue;
      }
      seenInFile.add(dedupeKey);
      importable.push(lead);
    }

    const leadRows = importable.map((lead) => {
      const project = resolveProject(lead, projectRows, fallbackProject);
      return {
        project_id: project.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        message: lead.message,
        property_title: lead.propertyTitle || project.title,
        source_path: lead.sourcePath,
        source_url: lead.sourceUrl,
        status: lead.status,
        priority: lead.priority,
        assigned_to: lead.assignedTo,
        follow_up_at: lead.followUpAt,
      };
    });

    let insertedLeads: Array<{ id: string }> = [];
    if (leadRows.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('crm_leads')
        .insert(leadRows)
        .select('id');

      if (insertError) throw insertError;
      insertedLeads = inserted || [];
    }

    if (insertedLeads.length > 0) {
      const { error: activityError } = await supabase
        .from('crm_lead_activities')
        .insert(
          insertedLeads.map((lead, index) => ({
            lead_id: lead.id,
            type: 'created',
            note: `Imported from ${file.name} via ${importable[index].source}.`,
            created_by: 'admin-import',
            metadata: {
              source: importable[index].source,
              fileName: file.name,
              rowNumber: importable[index].rowNumber,
              externalId: importable[index].externalId,
              originalRow: importable[index].originalRow,
            },
          }))
        );

      if (activityError) {
        console.error('[CRM] Failed to write import activities:', activityError);
      }
    }

    return NextResponse.json({
      fileName: file.name,
      rowsRead: rows.length,
      imported: insertedLeads.length,
      skipped: skipped.length,
      duplicates: duplicateCount,
      detectedColumns: rows[0] ? Object.keys(rows[0]) : [],
      skippedRows: skipped.slice(0, 25).map((item) => ({
        rowNumber: item.rowNumber,
        reason: item.reason,
      })),
    });
  } catch (error) {
    console.error('[CRM] Failed to import leads:', error);
    const message = error instanceof Error ? error.message : 'Failed to import leads';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
