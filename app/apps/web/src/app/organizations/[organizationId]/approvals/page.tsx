'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, Inbox, Loader2, Lock, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { Initials } from '@/components/access/shared';
import { RingJourney } from '@/components/access/RingJourney';
import {
  brainApi,
  brainErrorText,
  type BrainPromotionRequest,
} from '@/components/brain/brain-api';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

interface RequestLists {
  items: BrainPromotionRequest[];
  mine: BrainPromotionRequest[];
}

const requesterName = (request: BrainPromotionRequest) =>
  typeof request.requestedBy === 'string'
    ? request.requestedBy
    : (request.requestedBy?.name ?? 'Someone');

const isPending = (request: BrainPromotionRequest) =>
  !request.status || request.status === 'PENDING';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for your lead',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

/** Department leads approve or decline moving notes inward; owners and admins can't override. */
export default function ApprovalsPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Requests decided in this visit stay on screen as a confirmation instead of vanishing.
  const [decided, setDecided] = useState<
    Record<string, { decision: 'approve' | 'decline'; request: BrainPromotionRequest }>
  >({});

  const accessQuery = useQuery({
    queryKey: ['brain-access', organizationId],
    queryFn: () => brainApi.access(organizationId),
    retry: false,
  });

  // The brain api answers `{ items: to review, mine: my own requests }`.
  const requests = useQuery({
    queryKey: ['brain-promotion-requests', organizationId],
    queryFn: async (): Promise<RequestLists> => {
      const data = await apiClient.get<unknown>(
        `/api/organizations/${organizationId}/brain/promotion-requests`,
      );
      if (Array.isArray(data)) return { items: data as BrainPromotionRequest[], mine: [] };
      const wrapped = data as Partial<RequestLists> | null;
      return { items: wrapped?.items ?? [], mine: wrapped?.mine ?? [] };
    },
    retry: false,
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'decline' }) =>
      brainApi.decide(organizationId, id, decision),
    onSuccess: (_, { id, decision }) => {
      const request = requests.data?.items.find((item) => item.id === id);
      if (request) setDecided((current) => ({ ...current, [id]: { decision, request } }));
      toast.success(decision === 'approve' ? 'Approved. The note moved inward.' : 'Declined');
      queryClient.invalidateQueries({ queryKey: ['brain-promotion-requests', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['brain-notes', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['brain-graph', organizationId] });
    },
    onError: (error) => toast.error(brainErrorText(error)),
  });

  const ledDepartments = (accessQuery.data?.areas ?? []).filter(
    (area) => !area.isCore && (area.leads ?? [area.ownerUserId]).includes(user?.id ?? ''),
  );
  const isLead = ledDepartments.length > 0;
  const pending = (requests.data?.items ?? []).filter(isPending);
  const confirmed = Object.values(decided);
  const mine = (requests.data?.mine ?? []).slice(0, 5);
  const ready = !requests.isLoading && !accessQuery.isLoading;

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Approvals"
          description="Requests to move a note from a department into a core. Only that department's leads decide."
        >
          {isLead && pending.length > 0 && (
            <Badge className="px-3 py-1 text-sm">{pending.length} waiting</Badge>
          )}
        </PageHeader>

        {!ready && !requests.isError && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {requests.isError && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Approvals aren&apos;t reachable right now.
          </p>
        )}

        {ready && !isLead && (
          <Card>
            <CardContent className="flex items-start gap-3 py-5">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">Only department leads can approve requests</p>
                <p className="text-muted-foreground">
                  Ask your lead to move a note into the department core or the company core. Owners
                  and admins can&apos;t override a lead either.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {ready && isLead && pending.length === 0 && confirmed.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center py-14 text-center">
              <Inbox className="mb-3 h-10 w-10 text-muted-foreground" />
              <h3 className="font-medium">Nothing waiting for you</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                When someone in {ledDepartments.map((area) => area.name).join(' or ')} asks to
                promote a note, it shows up here.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {confirmed.map(({ decision, request }) => (
            <Card
              key={`done-${request.id}`}
              className={decision === 'approve' ? 'border-emerald-600/40' : undefined}
            >
              <CardContent className="flex items-center gap-3 py-4">
                <CheckCircle2
                  className={
                    decision === 'approve'
                      ? 'h-6 w-6 text-emerald-600'
                      : 'h-6 w-6 text-muted-foreground'
                  }
                />
                <div className="min-w-0 space-y-1.5">
                  <p className="truncate font-medium">{request.noteTitle ?? request.noteId}</p>
                  {decision === 'approve' ? (
                    <RingJourney from={request.from} to={request.to} done />
                  ) : (
                    <p className="text-xs text-muted-foreground">Declined. The note stays put.</p>
                  )}
                </div>
                <Badge variant="outline" className="ml-auto">
                  {decision === 'approve' ? 'Moved' : 'Declined'}
                </Badge>
              </CardContent>
            </Card>
          ))}

          {pending.map((request) => (
            <Card key={request.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div className="flex min-w-0 items-center gap-4">
                  <Initials name={requesterName(request)} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="truncate text-base font-medium">
                      {request.noteTitle ?? request.noteId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {requesterName(request)} asks to move this note
                      {request.department ? ` from ${request.department}` : ''}
                    </p>
                    <RingJourney from={request.from} to={request.to} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: request.id, decision: 'decline' })}
                  >
                    <X className="mr-1 h-4 w-4" />
                    Decline
                  </Button>
                  <Button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: request.id, decision: 'approve' })}
                  >
                    {decide.isPending && decide.variables?.id === request.id ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {ready && mine.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Your requests</h2>
            <div className="grid gap-2">
              {mine.map((request) => (
                <Card key={`mine-${request.id}`}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {request.noteTitle ?? request.noteId}
                      </p>
                      <RingJourney from={request.from} to={request.to} done={request.status === 'APPROVED'} />
                    </div>
                    <Badge variant="outline">
                      {STATUS_LABEL[request.status ?? 'PENDING'] ?? request.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
