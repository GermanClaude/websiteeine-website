// NULLPUNKT – Panzerbreschen online (Nutzer 21.10.): Host + Anna (von Anfang an) + Bert (tritt dem laufenden Match bei)
// über das lokale Nostr-Relay, Fahrzeuge an, keine Bots. Standard Hafen (Bürohaus; der Test setzt seinen Panzer selbst),
// --map=grenzland (Dorf) braucht ≈ 5 GB je Seite. Der Host schießt SG und PG auf Hauswände und lässt einen
// Panzer rammen (Körperphysik in festen Schritten, gesetzte Geschwindigkeit); er entscheidet jede Bresche und verteilt
// sie vollständig ('ev' br). Geprüft wird:
//   1. Anna bekommt jede Bresche mit derselben Id, Mitte, Normale, Dicke, Zufallswert und demselben Umriss (≤ 1 mm).
//   2. Bei Anna geht ein Kugelstrahl durch die Rammbresche, ihr Spieler läuft hindurch (gleicher Durchgang wie beim
//      Host). Zufall der Bruchformen beim Host mit fester Saat (wiederholbar); Zielhöhen über dem Boden VOR der Wand
//      (groundHeight von 40 m abwärts träfe an der Wand das Dach).
//   3. Bert tritt später bei (Anna ist dann gegangen – Last) und bekommt alle Breschen nachgereicht (breachState, ohne
//      Effekte) – ebenfalls identisch.
//   4. keine Seitenfehler.
// Voraussetzung: Server (NP_BASE) und node tools/nostr-relay.mjs <port> (NP_RELAY, Standard ws://127.0.0.1:7777).
// Aufruf: node tools/tank-breach-online-test.mjs [--quality=low] [--size=640x360] [--map=hafen|grenzland]
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const [W, H] = String(opt.size || '640x360').split('x').map(Number);
const QUALITY = String(opt.quality || 'low');
const MAP = String(opt.map || 'hafen');
// Suchmittelpunkte je Karte (x, z): Grenzland-Dorfplatz vor dem Haus mit der Westwand bei x = 12, Gasthaus-Südseite;
// Hafen: Ostwand des Bürohauses bei x = 35. Zwei Grenzland-Seiten brauchen beim Laden zusammen ≈ 10 GB (Software-GL)
const SPOTS = { grenzland: [[4, 79.2], [-28, 47]], hafen: [[44, -46]] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const killer = setTimeout(() => { console.log(`${ts()} FEHL Zeitlimit 40 min überschritten`); browser.close().finally(() => process.exit(1)); }, 40 * 60000);
const errors = {};
async function open(name) {
  const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  errors[name] = [];
  p.on('pageerror', (e) => errors[name].push(`[pageerror] ${e.message}`));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource|net::ERR_|WebGL|GL_INVALID|AudioContext/i.test(t)) return;
    errors[name].push(t);
  });
  // Seitenaufruf großzügig: auf ausgelasteten Prüfrechnern (Software-GL, mehrere Seiten) erreicht eine weitere Seite
  // „load“ teils erst nach > 5 min – nur bis zum Antworten des Servers warten, die Bereitschaft prüft waitForFunction
  await p.goto(`${BASE}spielen.html?quality=${QUALITY}&relays=${encodeURIComponent(RELAY)}`, { timeout: 300000, waitUntil: 'commit' });
  await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 900000, polling: 1000 });
  await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
async function until(p, fn, arg, timeout = 60000, every = 500) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}
/** Synchrone Breschen einer Seite (Id → Mitte, Normale, Dicke, Zufall, Umriss). */
const breaches = (p) => ev(p, () => {
  const Hs = window.__game.holes;
  if (!Hs || !Hs._sync) return [];
  return [...Hs._sync.values()].filter((h) => !h.dead).map((h) => ({ id: h.sync, p: h.pos.toArray(), n: h.n.toArray(), tn: h.tn, sd: h.seed, kb: h.kb, r: Array.from(h.sprof), cut: h.cut === true }));
});
/** größte Abweichung zweier Breschenlisten (gleiche Ids vorausgesetzt) → { missing, dev } */
function compare(a, b) {
  const byId = new Map(b.map((x) => [x.id, x]));
  let missing = 0, dev = 0;
  for (const x of a) {
    const y = byId.get(x.id);
    if (!y) { missing++; continue; }
    dev = Math.max(dev, ...x.p.map((v, i) => Math.abs(v - y.p[i])), ...x.n.map((v, i) => Math.abs(v - y.n[i])), Math.abs(x.tn - y.tn), Math.abs(x.sd - y.sd), Math.abs(x.kb - y.kb), ...x.r.map((v, i) => Math.abs(v - y.r[i])));
  }
  return { missing, dev };
}

try {
  const host = await open('Host');
  const anna = await open('Anna');
  info(`Host + Anna geladen (${QUALITY}, ${W}×${H}, ${MAP})`);
  const code = await ev(host, (map) => window.__game.net.host({
    name: 'Breschen-Test', mode: 'tdm', map, maxPlayers: 4, teamSize: 3, pvp: 'coop', botFill: false, difficulty: 'rekrut',
    weather: 'standard', time: 'standard', style: 'arcade', vehicles: true, thirdPerson: true,
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code), MAP);
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
  const joinOnce = (p, n) => ev(p, ([c, nm]) => window.__game.net.join(c, { name: nm }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), [code, n]);
  let ja = await joinOnce(anna, 'Anna');
  if (!ja.ok) { info(`Anna: ${ja.code} – zweiter Versuch`); ja = await joinOnce(anna, 'Anna'); }
  check(ja.ok, `Anna tritt bei (${ja.ok ? 'id ' + ja.id : ja.code})`);
  await until(host, () => window.__game.net.roster.length === 2, null, 20000);
  await ev(host, () => window.__game.net.startMatch());
  const inMatch = await Promise.all([host, anna].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive && !!window.__game.holes, null, 900000, 1000)));
  if (!check(inMatch.every(Boolean), 'Host + Anna im Match')) throw new Error('Match nicht erreicht');

  // Host: Hilfen, Wand suchen (frei davor), Spieler unverwundbar
  const wall = await ev(host, async (spots) => {
    const G = window.__game, T = await import('three'), VD = await import('./assets/js/game/vehicles/data.js');
    const Wd = G.world, Hs = G.holes, S = G.vehicles;
    G.player.godMode = true;
    const V3 = (x, y, z) => new T.Vector3(x, y, z);
    // Bodenhöhe unter (x, z), gesucht ab Höhe from (Standard 40 m – nur im Freien; an Wänden knapp darüber suchen)
    const gy = (x, z, from = 40) => { const g = Wd.groundHeight ? Wd.groundHeight(x, z, from) : null; return g == null ? 0 : g; };
    // feste Saat für die Bruchformen (Math.random in breach.js): Lauf wiederholbar
    let st = 0x5eed1234;
    Math.random = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    window.__h = { G, T, VD, Wd, Hs, S, V3, gy };
    // Kandidaten: Strahlenkranz um bekannte Kartenpunkte, Spieler und Kartenraster; Wand (Putz/Beton/Ziegel bis 60 cm,
    // Blech/Holz dünn), 9 m frei davor, Wand 2 m links und rechts. Abgestellte Zivilfahrzeuge an den Kartenpunkten zur Seite
    const centers = (spots || []).map(([x, z]) => V3(x, 0, z));
    for (const c of centers) for (const v of S.list) if (v.def.civil && Math.hypot(v.body.pos.x - c.x, v.body.pos.z - c.z) < 12) v.body.setPose(V3(-70 - S.list.indexOf(v) * 6, gy(-70, 0), 0), 0);
    centers.push(G.player.position.clone());
    if (Wd.bounds) {
      const b = Wd.bounds;
      for (const fx of [0.5, 0.25, 0.75]) for (const fz of [0.5, 0.25, 0.75]) centers.push(V3(b.min.x + (b.max.x - b.min.x) * fx, 0, b.min.z + (b.max.z - b.min.z) * fz));
    }
    for (const c of centers) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, d = V3(Math.cos(a), 0, Math.sin(a));
        const o = V3(c.x, gy(c.x, c.z) + 1.4, c.z);
        const f = Wd.raycast(o, d, 60);
        if (!f || f.vehicle || f.solid) continue;
        const n = f.normal.clone(); if (n.dot(d) > 0) n.negate();
        if (Math.abs(n.y) > 0.2) continue;
        const w = Hs.wallAt(f.point, n, 0.6);
        if (!w || !([1, 2, 7].includes(w.style) ? w.thick >= 0.1 : w.thick <= 0.03)) continue;
        // frei davor (Panzerbreite, Brust- und Kettenhöhe) und 3 m Wand links/rechts
        const tx = V3(0, 1, 0).cross(w.n).normalize();
        let free = true;
        for (const s of [-2, 0, 2]) for (const y of [0.7, 1.6]) {
          const p0 = w.point.clone().addScaledVector(tx, s).addScaledVector(w.n, 0.2); p0.y = gy(p0.x, p0.z, w.point.y + 1.5) + y;
          const h = Wd.raycast(p0, w.n, 9);
          if (h) free = false;
          const back = Hs._ray0(p0.clone().addScaledVector(w.n, 0.4), w.n.clone().negate(), 1.2);
          if (!back) free = false;
        }
        if (!free) continue;
        return { p: w.point.toArray(), n: w.n.toArray(), thick: w.thick, style: w.style };
      }
    }
    return null;
  }, SPOTS[MAP] || null);
  if (!check(!!wall, `Host findet eine Wand mit freiem Vorfeld (${wall ? `Stil ${wall.style}, ${wall.thick.toFixed(3)} m` : '–'})`)) throw new Error('keine Wand');

  // 1. SG + PG + Rammen beim Host
  const made = await ev(host, (wl) => {
    const { G, VD, Hs, S, V3, gy } = window.__h;
    const P = V3(...wl.p), n = V3(...wl.n), tx = V3(0, 1, 0).cross(n).normalize();
    const fire = (ammo, tgt) => {
      const o = tgt.clone().addScaledVector(n, 12); o.y += 1.0;
      const s = S.shells.fire(VD.vehicleWeapon('mbt', ammo), o, tgt.clone().sub(o).normalize(), null, null);
      for (let i = 0; i < 40 && S.shells.list.includes(s); i++) S.shells.update(1 / 120);
    };
    // Boden 1 m vor der Wand (Suche knapp über dem Wandpunkt, nicht vom Dach)
    const F = P.clone().addScaledVector(n, 1.0), g = gy(F.x, F.z, P.y + 1.5);
    fire('mbt_he', P.clone().addScaledVector(tx, -2.2).setY(g + 1.6));
    fire('mbt_ap', P.clone().addScaledVector(tx, 2.4).setY(g + 1.4));
    // Panzer (neu) rammt die Wand mittig mit 5 m/s
    const yaw = Math.atan2(n.x, n.z); // vorwärts = −n
    const start = P.clone().addScaledVector(n, 7.5); start.y = gy(start.x, start.z, P.y + 3);
    const v = S.spawnVehicle('mbt', start, yaw, 'A');
    const ev2 = [], ids = []; const off = G.events.on('wall:breach', (e) => { ev2.push(e.kind); if (e.kind === 3) ids.push(e.id); });
    const roll = (sec, keep) => { for (let i = 0, k = Math.round(sec * 60); i < k; i++) { G.time.elapsed += 1 / 60; const c = v.body.controls; c.handbrake = false; c.brake = 0; c.throttle = 0; if (keep) keep(); v.body.update(1 / 60, window.__h.Wd); v.sync(1 / 60); S.breaching.update(); Hs.update(1 / 60); } };
    roll(0.3);
    v.body.vel.copy(n).multiplyScalar(-5); v.body.wake();
    roll(3, () => { if (ev2.includes(3)) { const vn = -v.body.vel.dot(n); if (vn < 2.5) v.body.vel.addScaledVector(n, -(2.5 - vn)); } });
    off();
    return { n: Hs._sync.size, kinds: ev2, ram: ids[ids.length - 1] ?? null, ground: +g.toFixed(2), depth: +(-v.body.pos.clone().sub(P).dot(n)).toFixed(2) };
  }, wall);
  info(`Boden vor der Wand y ${made.ground}, Wandpunkt y ${wall.p[1].toFixed(2)}`);
  // SG und Rammbresche liegen nah beieinander und wachsen meist zu einer zusammen (Breschen derselben Wand)
  check(made.n >= 2 && made.kinds.includes(3), `Host: SG-, PG- und Rammbresche (${made.n} Breschen, Ereignisse ${made.kinds.join('/')}, Panzer ${made.depth} m hinter der Wandfläche)`);
  const hostB = await breaches(host);
  const annaOk = await until(anna, (n) => window.__game.holes && window.__game.holes._sync.size >= n, hostB.length, 30000);
  const annaB = await breaches(anna);
  const cA = compare(hostB, annaB);
  check(!!annaOk && cA.missing === 0 && cA.dev < 1e-3 && annaB.every((b) => b.cut), `Anna: alle ${hostB.length} Breschen identisch (fehlend ${cA.missing}, größte Abweichung ${cA.dev.toExponential(1)})`);

  // 2. Durchgang bei Anna (Kugelstrahl + Körperphysik) durch die Rammbresche (sonst die größte)
  const he = hostB.find((b) => b.id === made.ram) || hostB.reduce((m, b) => (!m || Math.max(...b.r) > Math.max(...m.r) ? b : m), null);
  const passA = await ev(anna, ([b]) => {
    const G = window.__game, Wd = G.world, T = G.player.body.position.constructor;
    const c = new T(...b.p), n = new T(...b.n);
    const o = c.clone().addScaledVector(n, 2);
    const ray = Wd.raycast(o, n.clone().negate(), 3);
    const B = G.player.body;
    const feet = Math.max(c.y - b.r[12] + 0.06, (Wd.groundHeight ? Wd.groundHeight(o.x, o.z, c.y + 2) : c.y - 1.5) ?? c.y - 1.5);
    B.position.set(c.x + n.x * 0.7, feet, c.z + n.z * 0.7); B.velocity.set(0, 0, 0);
    for (let i = 0; i < 90; i++) { B.velocity.x = -n.x * 3.5; B.velocity.z = -n.z * 3.5; if (i === 0) B.velocity.y = 4.5; B.step(1 / 60, Wd); }
    const depth = -B.position.clone().sub(c).dot(n);
    return { ray: ray ? +ray.distance.toFixed(2) : null, depth: +depth.toFixed(2), tn: b.tn };
  }, [he]);
  check(passA.ray === null || passA.ray > 2.0 + passA.tn, `Anna: Kugelstrahl durch die ${he && he.id === made.ram ? 'Ramm' : 'größte '}bresche (${passA.ray === null ? 'kein Treffer' : passA.ray + ' m'})`);
  check(passA.depth > passA.tn + 0.3, `Anna läuft durch die Bresche (${passA.depth} m hinter der Wandfläche)`);

  // 3. Bert tritt später bei. Anna ist fertig und verlässt das Spiel: zwei rechnende Software-GL-Seiten lasten den
  // Prüfrechner so aus, dass eine dritte kaum lädt (Abbruch nach 5 min); der Host verteilt ohnehin an jeden Beitretenden
  await anna.close();
  info('Anna verlässt das Spiel (Last für Berts Laden)');
  // Der Host zeichnet nicht, solange Bert lädt: alle Seiten teilen sich einen Software-GL-GPU-Prozess, die Bilder des
  // Hosts hielten Berts (synchrone) Shader-Vorbereitung sonst über 15 min auf. Simulation und Netz laufen weiter.
  await ev(host, () => { const R = window.__game.renderer; if (!R.__render0) { R.__render0 = R.render; R.render = () => {}; } });
  const bert = await open('Bert');
  let jb = await joinOnce(bert, 'Bert');
  if (!jb.ok) { info(`Bert: ${jb.code} – zweiter Versuch`); jb = await joinOnce(bert, 'Bert'); }
  check(jb.ok, `Bert tritt dem laufenden Match bei (${jb.ok ? 'id ' + jb.id : jb.code})`);
  // warten, bis Bert im Match ist und alle Breschen hat; jede Minute sein Stand (Laden unter Last dauert)
  let bertIn = null;
  for (let t0 = Date.now(), last = 0; !bertIn && Date.now() - t0 < 900000;) {
    const s = await Promise.race([
      bert.evaluate(() => {
        const G = window.__game;
        return { st: G.match.state, sync: G.holes ? G.holes._sync.size : -1, alive: !!(G.player && G.player.alive), role: G.match.netRole || null, roster: G.net && G.net.roster ? G.net.roster.length : -1, world: !!G.world, fps: G.renderer && G.renderer.fps ? Math.round(G.renderer.fps) : null };
      }).catch((e) => ({ err: String(e.message).slice(0, 80) })),
      sleep(30000).then(() => ({ err: 'evaluate > 30 s' })),
    ]);
    if (s.st === 'playing' && s.sync >= hostB.length) bertIn = s;
    else if (Date.now() - last > 60000) { last = Date.now(); info(`Bert: ${JSON.stringify(s)}`); }
    if (!bertIn) await sleep(1000);
  }
  await ev(host, () => { const R = window.__game.renderer; if (R.__render0) { R.render = R.__render0; delete R.__render0; } });
  const bertB = await breaches(bert);
  const cB = compare(hostB, bertB);
  check(!!bertIn && cB.missing === 0 && cB.dev < 1e-3, `Bert: ${bertB.length} Breschen nachgereicht, identisch (fehlend ${cB.missing}, größte Abweichung ${cB.dev.toExponential(1)})`);

  const errs = Object.entries(errors).filter(([, l]) => l.length);
  check(!errs.length, `keine Seitenfehler${errs.length ? ': ' + errs.map(([n, l]) => `${n}: ${l.slice(0, 2).join(' | ')}`).join('; ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  clearTimeout(killer);
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
