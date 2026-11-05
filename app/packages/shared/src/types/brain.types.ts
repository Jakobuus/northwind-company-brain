import { OrgRole } from '../enums/org-role.enum';
import { BRAIN_LAYERS, BRAIN_UPLOAD_ACCESS } from '../constants/brain';

/**
 * Company brain API: request/response types for `organizations/:organizationId/brain/...`.
 * Access model v2 (docs/design.md): four rings, departments with leads, grants, promotion requests.
 */

/** center -> edge: company core, department core, department internal, private (one person). */
export type BrainLayer = (typeof BRAIN_LAYERS)[number];

/** Layers a note can be moved to. */
export type BrainMoveTarget = 'dept' | 'dept-core' | 'core';

/** Legacy upload fields (kept): area + access. Prefer `layer`. */
export type BrainUploadAccess = (typeof BRAIN_UPLOAD_ACCESS)[number];

/** GET view, GET mcp-link */
export interface BrainLinkResponse {
  url: string;
}

export interface BrainNote {
  id: string;
  title: string;
  type: string;
  area: string;
  date: string | null;
  access: string;
  /** Present once the brain reports layers; otherwise derive from area/access. */
  layer?: BrainLayer;
  dept?: string | null;
  /** Moves so far, oldest first. */
  moved?: { from: string; to: string; by: string; at: string }[];
  /** Targets the caller may move this note to right now (brain decides). */
  can_move?: BrainMoveTarget[];
}

/** GET notes: only notes the caller may read. */
export interface BrainNotesResponse {
  items: BrainNote[];
  total: number;
}

/** Group a person gets for each extra department they may read into. Department readers = [slug, grant:slug]. */
export const BRAIN_GRANT_PREFIX = 'grant:';

export interface BrainAreaConfig {
  /** Department id (lowercase letters, digits, dash, underscore); `core` is the fixed company core. */
  slug: string;
  name: string;
  /** First lead (kept for older clients). */
  ownerUserId: string | null;
  /** Always `[slug, 'grant:' + slug]` for a department; `['everyone']` for core. Read-only. */
  readerGroups: string[];
  topics: string[];
  /** 1-2 department leads (user ids): approve promotions and write the department core. */
  leads: string[];
  /** The company core: always present, not editable. */
  isCore?: boolean;
}

export interface BrainMemberConfig {
  userId: string;
  name: string;
  /** Hidden (empty) for callers who are not OWNER/ADMIN. */
  email: string;
  role: OrgRole;
  /** Home department slug (one per person) followed by `grant:<dept>` for each extra department. Grants are manager-only. */
  groups: string[];
  home: string | null;
  title: string | null;
  rankOverride: number | null;
  /** Effective rank: override, else from role. */
  rank: number;
}

/** GET access. Department and people names are structure, not secrets; emails/grants/overrides are manager-only. */
export interface BrainAccessResponse {
  areas: BrainAreaConfig[];
  members: BrainMemberConfig[];
  /** True for OWNER/ADMIN. */
  canEdit: boolean;
  limits: { maxDepartments: number; maxMembersPerDepartment: number; maxLeads: number };
}

export interface UpdateBrainAreaRequest {
  slug: string;
  name: string;
  /** 1-2 user ids; each must have this department as home (a lead without a home is moved here). */
  leads?: string[];
  /** Used only when `leads` is missing. */
  ownerUserId?: string | null;
  topics?: string[];
  /** Ignored: readers are derived. */
  readerGroups?: string[];
}

export interface UpdateBrainMemberRequest {
  userId: string;
  /** Only the `grant:<dept>` entries count (existing departments). Home comes from `home`. */
  groups?: string[];
  home?: string | null;
  title?: string | null;
  /** OWNER only; an unchanged value is fine for an ADMIN. */
  rankOverride?: number | null;
}

/**
 * PUT access (OWNER/ADMIN). Areas not listed (except core) are deleted; unlisted members keep their settings.
 * Max 10 departments, 5 members each, 1-2 leads, one home per person. An ADMIN cannot change home, grants or
 * rank of anyone whose rank is >= their own (incl. themselves); only an OWNER sets rank overrides. Returns the new state.
 */
export interface UpdateBrainAccessRequest {
  areas: UpdateBrainAreaRequest[];
  members?: UpdateBrainMemberRequest[];
}

/**
 * POST upload (multipart/form-data): `file`, then either `layer` (+ `dept` for dept / dept-core) or the legacy
 * `area` + `access`; `allow` (repeat or comma-separate user ids) for the legacy `restricted` mode.
 * Who may write where: private = anyone (own space); dept = members of that department; dept-core = its leads;
 * core = OWNER/ADMIN.
 */
export interface BrainUploadFields {
  layer?: BrainLayer;
  dept?: string;
  area?: string;
  access?: BrainUploadAccess;
  allow?: string[];
}

export interface BrainUploadResponse {
  imported: { id: string; title: string }[];
  skipped: { name: string; reason: string }[];
}

/** POST notes/:noteId/move (and commit = move to `dept`). The brain decides; 403 when not allowed. */
export interface MoveBrainNoteRequest {
  to: BrainMoveTarget;
}

export interface BrainMoveResponse {
  ok: true;
}

/** POST notes/:noteId/promotion-requests */
export interface CreateBrainPromotionRequest {
  to: Exclude<BrainMoveTarget, 'dept'>;
}

export type BrainPromotionStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

export interface BrainPromotionRequestItem {
  id: string;
  noteId: string;
  noteTitle: string;
  /** Layer the note was in when asked. */
  from: BrainLayer;
  to: Exclude<BrainMoveTarget, 'dept'>;
  department: string;
  requestedBy: { id: string; name: string };
  status: BrainPromotionStatus;
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** GET promotion-requests: `items` = pending requests of departments I lead; `mine` = what I asked for. */
export interface BrainPromotionRequestsResponse {
  items: BrainPromotionRequestItem[];
  mine: BrainPromotionRequestItem[];
}
