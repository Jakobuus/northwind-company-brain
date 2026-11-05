/** Company brain: constants shared by api and web. */

export const BRAIN_CORE_AREA = 'core';
export const BRAIN_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Brain rank per organization role, unless a member has a rank override. */
export const BRAIN_ROLE_RANK = { OWNER: 100, ADMIN: 70, MEMBER: 30 } as const;

export const BRAIN_MAX_DEPARTMENTS = 10;
export const BRAIN_MAX_DEPT_MEMBERS = 8;
export const BRAIN_MAX_DEPT_LEADS = 3;

/** The four rings, center to edge. */
export const BRAIN_LAYERS = ['core', 'dept-core', 'dept', 'private'] as const;

export const BRAIN_UPLOAD_ACCESS = ['all', 'area', 'restricted', 'private'] as const;

/** Slugs and group names: letters, digits, dash, underscore. */
export const BRAIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
