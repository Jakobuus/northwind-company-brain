import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, PromotionStatus } from '@prisma/client';
import {
  BRAIN_CORE_AREA,
  BRAIN_GRANT_PREFIX,
  BRAIN_MAX_DEPARTMENTS,
  BRAIN_MAX_DEPT_LEADS,
  BRAIN_MAX_DEPT_MEMBERS,
  BRAIN_MAX_UPLOAD_BYTES,
  BRAIN_SLUG_PATTERN,
  BRAIN_UPLOAD_ACCESS,
  BrainAccessResponse,
  BrainLayer,
  BrainLinkResponse,
  BrainMoveResponse,
  BrainMoveTarget,
  BrainNote,
  BrainNotesResponse,
  BrainPromotionRequestItem,
  BrainPromotionRequestsResponse,
  BrainUploadResponse,
  OrgRole as SharedOrgRole,
  UpdateBrainAccessRequest,
} from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BrainClient } from './brain-client';
import { PolicyAreaInput, PolicyMemberInput, buildPolicy, rankFor } from './brain-policy';

const VIEW_TTL_SECONDS = 60 * 60;
const MANAGE_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];
const RESYNC_EVERY_MS = 30_000;
const RESYNC_MAX_TRIES = 10;

const DEMO_CAST = ['jakob', 'elena', 'daan', 'felix', 'clara'];

export interface DemoPersona {
  id: string;
  name: string;
  title: string;
  dept: string;
  url: string;
}

export interface UploadInput {
  file: { buffer: Buffer; originalname: string; size: number; mimetype?: string };
  layer?: string;
  dept?: string;
  area?: string;
  access?: string;
  allow?: string[];
}

interface OrgState {
  companyName: string;
  members: PolicyMemberInput[];
  areas: PolicyAreaInput[];
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** Layer of a note when the brain does not say (older brain): from area + access. */
export const layerOfNote = (note: BrainNote): BrainLayer => {
  if (note.layer) return note.layer;
  if (note.area.startsWith('personal-') || note.access === 'private') return 'private';
  if (note.area === BRAIN_CORE_AREA) return 'core';
  return note.access === 'all' ? 'dept-core' : 'dept';
};

/**
 * Connects an organization to its company brain. The brain enforces every read and every move;
 * this service keeps the brain's policy in step with members and departments and forwards who asked.
 */
@Injectable()
export class BrainService {
  private readonly logger = new Logger(BrainService.name);
  private readonly resyncing = new Set<string>();
  /** Pause between strict sync attempts (tests set 0). */
  retryDelayMs = 250;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: BrainClient,
  ) {}

  // ---------------------------------------------------------------- guards

  /** Role of the caller, or 403. (Read from Prisma directly so the organizations service can call us back.) */
  private async requireRole(userId: string, organizationId: string, manage = false): Promise<OrgRole> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    if (!member || (manage && !MANAGE_ROLES.includes(member.role))) {
      throw new ForbiddenException(
        manage
          ? 'You do not have permission to change access settings'
          : 'You do not have access to this organization',
      );
    }
    return member.role;
  }

  // ---------------------------------------------------------------- policy sync

  private async loadState(organizationId: string): Promise<OrgState> {
    const [org, members, brainMembers, areas] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      this.prisma.organizationMember.findMany({
        where: { organizationId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.brainMember.findMany({ where: { organizationId } }),
      this.prisma.brainArea.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const extra = new Map(brainMembers.map((b) => [b.userId, b]));
    const slugs = new Set(areas.map((a) => a.slug));
    const policyMembers: PolicyMemberInput[] = members.map((m) => {
      const b = extra.get(m.userId);
      return {
        userId: m.userId,
        role: m.role,
        name: m.user.name,
        email: m.user.email,
        home: b?.home && slugs.has(b.home) ? b.home : null,
        grants: (b?.grants ?? []).filter((g) => slugs.has(g)),
        rankOverride: b?.rankOverride ?? null,
        title: b?.title ?? null,
      };
    });
    const policyAreas: PolicyAreaInput[] = areas.map((a) => ({
      slug: a.slug,
      name: a.name,
      leadUserIds: a.leadUserIds,
      topics: a.topics,
    }));
    return { companyName: org?.name ?? organizationId, members: policyMembers, areas: policyAreas };
  }

  /** Build the policy from the database and PUT it to the brain (idempotent). */
  async syncPolicy(organizationId: string): Promise<OrgState> {
    const state = await this.loadState(organizationId);
    await this.client.putPolicy(organizationId, buildPolicy(state.companyName, state.members, state.areas));
    return state;
  }

  /** For joins: a brain outage must never block joining an org. */
  async syncPolicySafe(organizationId: string): Promise<void> {
    try {
      await this.syncPolicy(organizationId);
    } catch (err) {
      this.logger.warn(`policy sync for ${organizationId} failed: ${(err as Error).message}`);
    }
  }

  /**
   * For removals and demotions: a stale policy leaves the person's view/MCP links working, so retry,
   * shout on final failure, keep retrying in the background, and fail the request (502).
   */
  async syncPolicyStrict(organizationId: string, attempts = 3): Promise<void> {
    let last: unknown;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        await this.syncPolicy(organizationId);
        return;
      } catch (err) {
        last = err;
        if (i < attempts && this.retryDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * i));
        }
      }
    }
    this.logger.error(
      `SECURITY: policy sync for ${organizationId} failed ${attempts}x after a removal/demotion; ` +
        `the brain may still honour old links. Last error: ${(last as Error)?.message}`,
    );
    this.scheduleResync(organizationId, 1);
    throw new BadGatewayException(
      'The change was saved but the company brain could not be updated yet. It will keep retrying.',
    );
  }

  private scheduleResync(organizationId: string, attempt: number): void {
    if (attempt === 1 && this.resyncing.has(organizationId)) return;
    this.resyncing.add(organizationId);
    const timer = setTimeout(() => {
      this.syncPolicy(organizationId)
        .then(() => {
          this.resyncing.delete(organizationId);
          this.logger.log(`policy re-sync for ${organizationId} succeeded`);
        })
        .catch((err: Error) => {
          if (attempt >= RESYNC_MAX_TRIES) {
            this.resyncing.delete(organizationId);
            this.logger.error(`SECURITY: giving up re-syncing ${organizationId}: ${err.message}`);
          } else {
            this.scheduleResync(organizationId, attempt + 1);
          }
        });
    }, RESYNC_EVERY_MS);
    timer.unref?.();
  }

  // ---------------------------------------------------------------- links and notes

  async getViewLink(userId: string, organizationId: string): Promise<BrainLinkResponse> {
    await this.requireRole(userId, organizationId);
    await this.syncPolicy(organizationId);
    return { url: await this.client.viewUrl(organizationId, userId, VIEW_TTL_SECONDS) };
  }

  /**
   * Demo only: view links for the viewer plus a fixed cast, for the map's "view as" selector.
   * Owner or department lead, never in production; nobody outside the cast is ever returned.
   */
  async getDemoPersonas(userId: string, organizationId: string): Promise<DemoPersona[]> {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const role = await this.requireRole(userId, organizationId);
    const state = await this.loadState(organizationId);
    const isLead = state.areas.some((a) => a.leadUserIds.includes(userId));
    if (role !== OrgRole.OWNER && !isLead) throw new ForbiddenException('Not available');
    const cast = new Set(DEMO_CAST);
    const matches = (m: PolicyMemberInput): boolean => {
      const keys = [m.userId, (m.name ?? '').trim().split(/\s+/)[0], m.email.split('@')[0]];
      return keys.some((k) => cast.has(k.toLowerCase()));
    };
    const picked: PolicyMemberInput[] = [];
    for (const name of DEMO_CAST) {
      const m = state.members.find(
        (x) => matches(x) && [x.userId, (x.name ?? '').trim().split(/\s+/)[0], x.email.split('@')[0]].some((k) => k.toLowerCase() === name),
      );
      if (m && !picked.some((p) => p.userId === m.userId)) picked.push(m);
    }
    await this.syncPolicy(organizationId);
    const areaName = new Map(state.areas.map((a) => [a.slug, a.name]));
    return Promise.all(
      picked.map(async (m) => ({
        id: m.userId,
        name: m.name?.trim() || m.email.split('@')[0],
        title: m.title ?? '',
        dept: (m.home && areaName.get(m.home)) || '',
        url: await this.client.viewUrl(organizationId, m.userId, VIEW_TTL_SECONDS),
      })),
    );
  }

  async getMcpLink(userId: string, organizationId: string): Promise<BrainLinkResponse> {
    await this.requireRole(userId, organizationId);
    await this.syncPolicy(organizationId);
    return { url: await this.client.mcpLink(organizationId, userId) };
  }

  async listNotes(userId: string, organizationId: string): Promise<BrainNotesResponse> {
    await this.requireRole(userId, organizationId);
    await this.syncPolicy(organizationId);
    const items = await this.client.notes(organizationId, userId);
    return { items, total: items.length };
  }

  // ---------------------------------------------------------------- access settings

  async getAccess(userId: string, organizationId: string): Promise<BrainAccessResponse> {
    const role = await this.requireRole(userId, organizationId);
    const canEdit = MANAGE_ROLES.includes(role);
    const state = await this.loadState(organizationId);
    const memberIds = new Set(state.members.map((m) => m.userId));
    const areas = [
      {
        slug: BRAIN_CORE_AREA,
        name: 'Company core',
        ownerUserId: null,
        readerGroups: ['everyone'],
        topics: [] as string[],
        leads: [] as string[],
        isCore: true,
      },
      ...state.areas.map((a) => {
        const leads = a.leadUserIds.filter((id) => memberIds.has(id));
        return {
          slug: a.slug,
          name: a.name,
          ownerUserId: leads[0] ?? null,
          readerGroups: [a.slug, `${BRAIN_GRANT_PREFIX}${a.slug}`],
          topics: a.topics,
          leads,
        };
      }),
    ];
    const members = state.members.map((m) => ({
      userId: m.userId,
      name: m.name?.trim() || m.email.split('@')[0],
      email: canEdit ? m.email : '',
      role: m.role as unknown as SharedOrgRole,
      groups: [
        ...(m.home ? [m.home] : []),
        ...(canEdit ? m.grants.map((g) => `${BRAIN_GRANT_PREFIX}${g}`) : []),
      ],
      home: m.home,
      title: m.title,
      rankOverride: canEdit ? m.rankOverride : null,
      rank: rankFor(m.role, m.rankOverride),
    }));
    return {
      areas,
      members,
      canEdit,
      limits: {
        maxDepartments: BRAIN_MAX_DEPARTMENTS,
        maxMembersPerDepartment: BRAIN_MAX_DEPT_MEMBERS,
        maxLeads: BRAIN_MAX_DEPT_LEADS,
      },
    };
  }

  async updateAccess(
    userId: string,
    organizationId: string,
    data: UpdateBrainAccessRequest,
  ): Promise<BrainAccessResponse> {
    const role = await this.requireRole(userId, organizationId, true);
    const state = await this.loadState(organizationId);
    const byId = new Map(state.members.map((m) => [m.userId, m]));

    // --- who lives where: `home` of a listed member wins, else what they have now
    const listed = new Map((data.members ?? []).map((m) => [m.userId, m]));
    for (const m of listed.values()) {
      if (!byId.has(m.userId)) throw new BadRequestException('Unknown member in access settings');
    }
    const depts = data.areas.filter((d) => d.slug !== BRAIN_CORE_AREA);
    if (depts.length > BRAIN_MAX_DEPARTMENTS) {
      throw new BadRequestException(`At most ${BRAIN_MAX_DEPARTMENTS} departments`);
    }
    const slugs = new Set<string>();
    for (const d of depts) {
      if (!BRAIN_SLUG_PATTERN.test(d.slug) || d.slug.startsWith('personal-')) {
        throw new BadRequestException(`Invalid department id: ${d.slug.slice(0, 40)}`);
      }
      if (slugs.has(d.slug)) throw new BadRequestException(`Duplicate department: ${d.slug}`);
      slugs.add(d.slug);
    }
    const homeOf = new Map<string, string | null>();
    for (const m of state.members) {
      const l = listed.get(m.userId);
      const kept = m.home && slugs.has(m.home) ? m.home : null; // home of a deleted department is cleared
      const home = l && l.home !== undefined ? l.home || null : kept;
      if (home && !slugs.has(home)) throw new BadRequestException('Home must be an existing department');
      homeOf.set(m.userId, home);
    }
    const leadsOf = new Map<string, string[]>();
    for (const d of depts) {
      const leads = [...new Set(d.leads ?? (d.ownerUserId ? [d.ownerUserId] : []))];
      if (leads.length < 1 || leads.length > BRAIN_MAX_DEPT_LEADS) {
        throw new BadRequestException(`A department needs 1 to ${BRAIN_MAX_DEPT_LEADS} leads`);
      }
      for (const id of leads) {
        if (!byId.has(id)) throw new BadRequestException('Leads must be members of the organization');
        const home = homeOf.get(id);
        if (home && home !== d.slug) {
          throw new BadRequestException('A lead must have the department as their home');
        }
        homeOf.set(id, d.slug);
      }
      leadsOf.set(d.slug, leads);
    }
    for (const slug of slugs) {
      const count = [...homeOf.values()].filter((h) => h === slug).length;
      if (count > BRAIN_MAX_DEPT_MEMBERS) {
        throw new BadRequestException(`A department has at most ${BRAIN_MAX_DEPT_MEMBERS} members`);
      }
    }

    // --- who ends up with what, and the escalation checks
    const callerRank = rankFor(role, byId.get(userId)?.rankOverride ?? null);
    const next = new Map<string, { home: string | null; grants: string[]; rankOverride: number | null; title: string | null }>();
    for (const m of state.members) {
      const l = listed.get(m.userId);
      const home = homeOf.get(m.userId) ?? null;
      const wanted =
        l?.groups !== undefined
          ? l.groups.filter((g) => g.startsWith(BRAIN_GRANT_PREFIX)).map((g) => g.slice(BRAIN_GRANT_PREFIX.length))
          : m.grants;
      if (wanted.some((g) => !slugs.has(g)) && l?.groups !== undefined) {
        throw new BadRequestException('Grants must point at existing departments');
      }
      const grants = [...new Set(wanted)].filter((g) => slugs.has(g) && g !== home);
      const rankOverride = l && l.rankOverride !== undefined ? l.rankOverride : m.rankOverride;
      const title = l && l.title !== undefined ? l.title?.trim() || null : m.title;
      next.set(m.userId, { home, grants, rankOverride, title });
      const changedRank = rankOverride !== m.rankOverride;
      const changedAccess =
        home !== m.home || !sameSet(grants, m.grants.filter((g) => slugs.has(g) && g !== m.home));
      if (role !== OrgRole.OWNER) {
        if (changedRank) {
          throw new ForbiddenException('Only an owner can set a rank override');
        }
        if (changedAccess && rankFor(m.role, m.rankOverride) >= callerRank) {
          throw new ForbiddenException(
            'You cannot change the department or access of someone at or above your own rank',
          );
        }
      }
    }

    // --- lead changes: adding or removing someone at or above your own rank is an escalation
    let lostAccess = state.areas.some((a) => !slugs.has(a.slug)); // a department was deleted
    for (const old of state.areas) {
      const before = new Set(old.leadUserIds);
      const after = new Set(leadsOf.get(old.slug) ?? []);
      const touched = [
        ...[...after].filter((id) => !before.has(id)),
        ...[...before].filter((id) => !after.has(id)),
      ];
      if ([...before].some((id) => !after.has(id))) lostAccess = true;
      this.assertLeadChangeAllowed(role, callerRank, touched, byId);
    }
    for (const d of depts) {
      if (state.areas.some((a) => a.slug === d.slug)) continue;
      this.assertLeadChangeAllowed(role, callerRank, leadsOf.get(d.slug) ?? [], byId);
    }
    for (const m of state.members) {
      const n = next.get(m.userId);
      if (!n) continue;
      if (m.home && n.home !== m.home) lostAccess = true;
      if (m.grants.some((g) => !n.grants.includes(g))) lostAccess = true;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.brainArea.deleteMany({ where: { organizationId, slug: { notIn: [...slugs] } } });
      for (const d of depts) {
        const values = {
          name: d.name.trim() || d.slug,
          leadUserIds: leadsOf.get(d.slug) ?? [],
          topics: [...new Set((d.topics ?? []).map((t) => t.trim()).filter(Boolean))],
        };
        await tx.brainArea.upsert({
          where: { organizationId_slug: { organizationId, slug: d.slug } },
          create: { organizationId, slug: d.slug, ...values },
          update: values,
        });
      }
      for (const [id, v] of next) {
        await tx.brainMember.upsert({
          where: { organizationId_userId: { organizationId, userId: id } },
          create: { organizationId, userId: id, ...v },
          update: v,
        });
      }
    });

    // Taking access away must reach the brain: retry, shout, and fail the request if it cannot.
    if (lostAccess) await this.syncPolicyStrict(organizationId);
    else await this.syncPolicy(organizationId);
    return this.getAccess(userId, organizationId);
  }

  /** Non-owners may not add or remove leads ranked at or above themselves (self included). */
  private assertLeadChangeAllowed(
    role: OrgRole,
    callerRank: number,
    touched: string[],
    byId: Map<string, PolicyMemberInput>,
  ): void {
    if (role === OrgRole.OWNER) return;
    for (const id of touched) {
      const m = byId.get(id);
      if (m && rankFor(m.role, m.rankOverride) >= callerRank) {
        throw new ForbiddenException('You cannot change department leads at or above your own rank');
      }
    }
  }

  // ---------------------------------------------------------------- upload

  /** Decide (area, access, layer) for an upload from either the new `layer` or the legacy area+access. */
  private resolveUploadTarget(input: UploadInput): { layer: BrainLayer; dept: string; access: string } {
    if (input.layer) {
      const layer = input.layer as BrainLayer;
      if (!['core', 'dept-core', 'dept', 'private'].includes(layer)) {
        throw new BadRequestException('layer must be core, dept-core, dept or private');
      }
      const access = { core: 'all', 'dept-core': 'all', dept: 'area', private: 'private' }[layer];
      return { layer, dept: layer === 'dept' || layer === 'dept-core' ? input.dept ?? '' : BRAIN_CORE_AREA, access };
    }
    const access = input.access ?? 'area';
    if (!(BRAIN_UPLOAD_ACCESS as readonly string[]).includes(access)) {
      throw new BadRequestException('access must be all, area, restricted or private');
    }
    const area = input.area || BRAIN_CORE_AREA;
    if (access === 'private') return { layer: 'private', dept: BRAIN_CORE_AREA, access };
    if (area === BRAIN_CORE_AREA) {
      // Never widen: a restricted or area-only note must not silently become readable by everyone.
      if (access !== 'all') {
        throw new BadRequestException('The company core is readable by everyone: use access "all" there');
      }
      return { layer: 'core', dept: BRAIN_CORE_AREA, access: 'all' };
    }
    return { layer: access === 'all' ? 'dept-core' : 'dept', dept: area, access };
  }

  async upload(userId: string, organizationId: string, input: UploadInput): Promise<BrainUploadResponse> {
    const role = await this.requireRole(userId, organizationId);
    if (!input.file || !input.file.buffer?.length) throw new BadRequestException('A file is required');
    if (input.file.size > BRAIN_MAX_UPLOAD_BYTES) throw new BadRequestException('File is too large (20 MB max)');

    const target = this.resolveUploadTarget(input);
    const state = await this.syncPolicy(organizationId);
    const me = state.members.find((m) => m.userId === userId);
    const memberIds = new Set(state.members.map((m) => m.userId));
    const allow = [...new Set((input.allow ?? []).map((x) => x.trim()).filter(Boolean))];
    if (allow.some((id) => !memberIds.has(id))) {
      throw new BadRequestException('allow contains someone who is not a member');
    }

    if (target.layer === 'dept' || target.layer === 'dept-core') {
      const dept = state.areas.find((a) => a.slug === target.dept);
      if (!dept) throw new BadRequestException('Unknown department');
      const isMember = me?.home === dept.slug;
      const isLead = dept.leadUserIds.includes(userId);
      if (target.layer === 'dept' && !isMember) {
        throw new ForbiddenException('You can only upload to your own department');
      }
      if (target.layer === 'dept-core' && !isLead) {
        throw new ForbiddenException('Only department leads write the department core');
      }
    } else if (target.layer === 'core' && !MANAGE_ROLES.includes(role)) {
      throw new ForbiddenException('Only owners and admins write the company core directly');
    }

    return this.client.importFile(organizationId, input.file, {
      area: target.layer === 'private' || target.layer === 'core' ? BRAIN_CORE_AREA : target.dept,
      access: target.access,
      author: userId,
      allow: target.access === 'restricted' ? allow : [],
    });
  }

  // ---------------------------------------------------------------- moves and promotion requests

  /** Move a note between layers; the brain decides whether `userId` may. */
  async moveNote(
    userId: string,
    organizationId: string,
    noteId: string,
    to: BrainMoveTarget,
  ): Promise<BrainMoveResponse> {
    await this.requireRole(userId, organizationId);
    await this.syncPolicy(organizationId);
    await this.client.moveNote(organizationId, noteId, to, userId);
    return { ok: true };
  }

  async createPromotionRequest(
    userId: string,
    organizationId: string,
    noteId: string,
    target: 'dept-core' | 'core',
  ): Promise<BrainPromotionRequestItem> {
    await this.requireRole(userId, organizationId);
    const state = await this.syncPolicy(organizationId);
    const me = state.members.find((m) => m.userId === userId);
    if (!me?.home) throw new BadRequestException('You need a home department to request a promotion');

    const notes = await this.client.notes(organizationId, userId);
    const note = notes.find((n) => n.id === noteId);
    if (!note) throw new NotFoundException('Note not found');
    const layer = layerOfNote(note);
    const dept = note.dept ?? note.area;
    const allowed: Record<string, string[]> = { dept: ['dept-core', 'core'], 'dept-core': ['core'] };
    if (dept !== me.home || !(allowed[layer] ?? []).includes(target)) {
      throw new BadRequestException('This note cannot be promoted there');
    }
    if (state.areas.find((a) => a.slug === dept)?.leadUserIds.includes(userId)) {
      throw new BadRequestException('You lead this department: promote the note directly');
    }

    const existing = await this.prisma.promotionRequest.findFirst({
      where: { organizationId, noteId, target, requesterId: userId, status: PromotionStatus.PENDING },
    });
    const row =
      existing ??
      (await this.prisma.promotionRequest.create({
        data: { organizationId, noteId, noteTitle: note.title, dept, target, fromLayer: layer, requesterId: userId },
      }));
    return this.toItem(row, state.members);
  }

  async listPromotionRequests(
    userId: string,
    organizationId: string,
  ): Promise<BrainPromotionRequestsResponse> {
    await this.requireRole(userId, organizationId);
    const state = await this.loadState(organizationId);
    const ledDepts = state.areas.filter((a) => a.leadUserIds.includes(userId)).map((a) => a.slug);
    const [mine, toReview] = await Promise.all([
      this.prisma.promotionRequest.findMany({
        where: { organizationId, requesterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      ledDepts.length
        ? this.prisma.promotionRequest.findMany({
            where: { organizationId, dept: { in: ledDepts }, status: PromotionStatus.PENDING },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    return {
      items: toReview.map((r) => this.toItem(r, state.members)),
      mine: mine.map((r) => this.toItem(r, state.members)),
    };
  }

  async decidePromotionRequest(
    userId: string,
    organizationId: string,
    requestId: string,
    approve: boolean,
  ): Promise<BrainPromotionRequestItem> {
    await this.requireRole(userId, organizationId);
    const state = await this.syncPolicy(organizationId);
    const request = await this.prisma.promotionRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    const isLead = request
      ? state.areas.find((a) => a.slug === request.dept)?.leadUserIds.includes(userId)
      : false;
    // Owners and admins cannot override a department lead; non-leads see the same 404 as a missing id.
    if (!request || !isLead) throw new NotFoundException('Promotion request not found');
    if (request.status !== PromotionStatus.PENDING) {
      throw new BadRequestException('This request was already decided');
    }
    if (approve) {
      await this.client.moveNote(organizationId, request.noteId, request.target, userId);
    }
    const updated = await this.prisma.promotionRequest.update({
      where: { id: request.id },
      data: {
        status: approve ? PromotionStatus.APPROVED : PromotionStatus.DECLINED,
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
    return this.toItem(updated, state.members);
  }

  private toItem(
    r: {
      id: string;
      noteId: string;
      noteTitle: string;
      dept: string;
      target: string;
      fromLayer?: string;
      status: PromotionStatus;
      requesterId: string;
      decidedById: string | null;
      decidedAt: Date | null;
      createdAt: Date;
    },
    members: PolicyMemberInput[],
  ): BrainPromotionRequestItem {
    const who = members.find((m) => m.userId === r.requesterId);
    return {
      id: r.id,
      noteId: r.noteId,
      noteTitle: r.noteTitle,
      from: (r.fromLayer ?? 'dept') as BrainLayer,
      to: r.target as 'dept-core' | 'core',
      department: r.dept,
      requestedBy: {
        id: r.requesterId,
        name: who?.name?.trim() || who?.email.split('@')[0] || 'Former member',
      },
      status: r.status,
      decidedById: r.decidedById,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
