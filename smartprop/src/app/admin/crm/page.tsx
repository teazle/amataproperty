'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Mail,
  Phone,
  RefreshCcw,
  Search,
  Upload,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  CrmLeadPriority,
  CrmLeadStatus,
  crmLeadPriorities,
  crmLeadStatuses,
  formatCrmStatus,
} from '@/lib/crm/validation';

type CrmProject = {
  id: string;
  slug: string;
  title: string;
  source: string;
  is_active: boolean;
};

type CrmActivity = {
  id: string;
  lead_id: string;
  type: string;
  note: string;
  created_by: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

type CrmLead = {
  id: string;
  project_id: string;
  name: string;
  phone: string;
  email: string;
  message: string;
  property_title: string;
  source_path: string;
  source_url: string | null;
  status: CrmLeadStatus;
  priority: CrmLeadPriority;
  assigned_to: string | null;
  follow_up_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  crm_projects: CrmProject | null;
  activities: CrmActivity[];
};

type ProjectsResponse = { projects: CrmProject[] };
type LeadsResponse = { leads: CrmLead[]; total: number; page: number; pageSize: number };
type LeadResponse = { lead: CrmLead };
type ImportResponse = {
  fileName: string;
  rowsRead: number;
  imported: number;
  skipped: number;
  duplicates: number;
  detectedColumns: string[];
  skippedRows: Array<{ rowNumber: number; reason: string }>;
};
type ActivityType = 'note' | 'call' | 'follow_up_scheduled';

type SortDir = 'asc' | 'desc';
type SortableColumn =
  | 'created_at'
  | 'last_activity_at'
  | 'follow_up_at'
  | 'name'
  | 'status'
  | 'priority'
  | 'property_title';

const statusPillClass: Record<CrmLeadStatus, string> = {
  new: 'bg-blue-50 text-blue-700 ring-blue-200',
  contacted: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  qualified: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  viewing_scheduled: 'bg-amber-50 text-amber-800 ring-amber-200',
  offer: 'bg-orange-50 text-orange-800 ring-orange-200',
  won: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  lost: 'bg-gray-100 text-gray-600 ring-gray-200',
};

const priorityPillClass: Record<CrmLeadPriority, string> = {
  low: 'bg-gray-50 text-gray-600 ring-gray-200',
  normal: 'bg-blue-50 text-blue-700 ring-blue-200',
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function formatDateTime(value: string | null) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDateShort(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function datetimeLocalToIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function isoToDatetimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

export default function CrmPage() {
  const [projects, setProjects] = useState<CrmProject[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [total, setTotal] = useState(0);

  const [selectedProject, setSelectedProject] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<SortableColumn>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [selectedLeadLoading, setSelectedLeadLoading] = useState(false);

  const [note, setNote] = useState('');
  const [activityType, setActivityType] = useState<ActivityType>('note');
  const [followUpValue, setFollowUpValue] = useState('');

  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const initialLoad = useRef(true);

  const loadProjects = useCallback(async () => {
    const data = await fetchJson<ProjectsResponse>('/api/admin/crm/projects');
    setProjects(data.projects);
  }, []);

  const loadLeads = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('project', selectedProject);
    params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    params.set('sortBy', sortBy);
    params.set('sortDir', sortDir);

    const data = await fetchJson<LeadsResponse>(`/api/admin/crm/leads?${params.toString()}`);
    setLeads(data.leads);
    setTotal(data.total);
  }, [selectedProject, statusFilter, search, page, pageSize, sortBy, sortDir]);

  const loadLead = useCallback(async (leadId: string) => {
    setSelectedLeadLoading(true);
    try {
      const data = await fetchJson<LeadResponse>(`/api/admin/crm/leads/${leadId}`);
      setSelectedLead(data.lead);
      setFollowUpValue(isoToDatetimeLocal(data.lead.follow_up_at));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load lead');
    } finally {
      setSelectedLeadLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        initialLoad.current ? loadProjects() : Promise.resolve(),
        loadLeads(),
      ]);
      initialLoad.current = false;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load CRM');
    } finally {
      setLoading(false);
    }
  }, [loadProjects, loadLeads]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    setPage(1);
  }, [selectedProject, statusFilter, search, pageSize]);

  useEffect(() => {
    if (selectedLeadId) {
      void loadLead(selectedLeadId);
    } else {
      setSelectedLead(null);
    }
  }, [selectedLeadId, loadLead]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  function toggleSort(column: SortableColumn) {
    if (sortBy === column) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir(column === 'name' || column === 'property_title' ? 'asc' : 'desc');
    }
  }

  async function updateLead(leadId: string, patch: Record<string, string | null>) {
    setError(null);
    try {
      const data = await fetchJson<LeadResponse>(`/api/admin/crm/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setSelectedLead(data.lead);
      await loadLeads();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update lead');
    }
  }

  async function addActivity() {
    if (!selectedLead || !note.trim()) return;

    setError(null);
    try {
      await fetchJson<{ activity: CrmActivity }>(`/api/admin/crm/leads/${selectedLead.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activityType,
          note: note.trim(),
          followUpAt: activityType === 'follow_up_scheduled' ? datetimeLocalToIso(followUpValue) : undefined,
        }),
      });
      setNote('');
      await Promise.all([loadLead(selectedLead.id), loadLeads()]);
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : 'Failed to add activity');
    }
  }

  async function importLeadFile(file: File) {
    setError(null);
    setImportResult(null);
    setImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('defaultProjectSlug', selectedProject === 'all' ? 'general-luxe' : selectedProject);

      const data = await fetchJson<ImportResponse>('/api/admin/crm/import', {
        method: 'POST',
        body: formData,
      });

      setImportResult(data);
      await loadLeads();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import leads');
    } finally {
      setImporting(false);
      setDragActive(false);
    }
  }

  function handleFileList(files: FileList | null) {
    const file = files?.[0];
    if (file) void importLeadFile(file);
  }

  function openLead(leadId: string) {
    setSelectedLeadId(leadId);
  }

  function closeLead() {
    setSelectedLeadId(null);
    setSelectedLead(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">CRM</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total > 0
              ? `${total.toLocaleString()} ${total === 1 ? 'lead' : 'leads'} from Luxe Realty projects.`
              : 'Lead inbox for Luxe Realty projects.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 px-3 py-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name, phone, email, project..."
              className="h-9 bg-white pl-9"
            />
          </div>
          <select
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900"
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.slug}>
                {project.title}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {crmLeadStatuses.map((status) => (
              <option key={status} value={status}>
                {formatCrmStatus(status)}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={() => void refreshAll()}
              disabled={loading}
              aria-label="Refresh"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {loading && leads.length === 0 ? (
          <LeadTableSkeleton />
        ) : leads.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium text-gray-900">No leads match these filters</p>
            <p className="mt-1 text-xs text-gray-500">
              Try clearing filters, or use <span className="font-medium text-gray-700">Import</span> to load an OpenClaw export.
            </p>
          </div>
        ) : (
          <div className="relative">
            <Table className="text-sm">
              <TableHeader className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur">
                <TableRow className="hover:bg-transparent">
                  <SortHeader label="Lead" column="name" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Project" column="property_title" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                  <TableHead className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Contact</TableHead>
                  <SortHeader label="Status" column="status" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Priority" column="priority" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                  <TableHead className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Message</TableHead>
                  <SortHeader
                    label="Follow-up"
                    column="follow_up_at"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Created"
                    column="created_at"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer border-gray-100 odd:bg-white even:bg-gray-50/40 hover:!bg-rose-50/50 transition-colors"
                    onClick={() => openLead(lead.id)}
                  >
                    <TableCell className="px-3 py-2 align-top">
                      <p className="font-medium text-gray-900">{lead.name || 'Unnamed lead'}</p>
                      {lead.assigned_to && (
                        <p className="mt-0.5 text-[11px] text-gray-500">Assigned to {lead.assigned_to}</p>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-gray-700">
                      {lead.crm_projects?.title || lead.property_title || <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      <div className="space-y-0.5 text-[12px] text-gray-700 tabular-nums">
                        {lead.phone ? (
                          <p className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3 text-gray-400" />
                            {lead.phone}
                          </p>
                        ) : null}
                        {lead.email ? (
                          <p className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3 text-gray-400" />
                            <span className="truncate max-w-[160px]">{lead.email}</span>
                          </p>
                        ) : null}
                        {!lead.phone && !lead.email && <span className="text-gray-400">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusPillClass[lead.status]}`}
                      >
                        {formatCrmStatus(lead.status)}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ring-inset ${priorityPillClass[lead.priority]}`}
                      >
                        {lead.priority}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-gray-600 max-w-[220px]">
                      <p className="truncate" title={lead.message}>
                        {lead.message || <span className="text-gray-400">—</span>}
                      </p>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-right text-gray-700 tabular-nums whitespace-nowrap">
                      {lead.follow_up_at ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="h-3 w-3 text-gray-400" />
                          {formatDateShort(lead.follow_up_at)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-right text-gray-500 tabular-nums whitespace-nowrap">
                      {formatDateShort(lead.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/60 px-3 py-2 text-xs text-gray-600">
          <div className="flex items-center gap-3">
            <span>
              {total === 0
                ? '0 leads'
                : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">Rows</span>
              <select
                className="h-7 rounded-md border border-gray-300 bg-white px-1.5 text-xs"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) setImportResult(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-rose-500" />
              Import leads
            </DialogTitle>
            <DialogDescription>
              Drop an OpenClaw export (.xlsx, .xlsm, .csv, .tsv). Rows are matched to the project by{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">project_slug</code>, or fall back to{' '}
              <strong>{selectedProject === 'all' ? 'General Luxe' : selectedProject}</strong>.
            </DialogDescription>
          </DialogHeader>

          <label
            className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
              dragActive ? 'border-rose-400 bg-rose-50' : 'border-gray-200 bg-gray-50 hover:border-gray-400'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              handleFileList(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xlsm,.csv,.tsv"
              className="sr-only"
              onChange={(event) => handleFileList(event.target.files)}
              disabled={importing}
            />
            <Upload className="h-6 w-6 text-gray-500" />
            <span className="mt-3 text-sm font-semibold text-gray-900">
              {importing ? 'Importing leads...' : 'Drop file here or click to choose'}
            </span>
            <span className="mt-1 text-xs text-gray-500">
              Detects normalized name, phone, email, project, status, priority, and notes columns.
            </span>
          </label>

          {importResult && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-900">{importResult.fileName}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <ImportStat label="Rows" value={importResult.rowsRead} />
                <ImportStat label="Added" value={importResult.imported} />
                <ImportStat label="Skipped" value={importResult.skipped} />
                <ImportStat label="Dupes" value={importResult.duplicates} />
              </div>
              {importResult.skippedRows.length > 0 && (
                <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Row {importResult.skippedRows[0].rowNumber}: {importResult.skippedRows[0].reason}
                    {importResult.skippedRows.length > 1
                      ? `, plus ${importResult.skippedRows.length - 1} more`
                      : ''}
                  </span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedLeadId)} onOpenChange={(open) => !open && closeLead()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedLead ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedLead.name}</DialogTitle>
                <DialogDescription>
                  {selectedLead.crm_projects?.title || selectedLead.property_title}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={selectedLead.phone} />
                <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={selectedLead.email} />
                <InfoRow icon={<CalendarClock className="h-4 w-4" />} label="Submitted" value={formatDateTime(selectedLead.created_at)} />
              </div>

              <div className="rounded-md border bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Customer message</p>
                <p className="mt-2 text-sm text-gray-900 whitespace-pre-wrap">{selectedLead.message}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">Status</span>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    value={selectedLead.status}
                    onChange={(event) => void updateLead(selectedLead.id, { status: event.target.value })}
                  >
                    {crmLeadStatuses.map((status) => (
                      <option key={status} value={status}>
                        {formatCrmStatus(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">Priority</span>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    value={selectedLead.priority}
                    onChange={(event) => void updateLead(selectedLead.id, { priority: event.target.value })}
                  >
                    {crmLeadPriorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">Assigned to</span>
                  <Input
                    defaultValue={selectedLead.assigned_to || ''}
                    placeholder="Admin"
                    onBlur={(event) => void updateLead(selectedLead.id, { assignedTo: event.target.value.trim() || null })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">Next follow-up</span>
                  <Input
                    type="datetime-local"
                    value={followUpValue}
                    onChange={(event) => setFollowUpValue(event.target.value)}
                    onBlur={(event) => void updateLead(selectedLead.id, { followUpAt: datetimeLocalToIso(event.target.value) })}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
                <select
                  className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
                  value={activityType}
                  onChange={(event) => setActivityType(event.target.value as ActivityType)}
                >
                  <option value="note">Note</option>
                  <option value="call">Call</option>
                  <option value="follow_up_scheduled">Follow-up</option>
                </select>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add an activity note"
                  className="min-h-24"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void addActivity()} disabled={!note.trim()}>
                  Add Activity
                </Button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Activity Timeline</h3>
                {selectedLead.activities.length === 0 ? (
                  <p className="text-sm text-gray-600">No activity yet.</p>
                ) : (
                  selectedLead.activities.map((activity) => (
                    <div key={activity.id} className="rounded-md border bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline">{activity.type.replaceAll('_', ' ')}</Badge>
                        <span className="text-xs text-gray-500">{formatDateTime(activity.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-900 mt-2 whitespace-pre-wrap">{activity.note}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="py-16 text-center text-sm text-gray-500">
              {selectedLeadLoading ? 'Loading lead...' : 'Select a lead'}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({
  label,
  column,
  sortBy,
  sortDir,
  onToggle,
  align = 'left',
}: {
  label: string;
  column: SortableColumn;
  sortBy: SortableColumn;
  sortDir: SortDir;
  onToggle: (column: SortableColumn) => void;
  align?: 'left' | 'right';
}) {
  const active = sortBy === column;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={`px-3 py-2 text-xs uppercase tracking-wide text-gray-500 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={`inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-gray-200/50 hover:text-gray-700 transition-colors ${
          active ? 'text-gray-900' : ''
        }`}
      >
        <span>{label}</span>
        <Icon className={`h-3 w-3 ${active ? 'opacity-90' : 'opacity-40'}`} />
      </button>
    </TableHead>
  );
}

function LeadTableSkeleton() {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-2.5">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-40 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-gray-100" />
          <div className="h-5 w-14 animate-pulse rounded-full bg-gray-100" />
          <div className="ml-auto h-4 w-24 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function ImportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-white px-2 py-2">
      <p className="text-[11px] font-medium uppercase text-gray-500">{label}</p>
      <p className="text-base font-bold text-gray-900">{value}</p>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-center gap-2 text-gray-500">
        {icon || <UserRound className="h-4 w-4" />}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-medium text-gray-900 mt-2 break-words">{value}</p>
    </div>
  );
}
