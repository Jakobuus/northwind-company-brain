'use client';

import { use, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, UploadCloud, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { organizationsApi } from '@/lib/organizations-api';
import { authStorage } from '@/lib/auth-storage';
import { brainApi, brainErrorText, type BrainAccessLevel } from '@/components/brain/brain-api';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

const ACCESS_OPTIONS: { value: BrainAccessLevel; label: string; hint: string }[] = [
  { value: 'all', label: 'Everyone', hint: 'The whole company can read it.' },
  { value: 'area', label: 'Department', hint: 'Only people in this department can read it.' },
  { value: 'restricted', label: 'Only selected people', hint: 'Only the people you tick below.' },
  { value: 'private', label: 'Private to me', hint: 'Only you. It waits in My space until you commit it.' },
];

interface FileResult {
  name: string;
  status: 'pending' | 'imported' | 'skipped' | 'error';
  detail?: string;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Upload failed');

export default function UploadPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [area, setArea] = useState('');
  const [access, setAccess] = useState<BrainAccessLevel>('area');
  const [allow, setAllow] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);

  // "Add a note" in My space links here with ?access=private.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('access');
    if (ACCESS_OPTIONS.some((option) => option.value === preset)) {
      setAccess(preset as BrainAccessLevel);
    }
  }, []);

  const accessQuery = useQuery({
    queryKey: ['brain-access', organizationId],
    queryFn: () => brainApi.access(organizationId),
    retry: false,
  });

  const usersQuery = useQuery({
    queryKey: ['organization-users', organizationId],
    queryFn: () => organizationsApi.getOrganizationUsers(organizationId),
    enabled: access === 'restricted',
  });

  const areas = accessQuery.data?.areas ?? [];
  // Default to the uploader's own department, not whichever area happens to be first.
  const myId = authStorage.getUser()?.id;
  const myHome = accessQuery.data?.members.find((member) => member.userId === myId)?.home;
  const homeArea = areas.find((item) => item.slug === myHome)?.slug;
  const selectedArea =
    area || homeArea || areas.find((item) => !item.isCore)?.slug || areas[0]?.slug || '';

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list)]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const handleZoneKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const handleToggleAllow = (userId: string) =>
    setAllow((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );

  const handleUpload = async () => {
    setIsUploading(true);
    const allowIds = access === 'restricted' ? allow : [];
    const next: FileResult[] = files.map((file) => ({ name: file.name, status: 'pending' }));
    setResults(next);

    // One request per file so each file gets its own result line.
    for (const [index, file] of files.entries()) {
      try {
        const result = await brainApi.upload(organizationId, file, selectedArea, access, allowIds);
        const skipped = result.skipped?.[0];
        next[index] = skipped
          ? { name: file.name, status: 'skipped', detail: skipped.reason }
          : {
              name: file.name,
              status: 'imported',
              detail: result.imported?.map((note) => note.title).join(', '),
            };
      } catch (error) {
        next[index] = {
          name: file.name,
          status: 'error',
          detail: brainErrorText(error, 'Upload failed'),
        };
      }
      setResults([...next]);
    }

    setFiles([]);
    setIsUploading(false);
    queryClient.invalidateQueries({ queryKey: ['brain-notes', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['brain-graph', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['brain-promotion-requests', organizationId] });
  };

  const canUpload =
    files.length > 0 &&
    !!selectedArea &&
    !isUploading &&
    (access !== 'restricted' || allow.length > 0);

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Upload"
          description="Add documents to the brain and decide who can read them."
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop files here or press Enter to choose files"
              onClick={() => inputRef.current?.click()}
              onKeyDown={handleZoneKey}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors',
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary',
              )}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Drop files here, or click to choose</p>
              <p className="text-xs text-muted-foreground">
                Markdown, text, PDF, Word, spreadsheets, email
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>

            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="brain-area">Department</Label>
                <Select value={selectedArea} onValueChange={setArea} disabled={areas.length === 0}>
                  <SelectTrigger id="brain-area">
                    <SelectValue
                      placeholder={
                        accessQuery.isLoading
                          ? 'Loading…'
                          : accessQuery.isError
                            ? 'Departments unavailable'
                            : 'Choose a department'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((item) => (
                      <SelectItem key={item.slug} value={item.slug}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brain-access">Who can read it</Label>
                <Select
                  value={access}
                  onValueChange={(value) => setAccess(value as BrainAccessLevel)}
                >
                  <SelectTrigger id="brain-access">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCESS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {ACCESS_OPTIONS.find((option) => option.value === access)?.hint}
                </p>
              </div>
            </div>

            {access === 'restricted' && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">People who may read it</legend>
                {usersQuery.isLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <div className="grid gap-1 sm:grid-cols-2">
                  {usersQuery.data?.users.map((member) => (
                    <label
                      key={member.userId}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={allow.includes(member.userId)}
                        onChange={() => handleToggleAllow(member.userId)}
                      />
                      {member.user.name || member.user.email}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <Button onClick={handleUpload} disabled={!canUpload}>
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
            </Button>
          </CardContent>
        </Card>

        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Results</CardTitle>
              <CardDescription>What the brain did with each file.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2" aria-live="polite">
                {results.map((result, index) => (
                  <li key={`${result.name}-${index}`} className="flex items-start gap-2 text-sm">
                    {result.status === 'pending' && (
                      <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {result.status === 'imported' && (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                    )}
                    {(result.status === 'skipped' || result.status === 'error') && (
                      <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">
                        {result.name}{' '}
                        <span className="font-normal text-muted-foreground">{result.status}</span>
                      </p>
                      {result.detail && (
                        <p className="text-xs text-muted-foreground">{result.detail}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
