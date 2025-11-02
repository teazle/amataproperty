'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  Copy, 
  Edit, 
  Trash2, 
  Plus, 
  CheckCircle, 
  Clock,
  Save,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';

interface AIPrompt {
  id: string;
  name: string;
  description?: string;
  prompt_content: string;
  version: number;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export default function AIPromptsPage() {
  const [prompts, setPrompts] = useState<AIPrompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<AIPrompt | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    prompt_content: ''
  });

  // Fetch prompts
  const fetchPrompts = async () => {
    try {
      const response = await fetch('/api/admin/ai-prompts');
      const data = await response.json();
      setPrompts(data.prompts || []);
      
      // Auto-select the active prompt
      const activePrompt = data.prompts?.find((p: AIPrompt) => p.is_active);
      if (activePrompt) {
        console.log('Active prompt loaded:', {
          name: activePrompt.name,
          length: activePrompt.prompt_content?.length || 0,
          preview: activePrompt.prompt_content?.substring(0, 100) + '...'
        });
        setSelectedPrompt(activePrompt);
        setFormData({
          name: activePrompt.name,
          description: activePrompt.description || '',
          prompt_content: activePrompt.prompt_content
        });
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      toast.error('Failed to fetch AI prompts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  // Create new prompt
  const handleCreatePrompt = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/ai-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to create prompt');
      }

      await response.json();
      toast.success('New prompt created successfully');
      setIsCreating(false);
      setFormData({ name: '', description: '', prompt_content: '' });
      fetchPrompts();
    } catch (error) {
      console.error('Error creating prompt:', error);
      toast.error('Failed to create prompt');
    } finally {
      setIsSaving(false);
    }
  };

  // Update prompt
  const handleUpdatePrompt = async () => {
    if (!selectedPrompt) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/admin/ai-prompts/${selectedPrompt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to update prompt');
      }

      await response.json();
      toast.success('Prompt updated successfully');
      setEditMode(false);
      fetchPrompts();
    } catch (error) {
      console.error('Error updating prompt:', error);
      toast.error('Failed to update prompt');
    } finally {
      setIsSaving(false);
    }
  };

  // Activate prompt
  const handleActivatePrompt = async (promptId: string) => {
    try {
      const response = await fetch('/api/admin/ai-prompts/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId })
      });

      if (!response.ok) {
        throw new Error('Failed to activate prompt');
      }

      toast.success('Prompt activated successfully');
      fetchPrompts();
    } catch (error) {
      console.error('Error activating prompt:', error);
      toast.error('Failed to activate prompt');
    }
  };

  // Delete prompt
  const handleDeletePrompt = async (promptId: string) => {
    try {
      const response = await fetch(`/api/admin/ai-prompts/${promptId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete prompt');
      }

      toast.success('Prompt deleted successfully');
      fetchPrompts();
      
      // If we deleted the selected prompt, clear selection
      if (selectedPrompt?.id === promptId) {
        setSelectedPrompt(null);
        setFormData({ name: '', description: '', prompt_content: '' });
      }
    } catch (error) {
      console.error('Error deleting prompt:', error);
      toast.error('Failed to delete prompt');
    }
  };

  // Copy prompt content
  const handleCopyPrompt = () => {
    if (selectedPrompt) {
      navigator.clipboard.writeText(selectedPrompt.prompt_content);
      toast.success('Prompt copied to clipboard');
    }
  };

  // Select prompt
  const handleSelectPrompt = (prompt: AIPrompt) => {
    console.log('Prompt selected:', {
      name: prompt.name,
      length: prompt.prompt_content?.length || 0,
      preview: prompt.prompt_content?.substring(0, 100) + '...'
    });
    setSelectedPrompt(prompt);
    setFormData({
      name: prompt.name,
      description: prompt.description || '',
      prompt_content: prompt.prompt_content
    });
    setEditMode(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Clock className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading AI prompts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">AI Prompt Management</h1>
        <p className="text-muted-foreground">
          Manage and edit AI conversation system prompts
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prompts List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Prompts</CardTitle>
              <Dialog open={isCreating} onOpenChange={setIsCreating}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    New
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create New Prompt</DialogTitle>
                    <DialogDescription>
                      Create a new AI system prompt for conversation management
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="new-name">Name</Label>
                      <Input
                        id="new-name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter prompt name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-description">Description</Label>
                      <Input
                        id="new-description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Enter prompt description"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-content">Prompt Content</Label>
                      <div className="text-xs text-muted-foreground mb-2">
                        Length: {formData.prompt_content.length} characters
                      </div>
                      <Textarea
                        id="new-content"
                        value={formData.prompt_content}
                        onChange={(e) => setFormData({ ...formData, prompt_content: e.target.value })}
                        placeholder="Enter the AI system prompt..."
                        rows={25}
                        className="font-mono text-sm"
                        maxLength={10000}
                      />
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsCreating(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreatePrompt} disabled={isSaving}>
                        {isSaving ? 'Creating...' : 'Create Prompt'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedPrompt?.id === prompt.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                  onClick={() => handleSelectPrompt(prompt)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{prompt.name}</h4>
                      <p className="text-sm text-muted-foreground truncate">
                        {prompt.description || 'No description'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={prompt.is_active ? 'default' : 'secondary'}>
                          {prompt.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge variant="outline">v{prompt.version}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {prompt.is_active ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivatePrompt(prompt.id);
                          }}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Prompt Editor */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {selectedPrompt ? selectedPrompt.name : 'Select a Prompt'}
                </CardTitle>
                <CardDescription>
                  {selectedPrompt 
                    ? `${selectedPrompt.description || 'No description'} - Version ${selectedPrompt.version}`
                    : 'Choose a prompt from the list to view and edit'
                  }
                </CardDescription>
              </div>
              {selectedPrompt && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyPrompt}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditMode(!editMode)}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    {editMode ? 'Cancel' : 'Edit'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Prompt</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete &quot;{selectedPrompt.name}&quot;? 
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDeletePrompt(selectedPrompt.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selectedPrompt ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="prompt-name">Name</Label>
                  <Input
                    id="prompt-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <Label htmlFor="prompt-description">Description</Label>
                  <Input
                    id="prompt-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <Label htmlFor="prompt-content">System Prompt</Label>
                  <div className="text-xs text-muted-foreground mb-2">
                    Length: {formData.prompt_content.length} characters
                  </div>
                  <Textarea
                    id="prompt-content"
                    value={formData.prompt_content}
                    onChange={(e) => setFormData({ ...formData, prompt_content: e.target.value })}
                    disabled={!editMode}
                    rows={30}
                    className="font-mono text-sm"
                    maxLength={10000}
                  />
                </div>
                
                {editMode && (
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setEditMode(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleUpdatePrompt} disabled={isSaving}>
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                )}

                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Prompt Statistics</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Version:</span>
                      <span className="ml-2 font-medium">{selectedPrompt.version}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>
                      <Badge 
                        variant={selectedPrompt.is_active ? 'default' : 'secondary'}
                        className="ml-2"
                      >
                        {selectedPrompt.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created:</span>
                      <span className="ml-2">{new Date(selectedPrompt.created_at).toLocaleDateString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Updated:</span>
                      <span className="ml-2">{new Date(selectedPrompt.updated_at).toLocaleDateString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created by:</span>
                      <span className="ml-2">{selectedPrompt.created_by || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Characters:</span>
                      <span className="ml-2">{selectedPrompt.prompt_content.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <Eye className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Select a prompt from the list to view and edit its content
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
