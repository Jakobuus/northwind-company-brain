'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { DepartmentCards } from '@/components/access/DepartmentCards';
import { RingsLegend } from '@/components/access/RingsLegend';
import {
  brainApi,
  brainErrorText,
  type BrainAccess,
  type BrainArea,
  type BrainMember,
} from '@/components/brain/brain-api';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

// Access model v2 limits (docs/design.md); the api enforces them too.
const MAX_DEPARTMENTS = 10;
const MAX_MEMBERS_PER_DEPARTMENT = 8;
const MAX_LEADS = 2;
const GRANT_PREFIX = 'grant:';

const toList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const leadsOf = (area: BrainArea) => area.leads ?? (area.ownerUserId ? [area.ownerUserId] : []);
const grantsOf = (member: BrainMember) =>
  member.groups
    .filter((group) => group.startsWith(GRANT_PREFIX))
    .map((group) => group.slice(GRANT_PREFIX.length));

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60';

/**
 * v2 → wire format: a department is read by its members and people granted it; a member's
 * groups are their home department plus `grant:<dept>` for each extra department.
 */
const toPayload = (draft: BrainAccess): BrainAccess => {
  const deptSlugs = new Set(draft.areas.filter((a) => !a.isCore).map((a) => a.slug));
  return {
    ...draft,
    areas: draft.areas.map((area) => {
      if (area.isCore) return area;
      const leads = leadsOf(area).slice(0, MAX_LEADS);
      const extraReaders = area.readerGroups.filter(
        (group) => group !== area.slug && group !== `${GRANT_PREFIX}${area.slug}`,
      );
      return {
        ...area,
        leads,
        ownerUserId: leads[0] ?? null,
        readerGroups: [area.slug, `${GRANT_PREFIX}${area.slug}`, ...extraReaders],
      };
    }),
    members: draft.members.map((member) => {
      const otherGroups = member.groups.filter(
        (group) => !group.startsWith(GRANT_PREFIX) && !deptSlugs.has(group),
      );
      const grants = grantsOf(member).filter((slug) => deptSlugs.has(slug) && slug !== member.home);
      return {
        ...member,
        groups: [
          ...(member.home ? [member.home] : []),
          ...grants.map((slug) => `${GRANT_PREFIX}${slug}`),
          ...otherGroups,
        ],
      };
    }),
  };
};

export default function AccessPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [view, setView] = useState<'overview' | 'edit'>('overview');
  const [draft, setDraft] = useState<BrainAccess | null>(null);

  const accessQuery = useQuery({
    queryKey: ['brain-access', organizationId],
    queryFn: () => brainApi.access(organizationId),
    retry: false,
  });

  useEffect(() => {
    if (accessQuery.data) setDraft(accessQuery.data);
  }, [accessQuery.data]);

  const save = useMutation({
    mutationFn: (data: BrainAccess) => brainApi.saveAccess(organizationId, toPayload(data)),
    onSuccess: (data) => {
      queryClient.setQueryData(['brain-access', organizationId], data);
      toast.success('Access saved');
    },
    onError: (error) => toast.error(brainErrorText(error, 'Save failed')),
  });

  const canEdit = !!accessQuery.data?.canEdit;

  const updateArea = (index: number, patch: Partial<BrainArea>) =>
    setDraft(
      (current) =>
        current && {
          ...current,
          areas: current.areas.map((area, i) => (i === index ? { ...area, ...patch } : area)),
        },
    );

  const updateMember = (userId: string, patch: Partial<BrainMember>) =>
    setDraft(
      (current) =>
        current && {
          ...current,
          members: current.members.map((member) =>
            member.userId === userId ? { ...member, ...patch } : member,
          ),
        },
    );

  const handleToggleGrant = (member: BrainMember, slug: string) => {
    const group = `${GRANT_PREFIX}${slug}`;
    const groups = member.groups.includes(group)
      ? member.groups.filter((g) => g !== group)
      : [...member.groups, group];
    updateMember(member.userId, { groups });
  };

  const handleSetLead = (index: number, slot: number, userId: string) => {
    const area = draft?.areas[index];
    if (!area) return;
    const leads = [...leadsOf(area)];
    leads[slot] = userId;
    updateArea(index, { leads: leads.filter(Boolean) });
  };

  const handleAddArea = () =>
    setDraft(
      (current) =>
        current && {
          ...current,
          areas: [
            ...current.areas,
            { slug: '', name: '', ownerUserId: null, readerGroups: [], topics: [], leads: [] },
          ],
        },
    );

  const handleRemoveArea = (index: number) =>
    setDraft(
      (current) => current && { ...current, areas: current.areas.filter((_, i) => i !== index) },
    );

  if (accessQuery.isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (accessQuery.isError || !draft) {
    return (
      <PageContainer>
        <PageHeader title="Access" description="Who can read what in the brain." />
        <p className="py-12 text-center text-sm text-muted-foreground">
          Access settings aren&apos;t available right now.
        </p>
      </PageContainer>
    );
  }

  const departments = draft.areas.filter((area) => !area.isCore && area.slug);
  const departmentCount = draft.areas.filter((area) => !area.isCore).length;
  const memberCount = (slug: string) =>
    draft.members.filter((member) => member.home === slug).length;

  return (
    <PageContainer variant="default">
      <div className="space-y-6">
        <PageHeader
          title="Access"
          description="Everyone reads the company core and every department core. Department internals stay with the department and people granted access. Private stays private."
        >
          {canEdit && view === 'edit' && (
            <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          )}
        </PageHeader>

        <RingsLegend />

        {canEdit ? (
          <div className="inline-flex rounded-lg border bg-muted/40 p-1 text-sm">
            {(['overview', 'edit'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={cn(
                  'rounded-md px-4 py-1.5 transition-colors',
                  view === value
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'overview' ? 'Overview' : 'Edit access'}
              </button>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            Only the company owner and admins can change who gets a look inside a department.
          </p>
        )}

        {(!canEdit || view === 'overview') && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">
                Departments
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {departmentCount} {departmentCount === 1 ? 'department' : 'departments'}
                </span>
              </h2>
              <p className="text-sm text-muted-foreground">
                Department leads decide what moves from their department into a core. Owners and
                admins can&apos;t override them.
              </p>
            </div>
            <DepartmentCards areas={draft.areas} members={draft.members} meId={user?.id} />
          </div>
        )}

        {canEdit && view === 'edit' && (
          <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                Departments
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {departmentCount} {departmentCount === 1 ? 'department' : 'departments'}
                </span>
              </CardTitle>
              <CardDescription>
                Leads decide what moves from the department into a core. Owners and admins
                can&apos;t override them.
              </CardDescription>
            </div>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddArea}
                disabled={departmentCount >= MAX_DEPARTMENTS}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add department
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Leads (1-2)</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Topics</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.areas.map((area, index) => {
                  if (area.isCore) {
                    return (
                      <TableRow key={area.slug}>
                        <TableCell className="font-medium">
                          {area.name}
                          <Badge className="ml-2">everyone</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          Filled by department leads
                        </TableCell>
                        <TableCell className="text-muted-foreground">all</TableCell>
                        <TableCell>{area.topics.join(', ') || '—'}</TableCell>
                        <TableCell />
                      </TableRow>
                    );
                  }
                  const leads = leadsOf(area);
                  const count = memberCount(area.slug);
                  return (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          aria-label="Department name"
                          value={area.name}
                          placeholder="Sales"
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateArea(index, {
                              name: event.target.value,
                              slug: area.slug || toSlug(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {Array.from({ length: MAX_LEADS }, (_, slot) => (
                            <select
                              key={slot}
                              aria-label={`Lead ${slot + 1} of ${area.name || 'department'}`}
                              className={selectClass}
                              disabled={!canEdit || (slot > 0 && !leads[0])}
                              value={leads[slot] ?? ''}
                              onChange={(event) => handleSetLead(index, slot, event.target.value)}
                            >
                              <option value="">{slot === 0 ? 'Choose lead' : '—'}</option>
                              {draft.members
                                .filter(
                                  (member) =>
                                    member.home === area.slug || leads.includes(member.userId),
                                )
                                .map((member) => (
                                  <option key={member.userId} value={member.userId}>
                                    {member.name}
                                  </option>
                                ))}
                            </select>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'text-sm',
                            count > MAX_MEMBERS_PER_DEPARTMENT && 'font-medium text-destructive',
                          )}
                        >
                          {count}/{MAX_MEMBERS_PER_DEPARTMENT}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="Topics"
                          defaultValue={area.topics.join(', ')}
                          placeholder="pricing, customers"
                          disabled={!canEdit}
                          onBlur={(event) =>
                            updateArea(index, { topics: toList(event.target.value) })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${area.name || 'department'}`}
                            onClick={() => handleRemoveArea(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
            <CardDescription>
              Each person has one home department. &quot;Can also read&quot; grants a look inside
              other departments. Rank decides whose word wins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Home department</TableHead>
                  <TableHead>Can also read</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-24">Rank</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.members.map((member) => {
                  const grants = grantsOf(member);
                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <p className="font-medium">{member.name}</p>
                        {member.role && (
                          <p className="text-xs text-muted-foreground">
                            {member.role.toLowerCase()}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <select
                          aria-label={`Home department for ${member.name}`}
                          className={selectClass}
                          disabled={!canEdit}
                          value={member.home ?? ''}
                          onChange={(event) =>
                            updateMember(member.userId, { home: event.target.value || null })
                          }
                        >
                          <option value="">—</option>
                          {departments.map((area) => (
                            <option
                              key={area.slug}
                              value={area.slug}
                              disabled={
                                member.home !== area.slug &&
                                memberCount(area.slug) >= MAX_MEMBERS_PER_DEPARTMENT
                              }
                            >
                              {area.name}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {departments
                            .filter((area) => area.slug !== member.home)
                            .map((area) => {
                              const isGranted = grants.includes(area.slug);
                              return (
                                <button
                                  key={area.slug}
                                  type="button"
                                  disabled={!canEdit}
                                  aria-pressed={isGranted}
                                  onClick={() => handleToggleGrant(member, area.slug)}
                                  className={cn(
                                    'rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-default',
                                    isGranted
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-border text-muted-foreground hover:border-primary',
                                  )}
                                >
                                  {area.name}
                                </button>
                              );
                            })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Title for ${member.name}`}
                          defaultValue={member.title ?? ''}
                          disabled={!canEdit}
                          onBlur={(event) =>
                            updateMember(member.userId, { title: event.target.value || null })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          aria-label={`Rank override for ${member.name}`}
                          placeholder={String(member.rank ?? '')}
                          defaultValue={member.rankOverride ?? ''}
                          disabled={!canEdit}
                          onBlur={(event) =>
                            updateMember(member.userId, {
                              rankOverride:
                                event.target.value === '' ? null : Number(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
