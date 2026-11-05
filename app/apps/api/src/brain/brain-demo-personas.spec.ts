import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { BrainService } from './brain.service';

describe('BrainService.getDemoPersonas', () => {
  const ORG = 'org-1';
  let role: OrgRole;
  let areas: any[];
  let client: any;
  let service: BrainService;
  const env = process.env.NODE_ENV;

  const members = [
    { userId: 'u-jakob', role: 'OWNER', user: { id: 'u-jakob', name: 'Jakob V', email: 'jakob@x.com' } },
    { userId: 'u-elena', role: 'MEMBER', user: { id: 'u-elena', name: 'Elena R', email: 'elena@x.com' } },
    { userId: 'u-zed', role: 'MEMBER', user: { id: 'u-zed', name: 'Zed Z', email: 'zed@x.com' } },
  ];

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    role = OrgRole.OWNER;
    areas = [];
    const prisma: any = {
      organizationMember: {
        findUnique: jest.fn().mockImplementation(async () => ({ role })),
        findMany: jest.fn().mockResolvedValue(members),
      },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme' }) },
      brainMember: { findMany: jest.fn().mockResolvedValue([]) },
      brainArea: { findMany: jest.fn().mockImplementation(async () => areas) },
    };
    client = {
      putPolicy: jest.fn().mockResolvedValue(undefined),
      viewUrl: jest.fn().mockImplementation(async (_o: string, p: string) => `http://x/v/tok-${p}/`),
    };
    service = new BrainService(prisma, client);
  });
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('returns only the cast in fixed order, nobody else', async () => {
    const r = await service.getDemoPersonas('u-elena', ORG);
    expect(r.map((p) => p.id)).toEqual(['u-jakob', 'u-elena']);
    expect(r.find((p) => p.id === 'u-zed')).toBeUndefined();
    expect(client.viewUrl).not.toHaveBeenCalledWith(ORG, 'u-zed', expect.anything());
  });

  it('owner ok', async () => {
    const r = await service.getDemoPersonas('u-jakob', ORG);
    expect(r.map((p) => p.id)).toEqual(['u-jakob', 'u-elena']);
    expect(r[0].url).toContain('tok-u-jakob');
  });

  it('department lead ok', async () => {
    role = OrgRole.MEMBER;
    areas = [{ slug: 'sales', name: 'Sales', leadUserIds: ['u-elena'], topics: [] }];
    const r = await service.getDemoPersonas('u-elena', ORG);
    expect(r.length).toBeGreaterThan(0);
  });

  it('plain member forbidden', async () => {
    role = OrgRole.MEMBER;
    areas = [{ slug: 'sales', name: 'Sales', leadUserIds: ['u-jakob'], topics: [] }];
    await expect(service.getDemoPersonas('u-elena', ORG)).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.viewUrl).not.toHaveBeenCalled();
  });

  it('production forbidden', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.getDemoPersonas('u-jakob', ORG)).rejects.toBeInstanceOf(NotFoundException);
    expect(client.viewUrl).not.toHaveBeenCalled();
  });
});
