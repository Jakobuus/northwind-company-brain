#!/usr/bin/env node
// Lane VIZ proof capture: screenshots + webm of the graph page at 1920x1080.
//   cd web/viz && npm i && node capture.mjs [--only 1,2,3,4,5] [--org <northwind-org-id>] [--sandbox <org-id>]
// Shots 1, 2, 5 are read-only and run on --org (default: the org in ../../../.northwind-seed.json).
// Shots 3, 4 DROP / MOVE notes, so they run only on a throwaway sandbox org that the script creates itself
// (policy copied from the demo manifest + a few seed files). Northwind is never written to.
// Output: web/viz/out/  (git-ignored).  Needs brain :8000 + web assets served by it (view URL), token in ../../../.brain-dev.env.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const opt0 = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '../..');
const BASE = path.resolve(KIT, '..');
const OUT = opt0('out', path.join(BASE, 'screens/viz'));
const RAW = path.join(KIT, 'demo-raw/northwind');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = new Set((opt('only', '1,2,3,4,5,6')).split(',').map(Number));
const BRAIN = opt('brain', 'http://localhost:8000');
const W = 1920, H = 1080;

const env = Object.fromEntries(fs.readFileSync(path.join(BASE, '.brain-dev.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
const SVC = { 'X-Brain-Service': env.BRAIN_SERVICE_TOKEN };
const NW_ORG = opt('org', Object.keys(JSON.parse(fs.readFileSync(path.join(BASE, '.northwind-seed.json'), 'utf8')))[0]);
const manifest = JSON.parse(fs.readFileSync(path.join(RAW, 'manifest.json'), 'utf8'));
const pid = (email) => email.split('@')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[viz]', ...a);
const results = {};

async function internal(org, method, p, body, form) {
  const res = await fetch(`${BRAIN}/internal/orgs/${org}/${p}`, {
    method, headers: { ...SVC, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
function resolvePerson(org, person) {  // first name -> person id (Northwind ids are uuids, sandbox ids are first names)
  const txt = fs.readFileSync(path.join(BASE, 'brain-root', org, 'policy.yaml'), 'utf8');
  for (const m of txt.matchAll(/^  ([A-Za-z0-9_-]+):\n    name: (.+)$/gm)) if (m[2].trim().split(' ')[0].toLowerCase() === person) return m[1];
  return person;
}
async function viewUrl(org, person) {
  person = resolvePerson(org, person);
  const { url } = await internal(org, 'POST', 'view-token', { person, ttl_seconds: 7200 });
  // the url carries BRAIN_PUBLIC_URL; always drive the local brain
  return BRAIN + new URL(url).pathname;
}

// ---------- sandbox org (shots 3, 4) ----------
async function makeSandbox() {
  const org = opt('sandbox', 'viz-' + randomUUID());
  const people = {}, areas = {};
  for (const p of manifest.people) people[p.id] = { name: p.name, title: p.title, rank: p.role === 'OWNER' ? 100 : p.role === 'ADMIN' ? 70 : 30, groups: [p.dept, ...p.grants.map(() => null).filter(Boolean)], home: p.dept };
  for (const g of manifest.grants || []) { /* grants: {person, area} or similar */
    const who = g.person || g.user, area = g.area || g.dept; if (people[who] && area) people[who].groups.push('grant:' + area);
  }
  for (const d of manifest.departments) areas[d.slug] = { name: d.name, owner: d.leads[0], readers: [], topics: d.topics, leads: d.leads };
  await internal(org, 'PUT', 'policy', { company_name: 'Viz sandbox', people, areas });
  const pick = new Set([
    'core/company-handbook-overview.md', 'core/all-hands-2026-10-30.md', 'core/leadership-decisions-2026-10.md', 'core/values-and-ways-of-working.md',
    'leadership/strategy-memo-2026.md', 'private/clara/private-note-halden-ceiling.md',
    'product-engineering/bms-explained-for-everyone.md', 'product-engineering/t2-architecture.md', 'product-engineering/standup-2026-09-08.vtt',
    'product-engineering/firmware-0.9-release-notes.md', 'private/ingrid/private-note-fast-charge.md',
    'customer-care/support-playbook.md', 'customer-care/ticket-summary-2026-q3.csv', 'customer-care/csat-report-2026-q3.md',
    'sales/q3-sales-review.md', 'sales/dealer-network-plan.md', 'marketing/brand-guidelines.pptx',
  ]);
  let n = 0;
  for (const f of manifest.files.filter((x) => pick.has(x.path))) {
    const fd = new FormData();
    const mode = { core: 'all', 'dept-core': 'all', dept: 'area', private: 'private' }[f.layer];
    fd.append('area', f.layer === 'core' ? 'core' : f.dept); fd.append('access', mode); fd.append('author', pid(f.author));
    fd.append('file', new Blob([fs.readFileSync(path.join(RAW, f.path))]), path.basename(f.path));
    try { await internal(org, 'POST', 'import', null, fd); n++; } catch (e) { log('seed skip', f.path, String(e).slice(0, 120)); }
  }
  log(`sandbox org ${org}: ${n} seed notes`);
  return org;
}

// ---------- page helpers ----------
let browser;
async function openPersona(org, person, name, { video = false, width = W, height = H } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: path.join(OUT, '.vid'), size: { width, height } } } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
  await page.goto(await viewUrl(org, person), { waitUntil: 'networkidle' });
  await page.waitForSelector('#c');
  await sleep(2500); // layout + intro animation
  return { ctx, page, errors, name };
}
async function closeVideo(h, outName) {
  const v = h.page.video();
  await h.ctx.close();
  if (v) { fs.renameSync(await v.path(), path.join(OUT, outName + '.webm')); }
}
const shot = (h, name) => h.page.screenshot({ path: path.join(OUT, name + '.png') });
const graphText = (page) => page.evaluate(async () => (await fetch('api/graph' + location.search)).text());
async function waitFor(fn, ms, step = 300) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return Date.now() - t; await sleep(step); } return -1; }

// ---------- shot 1 ----------
async function shot1() {
  const h = await openPersona(NW_ORG, 'clara', 'clara', { video: true });
  await sleep(1500);
  await shot(h, '1-overview-clara');
  await closeVideo(h, '1-overview-clara');
  results[1] = { errors: h.errors };
}

// ---------- shot 2 ----------
async function shot2() {
  const a = await openPersona(NW_ORG, 'clara', 'Clara Vogel (owner)');
  const b = await openPersona(NW_ORG, 'daan', 'Daan de Vries (sales)');
  await sleep(500);
  const A = await a.page.screenshot(), B = await b.page.screenshot();
  await shot(a, '2a-clara'); await shot(b, '2b-daan');
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const img = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  await p.setContent(`<body style="margin:0;background:#0b0b10;color:#e8e8ee;font:600 22px system-ui;width:${W}px;height:${H}px;display:grid;grid-template-columns:1fr 1fr;gap:0;align-content:center">
    <div style="text-align:center"><div style="padding:6px">${a.name}</div><img src="${img(A)}" style="width:100%;display:block;border-right:2px solid #333"></div>
    <div style="text-align:center"><div style="padding:6px">${b.name}</div><img src="${img(B)}" style="width:100%;display:block"></div></body>`);
  await p.screenshot({ path: path.join(OUT, '2-two-personas.png') });
  await ctx.close(); await a.ctx.close(); await b.ctx.close();
  results[2] = { errors: [...a.errors, ...b.errors] };
}

// ---------- shot 3 ----------
async function drop(org, person, label, file, layer, outName, needle) {
  const h = await openPersona(org, person, label, { video: true });
  await shot(h, `${outName}-0-before`);
  const before = (await graphText(h.page)).includes(needle);
  await h.page.setInputFiles('#addfile', path.join(RAW, file));
  await h.page.waitForSelector('#dropmenu:not([hidden])', { timeout: 5000 });
  await sleep(700);
  await shot(h, `${outName}-1-menu`);
  await h.page.click(`#dropmenu button[data-layer="${layer}"]`);
  const t0 = Date.now();
  const landed = await waitFor(async () => (await graphText(h.page)).includes(needle), 25000, 400);
  for (const [i, d] of [300, 700, 1200, 2500].entries()) { await sleep(Math.max(0, d - (Date.now() - t0 - (i ? 0 : 0))) > 0 ? 250 : 0); await shot(h, `${outName}-${i + 2}-landing`); }
  await sleep(2500);
  await shot(h, `${outName}-6-settled`);
  const toasts = await h.page.$$eval('#toasts > *', (els) => els.map((e) => e.textContent.trim().slice(0, 100)));
  await closeVideo(h, outName);
  return { person, layer, wasThereBefore: before, landedMs: landed, toasts, errors: h.errors };
}
async function shot3(sb) {
  results[3] = [
    await drop(sb, 'clara', 'clara', '_live/company-okrs-2027.docx', 'core', '3a-drop-core', 'company-okrs-2027'),
    await drop(sb, 'yara', 'yara', '_live/care-ticket-spike-2026-11-03.csv', 'dept', '3b-drop-dept-internal', 'care-ticket-spike'),
    await drop(sb, 'priya', 'priya', '_live/priya-roadmap-doubts.md', 'private', '3c-drop-private', 'roadmap doubts'),
  ];
}

// ---------- shot 4 ----------
async function shot4(sb) {
  const note = (await internal(sb, 'GET', 'notes?person=tobias')).find((n) => /bms-explained|bms/i.test(n.id + n.title));
  if (!note) throw new Error('no bms note in sandbox');
  const h = await openPersona(sb, 'tobias', 'tobias', { video: true });
  await shot(h, '4-promote-0-before');
  await sleep(1500);
  const t0 = Date.now();
  const r = await internal(sb, 'POST', `notes/${note.id}/move`, { to: 'core', by: 'tobias' });
  log('promoted', note.id, JSON.stringify(r).slice(0, 80));
  for (const [i, ms] of [400, 900, 1500, 2200, 3200].entries()) {
    await sleep(Math.max(0, ms - (Date.now() - t0))); await shot(h, `4-promote-${i + 1}-t${ms}`);
  }
  await sleep(2500);
  await shot(h, '4-promote-9-settled');
  await closeVideo(h, '4-promote');
  results[4] = { note: note.id, layerAfter: r.layer, errors: h.errors };
}

// ---------- shot 5 ----------
async function shot5() {
  const h = await openPersona(NW_ORG, 'jonas', 'jonas', { video: true });
  await shot(h, '5-ask-0-before');
  await h.page.fill('#q', 'How should we price the T2, cost-plus or value-based?');
  await sleep(500);
  await h.page.press('#q', 'Enter');
  const t0 = Date.now();
  const got = await waitFor(async () => !/Answers use only|Searching what/.test(await h.page.textContent('#ans')), 60000, 400);
  for (const [i, ms] of [500, 1500, 2500, 4000].entries()) {
    await sleep(Math.max(0, ms - (Date.now() - t0))); await shot(h, `5-ask-${i + 1}-t${ms}`);
  }
  await sleep(2500);
  await shot(h, '5-ask-9-settled');
  if (got > 0) for (const [i, ms] of [400, 1200, 2500].entries()) { await sleep(ms - (i ? [400, 1200, 2500][i - 1] : 0)); await shot(h, `5-ask-after-answer-${i + 1}-t${ms}`); }
  const answer = (await h.page.textContent('#ans')).trim().slice(0, 160);
  const halo = await h.page.textContent('#halocap').catch(() => '');
  await closeVideo(h, '5-ask-halo');
  results[5] = { answeredMs: got, answer, halocap: halo.trim().slice(0, 80), errors: h.errors };
}

// ---------- shot 6: click-around stress (read-only on Northwind; the drop popover is opened and cancelled, never uploaded) ----------
async function shot6() {
  const h = await openPersona(NW_ORG, 'clara', 'clara', { video: false });
  const page = h.page, notes = [];
  const roleBtns = await page.$$('#roles button, #roles [role=button], #roles > *');
  notes.push(`person switcher items: ${roleBtns.length}`);
  const ask = async (q, tag) => {
    await page.fill('#q', q); await page.press('#q', 'Enter');
    const ms = await waitFor(async () => !/Answers use only|Searching what/.test(await page.textContent('#ans')), 70000, 500);
    notes.push(`ask ${tag}: ${ms < 0 ? 'STUCK (no answer in 70s)' : ms + 'ms'}`);
    await sleep(800); await shot(h, `6-stress-${tag}`);
  };
  if (roleBtns.length >= 4) {
    for (let i = 0; i < 4; i++) {
      const btns = await page.$$('#roles button, #roles [role=button], #roles > *');
      await btns[(i * 3 + 1) % btns.length].click(); await sleep(1500);
      notes.push(`switch ${i}: title="${(await page.textContent('#subtitle')).trim()}"`);
    }
    await shot(h, '6-stress-after-switches');
  } else {
    for (const p of ['tobias', 'daan', 'jonas', 'clara']) {  // token page has no switcher: reopen as other persons
      await page.goto(await viewUrl(NW_ORG, p), { waitUntil: 'networkidle' }); await sleep(1500);
    }
    notes.push('no in-page person switcher on token view; reloaded 4 persons instead');
  }
  await ask('When does the Model T2 launch?', 'ask1');
  const close = await page.$('#ans .close, #ans [aria-label*=lose], #ans button, #note .close, #note button');
  if (close) { await close.click(); await sleep(500); notes.push('closed card via ' + (await close.evaluate((e) => e.className || e.textContent)).toString().slice(0, 30)); }
  else notes.push('no close button found on answer/note card');
  await ask('What is the retail price of the Model T1?', 'ask2');
  await page.setInputFiles('#addfile', path.join(RAW, '_live/priya-roadmap-doubts.md'));
  const shown = await page.waitForSelector('#dropmenu:not([hidden])', { timeout: 4000 }).then(() => true, () => false);
  notes.push('drop popover opened: ' + shown);
  if (shown) { await shot(h, '6-stress-dropmenu'); await page.click('#dropmenu .dm-cancel'); await sleep(400); notes.push('popover closed: ' + await page.$eval('#dropmenu', (e) => e.hidden)); }
  await page.canvas; await shot(h, '6-stress-final');
  results[6] = { notes, errors: h.errors };
  await h.ctx.close();
}

// ---------- main ----------
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, '.vid'), { recursive: true });
browser = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
let sb;
try {
  if (ONLY.has(3) || ONLY.has(4)) sb = await makeSandbox();
  const steps = { 1: shot1, 2: shot2, 3: () => shot3(sb), 4: () => shot4(sb), 5: shot5, 6: shot6 };
  for (const k of [1, 2, 3, 4, 5, 6]) {
    if (!ONLY.has(k)) continue;
    log('shot', k);
    try { await steps[k](); } catch (e) { results[k] = { failed: String(e).slice(0, 300) }; log('shot', k, 'FAILED', e); }
  }
} finally {
  await browser.close();
  fs.rmSync(path.join(OUT, '.vid'), { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ northwindOrg: NW_ORG, sandboxOrg: sb, results }, null, 1));
  log(JSON.stringify(results, null, 1));
}
