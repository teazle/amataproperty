'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  AlertCircle,
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
type LeadsResponse = { leads: CrmLead[] };
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

const statusTone: Record<CrmLeadStatus, string> = {
  new: 'bg-blue-50 border-blue-200',
  contacted: 'bg-cyan-50 border-cyan-200',
  qualified: 'bg-indigo-50 border-indigo-200',
  viewing_scheduled: 'bg-amber-50 border-amber-200',
  offer: 'bg-orange-50 border-orange-200',
  won: 'bg-emerald-50 border-emerald-200',
  lost: 'bg-gray-50 border-gray-200',
};

const priorityTone: Record<CrmLeadPriority, string> = {
  low: 'bg-gray-100 text-gray-800',
  normal: 'bg-blue-100 text-blue-800',
  high: 'bg-red-100 text-red-800',
};

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
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

export default function CrmPage() {
  const [projects, setProjects] = useState<CrmProject[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [selectedProject, setSelectedProject] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [note, setNote] = useState('');
  const [activityType, setActivityType] = useState<ActivityType>('note');
  const [followUpValue, setFollowUpValue] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);

  async function loadProjects() {
    const data = await fetchJson<ProjectsResponse>('/api/admin/crm/projects');
    setProjects(data.projects);
  }

  async function loadLeads() {
    const params = new URLSearchParams();
    params.set('project', selectedProject);
    params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());

    const data = await fetchJson<LeadsResponse>(`/api/admin/crm/leads?${params.toString()}`);
    setLeads(data.leads);
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadProjects(), loadLeads()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load CRM');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, statusFilter, search]);

  const stats = useMemo(() => {
    return {
      total: leads.length,
      new: leads.filter((lead) => lead.status === 'new').length,
      followUps: leads.filter((lead) => lead.follow_up_at).length,
      won: leads.filter((lead) => lead.status === 'won').length,
    };
  }, [leads]);

  const leadsByStatus = useMemo(() => {
    return crmLeadStatuses.reduce<Record<CrmLeadStatus, CrmLead[]>>((acc, status) => {
      acc[status] = leads.filter((lead) => lead.status === status);
      return acc;
    }, {} as Record<CrmLeadStatus, CrmLead[]>);
  }, [leads]);

  function updateSelectedLead(updatedLeads: CrmLead[]) {
    if (!selectedLead) return;
    setSelectedLead(updatedLeads.find((lead) => lead.id === selectedLead.id) || null);
  }

  async function reloadLeadsKeepingSelection() {
    const params = new URLSearchParams();
    params.set('project', selectedProject);
    params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());
    const data = await fetchJson<LeadsResponse>(`/api/admin/crm/leads?${params.toString()}`);
    setLeads(data.leads);
    updateSelectedLead(data.leads);
  }

  async function updateLead(leadId: string, patch: Record<string, string | null>) {
    setError(null);
    try {
      await fetchJson<{ lead: CrmLead }>(`/api/admin/crm/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await reloadLeadsKeepingSelection();
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
      await reloadLeadsKeepingSelection();
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
      await refreshAll();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Project CRM</h1>
          <p className="text-sm text-gray-600 mt-2">
            Customer inquiries from Luxe Realty project pages, organized by project and pipeline stage.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refreshAll()} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Metric label="Total leads" value={stats.total} />
        <Metric label="New" value={stats.new} />
        <Metric label="Follow-ups" value={stats.followUps} />
        <Metric label="Won" value={stats.won} />
      </div>

      <section className="rounded-lg border border-dashed border-gray-300 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-center">
          <label
            className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border px-4 py-6 text-center transition ${
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
              {importing ? 'Importing leads...' : 'Drop OpenClaw Excel or CSV leads here'}
            </span>
            <span className="mt-1 text-xs text-gray-500">
              Uses normalized name, phone, email, project, status, priority, and notes columns when present.
            </span>
          </label>

          <div className="rounded-md border bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <FileSpreadsheet className="h-4 w-4 text-rose-500" />
              Lead import
            </div>
            {importResult ? (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{importResult.fileName}</p>
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
                      {importResult.skippedRows.length > 1 ? `, plus ${importResult.skippedRows.length - 1} more` : ''}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-600">
                Imports into the selected project, or General Luxe when all projects are selected.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_180px_1fr] gap-3">
        <select
          className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
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
          className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
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
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, phone, email, or project"
            className="pl-9 bg-white"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border bg-white p-10 text-center text-gray-600">Loading CRM leads...</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-7 gap-4">
          {crmLeadStatuses.map((status) => (
            <section key={status} className={`rounded-lg border p-3 ${statusTone[status]}`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">{formatCrmStatus(status)}</h2>
                <Badge variant="secondary">{leadsByStatus[status].length}</Badge>
              </div>
              <div className="space-y-3 min-h-32">
                {leadsByStatus[status].map((lead) => (
                  <button
                    key={lead.id}
                    className="w-full rounded-md border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-gray-400 hover:shadow-md"
                    onClick={() => {
                      setSelectedLead(lead);
                      setFollowUpValue(isoToDatetimeLocal(lead.follow_up_at));
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{lead.name}</p>
                        <p className="text-xs text-gray-600 mt-1">{lead.crm_projects?.title || lead.property_title}</p>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${priorityTone[lead.priority]}`}>
                        {lead.priority}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-3 line-clamp-2">{lead.message}</p>
                    <p className="text-[11px] text-gray-500 mt-3">{formatDate(lead.created_at)}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selectedLead)} onOpenChange={(open) => !open && setSelectedLead(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedLead && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedLead.name}</DialogTitle>
                <DialogDescription>{selectedLead.crm_projects?.title || selectedLead.property_title}</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={selectedLead.phone} />
                <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={selectedLead.email} />
                <InfoRow icon={<CalendarClock className="h-4 w-4" />} label="Submitted" value={formatDate(selectedLead.created_at)} />
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
                      <option key={status} value={status}>{formatCrmStatus(status)}</option>
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
                      <option key={priority} value={priority}>{priority}</option>
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
                        <span className="text-xs text-gray-500">{formatDate(activity.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-900 mt-2 whitespace-pre-wrap">{activity.note}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
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
