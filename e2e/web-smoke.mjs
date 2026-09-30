// Browser smoke test of the web panel against a REAL backend + Vite dev server + DevClient.
// Drives the UI like a user (Playwright/Chromium) and asserts visible results. See docs/E2E.md ("Web smoke test").
//
// Environment (defaults in brackets):
//   SMOKE_WEB [http://localhost:5190]   Vite dev server (proxying /api to the backend)
//   SMOKE_API [http://127.0.0.1:3310]   backend (only used by the DevClient)
//   SMOKE_DATA [e2e/.data/websmoke]     screenshots/, identities/
//   DOTNET_ROOT [/opt/dotnet]           .NET runtime for the DevClient apphost
//   DEVCLIENT [plugin/tools/ScpslTrust.DevClient/bin/Debug/net8.0/trust-devclient]
//   ADMIN_EMAIL / ADMIN_PASSWORD        the super admin created with `pnpm cli:create-admin` (2FA not yet enrolled)
//   PLAYWRIGHT_MODULE [playwright-core] module specifier or path of playwright(-core); browsers from PLAYWRIGHT_BROWSERS_PATH
//   SMOKE_HEADFUL=1                     show the browser
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = process.env.SMOKE_WEB ?? 'http://localhost:5190';
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:3310';
const DATA = process.env.SMOKE_DATA ?? path.join(ROOT, 'e2e', '.data', 'websmoke');
const SHOTS = path.join(DATA, 'screenshots');
const DEVCLIENT =
  process.env.DEVCLIENT ?? path.join(ROOT, 'plugin/tools/ScpslTrust.DevClient/bin/Debug/net8.0/trust-devclient');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@websmoke.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Correct-Horse-Battery-9';
const OTPAuth = createRequire(path.join(ROOT, 'backend', 'package.json'))('otpauth');

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_MODULE ?? 'playwright-core';
  const target = spec.startsWith('/') || spec.startsWith('.') ? pathToFileURL(path.resolve(spec)).href : spec;
  const mod = await import(target);
  return mod.chromium ?? mod.default.chromium;
}

// ------------------------------------------------------------------------------------ harness
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let currentPage = null;
function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n  ${err.stack ?? err}`);
    if (currentPage) {
      const file = path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png`);
      await currentPage.screenshot({ path: file, fullPage: true }).catch(() => {});
      const snap = await currentPage.locator('body').ariaSnapshot().catch(() => '');
      console.log(`  url: ${currentPage.url()}\n  screenshot: ${file}\n  aria snapshot:\n${snap.slice(0, 4000)}`);
    }
    throw err;
  }
}

const usedSteps = new Map();
/** TOTP code for a 30 s step not used before by this secret (the backend rejects step reuse). */
async function freshCode(totp) {
  const key = totp.secret.base32;
  for (;;) {
    const stepNo = Math.floor(Date.now() / 30000);
    const msLeft = 30000 - (Date.now() % 30000);
    if (usedSteps.get(key) !== stepNo && msLeft > 2500) {
      usedSteps.set(key, stepNo);
      return totp.generate();
    }
    await sleep(msLeft + 200);
  }
}

// ------------------------------------------------------------------------------------ DevClient
function parseDocs(text) {
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
const devEnv = { ...process.env, DOTNET_ROOT: process.env.DOTNET_ROOT ?? '/opt/dotnet', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
const idDir = (name) => path.join(DATA, 'identities', name);
async function dev(identity, args) {
  const argv = [...args, '--identity', identity, '--api', API];
  try {
    const { stdout } = await execFileP(DEVCLIENT, argv, { timeout: 60000, env: devEnv });
    const docs = parseDocs(stdout);
    return docs[docs.length - 1];
  } catch (err) {
    throw new Error(`devclient ${args.join(' ')} failed (exit ${err.code}): ${String(err.stderr ?? err).slice(0, 800)}`);
  }
}

// ------------------------------------------------------------------------------------ helpers
/** 1x1 PNG with a random pixel (unique hash per run). */
function tinyPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, ...Array.from({ length: 3 }, () => Math.floor(Math.random() * 256))]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
}

/** Screenshots of the current page at 1280 px and 390 px, light + dark. */
async function shoot(page, name) {
  const original = page.viewportSize();
  for (const [w, h] of [
    [1280, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      await sleep(150);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${w}-${theme}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `${name} at ${w}px has ${overflow}px horizontal overflow`);
    }
  }
  await setTheme(page, 'light');
  await page.setViewportSize(original);
}

async function expectText(page, text, timeout = 10000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

async function login(page, email, password, totp) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  if (totp) {
    await page.getByLabel('Authentication code').fill(await freshCode(totp));
    await page.getByRole('button', { name: /verify|continue|sign in/i }).first().click();
  }
}

async function logout(page) {
  await page.context().clearCookies();
}

// ------------------------------------------------------------------------------------ flow
const S = {};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(path.join(DATA, 'identities'), { recursive: true });
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: process.env.SMOKE_HEADFUL !== '1' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  const consoleErrors = [];
  page.on('console', (msg) => {
    // The initial GET /auth/session of a logged-out visitor answers 401 by design.
    if (msg.type() === 'error' && !/status of 401/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await step('login + forced 2FA enrolment', async () => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.waitForURL(/\/account\/security/);
      await page.getByRole('button', { name: /enable|set up/i }).first().click();
      const secret = (await page.getByText('Manual secret (Base32)').locator('..').locator('code, pre').first().innerText()).trim();
      assert(/^[A-Z2-7]{16,}$/.test(secret), `secret shown (${secret})`);
      S.adminTotp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' });
      await page.getByLabel('Confirmation code').fill(await freshCode(S.adminTotp));
      await page.getByRole('button', { name: /enable|confirm|verify/i }).first().click();
      await expectText(page, /recovery codes/i);
      await shoot(page, 'security');
    });

    await step('dashboard renders counts', async () => {
      await page.goto(`${WEB}/`);
      await page.getByRole('heading', { name: 'Dashboard', level: 1 }).waitFor();
      const name = page.locator('.user-menu-name');
      assert(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), 'username in the top bar is not truncated at 1280px');
      for (const label of ['Open cases', 'Pending reports', 'Evidence awaiting review', 'Whitelist requests']) await expectText(page, label);
      await shoot(page, 'dashboard-empty');
    });

    await step('create server: registration token shown once', async () => {
      await page.goto(`${WEB}/servers/new`);
      await page.getByLabel('Name').fill('Smoke Test Server');
      await page.getByLabel('Description (optional)').fill('Created by the web smoke test');
      await page.getByLabel('Accept whitelist requests from players').check();
      await page.getByRole('button', { name: 'Create server and get token' }).click();
      await page.getByRole('heading', { name: 'Server created' }).waitFor();
      const body = await page.locator('main').innerText();
      S.token = body.match(/sreg_[A-Za-z0-9_-]+/)?.[0];
      assert(S.token, 'registration token visible');
      await shoot(page, 'server-created');
      await page.getByLabel('I have saved this in a safe place').check();
      await page.getByRole('button', { name: 'Continue to the server' }).click();
      await page.waitForURL(/\/servers\/srv_/);
      S.serverId = page.url().match(/srv_[A-Za-z0-9]+/)[0];
      await page.getByRole('tablist', { name: 'Server sections' }).waitFor();
      assert(!(await page.locator('main').innerText()).includes(S.token), 'token not shown again on the detail page');
    });

    await step('register server with DevClient -> active/online in UI', async () => {
      const reg = await dev(idDir('srv1'), ['register', '--token', S.token, '--game-version', '14.1.3']);
      assert(reg?.status === 'active' || reg?.server?.status === 'active', `register result ${JSON.stringify(reg)}`);
      await dev(idDir('srv1'), ['heartbeat', '--players', '4']);
      await page.reload();
      await page.getByRole('tab', { name: 'Overview' }).click();
      await page.getByText('Active', { exact: true }).first().waitFor();
      await page.getByText('Online', { exact: true }).first().waitFor();
      await shoot(page, 'server-overview');
      await page.getByRole('tab', { name: 'Keys' }).click();
      await expectText(page, /fingerprint/i);
      await shoot(page, 'server-keys');
    });

    await step('policy editor: account age < 7 days -> kick, save, preview', async () => {
      await page.getByRole('tab', { name: 'Policy' }).click();
      const editor = page.getByRole('form', { name: 'Policy editor' });
      await editor.waitFor();
      const before = Number((await editor.innerText()).match(/\bv(\d+) ·/)[1]);
      const section = editor.locator('section#policy-section-account_age, section[aria-labelledby="policy-section-account_age"]');
      await section.getByRole('button', { name: 'Add rule' }).click();
      const rule = section.getByRole('group', { name: /^Rule \d+$/ }).last();
      await rule.getByLabel('Account younger than (days)').fill('7');
      await rule.getByLabel('Action').selectOption('kick');
      await rule.getByLabel('Message (optional)').fill('Account too new');
      await editor.getByRole('button', { name: `Save as version ${before + 1}` }).click();
      await expectText(page, `Policy saved as version ${before + 1}`);
      await page.getByRole('form', { name: 'Policy editor' }).getByText(`v${before + 1} ·`).waitFor();
      // Preview: a 3-day-old account is kicked (client-side and backend evaluation).
      await page.getByLabel('Account age (days)').fill('3');
      const decision = page.locator('.card', { has: page.getByText('Decision', { exact: true }) }).last();
      await decision.locator('.policy-decision-action').first().filter({ hasText: /kick/i }).waitFor();
      await decision.getByRole('button', { name: 'Evaluate on backend' }).click();
      await expectText(page, 'Backend and client agree.');
      await shoot(page, 'server-policy');
      const pol = await dev(idDir('srv1'), ['policy']).catch(() => null);
      if (pol) assert(JSON.stringify(pol).includes('kick'), 'DevClient sees the kick rule');
    });

    await step('server detail: whitelist + members tabs render', async () => {
      await page.getByRole('tab', { name: 'Whitelist & bypasses' }).click();
      await sleep(300);
      await page.getByRole('tab', { name: 'Members' }).click();
      await expectText(page, 'smoke_admin');
    });

    // A separate account reports and uploads evidence (reviewers may not review evidence they uploaded or cases they reported).
    const player = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ppage = await player.newPage();
    ppage.on('pageerror', (err) => consoleErrors.push(`pageerror(player): ${err.message}`));
    S.suspect = '76561198000' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    S.playerSteam = '76561198100' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

    await step('register second user (player) through the UI', async () => {
      currentPage = ppage;
      await ppage.goto(`${WEB}/register`);
      await ppage.getByLabel('Email').fill('player@websmoke.test');
      await ppage.getByLabel('Username').fill('smoke_player');
      await ppage.locator('input[autocomplete="new-password"]').first().fill('Quiet-Harbor-Lantern-7');
      await ppage.getByLabel('Confirm password').fill('Quiet-Harbor-Lantern-7');
      await ppage.getByRole('button', { name: /create account|register/i }).click();
      await ppage.getByRole('heading', { name: 'Account created' }).waitFor();
      await shoot(ppage, 'register-done');
      await login(ppage, 'player@websmoke.test', 'Quiet-Harbor-Lantern-7');
      await ppage.waitForURL((u) => !u.pathname.startsWith('/login'));
    });

    await step('create a report for a steam id from the UI', async () => {
      await ppage.goto(`${WEB}/reports/new`);
      await ppage.getByLabel('Identity type').selectOption('steam');
      await ppage.getByLabel('Player id').fill(S.suspect);
      await ppage.getByLabel('Reason (short)').fill('Aimbot on Surface');
      await ppage.getByLabel('Description (optional)').fill('Snapped to heads through walls for three rounds in a row.');
      await ppage.getByLabel(/Server id where it happened|Server where it happened/).fill(S.serverId);
      await shoot(ppage, 'report-new');
      await ppage.getByRole('button', { name: 'Submit report' }).click();
      await ppage.waitForURL(/\/reports\/[0-9a-f-]{36}/);
      await expectText(ppage, S.suspect);
      const caseLink = ppage.getByRole('link', { name: /CASE-\d{4}-\d+/ }).first();
      S.caseNo = (await caseLink.innerText()).match(/CASE-\d{4}-\d+/)[0];
      await shoot(ppage, 'report-detail');
    });

    await step('reporter: case page shows the public view only; uploads PNG evidence from the report page', async () => {
      S.reportUrl = ppage.url();
      await ppage.goto(`${WEB}/cases/${S.caseNo}`);
      await ppage.getByRole('heading', { name: S.caseNo, level: 1 }).waitFor();
      await expectText(ppage, 'public view');
      assert((await ppage.getByRole('tab', { name: /Evidence/ }).count()) === 0, 'no staff tabs for the reporter');
      await ppage.goto(S.reportUrl);
      await ppage.getByRole('button', { name: 'Add evidence' }).click();
      const dialog = ppage.getByRole('dialog');
      await dialog.getByLabel('File').setInputFiles({ name: 'aimbot.png', mimeType: 'image/png', buffer: tinyPng() });
      await dialog.getByLabel('Evidence type').selectOption({ index: 0 }).catch(() => {});
      const typeSel = dialog.getByLabel('Evidence type');
      const opts = await typeSel.locator('option').allInnerTexts();
      const shot = opts.find((o) => /screenshot|image/i.test(o));
      if (shot) await typeSel.selectOption({ label: shot });
      await dialog.getByLabel('Title').fill('Screenshot of the aimbot');
      await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
      await dialog.getByText(/sha-?256|uploaded/i).first().waitFor({ timeout: 20000 });
      await shoot(ppage, 'evidence-uploaded');
      await dialog.getByRole('button').filter({ hasText: /done|close/i }).first().click();
      await ppage.getByText('Evidence attached').locator('xpath=following-sibling::*[1]').filter({ hasText: '1' }).waitFor();
    });
    await step('admin: case page renders all tabs; start review', async () => {
      currentPage = page;
      await page.goto(`${WEB}/cases/${S.caseNo}`);
      await page.getByRole('heading', { name: S.caseNo, level: 1 }).waitFor();
      for (const tab of ['Reports', 'Evidence', 'Review history', 'Appeals', 'Server confirmations', 'Audit history']) {
        await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
        await page.getByRole('tabpanel').first().waitFor();
      }
      await page.getByRole('tab', { name: /^Reports/ }).click();
      await expectText(page, 'Aimbot on Surface');
      await page.getByRole('button', { name: 'Start review' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Comment').fill('Starting the review of the uploaded screenshot.');
      await dlg.locator('button[type=submit]').click();
      await dlg.waitFor({ state: 'hidden' });
      await page.getByText('Under review', { exact: true }).first().waitFor();
      await shoot(page, 'case-detail');
    });

    await step('admin reviews the evidence (three assessments)', async () => {
      await page.getByRole('tab', { name: /^Evidence/ }).click();
      await page.getByRole('link', { name: 'Screenshot of the aimbot' }).click();
      await page.waitForURL(/\/evidence\//);
      const form = page.getByRole('form', { name: 'Review evidence' });
      await form.waitFor();
      for (const sel of await form.locator('select').all()) await sel.selectOption('verified');
      await form.getByLabel('Review comment').fill('Crosshair locks through the wall; metadata consistent with the round.');
      await form.getByRole('button', { name: 'Record review' }).click();
      await page.getByText(/review (recorded|saved)/i).first().waitFor();
      await shoot(page, 'evidence-detail');
    });

    await step('admin sets verdict confirmed', async () => {
      await page.goto(`${WEB}/cases/${S.caseNo}`);
      await page.getByRole('button', { name: /Set verdict/ }).first().click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Verdict').selectOption('confirmed');
      await dlg.getByLabel('Review comment (internal)').fill('Confirmed by the verified screenshot evidence.');
      await dlg.getByLabel('Public summary (optional)').fill('Aimbot confirmed');
      for (const cb of await dlg.locator('input[type=checkbox]').all()) await cb.check();
      await dlg.getByRole('button', { name: 'Set verdict' }).click();
      await dlg.waitFor({ state: 'hidden' });
      await page.getByText('Confirmed', { exact: true }).first().waitFor();
      await shoot(page, 'case-confirmed');
    });

    await step('public case page (logged out) shows limited info only', async () => {
      const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const apage = await anon.newPage();
      currentPage = apage;
      await apage.goto(`${WEB}/public/cases/${S.caseNo}`);
      await apage.getByText(S.caseNo).first().waitFor();
      await expectText(apage, 'Aimbot confirmed');
      const text = await apage.locator('body').innerText();
      for (const secret of ['Aimbot on Surface', 'Snapped to heads', 'Screenshot of the aimbot', 'smoke_player', 'Confirmed by the verified screenshot']) {
        assert(!text.includes(secret), `public page must not show "${secret}"`);
      }
      await shoot(apage, 'public-case');
      await anon.close();
      currentPage = page;
    });

    await step('player links the in-game account via DevClient link with the code from the profile page', async () => {
      currentPage = ppage;
      await ppage.goto(`${WEB}/account`);
      await ppage.getByRole('button', { name: 'Link in-game account' }).click();
      const cmd = await ppage.getByText(/\.trustlink \S+/).first().innerText();
      const code = cmd.match(/\.trustlink (\S+)/)[1];
      await shoot(ppage, 'profile-link-code');
      await dev(idDir('srv1'), ['link', '--player', `${S.playerSteam}@steam`, '--code', code]);
      await ppage.getByRole('button', { name: /check status/ }).click();
      await expectText(ppage, S.playerSteam);
      await shoot(ppage, 'profile-linked');
    });

    await step('player requests a VPN whitelist', async () => {
      await ppage.goto(`${WEB}/whitelist-requests?server_id=${S.serverId}`);
      const form = ppage.getByRole('form', { name: 'Request whitelist' });
      await form.waitFor();
      const sid = form.getByLabel('Server id');
      if ((await sid.inputValue()) !== S.serverId) await sid.fill(S.serverId);
      await form.getByLabel('Type').selectOption('vpn_whitelist');
      await form.getByLabel('Reason').fill('My ISP routes everything through a carrier-grade NAT that looks like a VPN.');
      await form.getByRole('button', { name: 'Submit request' }).click();
      await ppage.getByRole('cell', { name: 'Pending', exact: true }).first().waitFor();
      await shoot(ppage, 'whitelist-player');
    });

    await step('owner approves the whitelist request; plugin sees the bypass', async () => {
      currentPage = page;
      await page.goto(`${WEB}/whitelist-requests?status=pending`);
      await page.getByRole('button', { name: 'Approve' }).first().click();
      const dlg = page.getByRole('dialog');
      await dlg.getByRole('button', { name: 'Approve' }).click();
      await dlg.waitFor({ state: 'hidden' });
      await page.goto(`${WEB}/whitelist-requests?status=approved`);
      await page.getByRole('cell', { name: 'Approved', exact: true }).first().waitFor();
      await shoot(page, 'whitelist-owner');
      const b = await dev(idDir('srv1'), ['bypass', '--player', `${S.playerSteam}@steam`, '--types', 'vpn_whitelist']);
      assert(b?.bypass === true, `bypass after approval ${JSON.stringify(b)}`);
    });

    await step('admin users page, audit log, verify chain', async () => {
      await page.goto(`${WEB}/admin/users`);
      await expectText(page, 'smoke_player');
      await shoot(page, 'admin-users');
      await page.goto(`${WEB}/admin/audit`);
      await page.getByRole('heading', { name: 'Audit log', level: 1 }).waitFor();
      await page.getByRole('button', { name: 'Verify hash chain' }).click();
      await expectText(page, 'Hash chain intact');
      await shoot(page, 'admin-audit');
    });

    await step('proof page: code from a DevClient overwatch session is valid', async () => {
      const spectator = '76561198200000001@steam';
      const child = spawn(
        DEVCLIENT,
        ['overwatch', '--target', `${S.suspect}@steam`, '--spectator', spectator, '--seconds', '12', '--identity', idDir('srv1'), '--api', API],
        { env: devEnv },
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      const exited = new Promise((resolve) => child.on('close', resolve));
      let codeDoc = null;
      let started = null;
      for (let i = 0; i < 150 && !codeDoc; i++) {
        await sleep(100);
        const docs = parseDocs(out);
        started = docs.find((d) => d.event === 'session_started') ?? started;
        codeDoc = docs.find((d) => d.event === 'proof_code') ?? null;
      }
      assert(codeDoc && started, `proof code printed (stderr: ${err.slice(0, 400)})`);
      const ts = Math.max(Date.parse(started.started_at), Date.now() - 200);
      const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const apage = await anon.newPage();
      currentPage = apage;
      await apage.goto(`${WEB}/tools/proof`);
      const form = apage.getByRole('form', { name: 'Verify proof' });
      await form.getByLabel('Server id').fill(S.serverId);
      await form.getByLabel('Target player user id').fill(`${S.suspect}@steam`);
      await form.getByLabel('Spectator user id').fill(spectator);
      await form.getByLabel('Unix milliseconds').fill(String(ts));
      await form.getByLabel('Proof code').fill(codeDoc.code);
      await form.getByRole('button', { name: /verify/i }).click();
      await expectText(apage, 'Valid proof');
      await shoot(apage, 'proof-valid');
      await anon.close();
      currentPage = page;
      await exited;
    });

    await step('dashboard + mobile navigation', async () => {
      await page.goto(`${WEB}/`);
      await page.getByRole('heading', { name: 'Dashboard', level: 1 }).waitFor();
      await shoot(page, 'dashboard');
      await page.setViewportSize({ width: 390, height: 844 });
      const toggle = page.getByRole('button', { name: 'Open navigation' });
      await toggle.click();
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Audit log' }).waitFor({ state: 'visible' });
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await sleep(150);
        await page.screenshot({ path: path.join(SHOTS, `mobile-nav-390-${theme}.png`) });
      }
      await setTheme(page, 'light');
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Audit log' }).click();
      await page.getByRole('heading', { name: 'Audit log', level: 1 }).waitFor();
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    for (const [name, url] of [
      ['cases-list', '/cases'],
      ['servers-list', '/servers'],
      ['reports-list', '/reports'],
      ['evidence-list', '/evidence'],
    ]) {
      await step(`screenshots: ${name}`, async () => {
        await page.goto(`${WEB}${url}`);
        await page.locator('main h1').first().waitFor();
        await page.waitForLoadState('networkidle');
        await shoot(page, name);
      });
    }
    await step('server policy tab screenshots', async () => {
      await page.goto(`${WEB}/servers/${S.serverId}`);
      await page.getByRole('tab', { name: 'Policy' }).click();
      await page.getByRole('form', { name: 'Policy editor' }).waitFor();
      await shoot(page, 'server-policy-final');
    });
  } finally {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} steps passed`);
    if (consoleErrors.length) console.log(`browser console errors:\n  ${consoleErrors.slice(0, 20).join('\n  ')}`);
    await browser.close();
  }
  if (results.some((r) => !r.ok) || consoleErrors.length) process.exitCode = 1;
}

main().catch(() => {
  process.exitCode = 1;
});
