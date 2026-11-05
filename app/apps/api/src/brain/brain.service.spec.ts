import { BadGatewayException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { BrainService } from './brain.service';

describe('BrainService', () => {
  const ORG = 'org-1';
  let prisma: any;
  let client: any;
  let service: BrainService;
  let role: OrgRole | null;
  let brainMembers: any[];
  let areas: any[];

  const orgMembers = () => [
    { userId: 'owner', role: 'OWNER', user: { id: 'owner', name: 'Owner', email: 'o@x.com' } },
    { userId: 'admin', role: 'ADMIN', user: { id: 'admin', name: 'Admin', email: 'a@x.com' } },
    { userId: 'admin2', role: 'ADMIN', user: { id: 'admin2', name: 'Admin2', email: 'a2@x.com' } },
    { userId: 'mem', role: 'MEMBER', user: { id: 'mem', name: 'Mem', email: 'm@x.com' } },
    { userId: 'mem2', role: 'MEMBER', user: { id: 'mem2', name: 'Mem2', email: 'm2@x.com' } },
  ];

  beforeEach(() => {
    role = OrgRole.MEMBER;
    brainMembers = [];
    areas = [];
    prisma = {
      organizationMember: {
        findUnique: jest.fn().mockImplementation(async () => (role ? { role } : null)),
        findMany: jest.fn().mockImplementation(async () => orgMembers()),
      },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme' }) },
      brainMember: { findMany: jest.fn().mockImplementation(async () => brainMembers), upsert: jest.fn() },
      brainArea: {
        findMany: jest.fn().mockImplementation(async () => areas),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      promotionRequest: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'r1', decidedById: null, decidedAt: null, status: 'PENDING', createdAt: new Date(), ...data,
        })),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'r1', noteId: 'n1', noteTitle: 'T', dept: 'sales', target: 'core', requesterId: 'mem',
          createdAt: new Date(), decidedById: null, decidedAt: null, ...data,
        })),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(prisma)),
    };
    client = {
      putPolicy: jest.fn().mockResolvedValue(undefined),
      importFile: jest.fn().mockResolvedValue({ imported: [], skipped: [] }),
      notes: jest.fn().mockResolvedValue([]),
      moveNote: jest.fn().mockResolvedValue(undefined),
    };
    service = new BrainService(prisma, client);
    service.retryDelayMs = 0;
  });

  /** Web-shaped PUT body: areas with leads, members with home. */
  const area = (slug: string, leads: string[]) => ({ slug, name: slug, leads });
  const home = (slug: string | null, ...ids: string[]) => ids.map((userId) => ({ userId, home: slug }));
  const body = (areas: any[], members: any[] = []) => ({ areas, members });
  const salesBody = () => body([area('sales', ['mem'])], home('sales', 'mem', 'mem2'));

  describe('updateAccess', () => {
    it('forbids a MEMBER', async () => {
      await expect(service.updateAccess('mem', ORG, body([]))).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(client.putPolicy).not.toHaveBeenCalled();
    });

    it('forbids a non-member', async () => {
      role = null;
      await expect(service.updateAccess('x', ORG, body([]))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an ADMIN save departments and syncs the policy with leads and homes', async () => {
      role = OrgRole.ADMIN;
      await service.updateAccess('admin', ORG, salesBody());
      expect(prisma.brainArea.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ slug: 'sales', leadUserIds: ['mem'] }) }),
      );
      expect(prisma.brainMember.upsert).toHaveBeenCalledTimes(5);
      expect(client.putPolicy).toHaveBeenCalledWith(ORG, expect.objectContaining({ company_name: 'Acme' }));
    });

    it('turns grant: groups into grants; a lead without a home is moved into the department', async () => {
      role = OrgRole.ADMIN;
      await service.updateAccess(
        'admin',
        ORG,
        body([area('sales', ['mem']), area('ops', ['mem2'])], [{ userId: 'mem', groups: ['grant:ops'] }]),
      );
      expect(prisma.brainMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: 'mem', home: 'sales', grants: ['ops'] }) }),
      );
      expect(prisma.brainMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: 'mem2', home: 'ops' }) }),
      );
    });

    it('enforces limits: members per department, leads, lead home, grants, ids', async () => {
      role = OrgRole.OWNER;
      const run = (b: any) => service.updateAccess('owner', ORG, b);
      await expect(run(body([area('s', [])], home('s', 'mem')))).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(body([area('s', ['mem', 'mem2', 'admin', 'admin2'])]))).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(body([area('s', ['mem']), area('t', ['mem'])]))).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(body([area('s', ['mem'])], [{ userId: 'mem2', home: 'nope' }]))).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(body([area('s', ['mem'])], [{ userId: 'mem2', groups: ['grant:nope'] }]))).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(body([area('personal-x', ['mem'])]))).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        run(body(Array.from({ length: 11 }, (_, i) => area(`d${i}`, ['mem'])))),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a ninth member in one department', async () => {
      role = OrgRole.OWNER;
      const original = prisma.organizationMember.findMany.getMockImplementation();
      prisma.organizationMember.findMany.mockImplementation(async () => [
        ...(await original()),
        ...[3, 4, 5, 6].map((i) => ({ userId: `mem${i}`, role: 'MEMBER', user: { id: `mem${i}`, name: `M${i}`, email: `m${i}@x.com` } })),
      ]);
      const nine = home('s', 'owner', 'admin', 'admin2', 'mem', 'mem2', 'mem3', 'mem4', 'mem5', 'mem6');
      await expect(service.updateAccess('owner', ORG, body([area('s', ['owner'])], nine))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.updateAccess('owner', ORG, body([area('s', ['owner'])], nine.slice(0, 8)))).resolves.toBeDefined();
    });

    describe('privilege escalation', () => {
      it('ADMIN raising their own rank override -> 403', async () => {
        role = OrgRole.ADMIN;
        await expect(
          service.updateAccess('admin', ORG, body([], [{ userId: 'admin', rankOverride: 100 }])),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('ADMIN setting a rank override on a member -> 403', async () => {
        role = OrgRole.ADMIN;
        await expect(
          service.updateAccess('admin', ORG, body([], [{ userId: 'mem', rankOverride: 90 }])),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('ADMIN granting themselves access, or moving an owner/peer admin -> 403', async () => {
        role = OrgRole.ADMIN;
        const withSales = [area('sales', ['mem'])];
        await expect(
          service.updateAccess('admin', ORG, body(withSales, [{ userId: 'admin', groups: ['grant:sales'] }])),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          service.updateAccess('admin', ORG, body(withSales, home('sales', 'owner'))),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          service.updateAccess('admin', ORG, body(withSales, home('sales', 'admin2'))),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          service.updateAccess('admin', ORG, body(withSales, home('sales', 'admin'))),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('ADMIN may change someone ranked below them, and re-send unchanged values', async () => {
        role = OrgRole.ADMIN;
        brainMembers = [{ userId: 'admin', rankOverride: null, grants: [], home: null, title: null }];
        await service.updateAccess(
          'admin',
          ORG,
          body([area('sales', ['mem'])], [
            { userId: 'mem', groups: ['sales', 'grant:sales'], home: 'sales' },
            { userId: 'admin', rankOverride: null, home: null },
          ]),
        );
        expect(prisma.$transaction).toHaveBeenCalled();
      });

      it('ADMIN adding themselves, an owner or a peer admin as lead -> 403; adding a lower-ranked lead is fine', async () => {
        role = OrgRole.ADMIN;
        for (const lead of ['admin', 'owner', 'admin2']) {
          await expect(
            service.updateAccess('admin', ORG, body([area('sales', [lead])], home('sales', lead))),
          ).rejects.toBeInstanceOf(ForbiddenException);
        }
        // brand-new department led by a member is fine
        await service.updateAccess('admin', ORG, body([area('sales', ['mem'])], home('sales', 'mem')));
        expect(prisma.$transaction).toHaveBeenCalled();
      });

      it('ADMIN removing an owner-level or own lead role -> 403', async () => {
        role = OrgRole.ADMIN;
        areas = [{ slug: 'sales', name: 'sales', leadUserIds: ['owner'], topics: [] }];
        brainMembers = [{ userId: 'owner', home: 'sales', grants: [], rankOverride: null, title: null }];
        await expect(
          service.updateAccess('admin', ORG, body([area('sales', ['mem'])], home('sales', 'mem'))),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // deleting the department also removes its leads
        await expect(service.updateAccess('admin', ORG, body([]))).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('OWNER may add themselves as lead', async () => {
        role = OrgRole.OWNER;
        await service.updateAccess('owner', ORG, body([area('sales', ['owner'])], home('sales', 'owner')));
        expect(prisma.$transaction).toHaveBeenCalled();
      });

      it('OWNER may set a rank override and change their own record', async () => {
        role = OrgRole.OWNER;
        await service.updateAccess(
          'owner',
          ORG,
          body([area('exec', ['owner'])], [{ userId: 'mem', rankOverride: 80 }]),
        );
        expect(prisma.brainMember.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ create: expect.objectContaining({ userId: 'mem', rankOverride: 80 }) }),
        );
        expect(prisma.brainMember.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ create: expect.objectContaining({ userId: 'owner', home: 'exec' }) }),
        );
      });
    });
  });

  describe('getAccess', () => {
    it('hides emails, grants and rank overrides from a MEMBER but shows structure', async () => {
      areas = [{ slug: 'sales', name: 'Sales', leadUserIds: ['mem'], topics: [] }];
      brainMembers = [{ userId: 'mem2', home: 'sales', grants: ['sales'], rankOverride: 40, title: 'Rep' }];
      const r = await service.getAccess('mem', ORG);
      expect(r.canEdit).toBe(false);
      expect(r.members.every((m) => m.email === '' && m.groups.every((g) => !g.startsWith('grant:')) && m.rankOverride === null)).toBe(true);
      expect(r.areas.map((a) => a.slug)).toEqual(['core', 'sales']);
      expect(r.areas[1]).toMatchObject({ leads: ['mem'], readerGroups: ['sales', 'grant:sales'] });
      expect(r.members.find((m) => m.userId === 'mem2')).toMatchObject({ home: 'sales', groups: ['sales'] });
    });
  });

  describe('upload', () => {
    const file = { buffer: Buffer.from('hi'), originalname: 'a.txt', size: 2 };
    beforeEach(() => {
      areas = [{ slug: 'sales', name: 'Sales', leadUserIds: ['mem'], topics: [] }];
      brainMembers = [
        { userId: 'mem', home: 'sales', grants: [], rankOverride: null, title: null },
        { userId: 'mem2', home: 'sales', grants: [], rankOverride: null, title: null },
        { userId: 'admin', home: null, grants: [], rankOverride: null, title: null },
      ];
    });

    it('private upload: caller is the author, policy synced first', async () => {
      await service.upload('mem2', ORG, { file, layer: 'private' });
      expect(client.putPolicy).toHaveBeenCalled();
      expect(client.importFile).toHaveBeenCalledWith(ORG, file, {
        area: 'core', access: 'private', author: 'mem2', allow: [],
      });
    });

    it('members write their own department; leads write its core; only owner/admin write company core', async () => {
      await service.upload('mem2', ORG, { file, layer: 'dept', dept: 'sales' });
      expect(client.importFile).toHaveBeenLastCalledWith(ORG, file, expect.objectContaining({ area: 'sales', access: 'area' }));
      await expect(service.upload('mem2', ORG, { file, layer: 'dept-core', dept: 'sales' })).rejects.toBeInstanceOf(ForbiddenException);
      await service.upload('mem', ORG, { file, layer: 'dept-core', dept: 'sales' });
      expect(client.importFile).toHaveBeenLastCalledWith(ORG, file, expect.objectContaining({ area: 'sales', access: 'all' }));
      await expect(service.upload('mem', ORG, { file, layer: 'core' })).rejects.toBeInstanceOf(ForbiddenException);
      role = OrgRole.ADMIN;
      await service.upload('admin', ORG, { file, layer: 'core' });
      expect(client.importFile).toHaveBeenLastCalledWith(ORG, file, expect.objectContaining({ area: 'core', access: 'all' }));
    });

    it('never widens: restricted or area uploads to core are refused; all is core', async () => {
      role = OrgRole.ADMIN;
      for (const access of ['restricted', 'area']) {
        await expect(service.upload('admin', ORG, { file, area: 'core', access, allow: ['mem'] })).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(client.importFile).not.toHaveBeenCalled();
      await service.upload('admin', ORG, { file, area: 'core', access: 'all' });
      expect(client.importFile).toHaveBeenCalledWith(ORG, file, expect.objectContaining({ area: 'core', access: 'all' }));
    });

    it('keeps allow lists on restricted department uploads', async () => {
      await service.upload('mem2', ORG, { file, area: 'sales', access: 'restricted', allow: ['mem'] });
      expect(client.importFile).toHaveBeenCalledWith(ORG, file, expect.objectContaining({ area: 'sales', access: 'restricted', allow: ['mem'] }));
    });

    it('stops outsiders writing into a department they are not in', async () => {
      role = OrgRole.ADMIN;
      await expect(service.upload('admin', ORG, { file, layer: 'dept', dept: 'sales' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.importFile).not.toHaveBeenCalled();
    });
  });

  describe('updateAccess: taking access away uses the strict sync', () => {
    it('fails closed (502) when a home is removed and the brain is down; plain additions do not', async () => {
      role = OrgRole.OWNER;
      brainMembers = [{ userId: 'mem', home: 'sales', grants: [], rankOverride: null, title: null }];
      areas = [{ slug: 'sales', name: 'sales', leadUserIds: ['owner'], topics: [] }];
      client.putPolicy.mockRejectedValue(new Error('down'));
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await expect(
        service.updateAccess('owner', ORG, body([area('sales', ['owner'])], [{ userId: 'mem', home: null }, { userId: 'owner', home: 'sales' }])),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(client.putPolicy).toHaveBeenCalledTimes(3);
    });
  });

  describe('moves and promotion requests', () => {
    beforeEach(() => {
      areas = [{ slug: 'sales', name: 'Sales', leadUserIds: ['mem'], topics: [] }];
      brainMembers = [
        { userId: 'mem', home: 'sales', grants: [], rankOverride: null, title: null },
        { userId: 'mem2', home: 'sales', grants: [], rankOverride: null, title: null },
      ];
    });

    it('commit forwards the caller as `by`', async () => {
      await service.moveNote('mem2', ORG, 'n1', 'dept');
      expect(client.moveNote).toHaveBeenCalledWith(ORG, 'n1', 'dept', 'mem2');
    });

    it('creates a request for an own-department note, and refuses other notes', async () => {
      client.notes.mockResolvedValue([{ id: 'n1', title: 'T', type: 'doc', area: 'sales', access: 'area', date: null, layer: 'dept' }]);
      const r = await service.createPromotionRequest('mem2', ORG, 'n1', 'core');
      expect(r).toMatchObject({ noteId: 'n1', department: 'sales', to: 'core', from: 'dept', status: 'PENDING', requestedBy: { id: 'mem2', name: 'Mem2' } });
      await expect(service.createPromotionRequest('mem2', ORG, 'nope', 'core')).rejects.toBeInstanceOf(NotFoundException);
      client.notes.mockResolvedValue([{ id: 'n2', title: 'P', type: 'doc', area: 'personal-mem2', access: 'private', date: null }]);
      await expect(service.createPromotionRequest('mem2', ORG, 'n2', 'core')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only a lead of the department decides; owners and admins get a 404', async () => {
      prisma.promotionRequest.findFirst.mockResolvedValue({
        id: 'r1', noteId: 'n1', noteTitle: 'T', dept: 'sales', target: 'core', requesterId: 'mem2', status: 'PENDING',
      });
      role = OrgRole.OWNER;
      await expect(service.decidePromotionRequest('owner', ORG, 'r1', true)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.decidePromotionRequest('mem2', ORG, 'r1', true)).rejects.toBeInstanceOf(NotFoundException);
      expect(client.moveNote).not.toHaveBeenCalled();
      const done = await service.decidePromotionRequest('mem', ORG, 'r1', true);
      expect(client.moveNote).toHaveBeenCalledWith(ORG, 'n1', 'core', 'mem');
      expect(done.status).toBe('APPROVED');
    });

    it('declining does not move the note', async () => {
      prisma.promotionRequest.findFirst.mockResolvedValue({
        id: 'r1', noteId: 'n1', noteTitle: 'T', dept: 'sales', target: 'core', requesterId: 'mem2', status: 'PENDING',
      });
      const done = await service.decidePromotionRequest('mem', ORG, 'r1', false);
      expect(client.moveNote).not.toHaveBeenCalled();
      expect(done.status).toBe('DECLINED');
    });
  });

  describe('syncPolicyStrict', () => {
    it('retries and succeeds', async () => {
      client.putPolicy.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
      await expect(service.syncPolicyStrict(ORG)).resolves.toBeUndefined();
      expect(client.putPolicy).toHaveBeenCalledTimes(3);
    });

    it('fails closed with a 502 and a loud error after 3 failures', async () => {
      client.putPolicy.mockRejectedValue(new Error('down'));
      const errors = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await expect(service.syncPolicyStrict(ORG)).rejects.toBeInstanceOf(BadGatewayException);
      expect(client.putPolicy).toHaveBeenCalledTimes(3);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('SECURITY'));
    });
  });
});
