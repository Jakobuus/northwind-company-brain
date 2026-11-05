/**
 * Northwind Bikes demo seed (INVENTED company, see docs/demo-company.md "Seed").
 *
 * Loads the company into the running product through the product's own paths:
 *  - users + org membership: Prisma directly (email-verified, password Demo123!)
 *  - organization: POST /organizations as Clara
 *  - departments, leads, homes, grants: PUT /organizations/:id/brain/access as Clara
 *  - notes: POST /brain/upload as each author, POST /brain/notes/:id/move by the department lead
 *  - Lukas's pending promotion request: POST /brain/notes/:id/promotion-requests
 *
 * Idempotent: users upsert, the org is found by name, access PUT is a full replace, and a note is only
 * uploaded when its author's view has no note with the same title already (moves and requests check state too).
 *
 *   cd app/apps/api && ts-node prisma/seed-northwind.ts [--reset] [--skip-missing]
 *   --reset   first wipe the Northwind org (db rows cascade) and its brain folder, then seed
 *
 * Run with Node 22 (scripts/reset_northwind.sh sets the PATH).
 */
import { PrismaClient, OrgRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const apiRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(apiRoot, '.env') });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/api/.env)');
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo accounts in production');

const kitRoot = path.resolve(apiRoot, '../../..');
const rawRoot = path.join(kitRoot, 'demo-raw', 'northwind');
const brainRoot = process.env.NW_BRAIN_ROOT ?? path.resolve(kitRoot, '..', 'brain-root');
const API = process.env.NW_API_URL ?? 'http://localhost:3001/api';
const WEB = process.env.NW_WEB_URL ?? 'http://localhost:3000';
const ORG_NAME = 'Northwind';
const PASSWORD = 'Demo123!';
const args = new Set(process.argv.slice(2));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---------------------------------------------------------------- manifest

interface Person {
  id: string;
  name: string;
  email: string;
  title: string;
  dept: string;
  lead: boolean;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  grants: string[];
}
interface Dept {
  slug: string;
  name: string;
  members: string[];
  leads: string[];
  topics: string[];
}
interface Row {
  path: string;
  author: string; // email
  date: string;
  dept: string;
  layer: 'core' | 'dept-core' | 'dept' | 'private';
  title: string;
  seed: boolean;
}
interface Manifest {
  departments: Dept[];
  people: Person[];
  grants: { person: string; dept: string; granted_by: string }[];
  pending_promotion_requests: { file: string; requested_by: string; to: string; decider: string }[];
  files: Row[];
}
const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(rawRoot, 'manifest.json'), 'utf8'));
const personByEmail = new Map(manifest.people.map((p) => [p.email, p]));
const personById = new Map(manifest.people.map((p) => [p.id, p]));
const deptBySlug = new Map(manifest.departments.map((d) => [d.slug, d]));

// ---------------------------------------------------------------- http helpers

const tokens = new Map<string, string>();
async function login(personId: string): Promise<string> {
  const cached = tokens.get(personId);
  if (cached) return cached;
  const p = personById.get(personId)!;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: p.email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${p.email}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string };
  tokens.set(personId, body.accessToken);
  return body.accessToken;
}

async function call<T>(personId: string, method: string, url: string, body?: unknown, form?: FormData): Promise<T> {
  const token = await login(personId);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${url}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${personId} ${method} ${url}: ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface Note {
  id: string;
  title: string;
  layer?: string;
  dept?: string | null;
  can_move?: string[];
}

// ---------------------------------------------------------------- steps

async function reset(): Promise<void> {
  const orgs = await prisma.organization.findMany({ where: { name: ORG_NAME }, select: { id: true } });
  for (const o of orgs) {
    await prisma.organization.delete({ where: { id: o.id } }); // members, brain areas, promotions cascade
    const dir = path.join(brainRoot, o.id);
    if (fs.existsSync(dir) && path.dirname(dir) === brainRoot) fs.rmSync(dir, { recursive: true, force: true });
    const l = readLedger();
    delete l[o.id];
    writeLedger(l);
    console.log(`reset: removed org ${o.id} and its brain folder`);
  }
  if (!orgs.length) console.log('reset: no Northwind org found');
}

async function seedUsers(): Promise<Map<string, string>> {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const ids = new Map<string, string>();
  for (const p of manifest.people) {
    const u = await prisma.user.upsert({
      where: { email: p.email },
      update: { password: hash, name: p.name, emailVerifiedAt: new Date() },
      create: { email: p.email, password: hash, name: p.name, username: p.id, emailVerifiedAt: new Date() },
    });
    ids.set(p.id, u.id);
  }
  return ids;
}

async function seedOrg(userIds: Map<string, string>): Promise<string> {
  const clara = userIds.get('clara')!;
  let org = await prisma.organization.findFirst({
    where: { name: ORG_NAME, members: { some: { userId: clara, role: OrgRole.OWNER } } },
  });
  if (!org) {
    const created = await call<{ id: string }>('clara', 'POST', '/organizations', { name: ORG_NAME });
    org = await prisma.organization.findUniqueOrThrow({ where: { id: created.id } });
  }
  for (const p of manifest.people) {
    const userId = userIds.get(p.id)!;
    await prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId, organizationId: org.id } },
      update: { role: p.role as OrgRole },
      create: { userId, organizationId: org.id, role: p.role as OrgRole },
    });
  }
  return org.id;
}

async function seedAccess(orgId: string, userIds: Map<string, string>): Promise<void> {
  const grantsOf = (id: string) => manifest.grants.filter((g) => g.person === id).map((g) => `grant:${g.dept}`);
  await call('clara', 'PUT', `/organizations/${orgId}/brain/access`, {
    areas: manifest.departments.map((d) => ({
      slug: d.slug,
      name: d.name,
      leads: d.leads.map((l) => userIds.get(l)!),
      topics: d.topics,
    })),
    members: manifest.people.map((p) => ({
      userId: userIds.get(p.id)!,
      home: p.dept,
      title: p.title,
      groups: grantsOf(p.id),
    })),
  });
}

const listNotes = async (orgId: string, personId: string) =>
  (await call<{ items: Note[] }>(personId, 'GET', `/organizations/${orgId}/brain/notes`)).items;

function leadOf(dept: string): string {
  return deptBySlug.get(dept)!.leads[0];
}

/**
 * The brain gives uploaded notes fresh ids and keeps no source file name (a spreadsheet or mbox becomes
 * several notes), so "already uploaded" is remembered in a ledger next to brain-root: orgId -> path -> note ids.
 */
const ledgerFile = path.join(brainRoot, '..', '.northwind-seed.json');
type Ledger = Record<string, Record<string, string[]>>;
const readLedger = (): Ledger => (fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {});
const writeLedger = (l: Ledger) => fs.writeFileSync(ledgerFile, JSON.stringify(l, null, 1));

async function upload(orgId: string, authorId: string, row: Row, layer: string): Promise<string[]> {
  const buf = fs.readFileSync(path.join(rawRoot, row.path));
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)]), path.basename(row.path));
  form.append('layer', layer);
  if (layer === 'dept' || layer === 'dept-core') form.append('dept', row.dept);
  const r = await call<{ imported: { id: string }[]; skipped: { name: string; reason: string }[] }>(
    authorId, 'POST', `/organizations/${orgId}/brain/upload`, undefined, form,
  );
  if (!r.imported.length) console.warn(`  ! ${row.path}: nothing imported (${r.skipped.map((s) => s.reason).join('; ')})`);
  return r.imported.map((i) => i.id);
}

interface Placed {
  row: Row;
  noteIds: string[];
  layer: string;
}

async function seedNotes(orgId: string, skipMissing: boolean): Promise<Placed[]> {
  const rows = manifest.files
    .filter((r) => r.seed && !r.path.startsWith('_live/'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path));
  const ledger = readLedger();
  const done = (ledger[orgId] ??= {});
  if (!Object.keys(done).length) {
    const existing = await listNotes(orgId, 'clara');
    if (existing.length > 1) {
      throw new Error('org already has notes but no seed ledger; run scripts/reset_northwind.sh to start clean');
    }
  }
  const placed: Placed[] = [];
  const missing: string[] = [];
  const viewCache = new Map<string, Note[]>();
  const view = async (id: string, fresh = false) => {
    if (fresh || !viewCache.has(id)) viewCache.set(id, await listNotes(orgId, id));
    return viewCache.get(id)!;
  };

  for (const row of rows) {
    if (!fs.existsSync(path.join(rawRoot, row.path))) {
      missing.push(row.path);
      continue;
    }
    const authorId = personByEmail.get(row.author)!.id;
    const uploadLayer = row.layer === 'dept-core' ? 'dept' : row.layer;
    let ids = done[row.path];
    if (!ids) {
      ids = await upload(orgId, authorId, row, uploadLayer);
      if (!ids.length) continue;
      done[row.path] = ids;
      writeLedger(ledger);
      process.stdout.write(`  + ${row.path} (${authorId}, ${uploadLayer}, ${ids.length} note${ids.length > 1 ? 's' : ''})\n`);
    }
    if (row.layer === 'dept-core') {
      const leadId = leadOf(row.dept);
      // fresh read: the lead may have just uploaded this note, or another note of this department
      const leadView = await view(leadId, true);
      for (const id of ids) {
        const n = leadView.find((x) => x.id === id);
        if (n && n.layer !== 'dept-core') {
          await call(leadId, 'POST', `/organizations/${orgId}/brain/notes/${id}/move`, { to: 'dept-core' });
          process.stdout.write(`  ^ ${row.path} -> dept-core by ${leadId}\n`);
        }
      }
    }
    placed.push({ row, noteIds: ids, layer: row.layer });
  }
  if (missing.length) {
    const msg = `missing raw files (${missing.length}): ${missing.join(', ')}`;
    if (!skipMissing) throw new Error(`${msg}\n(re-run with --skip-missing to seed without them)`);
    console.warn(`  ! ${msg}`);
  }
  return placed;
}

async function seedPromotionRequests(orgId: string, placed: Placed[]): Promise<void> {
  for (const req of manifest.pending_promotion_requests) {
    const hit = placed.find((p) => p.row.path === req.file);
    if (!hit?.noteIds[0]) {
      console.warn(`  ! promotion request skipped, note not seeded: ${req.file}`);
      continue;
    }
    const mine = await call<{ mine: { noteId: string; status: string }[] }>(
      req.requested_by, 'GET', `/organizations/${orgId}/brain/promotion-requests`,
    );
    if (mine.mine.some((m) => m.noteId === hit.noteIds[0] && m.status === 'PENDING')) {
      console.log(`  = request exists: ${req.file} (${req.requested_by} -> ${req.decider})`);
      continue;
    }
    await call(req.requested_by, 'POST', `/organizations/${orgId}/brain/notes/${hit.noteIds[0]}/promotion-requests`, { to: 'core' });
    console.log(`  + pending request: ${req.file} (${req.requested_by} asks ${req.decider}, left pending)`);
  }
}

async function summary(orgId: string, placed: Placed[]): Promise<void> {
  const layers: Record<string, number> = { core: 0, 'dept-core': 0, dept: 0, private: 0 };
  let total = 0;
  for (const p of placed) { layers[p.layer] += p.noteIds.length; total += p.noteIds.length; }
  const perDept = new Map<string, number>();
  for (const p of placed) if (p.layer === 'dept' || p.layer === 'dept-core') perDept.set(p.row.dept, (perDept.get(p.row.dept) ?? 0) + p.noteIds.length);
  const pending = await prisma.promotionRequest.count({ where: { organizationId: orgId, status: 'PENDING' } });
  const mem = await prisma.organizationMember.count({ where: { organizationId: orgId } });
  const areas = await prisma.brainArea.count({ where: { organizationId: orgId } });
  console.log('\n=== Northwind Bikes seeded ===');
  console.log(`org id            ${orgId}`);
  console.log(`people            ${mem}   departments ${areas}   pending promotion requests ${pending}`);
  console.log(`notes             ${total} from ${placed.length} files  (core ${layers.core}, dept-core ${layers['dept-core']}, dept internal ${layers.dept}, private ${layers.private})`);
  console.log(`notes per dept    ${[...perDept].map(([d, n]) => `${d} ${n}`).join(', ')}`);
  console.log(`password for all  ${PASSWORD}`);
  const personas: [string, string][] = [
    ['clara', 'owner, sees the rings, Access page'],
    ['tobias', 'Engineering lead: promotes, remark vs decision'],
    ['daan', 'Sales member: core + dept-cores only'],
    ['jonas', 'Finance lead, granted Sales internal'],
    ['ingrid', 'BMS expert, private note to commit'],
    ['elena', 'Sales lead: Approvals inbox'],
  ];
  console.log('\nlogin (web)       ' + `${WEB}/login`);
  for (const [id, why] of personas) {
    console.log(`  ${personById.get(id)!.email.padEnd(28)} ${why}`);
  }
  console.log(`\nBrain page        ${WEB}/organizations/${orgId}/brain`);
  console.log(`Access / Approvals ${WEB}/organizations/${orgId}/access  |  /approvals`);
}

async function main(): Promise<void> {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`api not reachable at ${API} (scripts/dev-app.sh)`);
  if (args.has('--reset')) await reset();
  console.log('users ...');
  const userIds = await seedUsers();
  console.log('organization ...');
  const orgId = await seedOrg(userIds);
  console.log('departments, leads, grants ...');
  await seedAccess(orgId, userIds);
  console.log('notes ...');
  const placed = await seedNotes(orgId, args.has('--skip-missing'));
  console.log('promotion requests ...');
  await seedPromotionRequests(orgId, placed);
  await summary(orgId, placed);
}

main()
  .catch((err) => {
    console.error(`\nSEED FAILED: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
