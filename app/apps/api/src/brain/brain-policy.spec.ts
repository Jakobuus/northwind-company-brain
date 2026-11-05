import { buildPolicy, PolicyMemberInput } from './brain-policy';

const member = (over: Partial<PolicyMemberInput> = {}): PolicyMemberInput => ({
  userId: 'u1',
  role: 'MEMBER',
  name: 'Una',
  email: 'una@example.com',
  home: null,
  grants: [],
  rankOverride: null,
  title: null,
  ...over,
});
const dept = (slug: string, leadUserIds: string[] = [], topics: string[] = []) => ({
  slug,
  name: slug.toUpperCase(),
  leadUserIds,
  topics,
});

describe('buildPolicy', () => {
  it('maps roles to ranks', () => {
    const p = buildPolicy(
      'Acme',
      [
        member({ userId: 'o', role: 'OWNER' }),
        member({ userId: 'a', role: 'ADMIN' }),
        member({ userId: 'm', role: 'MEMBER' }),
      ],
      [],
    );
    expect([p.people.o.rank, p.people.a.rank, p.people.m.rank]).toEqual([100, 70, 30]);
  });

  it('lets a rank override win over the role', () => {
    const p = buildPolicy('Acme', [member({ role: 'MEMBER', rankOverride: 90 })], []);
    expect(p.people.u1.rank).toBe(90);
  });

  it('puts the home department and grants into groups', () => {
    const p = buildPolicy(
      'Acme',
      [member({ userId: 'a', home: 'sales', grants: ['ops', 'sales'], title: 'Rep' })],
      [dept('sales'), dept('ops')],
    );
    expect(p.people.a).toMatchObject({ groups: ['sales', 'grant:ops'], home: 'sales', title: 'Rep' });
  });

  it('drops an unknown home and unknown grants', () => {
    const p = buildPolicy('Acme', [member({ home: 'gone', grants: ['gone2'] })], [dept('sales')]);
    expect(p.people.u1.home).toBeNull();
    expect(p.people.u1.groups).toEqual([]);
  });

  it('readers of a department are its home group and its grant group; leads are listed', () => {
    const p = buildPolicy('Acme', [member({ userId: 'l' })], [dept('sales', ['l', 'ghost'], ['pricing'])]);
    expect(p.areas.sales).toEqual({
      name: 'SALES',
      owner: 'l',
      leads: ['l'],
      readers: ['sales', 'grant:sales'],
      topics: ['pricing'],
    });
  });

  it('always has core readable by everyone, owned by the highest rank', () => {
    const p = buildPolicy('Acme', [member({ userId: 'm' }), member({ userId: 'o', role: 'OWNER' })], []);
    expect(p.areas.core).toEqual({
      name: 'Company core',
      owner: 'o',
      leads: [],
      readers: ['everyone'],
      topics: [],
    });
  });

  it('falls back to the email name and cannot override core from a department row', () => {
    const p = buildPolicy('Acme', [member({ name: null })], [dept('core')]);
    expect(p.people.u1.name).toBe('una');
    expect(p.areas.core.readers).toEqual(['everyone']);
  });
});
