import { BadGatewayException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service';

/** Removal and demotion must wait for the brain policy sync and fail loudly when it cannot happen. */
describe('OrganizationsService brain sync (fail closed)', () => {
  const ORG = 'org-1';
  let prisma: any;
  let brain: { syncPolicyStrict: jest.Mock; syncPolicySafe: jest.Mock };
  let service: OrganizationsService;

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG }) },
      organizationMember: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => ({
          id: 'm',
          userId: where.userId_organizationId.userId,
          organizationId: ORG,
          role: OrgRole.MEMBER,
          user: { id: 'target', email: 't@x.com', name: 'T', emailVerifiedAt: null, lastLoginAt: null, createdAt: new Date() },
        })),
        count: jest.fn().mockResolvedValue(2),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({
          id: 'm', userId: 'target', organizationId: ORG, role: OrgRole.MEMBER,
          user: { id: 'target', email: 't@x.com', name: 'T', emailVerifiedAt: null, lastLoginAt: null, createdAt: new Date() },
        }),
      },
    };
    brain = { syncPolicyStrict: jest.fn().mockResolvedValue(undefined), syncPolicySafe: jest.fn() };
    service = new OrganizationsService(prisma, brain as any);
    jest.spyOn(service, 'getUserRoleInOrganization').mockResolvedValue('OWNER' as any);
  });

  it('removal waits for the sync', async () => {
    await service.removeOrganizationUser(ORG, 'target', 'owner');
    expect(prisma.organizationMember.delete).toHaveBeenCalled();
    expect(brain.syncPolicyStrict).toHaveBeenCalledWith(ORG);
  });

  it('removal fails (502) when the brain sync fails, instead of pretending it worked', async () => {
    brain.syncPolicyStrict.mockRejectedValue(new BadGatewayException('brain down'));
    await expect(service.removeOrganizationUser(ORG, 'target', 'owner')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('a role change fails (502) when the brain sync fails', async () => {
    brain.syncPolicyStrict.mockRejectedValue(new BadGatewayException('brain down'));
    await expect(
      service.updateOrganizationUserRole(ORG, 'target', 'ADMIN' as any, 'owner'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
