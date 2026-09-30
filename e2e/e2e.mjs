// End-to-end flow: web API (cookie + CSRF) <-> backend <-> real DevClient binary (signed plugin API).
// Started by e2e/run.sh, which provides a running backend and these environment variables:
//   E2E_API, E2E_DATA, E2E_ROOT, DEVCLIENT, ADMIN_EMAIL, ADMIN_PASSWORD, E2E_SKIP_WEB
import { spawn, execFile } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const API = process.env.E2E_API;
const DATA = process.env.E2E_DATA;
const ROOT = process.env.E2E_ROOT;
const DEVCLIENT = process.env.DEVCLIENT;
const requireBackend = createRequire(path.join(ROOT, 'backend', 'package.json'));
const OTPAuth = requireBackend('otpauth');

// ------------------------------------------------------------------------------------ harness
const results = [];
let current = null;
class AssertionError extends Error {}
function assert(cond, message, extra) {
  if (!cond) throw new AssertionError(message + (extra !== undefined ? ` — got ${JSON.stringify(extra).slice(0, 600)}` : ''));
}
function eq(actual, expected, what) {
  assert(actual === expected, `${what}: expected ${JSON.stringify(expected)}`, actual);
}
async function step(name, fn) {
  current = name;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}  (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').join('\n      ')}`);
    throw err;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------ web client
class WebSession {
  constructor(label) {
    this.label = label;
    this.cookie = null;
    this.csrf = null;
    this.totp = null;
  }
  async req(method, url, { body, form, expect, query } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = this.csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const res = await fetch(API + '/api/v1' + url + qs, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const m = /^stn_session=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `stn_session=${m[1]}` : null;
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    const want = expect ?? [200, 201];
    const ok = Array.isArray(want) ? want.includes(res.status) : res.status === want;
    assert(ok, `[${this.label}] ${method} ${url} -> HTTP ${res.status} (expected ${JSON.stringify(want)})`, json);
    return { status: res.status, json };
  }
  get(url, opts) { return this.req('GET', url, opts); }
  post(url, body, opts = {}) { return this.req('POST', url, { ...opts, body }); }
  async login(email, password) {
    const { json } = await this.post('/auth/login', { email, password }, { expect: 200 });
    if (json.mfa_required) {
      assert(this.totp, `[${this.label}] 2FA required but no secret known`);
      const r = await this.post('/auth/login/2fa', { mfa_token: json.mfa_token, code: await freshCode(this.totp) }, { expect: 200 });
      this.csrf = r.json.csrf_token;
      return r.json;
    }
    this.csrf = json.csrf_token;
    return json;
  }
  /** Enrols TOTP on the current session (staff roles must, before any staff route works). */
  async enroll2fa() {
    const setup = await this.post('/auth/2fa/setup', undefined, { expect: 200 });
    assert(/^otpauth:\/\//.test(setup.json.otpauth_uri), 'otpauth uri', setup.json);
    this.totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.json.secret), algorithm: 'SHA1', digits: 6, period: 30 });
    const en = await this.post('/auth/2fa/enable', { code: await freshCode(this.totp) }, { expect: 200 });
    eq(en.json.recovery_codes.length, 10, 'recovery code count');
    const session = await this.get('/auth/session', { expect: 200 });
    if (session.json.csrf_token) this.csrf = session.json.csrf_token;
    return session.json;
  }
}
const usedSteps = new Map();
/** TOTP code for a step not used before by this secret (the backend rejects step reuse). */
async function freshCode(totp) {
  const key = totp.secret.base32;
  for (;;) {
    const stepNo = Math.floor(Date.now() / 30000);
    const msLeft = 30000 - (Date.now() % 30000);
    if (usedSteps.get(key) !== stepNo && msLeft > 1500) {
      usedSteps.set(key, stepNo);
      return totp.generate();
    }
    await sleep(msLeft + 200);
  }
}

// ------------------------------------------------------------------------------------ DevClient
function parseDocs(text) {
  // DevClient prints indented JSON documents; each top-level document starts with '{' at column 0.
  const docs = [];
  let buf = [];
  for (const line of text.split('\n')) {
    if (line === '{' && buf.length === 0) buf.push(line);
    else if (buf.length) {
      buf.push(line);
      if (line === '}') {
        docs.push(JSON.parse(buf.join('\n')));
        buf = [];
      }
    }
  }
  return docs;
}
async function dev(identity, args, { expectError } = {}) {
  const argv = [...args, '--identity', identity, '--api', API];
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    ({ stdout, stderr } = await execFileP(DEVCLIENT, argv, { timeout: 60000 }));
  } catch (err) {
    ({ stdout = '', stderr = '' } = err);
    code = err.code ?? 1;
  }
  const out = parseDocs(stdout);
  const errDoc = parseDocs(stderr)[0] ?? null;
  const shown = `devclient ${args.join(' ')} (exit ${code})\nstderr: ${stderr.trim().slice(0, 800)}`;
  if (expectError) {
    assert(code === 2, `expected API error from ${shown}`, out);
    const errorCode = errDoc?.error?.code;
    eq(errorCode, expectError, `error code of ${args[0]}`);
    return errDoc.error;
  }
  assert(code === 0, shown);
  return out[out.length - 1];
}

// ------------------------------------------------------------------------------------ flow
const S = {}; // shared state across steps
const idDir = (name) => path.join(DATA, 'identities', name);
const rnd17 = () => '7656119' + String(randomInt(0, 1e9)).padStart(10, '0');
const PLAYER = `${rnd17()}@steam`;
const PLAYER_OBJ = { type: 'steam', id: PLAYER.split('@')[0] };
const SPECTATOR = `${rnd17()}@steam`;
const PW = 'Correct-Horse-Battery-9';

async function registerUser(admin, label, role) {
  const s = new WebSession(label);
  const email = `${label}@e2e.test`;
  const reg = await s.post('/auth/register', { email, username: `e2e_${label}`, password: PW }, { expect: 201 });
  if (role) {
    const upd = await admin.req('PATCH', `/admin/users/${reg.json.user_id}`, { body: { role, reason: 'e2e setup' }, expect: 200 });
    eq(upd.json.role, role, `${label} role`);
  }
  await s.login(email, PW);
  return s;
}

async function main() {
  const admin = new WebSession('admin');

  await step('a. web login as super admin (+2FA enrolment), create server 1 -> registration token', async () => {
    const login = await admin.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    assert(typeof admin.csrf === 'string' && admin.cookie, 'cookie + csrf after login', login);
    eq(login.user.role, 'super_admin', 'role');
    const blocked = await admin.get('/cases', { expect: 403 });
    eq(blocked.json.error.code, 'MFA_ENROLLMENT_REQUIRED', 'staff route before 2FA');
    await admin.enroll2fa();
    await admin.get('/cases', { expect: 200 });
    const created = await admin.post('/servers', { name: 'E2E Server One', description: 'e2e' }, { expect: 201 });
    assert(/^sreg_[A-Za-z0-9_-]{43}$/.test(created.json.registration_token), 'registration token format', created.json);
    eq(created.json.server.status, 'pending', 'server status');
    S.server1 = created.json.server.server_id;
    S.token1 = created.json.registration_token;
  });

  await step('a2. CSRF is enforced for cookie-authenticated writes', async () => {
    const saved = admin.csrf;
    admin.csrf = 'bogus';
    const r = await admin.post('/servers', { name: 'Should Fail' }, { expect: 403 });
    admin.csrf = saved;
    eq(r.json.error.code, 'CSRF_TOKEN_INVALID', 'error code');
  });

  await step('b. DevClient init + register -> active; heartbeat; default policy', async () => {
    const init = await dev(idDir('srv1'), ['init']);
    eq(init.created, true, 'init created');
    eq(init.registered, false, 'init registered');
    const reg = await dev(idDir('srv1'), ['register', '--token', S.token1, '--game-version', '14.1.3']);
    eq(reg.server_id, S.server1, 'server_id');
    eq(reg.status, 'active', 'status');
    eq(reg.key_fingerprint, init.fingerprint, 'fingerprint');
    const again = await dev(idDir('srv1b'), ['init']);
    void again;
    await dev(idDir('srv1b'), ['register', '--token', S.token1], { expectError: 'REGISTRATION_TOKEN_INVALID' });
    const hb = await dev(idDir('srv1'), ['heartbeat', '--players', '3']);
    eq(hb.status, 'active', 'heartbeat status');
    eq(hb.policy_version, 1, 'heartbeat policy_version');
    const pol = await dev(idDir('srv1'), ['policy']);
    eq(pol.version, 1, 'policy version');
    eq(pol.backend_unavailable_action, 'allow', 'backend_unavailable_action');
    const sigs = pol.rules.map((r) => `${r.signal}:${r.action}`).sort();
    assert(JSON.stringify(sigs) === JSON.stringify(['account_age:admin_notify', 'alt_account:admin_notify', 'global_verdict:admin_notify', 'vpn:admin_notify']), 'default rules', pol.rules);
    const web = await admin.get(`/servers/${S.server1}`, { expect: 200 });
    const srv = web.json.server ?? web.json;
    eq(srv.status, 'active', 'web view of server status');
  });

  const reporter = await registerUser(admin, 'reporter');

  await step('c. unknown player check -> none; web report creates case; check -> reported', async () => {
    const c1 = await dev(idDir('srv1'), ['check', '--player', PLAYER, '--nickname', 'Suspect', '--ip', '203.0.113.7']);
    eq(c1.global_status, 'none', 'global_status');
    assert(!('action' in c1), 'no action field in /player/check (R1)', Object.keys(c1));
    eq(c1.reports, 0, 'reports');
    eq(c1.policy_version, 1, 'policy_version');
    const rep = await reporter.post('/reports', { player: PLAYER_OBJ, reason: 'Aimbot', description: 'Snaps to heads through walls', server_id: S.server1 }, { expect: 201 });
    assert(/^CASE-\d{4}-\d{6}$/.test(rep.json.case_id), 'case number', rep.json);
    S.caseNo = rep.json.case_id;
    const c2 = await dev(idDir('srv1'), ['check', '--player', PLAYER]);
    eq(c2.global_status, 'reported', 'global_status');
    eq(c2.reports, 1, 'reports');
    eq(c2.case_id, S.caseNo, 'case_id');
  });

  await step('d. evidence upload (sha256), start review, evidence review, verdict confirmed; check -> confirmed', async () => {
    // Minimal PNG: signature + IHDR + IEND (file-type sniffs image/png from the magic bytes).
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010018dd8db00000000049454e44ae426082',
      'hex',
    );
    const localHash = createHash('sha256').update(png).digest('hex');
    const form = new FormData();
    form.set('type', 'image');
    form.set('title', 'Screenshot of wallhack');
    form.set('file', new Blob([png], { type: 'image/png' }), 'shot.png');
    // Uploaded by the reporting user: reviewers may not review evidence they uploaded themselves.
    const up = await reporter.req('POST', `/cases/${S.caseNo}/evidence`, { form, expect: 201 });
    eq(up.json.sha256, localHash, 'sha256');
    eq(up.json.mime_type, 'image/png', 'mime_type');
    S.evidenceId = up.json.id;
    // A mislabeled upload (text claiming to be mp4) must be refused by magic-byte sniffing.
    const bad = new FormData();
    bad.set('type', 'video');
    bad.set('title', 'Fake video');
    bad.set('file', new Blob([Buffer.from('definitely not a video')], { type: 'video/mp4' }), 'x.mp4');
    const rej = await reporter.req('POST', `/cases/${S.caseNo}/evidence`, { form: bad, expect: 415 });
    eq(rej.json.error.code, 'UNSUPPORTED_MEDIA_TYPE', 'mismatch error');
    // Download via ticket (no session) and compare hash.
    const t = await admin.post(`/evidence/${S.evidenceId}/ticket`, undefined, { expect: [200, 201] });
    const dl = await fetch(t.json.url.startsWith('http') ? t.json.url : API + t.json.url);
    eq(dl.status, 200, 'ticket download status');
    eq(createHash('sha256').update(Buffer.from(await dl.arrayBuffer())).digest('hex'), localHash, 'downloaded sha256');
    const early = await admin.post(`/cases/${S.caseNo}/verdict`, { verdict: 'confirmed', comment: 'too early' }, { expect: 422 });
    eq(early.json.error.code, 'INSUFFICIENT_EVIDENCE', 'verdict without verified evidence');
    const start = await admin.post(`/cases/${S.caseNo}/reviews/start`, { comment: 'Starting review' }, { expect: 200 });
    eq(start.json.status, 'under_review', 'case status');
    const c = await dev(idDir('srv1'), ['check', '--player', PLAYER]);
    eq(c.global_status, 'under_review', 'global_status during review');
    const rv = await admin.post(`/evidence/${S.evidenceId}/reviews`, {
      status: 'verified', identity_status: 'verified', authenticity_status: 'verified', cheating_status: 'verified', comment: 'Clear wallhack',
    }, { expect: 201 });
    eq(rv.json.cheating_status, 'verified', 'cheating_status');
    const v = await admin.post(`/cases/${S.caseNo}/verdict`, { verdict: 'confirmed', comment: 'Confirmed by evidence', public_summary: 'Wallhack confirmed' }, { expect: 200 });
    eq(v.json.verdict, 'confirmed', 'verdict');
    eq(v.json.status, 'closed', 'case status');
    const c3 = await dev(idDir('srv1'), ['check', '--player', PLAYER]);
    eq(c3.global_status, 'confirmed', 'global_status');
    eq(c3.case_id, S.caseNo, 'case_id');
    const pub = await fetch(`${API}/api/v1/public/cases/${S.caseNo}`);
    eq(pub.status, 200, 'public case lookup');
  });

  const owner2 = await registerUser(admin, 'owner2', 'server_admin');

  await step('e. server 2 (other owner) registers and confirms the case -> confirmed_servers >= 1 from server 1', async () => {
    const created = await owner2.post('/servers', { name: 'E2E Server Two' }, { expect: 201 });
    S.server2 = created.json.server.server_id;
    await dev(idDir('srv2'), ['init']);
    const reg = await dev(idDir('srv2'), ['register', '--token', created.json.registration_token]);
    eq(reg.status, 'active', 'server 2 status');
    const forbidden = await owner2.post(`/cases/${S.caseNo}/confirmations`, { server_id: S.server1, note: 'not mine' }, { expect: 403 });
    eq(forbidden.json.error.code, 'FORBIDDEN', 'confirm for a foreign server');
    await owner2.post(`/cases/${S.caseNo}/confirmations`, { server_id: S.server2, note: 'Seen on our server too' }, { expect: 201 });
    const c = await dev(idDir('srv1'), ['check', '--player', PLAYER]);
    assert(c.confirmed_servers >= 1, 'confirmed_servers >= 1', c.confirmed_servers);
    assert(c.independent_confirmed_servers >= 1, 'independent_confirmed_servers >= 1', c.independent_confirmed_servers);
    eq(c.cases[0].confirmed_servers, c.confirmed_servers, 'cases[0].confirmed_servers');
  });

  const playerUser = await registerUser(admin, 'suspect');

  await step('f. account link via DevClient, VPN whitelist request, owner approves -> bypass on server 1 only', async () => {
    const code = await playerUser.post('/me/player-link', undefined, { expect: 200 });
    assert(/^LNK-[0-9A-Z]{6}$/.test(code.json.code), 'link code format', code.json);
    const link = await dev(idDir('srv1'), ['link', '--player', PLAYER, '--code', code.json.code]);
    eq(link.linked, true, 'linked');
    eq(link.username, 'e2e_suspect', 'linked username');
    await dev(idDir('srv1'), ['link', '--player', PLAYER, '--code', code.json.code], { expectError: undefined }).then(
      () => assert(false, 'link code must be single-use'),
      (e) => assert(/exit 2/.test(e.message), 'reused link code rejected by the API', e.message),
    );
    const me = await playerUser.get('/me', { expect: 200 });
    const linked = me.json.linked_player;
    assert(linked && JSON.stringify(linked).includes(PLAYER_OBJ.id), 'linked player on /me', me.json);
    const wr = await playerUser.post('/whitelist-requests', { server_id: S.server1, type: 'vpn_whitelist', reason: 'I use a VPN for work reasons', requested_days: 30 }, { expect: 201 });
    eq(wr.json.status, 'pending', 'request status');
    const other = await owner2.post(`/whitelist-requests/${wr.json.id}/decision`, { decision: 'approve', note: 'not my server' }, { expect: [403, 404] });
    void other;
    const dec = await admin.post(`/whitelist-requests/${wr.json.id}/decision`, { decision: 'approve', note: 'ok', days: 30 }, { expect: 200 });
    eq(dec.json.status, 'approved', 'decision status');
    const b1 = await dev(idDir('srv1'), ['bypass', '--player', PLAYER, '--types', 'vpn_whitelist']);
    eq(b1.bypass, true, 'bypass from server 1');
    eq(b1.bypass_type, 'vpn_whitelist', 'bypass_type');
    const b2 = await dev(idDir('srv2'), ['bypass', '--player', PLAYER]);
    eq(b2.bypass, false, 'bypass from server 2');
  });

  await step('g. overwatch session: proof codes verified anonymously / wrong code / reviewer view; session ended', async () => {
    const child = spawn(DEVCLIENT, ['overwatch', '--target', PLAYER, '--spectator', SPECTATOR, '--seconds', '8', '--identity', idDir('srv1'), '--api', API]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const exited = new Promise((resolve) => child.on('close', resolve));
    let codeDoc = null;
    let started = null;
    for (let i = 0; i < 100 && !codeDoc; i++) {
      await sleep(100);
      const docs = parseDocs(out);
      started = docs.find((d) => d.event === 'session_started') ?? started;
      codeDoc = docs.find((d) => d.event === 'proof_code') ?? null;
    }
    assert(codeDoc && started, `proof code printed (stderr: ${err.slice(0, 400)})`, out.slice(0, 400));
    // A moment inside the session that is not in the future for the backend (proofs cover [started_at, now]).
    const ts = Math.max(Date.parse(started.started_at), Date.now() - 200);
    const q = { server_id: S.server1, player_id: PLAYER, spectator_id: SPECTATOR, timestamp: String(ts) };
    const anon = new WebSession('anonymous');
    const ok = await anon.get('/evidence/proof', { query: { ...q, code: codeDoc.code }, expect: 200 });
    if (!ok.json.valid) {
      const dbg = await admin.get('/evidence/proof', { query: q, expect: 200 });
      assert(false, `valid with printed code ${codeDoc.code} (ts ${new Date(ts).toISOString()}, started ${JSON.stringify(started)}, printed ${JSON.stringify(codeDoc)}, reviewer view ${JSON.stringify(dbg.json)})`, ok.json);
    }
    eq(ok.json.session_id, started.session_id, 'session_id');
    assert(!('code' in ok.json), 'anonymous response must not contain the code', ok.json);
    const wrongCode = codeDoc.code === '000-000' ? '000-001' : '000-000';
    const bad = await anon.get('/evidence/proof', { query: { ...q, code: wrongCode }, expect: 200 });
    eq(bad.json.valid, false, 'valid with wrong code');
    assert(!('code' in bad.json), 'no code leak on invalid', bad.json);
    const rev = await admin.get('/evidence/proof', { query: q, expect: 200 });
    eq(rev.json.code, codeDoc.code, 'reviewer sees expected code');
    const exitCode = await exited;
    eq(exitCode, 0, `overwatch exit code (stderr: ${err.slice(0, 300)})`);
    const docs = parseDocs(out);
    const end = docs[docs.length - 1];
    eq(end.event, 'session_ended', 'last event');
    eq(end.status, 'ended', 'session status');
    const view = await admin.get(`/overwatch/sessions/${started.session_id}`, { expect: 200 });
    const sess = view.json.session ?? view.json;
    eq(sess.status, 'ended', 'web overwatch session status');
    assert(!JSON.stringify(view.json).includes('secret'), 'overwatch view never exposes the secret', Object.keys(sess));
  });

  await step('i. negative auth: tampered signature -> INVALID_SIGNATURE; replayed nonce -> REPLAYED_NONCE', async () => {
    await dev(idDir('srv2'), ['check', '--player', PLAYER, '--tamper-signature'], { expectError: 'INVALID_SIGNATURE' });
    await dev(idDir('srv2'), ['check', '--player', PLAYER, '--replay'], { expectError: 'REPLAYED_NONCE' });
    const unsigned = await fetch(`${API}/api/v1/player/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player: PLAYER_OBJ }) });
    eq(unsigned.status, 401, 'unsigned request status');
    eq((await unsigned.json()).error.code, 'MISSING_AUTH_HEADERS', 'unsigned error code');
    await dev(idDir('srv2'), ['heartbeat']);
  });

  await step('h. key rotation (old key rejected after 2 s grace, new key works); web revocation -> KEY_REVOKED', async () => {
    mkdirSync(idDir('srv1-old'), { recursive: true });
    cpSync(idDir('srv1'), idDir('srv1-old'), { recursive: true });
    const rot = await dev(idDir('srv1'), ['rotate']);
    assert(rot.new_fingerprint && rot.new_fingerprint !== rot.previous_fingerprint, 'new fingerprint', rot);
    const hb = await dev(idDir('srv1'), ['heartbeat']);
    eq(hb.status, 'active', 'heartbeat with new key');
    await sleep(3000);
    const oldErr = await dev(idDir('srv1-old'), ['heartbeat'], { expectError: 'NO_ACTIVE_KEY' });
    void oldErr;
    await dev(idDir('srv1'), ['check', '--player', PLAYER]);
    const keys = await admin.get(`/servers/${S.server1}/keys`, { expect: 200 });
    const active = keys.json.items.find((k) => k.status === 'active');
    eq(active.fingerprint, rot.new_fingerprint, 'active key fingerprint');
    const old = keys.json.items.find((k) => k.fingerprint === rot.previous_fingerprint);
    assert(old && ['retiring', 'retired'].includes(old.status), 'old key retiring/retired', old);
    await admin.post(`/servers/${S.server1}/keys/${active.id}/revoke`, { reason: 'e2e revocation test' }, { expect: 200 });
    await dev(idDir('srv1'), ['heartbeat'], { expectError: 'KEY_REVOKED' });
  });

  const reviewer2 = await registerUser(admin, 'reviewer2', 'reviewer');

  await step('j. audit chain valid; appeal: verdict setter refused (CONFLICT_OF_INTEREST), other reviewer reverses', async () => {
    const audit = await admin.get('/admin/audit/verify', { expect: 200 });
    eq(audit.json.valid, true, 'audit chain valid');
    assert(audit.json.checked_events > 10, 'audit events checked', audit.json);
    const blocked = await reviewer2.get('/appeals', { expect: 403 });
    eq(blocked.json.error.code, 'MFA_ENROLLMENT_REQUIRED', 'reviewer before 2FA');
    await reviewer2.enroll2fa();
    const ap = await playerUser.post('/appeals', { case_id: S.caseNo, statement: 'I was not cheating, this is a misunderstanding of my aim.' }, { expect: 201 });
    eq(ap.json.status, 'open', 'appeal status');
    const coi = await admin.post(`/appeals/${ap.json.id}/decision`, { decision: 'reverse', reason: 'I set the verdict myself' }, { expect: 409 });
    eq(coi.json.error.code, 'CONFLICT_OF_INTEREST', 'verdict setter decision');
    const dec = await reviewer2.post(`/appeals/${ap.json.id}/decision`, { decision: 'reverse', reason: 'Evidence does not show the suspect player' }, { expect: 200 });
    eq(dec.json.status, 'decided', 'appeal status');
    eq(dec.json.decision, 'reverse', 'decision');
    const kase = await admin.get(`/cases/${S.caseNo}`, { expect: 200 });
    const k = kase.json.case ?? kase.json;
    eq(k.verdict ?? k.current_verdict, 'rejected', 'case verdict after reverse');
    const c = await dev(idDir('srv2'), ['check', '--player', PLAYER]);
    eq(c.global_status, 'rejected', 'global_status after appeal');
    const audit2 = await admin.get('/admin/audit/verify', { expect: 200 });
    eq(audit2.json.valid, true, 'audit chain still valid');
  });

  if (process.env.E2E_SKIP_WEB !== '1') {
    await step('k. web app builds; Vite dev server proxies /api/v1/time to the backend', async () => {
      const web = path.join(ROOT, 'web');
      await execFileP('pnpm', ['build'], { cwd: web, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      const index = readFileSync(path.join(web, 'dist', 'index.html'), 'utf8');
      assert(index.includes('<div id="root"'), 'dist/index.html has the app root');
      const port = await freePort();
      const vite = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
        cwd: web, env: { ...process.env, VITE_API_PROXY_TARGET: API }, detached: true, stdio: 'ignore',
      });
      try {
        let body = null;
        for (let i = 0; i < 60 && !body; i++) {
          await sleep(500);
          body = await fetch(`http://127.0.0.1:${port}/api/v1/time`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        }
        assert(body && typeof body.epoch_ms === 'number', 'time via Vite proxy', body);
        const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
        assert(html.includes('id="root"'), 'Vite serves index.html');
      } finally {
        try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ }
      }
    });
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

try {
  await main();
} catch (err) {
  if (!results.some((r) => !r.ok)) {
    console.log(`FAIL  setup after ${current ?? 'start'}\n      ${err.stack}`);
    results.push({ name: current, ok: false });
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed${failed ? ' — FAILED' : ''}`);
process.exit(failed ? 1 : 0);
