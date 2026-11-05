import { Lock, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BrainArea, BrainLayer, BrainMember } from '@/components/brain/brain-api';
import { Initials, RING_DOT } from './shared';

const GRANT_PREFIX = 'grant:';
const HERO_SLUG = 'sales';

const leadsOf = (area: BrainArea) => area.leads ?? (area.ownerUserId ? [area.ownerUserId] : []);
const titleOf = (member: BrainMember) => member.title?.trim() || '';
/** "SDR, Amsterdam" → "SDR": the role without its region, for grouping. */
const roleOf = (member: BrainMember) => titleOf(member).split(',')[0]?.trim() ?? '';
const firstName = (member: BrainMember) => (member.name ?? '').split(/\s+/)[0] || '?';
const humanize = (group: string) => {
  const words = group.replace(/[-_:]+/g, ' ').trim();
  if (/lead/i.test(words)) return 'Team leads';
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const isHeadTitle = (title: string) => /^(head|chief|vp)\b|\b(ceo|cfo|coo|cto)\b/i.test(title);
const isTeamLeadTitle = (title: string) => /\b(team lead|lead)\b/i.test(title);

/** "Account Executive Amsterdam" + "Account Executive Berlin" share the group "Account Executive". */
const groupKeyOf = (title: string, titles: string[]) => {
  const words = title.split(/\s+/);
  let best = title;
  for (const other of titles) {
    if (other === title) continue;
    const otherWords = other.split(/\s+/);
    let shared = 0;
    while (shared < words.length && words[shared] === otherWords[shared]) shared += 1;
    if (shared > 0 && shared < words.length) {
      const prefix = words.slice(0, shared).join(' ');
      if (prefix.length < best.length) best = prefix;
    }
  }
  return best;
};

const plural = (label: string, count: number) => {
  if (count === 1) return label;
  if (/s$/i.test(label)) return label;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
};

interface Chip {
  layer: BrainLayer;
  label: string;
  granted?: boolean;
  /** A restricted group (access: restricted with an allow list), not a ring. */
  restricted?: boolean;
}

const RingChip = ({ chip, size = 'sm' }: { chip: Chip; size?: 'sm' | 'md' }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-background font-medium',
      size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
      chip.granted && 'border-dashed border-emerald-600 text-emerald-700 dark:text-emerald-400',
      chip.restricted && 'border-amber-500 text-amber-700 dark:text-amber-400',
    )}
  >
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full', chip.restricted ? 'bg-amber-500' : RING_DOT[chip.layer])}
      aria-hidden
    />
    {chip.granted ? `+ ${chip.label} (granted)` : chip.label}
  </span>
);

/** Role-driven only (never note data): leads read team-leads-only documents, others do not. */
const LeadsOnlyChip = ({ allowed }: { allowed: boolean }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-background px-2.5 py-1 text-xs font-medium',
      allowed
        ? 'border-amber-500 text-amber-700 dark:text-amber-400'
        : 'border-dashed border-muted-foreground/40 text-muted-foreground/70 line-through opacity-70',
    )}
    title={allowed ? undefined : 'Not readable for this tier'}
  >
    {allowed ? <Lock className="h-3 w-3 shrink-0" aria-hidden /> : <X className="h-3 w-3 shrink-0" aria-hidden />}
    Team leads only
  </span>
);

const CanRead = ({ chips, size }: { chips: Chip[]; size?: 'sm' | 'md' }) => (
  <div className="flex flex-wrap items-center gap-1">
    <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      Can read
    </span>
    {chips.map((chip) => (
      <RingChip key={`${chip.layer}-${chip.label}`} chip={chip} size={size} />
    ))}
  </div>
);

interface Props {
  areas: BrainArea[];
  members: BrainMember[];
  /** Highlights the viewer's own department. */
  meId?: string;
}

interface Group {
  key: string;
  label: string;
  people: BrainMember[];
}

interface OrgChart {
  head: BrainMember | null;
  teamLeads: BrainMember[];
  groups: Group[];
}

/** Head on top, team leads below, everyone else grouped by (shared) title. */
const buildOrgChart = (area: BrainArea, people: BrainMember[]): OrgChart => {
  const leads = leadsOf(area);
  const byId = (id: string) => people.find((member) => member.userId === id);
  const head =
    people.find((member) => isHeadTitle(titleOf(member))) ??
    leads.map(byId).find(Boolean) ??
    null;
  const teamLeads = people.filter(
    (member) =>
      member !== head && (leads.includes(member.userId) || isTeamLeadTitle(titleOf(member))),
  );
  const rest = people.filter((member) => member !== head && !teamLeads.includes(member));
  const titles = rest.map(roleOf).filter(Boolean);
  const groups = new Map<string, BrainMember[]>();
  for (const member of rest) {
    const title = roleOf(member);
    const key = title ? groupKeyOf(title, titles) : 'Team';
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  return {
    head,
    teamLeads,
    groups: [...groups.entries()]
      .map(([key, list]) => ({ key, label: plural(key, list.length), people: list }))
      .sort((a, b) => b.people.length - a.people.length),
  };
};

/** One department's org chart with what each tier can read, built from the access settings. */
const DepartmentOrgChart = ({
  area,
  areas,
  members,
  isHero,
  isMine,
}: {
  area: BrainArea;
  areas: BrainArea[];
  members: BrainMember[];
  isHero: boolean;
  isMine: boolean;
}) => {
  const people = members.filter((member) => member.home === area.slug);
  const leads = leadsOf(area);
  const guests = members.filter(
    (member) => member.home !== area.slug && member.groups.includes(`${GRANT_PREFIX}${area.slug}`),
  );
  const chart = buildOrgChart(area, people);
  const size = isHero ? 'md' : 'sm';

  const baseChips: Chip[] = [
    { layer: 'core', label: 'Company core' },
    { layer: 'dept-core', label: 'All department cores' },
    { layer: 'dept', label: `${area.name} internal` },
    { layer: 'private', label: 'Own private notes' },
  ];
  // Restricted groups: any extra group the access data puts on this department's people
  // (not a department, not a grant). Only shown when the api actually returns one.
  const deptSlugs = new Set(areas.map((a) => a.slug));
  const restrictedGroups = [
    ...new Set(
      people.flatMap((member) =>
        member.groups.filter(
          (group) =>
            !group.startsWith(GRANT_PREFIX) && !deptSlugs.has(group) && group !== 'everyone',
        ),
      ),
    ),
  ].map((group) => ({
    group,
    label: `${humanize(group)} only (${people
      .filter((member) => member.groups.includes(group))
      .map(firstName)
      .join(', ')})`,
  }));
  /** Restricted groups every person in this tier belongs to. */
  const restrictedChipsFor = (tier: BrainMember[]): Chip[] =>
    restrictedGroups
      .filter(({ group }) => tier.length > 0 && tier.every((m) => m.groups.includes(group)))
      .map(({ label }) => ({ layer: 'dept', label, restricted: true }));
  const grantChips = (member: BrainMember): Chip[] =>
    member.groups
      .filter((group) => group.startsWith(GRANT_PREFIX))
      .map((group) => group.slice(GRANT_PREFIX.length))
      .filter((slug) => slug !== area.slug)
      .map((slug) => areas.find((a) => a.slug === slug)?.name)
      .filter((name): name is string => !!name)
      .map((name) => ({ layer: 'dept', label: `${name} internal`, granted: true }));

  const Person = ({ member, showTitle, big }: { member: BrainMember; showTitle?: boolean; big?: boolean }) => {
    const isLead = leads.includes(member.userId);
    const extra = grantChips(member);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Initials
          name={member.name}
          title={`${member.name ?? ''}${member.title ? `, ${member.title}` : ''}`}
          className={cn(
            isLead && 'bg-primary text-primary-foreground',
            big && 'h-10 w-10 text-sm',
            isHero && !big && 'h-8 w-8 text-xs',
          )}
        />
        <span className={cn('text-sm', big && 'text-base')}>
          <span className="font-medium">{member.name ?? 'Former member'}</span>
          {showTitle && titleOf(member) && (
            <span className="text-muted-foreground"> · {titleOf(member)}</span>
          )}
        </span>
        {isLead && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
            Approves moves into the cores
          </Badge>
        )}
        {extra.map((chip) => (
          <RingChip key={chip.label} chip={chip} size="sm" />
        ))}
      </div>
    );
  };

  const HeroPerson = ({ member, big }: { member: BrainMember; big?: boolean }) => (
    <div className="flex items-start gap-2.5">
      <Initials
        name={member.name}
        className={cn(
          'h-9 w-9 text-xs',
          leads.includes(member.userId) && 'bg-primary text-primary-foreground',
          big && 'h-11 w-11 text-sm',
        )}
      />
      <div className="min-w-0 space-y-1">
        <p className={cn('font-medium leading-tight', big ? 'text-lg' : 'text-[15px]')}>
          {member.name ?? 'Former member'}
        </p>
        {titleOf(member) && <p className="text-sm leading-tight text-muted-foreground">{titleOf(member)}</p>}
        {leads.includes(member.userId) && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
            Approves moves into the cores
          </Badge>
        )}
        {grantChips(member).map((chip) => (
          <RingChip key={chip.label} chip={chip} size="sm" />
        ))}
      </div>
    </div>
  );

  const hasLeadStructure = !!chart.head || chart.teamLeads.length > 0;
  const tierLabel = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <Card
      className={cn(
        isHero && 'border-primary/50 shadow-md xl:col-span-3',
        isMine && !isHero && 'border-primary/60 shadow-sm',
      )}
    >
      <CardContent className={cn('space-y-4', isHero ? 'py-6' : 'py-5')}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className={cn('truncate font-semibold', isHero ? 'text-xl' : 'text-base')}>
              {area.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {people.length} {people.length === 1 ? 'person' : 'people'}
            </p>
          </div>
          {isMine && <Badge variant="outline">Your department</Badge>}
        </div>

        {isHero && (
          <div className="flex items-stretch gap-3">
            {[
              ...(chart.head ? [{ label: 'Department head', leads: true, people: [chart.head] }] : []),
              ...(chart.teamLeads.length > 0
                ? [{ label: chart.teamLeads.length > 1 ? 'Team leads' : 'Team lead', leads: true, people: chart.teamLeads }]
                : []),
              ...chart.groups.map((group) => ({
                label: `${group.label} (${group.people.length})`,
                leads: false,
                people: group.people,
              })),
            ].map((tier, index) => (
              <div key={tier.label} className="flex flex-1 items-stretch gap-3">
                {index > 0 && (
                  <span className="self-center text-xl text-muted-foreground" aria-hidden>
                    &rarr;
                  </span>
                )}
                <div
                  className={cn(
                    'flex flex-1 flex-col gap-3 rounded-lg border p-4',
                    index === 0 ? 'border-primary/40 bg-primary/5' : 'bg-muted/30',
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tier.label}</p>
                  <div className="flex-1 space-y-3">
                    {tier.people.map((member) => (
                      <HeroPerson key={member.userId} member={member} big={index === 0} />
                    ))}
                  </div>
                  <div className="flex flex-col items-start gap-1 border-t pt-3">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Can read
                    </span>
                    {[...baseChips, ...restrictedChipsFor(tier.people)].map((chip) => (
                      <RingChip key={chip.label} chip={chip} size="md" />
                    ))}
                    {hasLeadStructure && <LeadsOnlyChip allowed={tier.leads} />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isHero && (
          <>
        {chart.head && (
          <div className={cn('rounded-lg border bg-muted/30 p-3', isHero && 'p-4')}>
            <p className={tierLabel}>Department head</p>
            <div className="mt-2 space-y-2">
              <Person member={chart.head} showTitle big={isHero} />
            </div>
          </div>
        )}

        {chart.teamLeads.length > 0 && (
          <div className={cn('ml-4 border-l-2 pl-4', isHero && 'ml-6 pl-5')}>
            <p className={tierLabel}>{chart.teamLeads.length > 1 ? 'Team leads' : 'Team lead'}</p>
            <div className="mt-2 space-y-2">
              {chart.teamLeads.map((member) => (
                <Person key={member.userId} member={member} showTitle />
              ))}
            </div>
          </div>
        )}

        {chart.groups.length > 0 && (
          <div
            className={cn(
              'grid gap-3',
              isHero ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1',
              (chart.head || chart.teamLeads.length > 0) && 'ml-4 border-l-2 pl-4',
              isHero && 'ml-6 pl-5',
            )}
          >
            {chart.groups.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className={tierLabel}>
                  {group.label} ({group.people.length})
                </p>
                <div className="space-y-1.5">
                  {group.people.map((member) => (
                    <Person
                      key={member.userId}
                      member={member}
                      showTitle={!!titleOf(member) && titleOf(member) !== group.key}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

          </>
        )}

        <div className="border-t pt-3">
          {!isHero && <CanRead chips={baseChips} size={size} />}
          {!isHero && restrictedGroups.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Restricted
              </span>
              {restrictedGroups.map(({ group, label }) => (
                <span
                  key={group}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500 bg-background font-medium text-amber-700 dark:text-amber-400',
                    size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  {label}
                </span>
              ))}
            </div>
          )}
          {isHero && (
            <p className="text-sm text-muted-foreground">
              {hasLeadStructure
                ? `Team leads in ${area.name} also read documents marked team-leads-only, like strategy.`
                : `The four rings are the same for everyone in ${area.name}.`}
              {restrictedGroups.length > 0 && ' Amber chips are restricted groups.'}
              {people.some((member) => grantChips(member).length > 0) &&
                ' Dashed chips are other departments a person was granted.'}{' '}
              Names and structure only, never note content.
            </p>
          )}
        </div>

        {guests.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className={tierLabel}>Granted a look inside {area.name} internal</p>
            {guests.map((guest) => (
              <div key={guest.userId} className="flex items-center gap-2">
                <Initials name={guest.name} className="h-6 w-6 text-[10px]" />
                <span className="truncate text-sm">
                  {guest.name}
                  {titleOf(guest) && (
                    <span className="text-muted-foreground"> · {titleOf(guest)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/** One org chart per department: who leads it, who is in it, who can read what. Structure only. */
export function DepartmentCards({ areas, members, meId }: Props) {
  const departments = areas.filter((area) => !area.isCore && area.slug);
  const me = members.find((member) => member.userId === meId);
  const isHero = (area: BrainArea) =>
    area.slug === HERO_SLUG || (!departments.some((d) => d.slug === HERO_SLUG) && area === departments[0]);
  const ordered = [...departments.filter(isHero), ...departments.filter((area) => !isHero(area))];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ordered.map((area) => (
        <DepartmentOrgChart
          key={area.slug}
          area={area}
          areas={areas}
          members={members}
          isHero={isHero(area)}
          isMine={me?.home === area.slug}
        />
      ))}
    </div>
  );
}
