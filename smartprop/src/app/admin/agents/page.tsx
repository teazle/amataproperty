'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getShowingRange } from '@/lib/admin-browsing';
import { ArrowDown, ArrowUp, Download, Filter, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Agent { id: string; name: string; phone: string; agency: string | null; source: string | null; last_seen_at: string; }
const pageSize = 50;

export default function AgentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [letterFilter, setLetterFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const searchParams = new URLSearchParams({ page: String(page), limit: String(pageSize), search: searchTerm, letter: letterFilter, source: sourceFilter, sort: sortOrder });
    async function fetchAgents() {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/admin/agents?${searchParams}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        setAgents(result.agents || []);
        setTotal(result.pagination?.total || 0);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Error fetching agents:', error);
          setAgents([]);
          setTotal(0);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    fetchAgents();
    return () => controller.abort();
  }, [page, searchTerm, letterFilter, sourceFilter, sortOrder]);

  const showing = getShowingRange({ total, page, limit: pageSize, received: agents.length });
  const exportToCSV = () => {
    const csvContent = [['Name', 'Phone', 'Agency', 'Source', 'Last Seen'].join(','), ...agents.map((agent) => [agent.name, agent.phone, agent.agency || '', agent.source || '', agent.last_seen_at].join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agents.csv';
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold text-gray-900">Agents</h1><p className="mt-2 text-gray-600">Manage property agents and their information</p></div>
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Agent Directory</CardTitle><CardDescription>{isLoading ? 'Loading...' : `Showing ${showing.start}-${showing.end} of ${total} agents`}</CardDescription></div><Button onClick={exportToCSV} variant="outline" className="flex items-center gap-2"><Download className="h-4 w-4" /> Export page</Button></div></CardHeader>
      <CardContent><div className="mb-4 flex flex-wrap items-center gap-2"><Search className="h-4 w-4 text-gray-400" /><Input placeholder="Search agents by name, phone, agency, or source..." value={searchTerm} onChange={(event) => { setPage(1); setSearchTerm(event.target.value); }} className="max-w-sm" />
        <Select value={letterFilter} onValueChange={(value) => { setPage(1); setLetterFilter(value); }}><SelectTrigger className="w-[160px]"><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="Filter by letter" /></SelectTrigger><SelectContent><SelectItem value="all">All Letters</SelectItem><SelectItem value="A-F">A - F</SelectItem><SelectItem value="G-M">G - M</SelectItem><SelectItem value="N-S">N - S</SelectItem><SelectItem value="T-Z">T - Z</SelectItem></SelectContent></Select>
        <Select value={sourceFilter} onValueChange={(value) => { setPage(1); setSourceFilter(value); }}><SelectTrigger className="w-[160px]"><SelectValue placeholder="All sources" /></SelectTrigger><SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="propertyguru">PropertyGuru</SelectItem><SelectItem value="edgeprop">EdgeProp</SelectItem></SelectContent></Select>
        <Button onClick={() => { setPage(1); setSortOrder((current) => current === 'asc' ? 'desc' : 'asc'); }} variant="outline" className="flex items-center gap-2">{sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}{sortOrder === 'asc' ? 'A-Z' : 'Z-A'}</Button></div>
        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Agency</TableHead><TableHead>Source</TableHead><TableHead>Last Seen</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-gray-500">Loading agents...</TableCell></TableRow> : agents.length === 0 ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-gray-500">No agents found</TableCell></TableRow> : agents.map((agent) => <TableRow key={agent.id}><TableCell className="font-medium">{agent.name}</TableCell><TableCell>{agent.phone}</TableCell><TableCell>{agent.agency || '-'}</TableCell><TableCell>{agent.source || '-'}</TableCell><TableCell>{new Date(agent.last_seen_at).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></div>
        {!isLoading && total > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700"><span>Showing {showing.start}-{showing.end} of {total}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={showing.end >= total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>}
      </CardContent></Card>
  </div>;
}
