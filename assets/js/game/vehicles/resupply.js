// NULLPUNKT — Aufmunitionieren von Fahrzeugen an Versorgungspunkten (Nutzer 21.10.: „an den Punkten Munition auffüllen
// können, auch bei Panzern – sofern die Punkte auf offenem Land/Feld sind“).
//
// Host/offline (updateResupply, VehicleSystem.update): Hält ein Fahrzeug (|v| < SUPPLY.still m/s seit SUPPLY.settle s)
// mit Lücken im Granatengestell (crew.js gun.rack) oder in den MG-Gurten (vehicle.js w.reserve/w.mag) höchstens
// SUPPLY.reach m (Abstand Punkt → Grundfläche der Wanne) neben einem fahrzeugtauglichen Versorgungspunkt (mappoints.js
// vehiclePoints: offenes Feld, eigenes Team oder neutral), wird schrittweise aufgefüllt: alle SUPPLY.step s je
// Granatsorte ⌈Kapazität / 8⌉ und je MG ein Gurt (zuerst das angebrochene Magazin), bis alles voll ist – rund 5 s für ein
// leeres Gestell; Rangieren bis SUPPLY.maxSpeed unterbricht nicht. Ist alles voll, folgt die Abklingzeit je Fahrzeug
// (SUPPLY.cooldown s); wer vorher wegfährt, behält das Erhaltene und kann gleich wieder anhalten.
// Gibt es für das Team keinen solchen Punkt (Entwicklungsseite, Karte ohne Punkte), gilt wie bisher der eigene
// Stellplatz (≤ 25 m) als Versorgung.
//
// „Gang halten“ (Standard der Kettenfahrzeuge, drive-input.js): ohne Taste fährt der Panzer im Gang weiter – zum
// Anhalten Bremse halten oder auf N schalten (HUD-Zeile sagt es mit den Tasten). Beginnt die Versorgung, legt sie N ein,
// damit der Panzer nach dem Loslassen der Bremse stehen bleibt; Hochschalten/Gas fährt wieder an und bricht ab.
// Ein laufender MG-Gurtwechsel wird mit dem ersten Schritt durch einen frischen Gurt ersetzt (kein Warten, kein „voll“
// ohne Zuwachs); „voll“ meldet nur ein Fahrzeug, dem nichts mehr fehlt.
//
// Zustand je Fahrzeug: v.supply = { state: 'frei' | 'aktiv' | 'pause', point, t, given, readyAt }. Online trägt der
// Fahrzeugblock (Byte 63, vehicles/net.js) Zustand und Gurte; Clients leiten daraus Hinweis, Klang und Meldung ab.
// Ereignis 'vehicle:resupply' { vehicle, state: 'start' | 'schritt' | 'voll' | 'abbruch', shells, belts, net? }.
// HUD (supplyHint) und Minikarte nur für Fahrzeuge mit begrenzter Munition (Gestell oder MG-Gurte, suppliable) –
// zivile Fahrzeuge ohne Waffen zeigen nichts.
import * as THREE from 'three';

export const SUPPLY = Object.freeze({ reach: 6, still: 0.8, settle: 0.6, maxSpeed: 2, step: 0.6, cooldown: 40, padReach: 25, hint: 45 });

const STATES = ['frei', 'aktiv', 'pause'];
const _l = new THREE.Vector3();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const supplyStateIndex = (s) => Math.max(0, STATES.indexOf(s));
export const supplyStateOf = (i) => STATES[i] || 'frei';

/** Zustand am Fahrzeug (angelegt beim ersten Zugriff). */
export function supplyOf(v) {
  return v.supply || (v.supply = { state: 'frei', point: null, t: 0, still: 0, given: 0, readyAt: 0 });
}

/** MG-Waffen mit begrenztem Vorrat (alle Sitze). */
function belts(v) {
  const out = [];
  for (const s of v.seats) for (const w of s.weapons) if (w.def.kind === 'mg' && w.reserve != null) out.push(w);
  return out;
}

/** Hat das Fahrzeug begrenzte Munition (Granatengestell oder MG mit Ersatzgurten)? Sonst gibt es nichts zu versorgen. */
export function suppliable(v) {
  return !!(v && ((v.gun && v.def.ammo) || belts(v).length));
}

/** Was fehlt? → { shells (Granaten), belts (Gurte inkl. angebrochener Magazine), fill (0…1 Gesamtfüllung) } */
export function ammoNeed(v) {
  let shells = 0, cap = 0, have = 0, b = 0, bCap = 0, bHave = 0;
  const g = v.gun;
  if (g && v.def.ammo) {
    for (const [t, c] of Object.entries(v.def.ammo)) { const n = Math.max(0, Math.min(c, g.rack[t] || 0)); shells += c - n; cap += c; have += n; }
  }
  for (const w of belts(v)) {
    const maxR = w.def.mag * (w.def.belts || 0);
    b += (w.mag < w.def.mag ? 1 : 0) + Math.ceil(Math.max(0, maxR - w.reserve) / w.def.mag);
    bCap += maxR + w.def.mag;
    bHave += Math.min(maxR, w.reserve) + w.mag;
  }
  const parts = (cap ? 1 : 0) + (bCap ? 1 : 0);
  const fill = parts ? ((cap ? have / cap : 0) + (bCap ? bHave / bCap : 0)) / parts : 1;
  return { shells, belts: b, fill };
}

/** Abstand eines Punktes zur Grundfläche der Wanne (waagerecht, 0 = darunter) und Höhenunterschied. */
export function footDistance(v, p) {
  const hb = v.def.hullBox;
  const L = v.body.toLocal(_l.set(p.x, p.y, p.z), _l);
  const dx = Math.max(0, Math.abs(L.x - hb[0]) - hb[3]), dz = Math.max(0, Math.abs(L.z - hb[2]) - hb[5]);
  return Math.hypot(dx, dz);
}

/**
 * Nächster passender Versorgungspunkt für v (eigenes Team/neutral). → { point, dist (Grundfläche), inReach, pad } | null
 * maxDist: Suchradius (Mitte → Punkt).
 */
export function nearestSupply(sys, v, maxDist = SUPPLY.hint) {
  const G = sys.G;
  const team = v.team ?? null;
  const pts = G.points && typeof G.points.vehiclePoints === 'function' ? G.points.vehiclePoints(team) : [];
  const pos = v.body.pos;
  let best = null;
  for (const p of pts) {
    const q = p.position;
    if (Math.abs(q.y - pos.y) > 4) continue;
    const c = Math.hypot(q.x - pos.x, q.z - pos.z);
    if (c > maxDist) continue;
    const d = footDistance(v, q);
    if (!best || d < best.dist) best = { point: p, dist: d, inReach: d <= SUPPLY.reach, pad: false };
  }
  if (pts.length || team == null) return best;
  // Ohne Versorgungspunkt für das Team: eigener Stellplatz (wie bisher, crew.js vor 21.10.)
  for (const sp of sys.spawns || []) {
    if (sp.team !== team || !sp.position) continue;
    const c = Math.hypot(sp.position.x - pos.x, sp.position.z - pos.z);
    if (c <= SUPPLY.padReach && (!best || c < best.dist)) best = { point: null, dist: c, inReach: true, pad: true };
  }
  return best;
}

/** Ein Schritt: je Granatsorte ⌈Kapazität / 8⌉, je MG ein Gurt bzw. das angebrochene Magazin. → { shells, belts }
 *  Gibt nur dann nichts, wenn nichts fehlt (ammoNeed 0) – ein laufender Gurtwechsel bekommt den frischen Gurt sofort. */
function step(v) {
  let shells = 0, nb = 0;
  const g = v.gun;
  if (g && v.def.ammo) {
    for (const [t, c] of Object.entries(v.def.ammo)) {
      const cur = g.rack[t] || 0;
      if (cur >= c) continue;
      const add = Math.min(c - cur, Math.ceil(c / 8));
      g.rack[t] = cur + add;
      shells += add;
    }
  }
  for (const w of belts(v)) {
    const maxR = w.def.mag * (w.def.belts || 0);
    // angebrochener Gurt zuerst: frischer Gurt direkt eingelegt (ein laufender Gurtwechsel ist damit erledigt und nimmt
    // nichts mehr aus dem Vorrat)
    if (w.mag < w.def.mag) { w.mag = w.def.mag; w.reloadT = 0; nb++; }
    else if (w.reserve < maxR) { w.reserve = Math.min(maxR, w.reserve + w.def.mag); nb++; }
  }
  return { shells, belts: nb };
}

function end(sys, v, S, state) {
  const now = sys.G.time.elapsed;
  // voll → Abklingzeit; Abbruch (weggefahren) → frei, kurze Sperre gegen Flackern beim Rangieren
  if (state === 'voll' && S.given > 0) { S.state = 'pause'; S.readyAt = now + SUPPLY.cooldown; } else { S.state = 'frei'; S.t = 1.5; }
  if (v.gun) v.gun.refilling = false;
  sys.G.events.emit('vehicle:resupply', { vehicle: v, state, given: S.given, point: S.point });
  S.point = null; S.given = 0; S.still = 0;
  if (S.state === 'pause') S.t = 0;
}

/** Takt (Host/offline): alle Fahrzeuge prüfen und versorgen. */
export function updateResupply(sys, dt) {
  const now = sys.G.time.elapsed;
  for (const v of sys.list) {
    const S = supplyOf(v);
    if (!v.alive || v.wreck) {
      if (S.state === 'aktiv') end(sys, v, S, 'abbruch');
      continue;
    }
    if (S.state === 'pause' && now >= S.readyAt) S.state = 'frei';
    if (S.state === 'pause') continue;
    const sp = Math.abs(v.body.speed), slow = sp < SUPPLY.maxSpeed;
    S.still = sp < SUPPLY.still ? S.still + dt : 0;
    if (S.state === 'aktiv') {
      const n = slow ? nearestSupply(sys, v, 30) : null;
      if (!n || !n.inReach) { end(sys, v, S, 'abbruch'); continue; }
      S.t += dt;
      if (S.t < SUPPLY.step) continue;
      S.t = 0;
      const r = step(v);
      const got = r.shells + r.belts;
      S.given += got;
      if (got) sys.G.events.emit('vehicle:resupply', { vehicle: v, state: 'schritt', shells: r.shells, belts: r.belts, point: S.point });
      // „voll“ nur, wenn nichts mehr fehlt (sonst nächster Schritt)
      const need = ammoNeed(v);
      if (need.shells === 0 && need.belts === 0) end(sys, v, S, 'voll');
      continue;
    }
    // frei: beginnen, wenn das Fahrzeug hält, etwas fehlt und ein Punkt in Reichweite ist (Prüfung gedrosselt)
    S.t -= dt;
    if (S.still < SUPPLY.settle) continue;
    if (S.t > 0) continue;
    S.t = 0.5;
    const need = ammoNeed(v);
    if (need.shells === 0 && need.belts === 0) continue;
    const n = nearestSupply(sys, v, 30);
    if (!n || !n.inReach) continue;
    S.state = 'aktiv';
    S.point = n.point ? n.point.i : -1;
    S.t = 0;
    S.given = 0;
    if (v.gun) v.gun.refilling = true;
    // „Gang halten“: N einlegen, sonst rollt der Panzer nach dem Loslassen der Bremse im Gang wieder an (Abbruch)
    const dtn = v.body.drivetrain, c = v.body.controls;
    if (dtn && c && c.gearbox === 'hold' && !(c.throttle > 0.01) && (dtn.state.gear || dtn.state.targetGear)) dtn.setGear(0);
    sys.G.events.emit('vehicle:resupply', { vehicle: v, state: 'start', point: S.point });
  }
}

/** Knapp: Gestell leer, alle MG leer (Gurt und Vorrat) oder höchstens ein Viertel übrig. */
function short(v, need) {
  if (need.fill <= 0.25) return true;
  const g = v.gun;
  if (g && v.def.ammo && Object.keys(v.def.ammo).every((t) => !(g.rack[t] > 0))) return true;
  const bs = belts(v);
  return bs.length > 0 && bs.every((w) => w.mag <= 0 && !(w.reserve > 0));
}

/** Uhrzeit-Richtung (12 = vorn, 3 = rechts) eines Punktes relativ zur Wanne. */
function clockOf(v, p) {
  const pos = v.body.pos;
  const bearing = Math.atan2(-(p.x - pos.x), -(p.z - pos.z));
  const h = Math.round(12 - wrap(bearing - v.yaw) / (Math.PI / 6)) % 12;
  return h <= 0 ? h + 12 : h;
}

/** Wie hält der Fahrer an? (Gang halten: Bremse oder N; Automatik: Gas los/Bremse) */
function stopText(v, ctx) {
  const k = typeof ctx.keyFor === 'function' ? ctx.keyFor : () => null;
  const hold = (v.body.controls && v.body.controls.gearbox === 'hold') || (v.body.drive && v.body.drive.gearbox === 'hold');
  if (ctx.touch) return hold ? 'Anhalten: Bremse oder Gang − (N)' : 'Anhalten: Bremse';
  const brake = k('jump') || 'Leertaste';
  if (hold) return `Anhalten: ${brake} halten oder ${k('move_back') || 'S'} → N`;
  return `Anhalten: Gas los, ${brake} bremst`;
}

/**
 * HUD-Zeile für das Fahrzeug des Spielers (auch Client: Zustand aus dem Netzblock). → { text, tone, progress } | null
 * ctx = { seat (Sitz des Spielers), touch, keyFor } – Fahrer bekommen die Tasten zum Anhalten, die anderen Sitze
 * „Fahrer: anhalten“. Fehlt Munition und ist kein Punkt in der Nähe, zeigt die Zeile den nächsten eigenen Punkt mit
 * Entfernung und Uhrzeit-Richtung (nur bei knapper Munition – die Minikarte zeigt die Punkte immer).
 */
export function supplyHint(sys, v, ctx = {}) {
  if (!suppliable(v)) return null;
  const S = supplyOf(v);
  const now = sys.G.time.elapsed;
  const need = ammoNeed(v);
  const driver = !!(ctx.seat && ctx.seat.def && ctx.seat.def.drive);
  const hold = !!(v.body.drive && v.body.drive.gearbox === 'hold');
  if (S.state === 'aktiv') {
    const text = !driver ? 'Aufmunitionieren …' : hold ? (ctx.touch ? 'Aufmunitionieren … · Gang N' : 'Aufmunitionieren … · Gang N, stehen bleiben') : 'Aufmunitionieren … · stehen bleiben';
    return { text, tone: 'ok', progress: need.fill };
  }
  const full = need.shells === 0 && need.belts === 0;
  const n = nearestSupply(sys, v, SUPPLY.hint);
  if (!n) {
    if (full || !short(v, need)) return null;
    const f = nearestSupply(sys, v, Infinity);
    if (!f || f.pad || !f.point) return null;
    return { text: `Versorgung ${Math.max(5, Math.round(f.dist / 5) * 5)} m · ${clockOf(v, f.point.position)} Uhr`, tone: 'warn', progress: need.fill };
  }
  if (n.pad) return null;
  if (S.state === 'pause') {
    const left = Math.max(0, Math.ceil((S.readyAt || 0) - now));
    return { text: full ? 'Munition voll' : left > 0 ? `Versorgung wieder in ${left} s` : 'Versorgung: Abklingzeit', tone: 'dim', progress: need.fill };
  }
  if (full) return n.inReach ? { text: 'Versorgungspunkt · Munition voll', tone: 'dim', progress: 1 } : null;
  if (!n.inReach) return { text: `Versorgungspunkt ${Math.round(n.dist)} m – heranfahren`, tone: 'dim', progress: need.fill };
  if (Math.abs(v.body.speed) >= SUPPLY.still) return { text: driver ? stopText(v, ctx) : 'Versorgungspunkt – Fahrer: anhalten', tone: 'warn', progress: need.fill };
  return { text: 'Versorgungspunkt – gleich geht’s los …', tone: 'ok', progress: need.fill };
}

/** Kurze Meldung nach dem Auffüllen (Text nach Inhalt: Geländewagen haben nur Gurte). */
export function supplyDoneText(e, v = null) {
  if (!e || e.state !== 'voll') return 'Aufmunitionieren abgebrochen';
  const rack = !!(v && v.gun && v.def.ammo), mg = !!(v && belts(v).length);
  return `Aufmunitioniert – ${rack && mg ? 'Gestell und Gurte' : rack ? 'Gestell' : 'Gurte'} voll`;
}
