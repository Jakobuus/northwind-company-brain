import { BRAIN_CORE_AREA, BRAIN_ROLE_RANK } from '@app-starter/shared';

export interface PolicyMemberInput {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  name: string | null;
  email: string;
  /** Home department slug. */
  home: string | null;
  /** Department slugs this person is granted into. */
  grants: string[];
  rankOverride: number | null;
  title: string | null;
}

export interface PolicyAreaInput {
  slug: string;
  name: string;
  leadUserIds: string[];
  topics: string[];
}

export interface BrainPolicyPayload {
  company_name: string;
  people: Record<
    string,
    { name: string; title: string; rank: number; groups: string[]; home: string | null }
  >;
  areas: Record<
    string,
    { name: string; owner: string; leads: string[]; readers: string[]; topics: string[] }
  >;
}

export const grantGroup = (slug: string): string => `grant:${slug}`;

export const rankFor = (role: PolicyMemberInput['role'], rankOverride: number | null): number =>
  rankOverride ?? BRAIN_ROLE_RANK[role];

/**
 * Turn org members + departments into the policy the brain's internal API accepts (access model v2).
 * A department's readers are its home group (the slug) plus the people granted into it (`grant:<slug>`).
 */
export const buildPolicy = (
  companyName: string,
  members: PolicyMemberInput[],
  departments: PolicyAreaInput[],
): BrainPolicyPayload => {
  const people: BrainPolicyPayload['people'] = {};
  const memberIds = new Set(members.map((m) => m.userId));
  const slugs = new Set(departments.map((d) => d.slug).filter((s) => s !== BRAIN_CORE_AREA));

  for (const m of members) {
    const home = m.home && slugs.has(m.home) ? m.home : null;
    const grants = m.grants.filter((g) => slugs.has(g) && g !== home);
    people[m.userId] = {
      name: m.name?.trim() || m.email.split('@')[0],
      title: m.title ?? '',
      rank: rankFor(m.role, m.rankOverride),
      groups: [...(home ? [home] : []), ...grants.map(grantGroup)],
      home,
    };
  }

  const boss = [...members].sort(
    (a, b) => rankFor(b.role, b.rankOverride) - rankFor(a.role, a.rankOverride),
  )[0];
  const areas: BrainPolicyPayload['areas'] = {
    [BRAIN_CORE_AREA]: {
      name: 'Company core',
      owner: boss?.userId ?? '',
      leads: [],
      readers: ['everyone'],
      topics: [],
    },
  };
  for (const d of departments) {
    if (d.slug === BRAIN_CORE_AREA) continue;
    const leads = d.leadUserIds.filter((id) => memberIds.has(id));
    areas[d.slug] = {
      name: d.name,
      owner: leads[0] ?? '',
      leads,
      readers: [d.slug, grantGroup(d.slug)],
      topics: [...d.topics],
    };
  }

  return { company_name: companyName, people, areas };
};
