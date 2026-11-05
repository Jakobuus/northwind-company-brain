'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { NoteList, noteLayer } from '@/components/brain/NoteList';

const EXTRACTED_TYPES = new Set(['fact', 'decision', 'policy']);
import { brainApi } from '@/components/brain/brain-api';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

/** The caller's private ring: only they read it until they commit a note to their department. */
export default function MySpacePage({ params }: PageProps) {
  const { organizationId } = use(params);

  const notes = useQuery({
    queryKey: ['brain-notes', organizationId],
    queryFn: () => brainApi.notes(organizationId),
    retry: false,
  });

  // Facts, decisions and policies extracted from a note are notes too; list only the source documents.
  const privateNotes = (notes.data ?? []).filter(
    (note) => noteLayer(note) === 'private' && !EXTRACTED_TYPES.has(note.type ?? ''),
  );

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="My space"
          description="Private notes only you can read. Commit one to share it with your department."
        >
          <Button asChild>
            <Link href={`/organizations/${organizationId}/upload?access=private`}>Add a note</Link>
          </Button>
        </PageHeader>

        {notes.isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {notes.isError && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Your space isn&apos;t reachable right now.
          </p>
        )}

        {notes.data && privateNotes.length === 0 && (
          <EmptyState
            icon={Lock}
            title="Nothing private yet"
            description="Upload with “Private to me” to keep a draft here until it's ready."
          />
        )}

        {privateNotes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Private notes
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {privateNotes.length}
                </span>
              </CardTitle>
              <CardDescription>
                Nobody else sees these: not your lead, not the owner.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NoteList organizationId={organizationId} notes={privateNotes} />
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
