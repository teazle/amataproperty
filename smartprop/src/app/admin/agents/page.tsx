'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Search, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { supabaseClient as supabase } from '@/lib/supabase-client';

interface Agent {
  id: string;
  name: string;
  phone: string;
  agency: string | null;
  source: string | null;
  last_seen_at: string;
  email?: string;
  cea_reg_no?: string;
}


export default function AgentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [letterFilter, setLetterFilter] = useState<string>('all');

  // Fetch agents from Supabase
  const fetchAgents = async () => {
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching agents:', error);
        return;
      }

      setAgents(data || []);
    } catch (error) {
      console.error('Error fetching agents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch agents on component mount
  useEffect(() => {
    fetchAgents();
  }, []);

  const filteredAgents = agents
    .filter(agent => {
      // Letter filter by first letter of name
      if (letterFilter !== 'all') {
        const firstLetter = (agent.name || '').charAt(0).toUpperCase();
        if (letterFilter.includes('-')) {
          // Handle ranges like "A-F", "G-M", etc.
          const [start, end] = letterFilter.split('-');
          if (firstLetter < start || firstLetter > end) {
            return false;
          }
        } else {
          // Handle single letter
          if (firstLetter !== letterFilter) {
            return false;
          }
        }
      }
      
      // Search filter
      return (
        (agent.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (agent.phone || '').includes(searchTerm) ||
        (agent.agency || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (agent.source || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    })
    .sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      const comparison = nameA.localeCompare(nameB);
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const exportToCSV = () => {
    const headers = ['Name', 'Phone', 'Agency', 'Source', 'Last Seen'];
    const csvContent = [
      headers.join(','),
      ...filteredAgents.map(agent => [
        agent.name,
        agent.phone,
        agent.agency || '',
        agent.source || '',
        agent.last_seen_at
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agents.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Agents</h1>
        <p className="text-gray-600 mt-2">Manage property agents and their information</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Agent Directory</CardTitle>
              <CardDescription>
                {isLoading ? 'Loading...' : `${filteredAgents.length} agent${filteredAgents.length !== 1 ? 's' : ''} found`}
              </CardDescription>
            </div>
            <Button onClick={exportToCSV} variant="outline" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2 mb-4 flex-wrap">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search agents by name, phone, agency, or source..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
            <Select value={letterFilter} onValueChange={setLetterFilter}>
              <SelectTrigger className="w-[160px] flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <SelectValue placeholder="Filter by letter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Letters</SelectItem>
                <SelectItem value="A-F">A - F</SelectItem>
                <SelectItem value="G-M">G - M</SelectItem>
                <SelectItem value="N-S">N - S</SelectItem>
                <SelectItem value="T-Z">T - Z</SelectItem>
                {Array.from({ length: 26 }, (_, i) => {
                  const letter = String.fromCharCode(65 + i); // A-Z
                  return (
                    <SelectItem key={letter} value={letter}>
                      {letter}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button
              onClick={toggleSortOrder}
              variant="outline"
              className="flex items-center gap-2"
            >
              {sortOrder === 'asc' ? (
                <>
                  <ArrowUp className="h-4 w-4" />
                  A-Z
                </>
              ) : (
                <>
                  <ArrowDown className="h-4 w-4" />
                  Z-A
                </>
              )}
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                      Loading agents...
                    </TableCell>
                  </TableRow>
                ) : filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                      No agents found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAgents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell>{agent.phone}</TableCell>
                      <TableCell>{agent.agency || '-'}</TableCell>
                      <TableCell>{agent.source || '-'}</TableCell>
                      <TableCell>{new Date(agent.last_seen_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
