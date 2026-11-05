'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CheckSquare,
  Loader2,
  Lock,
  Network,
  Settings,
  UploadCloud,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { InviteOrganizationMembersDialog } from '@/components/organizations/InviteOrganizationMembersDialog';
import { organizationsApi } from '@/lib/organizations-api';
import { brainApi, type BrainLayer } from '@/components/brain/brain-api';
import { LayerBadge, noteLayer } from '@/components/brain/NoteList';

const SHORTCUTS: { href: string; icon: LucideIcon; title: string; description: string }[] = [
  { href: '/brain', icon: Network, title: 'Brain', description: 'The map of everything you may read, and a place to ask it.' },
  { href: '/space', icon: Lock, title: 'My space', description: 'Your private notes. Commit one when it is ready to share.' },
  { href: '/upload', icon: UploadCloud, title: 'Upload', description: 'Add documents and choose who can read them.' },
  { href: '/approvals', icon: CheckSquare, title: 'Approvals', description: 'Requests to move notes inward, decided by the lead.' },
];

// Extracted items (facts, decisions, policies) are notes too; the overview counts source documents only.
const EXTRACTED_TYPES = new Set(['fact', 'decision', 'policy']);

const LAYERS: BrainLayer[] = ['core', 'dept-core', 'dept', 'private'];

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

export default function OrganizationPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: organization, isLoading } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: () => organizationsApi.getOrganization(organizationId),
  });

  const { data: roleInfo } = useQuery({
    queryKey: ['organization-role', organizationId],
    queryFn: () => organizationsApi.getUserRoleInOrganization(organizationId),
  });

  const notes = useQuery({
    queryKey: ['brain-notes', organizationId],
    queryFn: () => brainApi.notes(organizationId),
    retry: false,
  });

  const documents = (notes.data ?? []).filter((note) => !EXTRACTED_TYPES.has(note.type ?? ''));
  const layerCounts = documents.reduce<Partial<Record<BrainLayer, number>>>(
    (counts, note) => {
      const layer = noteLayer(note);
      if (layer) counts[layer] = (counts[layer] ?? 0) + 1;
      return counts;
    },
    {},
  );

  const canManage = roleInfo?.role === 'OWNER' || roleInfo?.role === 'ADMIN';

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (!organization) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-4xl px-4 py-16 text-center text-muted-foreground">
          Organization not found, or you no longer have access to it.
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <PageHeader title={organization.name} description={organization.description || 'Your company brain: who sees what, and whose word wins.'}>
          <div className="flex gap-2">
            {canManage && (
              <Button variant="outline" onClick={() => setInviteOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invite
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/organizations/${organizationId}/settings`}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </Button>
          </div>
        </PageHeader>

        <section className="grid gap-3 sm:grid-cols-2">
          {SHORTCUTS.map(({ href, icon: Icon, title, description }) => (
            <Link key={href} href={`/organizations/${organizationId}${href}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader className="py-5">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{title}</CardTitle>
                  </div>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What you can read</CardTitle>
            <CardDescription>
              Documents counted from your own view of the brain. Notes you may not open are not counted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {notes.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {notes.isError && (
              <p className="text-sm text-muted-foreground">The brain isn&apos;t reachable right now.</p>
            )}
            {notes.data && notes.data.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing here yet. Upload a file to start.</p>
            )}
            {notes.data && notes.data.length > 0 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {LAYERS.map((layer) => (
                  <div key={layer} className="space-y-1">
                    <p className="text-2xl font-semibold">{layerCounts[layer] ?? 0}</p>
                    <LayerBadge layer={layer} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {organization.location && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              {organization.location}
            </CardContent>
          </Card>
        )}
      </div>

      <InviteOrganizationMembersDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        defaultOrganizationId={organizationId}
      />
    </PageContainer>
  );
}
