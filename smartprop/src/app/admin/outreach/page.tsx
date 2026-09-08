'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { reconciliationNotice, type ReconciliationNotice } from '@/lib/matcher/outreach-result';
import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type OutreachRow = {
  id: string;
  status: string;
  channel: string;
  template_name: string | null;
  created_at: string;
  first_message_sent_at: string | null;
  last_message_at: string | null;
  agents: { name: string; phone: string | null; agency: string | null } | null;
  listings: { title: string | null; district: string | null; price: number | null; scraped_at: string | null } | null;
};

type PreviewCandidate = {
  listingId: string;
  title: string | null;
  scrapedAt: string | null;
  agentId: string;
  agentName: string;
};

type MatcherResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  previews?: PreviewCandidate[];
  stats?: { outreachCreated?: number };
};

type OutreachProcessResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  stats?: {
    processed?: number;
    sent?: number;
    failed?: number;
    reconciliationRequired?: number;
    reconciliationErrors?: string[];
    reconciliationOutreachIds?: string[];
  };
};

const PAGE_SIZE = 50;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('en-SG') : '—';
}

function responseError(data: { error?: string; message?: string }, fallback: string) {
  return data.error || data.message || fallback;
}

export default function OutreachPage() {
  const [rows, setRows] = useState<OutreachRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<PreviewCandidate[]>([]);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [selectedOutreachIds, setSelectedOutreachIds] = useState<Set<string>>(new Set());
  const [sendConfirmed, setSendConfirmed] = useState(false);
  const [sendingSelected, setSendingSelected] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationNotice | null>(null);

  const loadOutreach = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), status });
      const response = await fetch(`/api/admin/outreach?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load outreach');
      setRows(data.outreach || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.totalPages || 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load outreach');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOutreach();
  // page and status deliberately determine the server-side page being loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  const previewMatcher = async () => {
    setPreviewLoading(true);
    try {
      const response = await fetch('/api/jobs/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json() as MatcherResponse;
      if (!response.ok || data.success !== true) throw new Error(responseError(data, 'Failed to preview matcher'));
      const candidates = data.previews || [];
      setPreview(candidates);
      setSelectedListingIds(new Set(candidates.map((candidate) => candidate.listingId)));
      setConfirmed(false);
      toast.success(`Preview found ${candidates.length} recently refreshed listing-agent matches. No requests were prepared or messages sent.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to preview matcher');
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleSelection = (listingId: string, checked: boolean) => {
    setSelectedListingIds((current) => {
      const next = new Set(current);
      if (checked) next.add(listingId);
      else next.delete(listingId);
      return next;
    });
    setConfirmed(false);
  };

  const prepareSelected = async () => {
    const confirmedListingIds = Array.from(selectedListingIds);
    if (!confirmed || confirmedListingIds.length === 0) return;

    setPreparing(true);
    try {
      const response = await fetch('/api/jobs/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, confirmedListingIds }),
      });
      const data = await response.json() as MatcherResponse;
      if (!response.ok || data.success !== true) throw new Error(responseError(data, 'Failed to prepare outreach'));
      setPreview([]);
      setSelectedListingIds(new Set());
      setConfirmed(false);
      toast.success(`Prepared ${data.stats?.outreachCreated || 0} selected requests. No messages were sent.`);
      await loadOutreach();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to prepare outreach');
    } finally {
      setPreparing(false);
    }
  };

  const toggleOutreachSelection = (outreachId: string, checked: boolean) => {
    setSelectedOutreachIds((current) => {
      const next = new Set(current);
      if (checked) next.add(outreachId);
      else next.delete(outreachId);
      return next;
    });
    setSendConfirmed(false);
  };

  const sendSelected = async () => {
    const confirmedOutreachIds = Array.from(selectedOutreachIds);
    if (!sendConfirmed || confirmedOutreachIds.length === 0) return;

    setSendingSelected(true);
    try {
      const response = await fetch('/api/outreach/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, confirmedOutreachIds }),
      });
      const data = await response.json() as OutreachProcessResponse;
      if (!response.ok || data.success !== true) throw new Error(responseError(data, 'Failed to process selected outreach'));
      const notice = reconciliationNotice(data.stats);
      setSelectedOutreachIds(new Set());
      setSendConfirmed(false);
      if (notice) {
        setReconciliation(notice);
        toast.error(`Processed ${data.stats?.processed || 0} selected rows; ${notice.count} accepted delivery requires reconciliation.`);
      } else {
        toast.success(`Processed ${data.stats?.processed || 0} selected rows: ${data.stats?.sent || 0} accepted, ${data.stats?.failed || 0} failed.`);
      }
      await loadOutreach();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to process selected outreach');
    } finally {
      setSendingSelected(false);
    }
  };

  return (
    <main className="container mx-auto space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Recently refreshed matcher</CardTitle>
          <CardDescription>
            Matches listings refreshed in the last 24 hours with their own listing agent. Prepare selected requests first, then send only selected queued requests after confirmation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={previewMatcher} disabled={previewLoading}>
            {previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Preview recently refreshed listings
          </Button>

          {preview.length > 0 && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm text-muted-foreground">Select the rows to prepare. Preparing creates queued records only; it does not send WhatsApp messages.</p>
              <div className="space-y-2">
                {preview.map((candidate) => (
                  <label key={candidate.listingId} className="flex cursor-pointer items-start gap-3 rounded border p-3">
                    <Checkbox
                      checked={selectedListingIds.has(candidate.listingId)}
                      onCheckedChange={(checked) => toggleSelection(candidate.listingId, checked === true)}
                    />
                    <span className="text-sm">
                      <span className="block font-medium">{candidate.title || 'Untitled listing'}</span>
                      <span className="block text-muted-foreground">{candidate.agentName} · refreshed {formatDate(candidate.scrapedAt)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
                I confirm that the selected listing agents should have outreach records prepared. No messages will be sent.
              </label>
              <Button onClick={prepareSelected} disabled={!confirmed || selectedListingIds.size === 0 || preparing}>
                {preparing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Prepare selected outreach ({selectedListingIds.size})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outreach history</CardTitle>
          <CardDescription>Browse all outreach records. Total: {total}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reconciliation && (
            <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">Delivery needs reconciliation. Do not resend these requests.</p>
              {reconciliation.outreachIds.length > 0 && <p className="mt-1">Affected outreach: {reconciliation.outreachIds.join(', ')}</p>}
              {reconciliation.errors.map((error) => <p key={error} className="mt-1">{error}</p>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={status} onValueChange={(next) => { setStatus(next); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="opted_out">Opted out</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadOutreach} disabled={loading}>Refresh</Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Select</TableHead><TableHead>Listing</TableHead><TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead>Prepared</TableHead><TableHead>Last activity</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No outreach records on this page.</TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell><Checkbox checked={selectedOutreachIds.has(row.id)} disabled={row.status !== 'queued'} onCheckedChange={(checked) => toggleOutreachSelection(row.id, checked === true)} /></TableCell>
                    <TableCell><div className="font-medium">{row.listings?.title || 'Listing unavailable'}</div><div className="text-xs text-muted-foreground">{row.listings?.district || '—'}</div></TableCell>
                    <TableCell><div>{row.agents?.name || 'Agent unavailable'}</div><div className="text-xs text-muted-foreground">{row.agents?.agency || '—'} · {row.agents?.phone || 'No phone'}</div></TableCell>
                    <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                    <TableCell>{formatDate(row.created_at)}</TableCell>
                    <TableCell>{formatDate(row.last_message_at || row.first_message_sent_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {selectedOutreachIds.size > 0 && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm text-muted-foreground">Only selected queued requests can be sent. Sending needs confirmation and respects opt-outs.</p>
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox checked={sendConfirmed} onCheckedChange={(checked) => setSendConfirmed(checked === true)} />
                I confirm the selected recipients should receive the prepared outreach message.
              </label>
              <Button onClick={sendSelected} disabled={!sendConfirmed || sendingSelected}>
                {sendingSelected && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send selected outreach ({selectedOutreachIds.size})
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <span>Page {page} of {Math.max(totalPages, 1)}</span>
            <div className="space-x-2">
              <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
