// Mehrspieler-UI: Abläufe + Bildschirmfotos (ein Browser, mehrere Kontexte, lokales Relay).
import { chromium, BASE, GL_ARGS } from '/home/user/websiteeine-website/tools/pw.mjs';

const RELAY = 'ws://127.0.0.1:7777';
const OUT = '/home/user/websiteeine-website/tools/out/';
const PHASE = process.argv[2] || 'all';
const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
let fail = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHL ') + text); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' };
const PORTRAIT = { ...PHONE, viewport: { width: 390, height: 844 } };

async function openGame(opts, name) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('nullpunkt:fullscreenGuide', '1'); } catch { /* */ } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') }).catch(() => {});
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] Seitenfehler:`, e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] Konsole:`, m.text().slice(0, 300)); });
  await p.goto(`${BASE}spielen.html?relays=${RELAY}&debug=1`);
  await p.waitForFunction(() => window.__game && window.__game.menus && document.querySelector('.m-lobby'), null, { timeout: 90000 });
  await p.evaluate(async (nm) => {
    const G = window.__game;
    G.settings.set('playerName', nm);
    if (!G.net) { const m = await import('/assets/js/game/net/index.js'); G.net = new m.NetSystem(G); window.__fakeNet = false; }
  }, name);
  p.ctx = ctx;
  return p;
}
const shot = (p, f) => sleep(450).then(() => p.screenshot({ path: OUT + f, timeout: 240000 })).then(() => console.log('Bild', f));
const tabOnline = async (p) => { await p.click('.lb-tabs [data-tab="online"]'); await p.waitForSelector('.nm'); };
const roomCode = (p) => p.evaluate(() => window.__game.net.room && window.__game.net.room.code);
const noOverflow = (p) => p.evaluate(() => {
  const r = [];
  const root = document.querySelector('#menu-root .m-screen');
  if (!root) return ['kein Bildschirm'];
  if (document.documentElement.scrollWidth > innerWidth + 1) r.push('Seite breiter als Fenster');
  for (const n of root.querySelectorAll('*')) {
    const b = n.getBoundingClientRect();
    if (b.width && (b.right > innerWidth + 1 || b.left < -1) && !n.closest('.m-scroll-x') && getComputedStyle(n).visibility !== 'hidden' && n.offsetParent) r.push(`${n.className || n.tagName} ${Math.round(b.left)}..${Math.round(b.right)}`);
  }
  return r.slice(0, 6);
});

/** Unechte Mitspieler ins Roster (nur Anzeige) – ids ab 20. */
const FAKE = [
  { name: 'Kalle', team: 'B', level: 23, ping: 41, cls: 'sturm' },
  { name: 'Mira', team: 'A', level: 7, ping: 118, cls: 'sanitaeter' },
  { name: 'Ostwind_99', team: 'B', level: 41, ping: 212, cls: 'aufklaerer' },
  { name: 'Lotte', team: 'A', level: 3, ping: 64, cls: 'pionier' },
  { name: 'Brummbär', team: 'B', level: 15, ping: 0, cls: 'sturm' },
];
const addFakes = (p, n) => p.evaluate(([list, n]) => {
  const G = window.__game;
  list.slice(0, n).forEach((f, i) => G.net.roster.push({ id: 20 + i, isHost: false, isBot: false, ready: false, loadout: null, kd: 1, ...f }));
  G.events.emit('net:roster', { roster: G.net.roster });
}, [FAKE, n]);

try {
  // ============================================================== Phase A: Lobby + Raum
  if (PHASE !== 'P') {
  const host = await openGame(DESK, 'Hosti');
  if (PHASE === 'B') {
    await tabOnline(host);
    await host.click('.lb-start[data-act="net-host"]');
    await host.waitForSelector('.m-room', { timeout: 20000 });
  } else {
  // Offline-Lobby unverändert: drei alte Reiter + Einsatz starten
  const off = await host.evaluate(() => ({ tabs: [...document.querySelectorAll('.lb-tabs .m-tab')].map((t) => t.dataset.tab), act: document.querySelector('.lb-start').dataset.act, label: document.querySelector('.lb-start').textContent.trim() }));
  check(off.tabs.join(',') === 'deploy,loadout,progress,online' && off.act === 'start' && /Einsatz starten/.test(off.label), `Lobby offline: Reiter ${off.tabs} · ${off.label}`);
  await tabOnline(host);
  await sleep(1500);
  const lob = await host.evaluate(() => ({ act: document.querySelector('.lb-start').dataset.act, label: document.querySelector('.lb-start').textContent.trim(), list: document.querySelector('[data-net-list]').textContent.trim().slice(0, 80) }));
  check(lob.act === 'net-host' && /Raum erstellen/.test(lob.label), `Mehrspieler-Reiter: Fußknopf ${lob.label}`);
  console.log('   Liste:', lob.list);
  await shot(host, 'mp-ui-lobby-desktop.png');
  check((await noOverflow(host)).length === 0, `Lobby desktop ohne Überlauf ${JSON.stringify(await noOverflow(host))}`);
  // Zurück auf „Einsatz“: wieder „Einsatz starten“
  await host.click('.lb-tabs [data-tab="deploy"]');
  check(await host.evaluate(() => document.querySelector('.lb-start').dataset.act === 'start'), 'Reiter Einsatz: Fußknopf wieder „Einsatz starten“');
  await tabOnline(host);

  // Raum erstellen
  await host.click('.lb-start[data-act="net-host"]');
  await host.waitForSelector('.m-room', { timeout: 20000 });
  const code = await roomCode(host);
  check(/^[A-HJ-NP-Z2-9]{6}$/.test(code || ''), `Raum eröffnet: ${code}`);
  check(await host.evaluate(() => document.querySelector('[data-room-code]').textContent) === code, 'Code groß im Raum');

  // Telefon tritt per Code bei
  const phone = await openGame(PHONE, 'Handy');
  await tabOnline(phone);
  await phone.fill('[data-net-code]', code.toLowerCase());
  await phone.click('[data-net="join"]');
  const st1 = await phone.evaluate(() => document.querySelector('[data-net-join]').textContent);
  check(/Suche Host|Verbinde/.test(st1), `Fortschritt: ${st1.trim()}`);
  await phone.waitForSelector('.m-room', { timeout: 30000 });
  check(true, 'Telefon im Raum (Client)');

  // Desktop-Client über eingefügten Link
  const anna = await openGame(DESK, 'Anna');
  await tabOnline(anna);
  await anna.fill('[data-net-code]', `${BASE}spielen.html?raum=${code}`);
  const parsed = await anna.evaluate(() => [document.querySelector('[data-net-code]').value, document.querySelector('[data-net-join]').textContent.trim()]);
  check(parsed[0] === code, `Link eingefügt → Code ${parsed[0]} (${parsed[1]})`);
  await anna.press('[data-net-code]', 'Enter');
  await anna.waitForSelector('.m-room', { timeout: 30000 });
  await host.waitForFunction(() => window.__game.net.roster.length === 3, null, { timeout: 10000 });
  check(true, 'Anna per Link + Enter im Raum');
  await sleep(800);
  const toast = await host.evaluate(() => [...document.querySelectorAll('.nt-item')].map((n) => n.textContent));
  check(toast.some((t) => /beigetreten/.test(t)), `Hinweis beim Host: ${toast.join(' | ')}`);

  // Host: Einstellungen ändern → Clients sehen sie
  await host.click('[data-set="mode"][data-v="dom"]');
  await host.click('[data-set="difficulty"][data-v="veteran"]');
  await host.click('[data-step="maxPlayers"][data-d="1"]');
  for (let i = 0; i < 3; i++) await host.click('[data-step="maxPlayers"][data-d="1"]');
  await anna.waitForFunction(() => window.__game.net.room.settings.mode === 'dom', null, { timeout: 5000 });
  const ro = await anna.evaluate(() => document.querySelector('.nr-ro').textContent);
  check(/Herrschaft/.test(ro) && /Veteran/.test(ro) && /12/.test(ro), 'Client sieht Einstellungen des Hosts (Herrschaft, Veteran, 12)');
  const focusKept = await host.evaluate(() => document.activeElement && document.activeElement.dataset.fk);
  check(focusKept === 'maxPlayers-p', `Fokus bleibt nach Neuzeichnen (${focusKept})`);
  // Gesperrter Modus
  await host.click('[data-set="mode"][data-v="cq"]', { force: true });
  const locked = await host.evaluate(() => [window.__game.net.room.settings.mode, document.querySelector('[data-room-modehint]').textContent]);
  check(locked[0] === 'dom' && /Stufe 2/.test(locked[1]), `Eroberung gesperrt: ${locked[1].slice(0, 60)}`);
  const warn = await host.evaluate(() => document.querySelector('[data-room-rec]').textContent);
  check(/Empfehlung: bis \d+ Spieler/.test(warn) && /empfohlen|Empfehlung:/.test(warn), `Empfehlung: ${warn.trim().slice(0, 120)}`);
  check(await host.evaluate(() => !!document.querySelector('[data-room-rec] .lb-warn')), 'Warnung über der Empfehlung');

  // Fake-Roster: insgesamt 6 Spieler
  await addFakes(host, 3);
  await sleep(300);
  await shot(host, 'mp-ui-room-host-desktop.png');
  check((await noOverflow(host)).length === 0, `Raum Host desktop ohne Überlauf ${JSON.stringify(await noOverflow(host))}`);
  await host.click('[data-act="kick"][data-id="20"]');
  check(await host.evaluate(() => !!document.querySelector('[data-act="kick-yes"][data-id="20"]')), 'Entfernen fragt nach');
  await shot(host, 'mp-ui-room-host-kick-desktop.png');
  await host.keyboard.press('Escape');
  check(await host.evaluate(() => !document.querySelector('[data-act="kick-yes"]') && document.querySelector('.m-room')), 'Esc schließt Rückfrage, Raum bleibt');
  // Fakes wieder raus
  await host.evaluate(() => { const G = window.__game; G.net.roster = G.net.roster.filter((r) => r.id < 20); G.events.emit('net:roster', { roster: G.net.roster }); });

  // Teamwechsel echt (Anna)
  const annaId = await anna.evaluate(() => window.__game.net.selfId);
  const t0 = await anna.evaluate(() => window.__game.net.roster.find((r) => r.id === window.__game.net.selfId).team);
  await host.click(`[data-act="team"][data-id="${annaId}"]`);
  await anna.waitForFunction((t) => window.__game.net.roster.find((r) => r.id === window.__game.net.selfId).team !== t, t0, { timeout: 5000 });
  check(true, `Team gewechselt (${t0} → anders)`);
  await addFakes(anna, 0);
  await shot(anna, 'mp-ui-room-client-desktop.png');
  check((await noOverflow(anna)).length === 0, `Raum Client desktop ohne Überlauf ${JSON.stringify(await noOverflow(anna))}`);
  await shot(phone, 'mp-ui-room-client-phone.png');
  check((await noOverflow(phone)).length === 0, `Raum Client Telefon ohne Überlauf ${JSON.stringify(await noOverflow(phone))}`);

  // Link kopieren
  await host.click('[data-act="copy-link"]');
  await sleep(300);
  const copied = await host.evaluate(() => document.querySelector('[data-act="copy-link"]').textContent.trim());
  const clip = await host.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/Kopiert/.test(copied) && clip.includes(`raum=${code}`) && /^http/.test(clip), `Link kopiert: ${clip}`);

  // Kick (echt): Anna fliegt raus → Lobby mit Hinweis
  await host.click(`[data-act="kick"][data-id="${annaId}"]`);
  await host.click(`[data-act="kick-yes"][data-id="${annaId}"]`);
  await anna.waitForSelector('.m-lobby .nm-alert', { timeout: 10000 });
  const kn = await anna.evaluate(() => document.querySelector('.nm-alert').textContent);
  check(/entfernt/.test(kn), `Gekickt: ${kn.trim()}`);
  await shot(anna, 'mp-ui-kicked-desktop.png');
  // Gekickt: erneuter Beitritt abgelehnt
  await anna.evaluate(() => { window.__game.net.joinTimeout = 6000; });
  await anna.fill('[data-net-code]', code);
  await anna.click('[data-net="join"]');
  await anna.waitForFunction(() => /entfernt/.test(document.querySelector('[data-net-join]').textContent), null, { timeout: 20000 }).catch(() => {});
  check(/entfernt/.test(await anna.evaluate(() => document.querySelector('[data-net-join]').textContent)), 'Erneuter Beitritt: „Der Host hat dich … entfernt“');

  // Join-Fehler: unbekannter Code
  await anna.evaluate(() => { window.__game.net.joinTimeout = 2500; });
  await anna.fill('[data-net-code]', 'O0I1');
  const bad = await anna.evaluate(() => document.querySelector('[data-net-join]').textContent);
  check(/kein I, O, 0 und 1/.test(bad), 'Ungültige Zeichen erklärt');
  await anna.fill('[data-net-code]', 'ZZZZZZ');
  await anna.click('[data-net="join"]');
  await anna.waitForFunction(() => document.querySelector('[data-net-join]').classList.contains('is-error'), null, { timeout: 15000 });
  const jerr = await anna.evaluate(() => document.querySelector('[data-net-join]').textContent.trim());
  check(/Kein Raum mit diesem Code/.test(jerr), `Fehler: ${jerr}`);
  await shot(anna, 'mp-ui-join-error-desktop.png');
  await anna.ctx.close();

  // Telefon: Raum verlassen → Lobby, Fehlerzustand, eigener Raum
  await phone.click('[data-act="leave"]');
  await phone.waitForSelector('.m-lobby .nm');
  await sleep(1200);
  await shot(phone, 'mp-ui-lobby-phone.png');
  check((await noOverflow(phone)).length === 0, `Lobby Telefon ohne Überlauf ${JSON.stringify(await noOverflow(phone))}`);
  await phone.evaluate(() => { window.__game.net.joinTimeout = 2500; });
  await phone.fill('[data-net-code]', 'ZZZZZZ');
  await phone.click('[data-net="join"]');
  await phone.waitForFunction(() => document.querySelector('[data-net-join]').classList.contains('is-error'), null, { timeout: 15000 });
  await phone.evaluate(() => document.querySelector('[data-net-join]').scrollIntoView({ block: 'center' }));
  await shot(phone, 'mp-ui-join-error-phone.png');
  // Schnell spielen: der Host-Raum ist privat → nichts gefunden, Angebot eigenes Spiel
  await phone.click('[data-net="quick"]');
  await phone.waitForSelector('[data-net="host-public"]', { timeout: 20000 });
  check(true, 'Schnell spielen ohne öffentliches Spiel → „Eigenes öffentliches Spiel eröffnen“');
  // Host macht seinen Raum öffentlich → erscheint in der Liste des Telefons
  await host.click('[data-toggle="public"]');
  await phone.waitForFunction((c) => !!document.querySelector(`[data-net-join="${c}"]`), code, { timeout: 20000 }).catch(() => {});
  check(await phone.evaluate((c) => !!document.querySelector(`[data-net-join="${c}"]`), code), 'Öffentlicher Raum erscheint in der Liste');
  await phone.evaluate(() => document.querySelector('[data-net-list]').scrollIntoView({ block: 'center' }));
  await shot(phone, 'mp-ui-lobby-public-phone.png');
  await shot(host, 'mp-ui-room-host-public-desktop.png');
  // Schnell spielen findet jetzt den öffentlichen Raum und tritt bei
  await phone.click('[data-net="quick"]');
  await phone.waitForSelector('.m-room', { timeout: 30000 });
  check(await phone.evaluate((c) => window.__game.net.room.code === c, code), 'Schnell spielen tritt dem öffentlichen Raum bei');
  await phone.click('[data-act="leave"]');
  await phone.waitForSelector('.m-lobby .nm');
  await host.evaluate(() => { const G = window.__game; G.net.updateSettings({ public: false }); });
  // Telefon: eigener Raum mit 6 Spielern
  await phone.click('.lb-start[data-act="net-host"]');
  await phone.waitForSelector('.m-room', { timeout: 20000 });
  await addFakes(phone, 5);
  await sleep(300);
  await shot(phone, 'mp-ui-room-host-phone.png');
  check((await noOverflow(phone)).length === 0, `Raum Host Telefon ohne Überlauf ${JSON.stringify(await noOverflow(phone))}`);
  await phone.evaluate(() => document.querySelector('.nr-body').scrollTo(0, 9999));
  await shot(phone, 'mp-ui-room-host-phone-scrolled.png');
  await phone.evaluate(() => { const G = window.__game; G.net.roster = G.net.roster.filter((r) => r.id < 20); G.events.emit('net:roster', { roster: G.net.roster }); });
  await phone.click('[data-act="leave"]');
  await phone.waitForSelector('.m-lobby');
  check(await phone.evaluate(() => !window.__game.net.online), 'Telefon: Raum geschlossen');
  await phone.ctx.close();

  // Hochformat (Telefon): Drehen-Hinweis; Deep-Link openJoin(code) tritt direkt bei
  const port = await openGame(PORTRAIT, 'Hoch');
  await port.evaluate((c) => window.__game.menus.openJoin(c), code);
  await port.waitForSelector('.m-room', { timeout: 30000 });
  check(true, 'openJoin(code): Deep-Link tritt direkt bei');
  await shot(port, 'mp-ui-room-portrait-phone.png');
  await port.click('[data-act="leave"]', { force: true }).catch(() => port.evaluate(() => window.__game.menus.net.leaveRoom()));
  await port.ctx.close();
  // Tablet hochkant (Menüs bedienbar): Lobby + Raum als Client
  const tab = await openGame({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true }, 'Tablet');
  await tabOnline(tab);
  await shot(tab, 'mp-ui-lobby-tablet.png');
  check((await noOverflow(tab)).length === 0, `Lobby Tablet ohne Überlauf ${JSON.stringify(await noOverflow(tab))}`);
  await tab.fill('[data-net-code]', code);
  await tab.click('[data-net="join"]');
  await tab.waitForSelector('.m-room', { timeout: 30000 });
  await shot(tab, 'mp-ui-room-client-tablet.png');
  check((await noOverflow(tab)).length === 0, `Raum Tablet ohne Überlauf ${JSON.stringify(await noOverflow(tab))}`);
  // Ausrüstung im Raum + Esc zurück
  await tab.click('[data-act="room-equip"]');
  await tab.waitForSelector('[data-screen="roomequip"] .lp-cls');
  await tab.keyboard.press('Escape');
  await tab.waitForSelector('.m-room');
  check(true, 'Ausrüstung im Raum, Esc zurück in den Raum');
  // Host schließt den Raum nicht – Client verlässt per Esc (ohne Rückfrage)
  await tab.keyboard.press('Escape');
  await tab.waitForSelector('.m-lobby');
  check(await tab.evaluate(() => !window.__game.net.online), 'Client: Esc im Raum = verlassen');
  await tab.ctx.close();

  }
  if (PHASE === 'A') { await host.ctx.close(); throw Object.assign(new Error('nur Phase A'), { onlyA: true }); }
  // ============================================================== Phase B: Match (Host desktop)
  await host.evaluate(() => window.__game.debugApi.setQuality('low'));
  await host.click('[data-act="room-start"]');
  await host.waitForFunction(() => window.__game.match.state === 'playing' || window.__game.match.state === 'countdown', null, { timeout: 400000 });
  await sleep(4000);
  // Drei Bots als Menschen mit Ping ausgeben (Puppen), Roster passend
  await host.evaluate(() => {
    const G = window.__game;
    const bots = G.actors.filter((a) => a.isBot);
    const pick = [bots.find((b) => b.team === 'A'), ...bots.filter((b) => b.team === 'B').slice(0, 2)].filter(Boolean);
    G.player.netId = 1;
    pick.forEach((b, i) => { b.netId = 2 + i; b.isRemoteHuman = true; });
    const pings = [37, 96, 188];
    G.net.roster = [G.net.roster[0], ...pick.map((b, i) => ({ id: 2 + i, name: b.name, team: b.team, isHost: false, isBot: false, level: 10 + i, ping: pings[i], ready: true, cls: 'sturm', loadout: null, kd: 1 }))];
    G.events.emit('net:roster', { roster: G.net.roster });
    try { G.renderer.setResolutionScale(0.4); } catch { /* */ }
    const orig = G.input.down.bind(G.input);
    G.input.down = (a) => (a === 'scoreboard' ? window.__board !== false : orig(a));
    window.__board = true;
  });
  await host.waitForSelector('.h-board:not([hidden]) th.sb-ping', { timeout: 120000 });
  await host.waitForFunction(() => document.querySelectorAll('.h-board tr:not(.is-me) .sb-human').length >= 3, null, { timeout: 120000 }).catch(() => {});
  const sb = await host.evaluate(() => ({ ping: !!document.querySelector('.h-board th.sb-ping'), humans: document.querySelectorAll('.h-board tr:not(.is-me) .sb-human').length, host: document.querySelectorAll('.h-board .sb-host').length, cells: [...document.querySelectorAll('.h-board td.sb-ping')].map((t) => t.textContent).join(' ') }));
  check(sb.ping && sb.humans === 3 && sb.host === 1, `Punktetabelle: Ping-Spalte, ${sb.humans} Mitspieler, Host-Abzeichen · ${sb.cells}`);
  await shot(host, 'mp-ui-scoreboard-desktop.png');
  await host.evaluate(() => { window.__board = false; });
  await host.evaluate(() => window.__game.debugApi.pause());
  await host.waitForSelector('.m-pause');
  const ps = await host.evaluate(() => ({ online: !!document.querySelector('.ps-online'), list: document.querySelectorAll('.ps-np').length, restart: !!document.querySelector('[data-act="restart"]') }));
  check(ps.online && ps.list === 4 && !ps.restart, `Pause online: Hinweis, ${ps.list} Spieler, kein „Neu starten“`);
  await host.click('.ps-np [data-pk="ask"]');
  await shot(host, 'mp-ui-pause-desktop.png');
  // Hinweis im Match
  await host.evaluate(() => window.__game.events.emit('net:peer', { id: 9, name: 'Zaungast', joined: true }));
  await host.evaluate(() => window.__game.debugApi.resume());
  await sleep(500);
  await shot(host, 'mp-ui-toast-ingame-desktop.png');
  // Offline-Tabelle unverändert (keine Ping-Spalte ohne Sitzung)
  const offRows = await host.evaluate(async () => {
    const m = await import('/assets/js/game/ui/scoreboard.js');
    const G = window.__game;
    const online = G.net.online;
    G.net.online = false;
    const html = m.scoreboardHtml(m.liveRows(G.mode), { teams: true, playerTeam: 'A' });
    G.net.online = online;
    return /sb-ping/.test(html);
  });
  check(!offRows, 'Offline: keine Ping-Spalte');
  await host.ctx.close();
  }

  // Telefon: Match als Host → Tabelle + Pause
  const ph2 = await openGame(PHONE, 'Handy');
  await tabOnline(ph2);
  await ph2.click('.lb-start[data-act="net-host"]');
  await ph2.waitForSelector('.m-room', { timeout: 20000 });
  await ph2.evaluate(() => window.__game.debugApi.setQuality('low'));
  await ph2.click('[data-act="room-start"]');
  await ph2.waitForFunction(() => window.__game.match.state === 'playing' || window.__game.match.state === 'countdown', null, { timeout: 400000 });
  await sleep(4000);
  await ph2.evaluate(() => {
    const G = window.__game;
    const bots = G.actors.filter((a) => a.isBot);
    const pick = [bots.find((b) => b.team === 'A'), ...bots.filter((b) => b.team === 'B').slice(0, 2)].filter(Boolean);
    G.player.netId = 1;
    pick.forEach((b, i) => { b.netId = 2 + i; b.isRemoteHuman = true; });
    G.net.roster = [G.net.roster[0], ...pick.map((b, i) => ({ id: 2 + i, name: b.name, team: b.team, isHost: false, isBot: false, level: 10 + i, ping: [37, 96, 188][i], ready: true, cls: 'sturm', loadout: null, kd: 1 }))];
    G.events.emit('net:roster', { roster: G.net.roster });
    try { G.renderer.setResolutionScale(0.4); } catch { /* */ }
    const orig = G.input.down.bind(G.input);
    G.input.down = (a) => (a === 'scoreboard' ? window.__board !== false : orig(a));
    window.__board = true;
  });
  await ph2.waitForSelector('.h-board:not([hidden]) th.sb-ping', { timeout: 120000 });
  await ph2.waitForFunction(() => document.querySelectorAll('.h-board tr:not(.is-me) .sb-human').length >= 3, null, { timeout: 120000 }).catch(() => {});
  await shot(ph2, 'mp-ui-scoreboard-phone.png');
  await ph2.evaluate(() => { window.__board = false; window.__game.debugApi.pause(); });
  await ph2.waitForSelector('.m-pause');
  await shot(ph2, 'mp-ui-pause-phone.png');
  check((await noOverflow(ph2)).length === 0, `Pause Telefon ohne Überlauf ${JSON.stringify(await noOverflow(ph2))}`);
  await ph2.ctx.close();
} catch (err) {
  if (!err.onlyA) { console.error('Abbruch:', err); fail++; }
} finally {
  await browser.close();
}
console.log(fail ? `${fail} Fehler` : 'alles ok');
process.exit(fail ? 1 : 0);
