import { apiClient } from '@/lib/api-client';

/**
 * Local request/response types for the brain endpoints (docs/design.md
 * "Platform (app/, from 04/11)"). Switch to @app-starter/shared once the api
 * side exports them.
 */

export type BrainAccessLevel = 'all' | 'area' | 'restricted' | 'private';

export interface BrainUrlResponse {
  url: string;
}

/** Access model v2 rings, outermost last. */
export type BrainLayer = 'core' | 'dept-core' | 'dept' | 'private';

export type BrainMoveTarget = 'dept' | 'dept-core' | 'core';

export interface BrainNoteMove {
  from: string;
  to: string;
  by: string;
  at: string;
}

export interface BrainNote {
  id: string;
  title: string;
  type?: string;
  area?: string;
  date?: string | null;
  access?: string;
  layer?: BrainLayer;
  dept?: string | null;
  /** Moves the viewer may make right now (brain decides). */
  can_move?: BrainMoveTarget[];
  moved?: BrainNoteMove[];
}

export interface BrainPromotionRequest {
  id: string;
  noteId: string;
  noteTitle?: string;
  from?: string;
  to: BrainMoveTarget;
  department?: string;
  requestedBy?: { id?: string; name?: string | null } | string;
  status?: 'PENDING' | 'APPROVED' | 'DECLINED';
  createdAt?: string;
}

export interface BrainArea {
  slug: string;
  name: string;
  ownerUserId: string | null;
  readerGroups: string[];
  topics: string[];
  /** v2: 1-2 department leads (approve promotions into the core). */
  leads?: string[];
  /** The company core area: always present, read-only in the Access page. */
  isCore?: boolean;
}

export interface BrainMember {
  userId: string;
  name?: string | null;
  email?: string | null;
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
  groups: string[];
  home: string | null;
  rankOverride: number | null;
  title: string | null;
  rank?: number;
}

export interface BrainAccess {
  areas: BrainArea[];
  members: BrainMember[];
  /** True for OWNER/ADMIN. */
  canEdit?: boolean;
}

export interface BrainUploadResult {
  imported: { id: string; title: string }[];
  skipped: { name: string; reason: string }[];
}

const toList = <T>(data: unknown): T[] => {
  if (Array.isArray(data)) return data as T[];
  const wrapped = data as { items?: T[]; requests?: T[] } | null;
  return wrapped?.items ?? wrapped?.requests ?? [];
};

const base = (organizationId: string) => `/api/organizations/${organizationId}/brain`;

/** Accepts a bare array or a `{ notes | items }` wrapper so either api shape works. */
const toNoteList = (data: unknown): BrainNote[] => {
  if (Array.isArray(data)) return data as BrainNote[];
  const wrapped = data as { notes?: BrainNote[]; items?: BrainNote[] } | null;
  return wrapped?.notes ?? wrapped?.items ?? [];
};

export const brainApi = {
  view: (organizationId: string) => apiClient.get<BrainUrlResponse>(`${base(organizationId)}/view`),

  demoPersonas: (organizationId: string) =>
    apiClient.get<
      { id: string; name: string; title: string; dept: string; url: string }[]
    >(`${base(organizationId)}/demo-personas`),

  mcpLink: (organizationId: string) =>
    apiClient.get<BrainUrlResponse>(`${base(organizationId)}/mcp-link`),

  notes: async (organizationId: string) =>
    toNoteList(await apiClient.get<unknown>(`${base(organizationId)}/notes`)),

  access: (organizationId: string) => apiClient.get<BrainAccess>(`${base(organizationId)}/access`),

  saveAccess: (organizationId: string, data: BrainAccess) =>
    apiClient.put<BrainAccess>(`${base(organizationId)}/access`, {
      areas: data.areas
        .filter((area) => !area.isCore)
        .map(({ slug, name, ownerUserId, readerGroups, topics, leads }) => ({
          slug,
          name,
          ownerUserId,
          readerGroups,
          topics,
          leads,
        })),
      members: data.members.map(({ userId, groups, home, rankOverride, title }) => ({
        userId,
        groups,
        home,
        rankOverride,
        title,
      })),
    }),

  upload: (
    organizationId: string,
    file: File,
    area: string,
    access: BrainAccessLevel,
    allow: string[],
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('area', area);
    form.append('access', access);
    allow.forEach((id) => form.append('allow', id));
    return apiClient.post<BrainUploadResult>(`${base(organizationId)}/upload`, form);
  },

  /** private -> own department (author only). */
  commit: (organizationId: string, noteId: string) =>
    apiClient.post<unknown>(`${base(organizationId)}/notes/${noteId}/commit`, {}),

  /** Lead moves a note inward directly. */
  move: (organizationId: string, noteId: string, to: BrainMoveTarget) =>
    apiClient.post<unknown>(`${base(organizationId)}/notes/${noteId}/move`, { to }),

  requestPromotion: (organizationId: string, noteId: string, to: BrainMoveTarget) =>
    apiClient.post<unknown>(`${base(organizationId)}/notes/${noteId}/promotion-requests`, { to }),

  promotionRequests: async (organizationId: string) =>
    toList<BrainPromotionRequest>(
      await apiClient.get<unknown>(`${base(organizationId)}/promotion-requests`),
    ),

  decide: (organizationId: string, requestId: string, decision: 'approve' | 'decline') =>
    apiClient.post<unknown>(
      `${base(organizationId)}/promotion-requests/${requestId}/${decision}`,
      {},
    ),
};

/** Api errors arrive as `{ statusCode, message }`; a 404 means the endpoint isn't live yet. */
export const brainErrorText = (error: unknown, fallback = 'Something went wrong') => {
  const apiError = error as { statusCode?: number; message?: unknown } | null;
  if (apiError?.statusCode === 404) return 'Not available yet';
  if (typeof apiError?.message === 'string') return apiError.message;
  return fallback;
};

export const isNotFound = (error: unknown) =>
  (error as { statusCode?: number } | null)?.statusCode === 404;
