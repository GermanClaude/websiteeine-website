// NULLPUNKT — Panzerbesatzung (panzer-mp.md §B.2/§B.5): Hauptkanone mit Ladezustand, manuelles Nachladen als
// Zustandsautomat des Ladeschützen (Host-autoritativ: offline, Host und Netz-Schritte laufen über dieselbe Funktion),
// Automatik (Regel/Bots), Munitionsgestell mit Auffüllen am eigenen Stellplatz, Störung durch Treffer/Stöße.
//
// vehicle.gun = { loaded, breechOpen, held, step: 'leer'|'gegriffen'|'eingeschoben'|'geladen', busy, busyKind, select,
//                 rack: { mbt_ap, mbt_he }, auto, autoT }
// Ladefolge (Ladeschütze, Sicht 'innen', Blick nur über die Gier im Turmraum geprüft):
//   'munition' (Sorte wählen) → Blick aufs Gestell → 'greifen' 1,0 s → Blick zum Verschluss → 'einschieben' 0,8 s
//   → 'schliessen' 0,4 s → geladen. Automatik: 5,0 s mit besetztem Ladeschützensitz, sonst 8,0 s.
import { VEHICLE_WEAPONS } from './data.js';

const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const LOAD_TIMES = { greifen: 1.0, einschieben: 0.8, schliessen: 0.4 };
export const SHORT = { mbt_ap: 'PG', mbt_he: 'SG' };
const REFILL_DIST = 25, REFILL_EVERY = 2;

/** Hauptkanone anlegen (nur Fahrzeuge mit Granatwaffe und Gestell). */
export function createGun(vehicle) {
  const def = vehicle.def;
  if (!def.ammo || !def.seats.some((s) => s.weapons.some((id) => VEHICLE_WEAPONS[id] && VEHICLE_WEAPONS[id].kind === 'shell'))) return null;
  const types = Object.keys(def.ammo);
  return {
    loaded: types[0], breechOpen: false, held: null, step: 'geladen', busy: 0, busyKind: null, select: types[0],
    rack: { ...def.ammo }, auto: false, autoT: 0, autoMax: 0, refilling: false,
    _refT: 0, _refK: 0, _acc: 0, _pv: null, _msg: null,
  };
}

export const gunSeat = (v) => v.seats.find((s) => s.def.mount === 'gun' && s.weapons.some((w) => w.def.kind === 'shell')) || null;
export const loaderSeat = (v) => v.seats.find((s) => s.def.loader) || null;
export const isHuman = (a) => !!(a && (a.isPlayer || a.isRemoteHuman));

/** Munitionswunsch des Richtschützen (gewählte Granatsorte; beim Koax-MG die zuletzt gewählte). */
export function ammoWish(v) {
  const gs = gunSeat(v);
  if (!gs) return v.gun ? v.gun.select : null;
  const w = gs.weapons[gs.weaponIndex];
  if (w && w.def.kind === 'shell') gs._shellWish = w.def.id;
  return gs._shellWish || (v.gun && v.gun.select);
}

/** Regel: 'automatisch', wenn die Raumregel es sagt, kein Mensch an Bord ist oder ein Bot lädt. */
export function autoReload(v) {
  const rule = v.sys && v.sys.rules ? v.sys.rules.reload : 'manuell';
  if (rule === 'automatisch') return true;
  if (!v.seats.some((s) => isHuman(s.actor))) return true;
  const ls = loaderSeat(v);
  return !!(ls && ls.actor && !isHuman(ls.actor));
}

/** Blickt der Ladeschütze (Gier im Turmraum) auf den Punkt interior[which]? */
export function facing(v, seat, which, tol = null) {
  const I = v.def.interior, crew = v.def.crew || {};
  if (!I || !I[which]) return true;
  const eye = I.loaderEye || [0, 0, 0], p = I[which];
  const yawTo = Math.atan2(-(p[0] - eye[0]), -(p[2] - eye[2]));
  return Math.abs(wrap(seat.look.relYaw - yawTo)) <= (tol ?? crew.faceTol ?? 0.6);
}
/** Gier (Turmraum) vom Auge zum Punkt – für Hinweispfeile. */
export function yawToPoint(v, which) {
  const I = v.def.interior;
  if (!I || !I[which]) return 0;
  const eye = I.loaderEye || [0, 0, 0], p = I[which];
  return Math.atan2(-(p[0] - eye[0]), -(p[2] - eye[2]));
}

/**
 * Ladeschritt (Host/offline; Netz-Schritte mit net: true → Blicktoleranz +0,2 rad).
 * action: 'greifen' | 'einschieben' | 'schliessen' | 'munition' | 'weiter' (nächster fälliger Schritt, Touch „Laden“)
 * → { ok, why? }  why ∈ 'schritt' | 'blick' | 'leer' | 'busy' | 'sitz'
 */
export function loadAction(v, seat, action, ammo = null, { net = false } = {}) {
  const g = v.gun;
  if (!g || !v.alive) return { ok: false, why: 'leer' };
  if (!seat || !seat.def.loader) return { ok: false, why: 'sitz' };
  const now = v.G.time.elapsed;
  if (now < (seat.readyAt || 0)) return { ok: false, why: 'sitz' };
  if (g.busy > 0) return { ok: false, why: 'busy' };
  if (action === 'weiter') action = g.step === 'eingeschoben' ? 'schliessen' : g.step === 'gegriffen' ? 'einschieben' : g.step === 'leer' ? 'greifen' : null;
  if (!action) return { ok: false, why: 'schritt' };
  if (g.auto && action !== 'munition') return { ok: false, why: 'schritt' };
  const tol = ((v.def.crew && v.def.crew.faceTol) || 0.6) + (net ? 0.2 : 0);
  const actor = seat.actor || null;
  switch (action) {
    case 'munition': {
      if (g.held) return { ok: false, why: 'schritt' };
      const types = Object.keys(g.rack);
      let t = ammo && types.includes(ammo) ? ammo : types[(types.indexOf(g.select) + 1) % types.length];
      if (!(g.rack[t] > 0)) { const o = types.find((x) => x !== t && g.rack[x] > 0); if (!o || ammo) return { ok: false, why: 'leer' }; t = o; }
      if (t !== g.select) { g.select = t; v.G.events.emit('vehicle:load', { vehicle: v, actor, step: 'munition', ammo: t }); }
      return { ok: true };
    }
    case 'greifen':
      if (g.step !== 'leer' || g.held) return { ok: false, why: 'schritt' };
      if (!facing(v, seat, 'rack', tol)) return { ok: false, why: 'blick' };
      if (!(g.rack[g.select] > 0)) return { ok: false, why: 'leer' };
      break;
    case 'einschieben':
      if (g.step !== 'gegriffen' || !g.held) return { ok: false, why: 'schritt' };
      if (!facing(v, seat, 'breech', tol)) return { ok: false, why: 'blick' };
      break;
    case 'schliessen':
      if (g.step !== 'eingeschoben') return { ok: false, why: 'schritt' };
      break;
    default:
      return { ok: false, why: 'schritt' };
  }
  g.busy = LOAD_TIMES[action];
  g.busyKind = action;
  g._busyMax = g.busy;
  v.G.events.emit('vehicle:load', { vehicle: v, actor, step: action, ammo: g.held || g.select });
  return { ok: true };
}

/** Kanonenschuss verbucht: Keil öffnet, Hülsenstumpf fällt; Automatik startet sofort. */
export function onGunFired(v) {
  const g = v.gun;
  if (!g) return;
  g.loaded = null;
  g.breechOpen = true;
  g.step = 'leer';
  g.busy = 0; g.busyKind = null;
  if (autoReload(v)) startAuto(v);
}

function startAuto(v) {
  const g = v.gun;
  if (g.auto) return;
  // laufende Handgriffe abbrechen: Granate aus der Hand zurück ins Gestell
  if (g.held) { g.rack[g.held] = (g.rack[g.held] || 0) + 1; g.held = null; }
  g.busy = 0; g.busyKind = null;
  if (g.step === 'eingeschoben' && g.loaded) { g.auto = true; g.autoT = g.autoMax = 0.4; return; }
  const ls = loaderSeat(v);
  const w = VEHICLE_WEAPONS[ammoWish(v)] || VEHICLE_WEAPONS[g.select];
  g.autoT = g.autoMax = ls && ls.actor ? (w.reload || 5) : (w.reloadNoLoader || 8);
  g.auto = true;
}

function finishLoad(v, ammo) {
  const g = v.gun;
  g.loaded = ammo;
  g.breechOpen = false;
  g.held = null;
  g.step = 'geladen';
  g.busy = 0; g.busyKind = null;
  g.auto = false; g.autoT = 0;
  g._msg = { text: `Geladen – ${SHORT[ammo] || ammo}`, until: v.G.time.elapsed + 2 };
  v.G.events.emit('vehicle:loaded', { vehicle: v, ammo });
  const own = v.G.player && v.G.player.vehicle === v;
  v.sys?.audio?.play?.('reload_bolt', { position: own ? null : v.body.pos.clone(), volume: own ? 0.75 : 0.5, pitch: 0.55 }); // Keil schließt
}

/** Granate fällt (Treffer/Stoß während der Handgriffe). */
export function dropShell(v) {
  const g = v.gun;
  if (!g || (!g.held && !(g.busy > 0 && g.busyKind !== 'schliessen'))) return false;
  if (g.held) g.rack[g.held] = (g.rack[g.held] || 0) + 1;
  g.held = null;
  g.busy = 0; g.busyKind = null;
  if (g.step === 'gegriffen') g.step = 'leer';
  g._msg = { text: 'Granate fallen gelassen', until: v.G.time.elapsed + 2, warn: true };
  v.G.events.emit('vehicle:load', { vehicle: v, actor: loaderSeat(v)?.actor || null, step: 'gefallen', ammo: null });
  return true;
}

/** Takt (nur Host/offline): Handgriffe, Automatik, Auffüllen, Störung. */
export function updateGun(v, dt) {
  const g = v.gun;
  if (!g || !v.alive) return;
  const G = v.G;
  // Automatik (Regel/Bots); wechselt die Regel während der Handgriffe (Mensch steigt aus), übernimmt sie
  if (g.step !== 'geladen') {
    if (autoReload(v)) startAuto(v);
    else if (g.auto && g.autoMax > 0.5) { g.auto = false; g.autoT = 0; } // Mensch übernimmt wieder: von Hand weiter
  }
  if (g.auto) {
    g.autoT -= dt;
    if (g.autoT <= 0) {
      if (g.step === 'eingeschoben' && g.loaded) finishLoad(v, g.loaded);
      else {
        const wish = ammoWish(v);
        const types = Object.keys(g.rack);
        const t = g.rack[wish] > 0 ? wish : types.find((x) => g.rack[x] > 0);
        if (t) { g.rack[t] -= 1; finishLoad(v, t); } else { g.auto = false; g.autoT = 0; g._msg = { text: 'Munition leer', until: G.time.elapsed + 2, warn: true }; }
      }
    }
  } else if (g.busy > 0) {
    // Handgriffe von Hand: Ladeschütze muss sitzen und bereit sein
    const ls = loaderSeat(v);
    if (!ls || !ls.actor) dropShell(v);
    else {
      g.busy -= dt;
      if (g.busy <= 0) {
        const k = g.busyKind;
        g.busy = 0; g.busyKind = null;
        if (k === 'greifen') { g.held = g.select; g.rack[g.select] = Math.max(0, (g.rack[g.select] || 0) - 1); g.step = 'gegriffen'; }
        else if (k === 'einschieben') { g.loaded = g.held; g.held = null; g.step = 'eingeschoben'; }
        else if (k === 'schliessen') finishLoad(v, g.loaded);
        if (k !== 'schliessen') G.events.emit('vehicle:load', { vehicle: v, actor: ls.actor, step: g.step, ammo: g.held || g.loaded });
      }
    }
  }
  // Störung: starke Wannenbeschleunigung (waagerecht, geglättet) während der Handgriffe
  const vel = v.body.vel;
  if (g._pv) {
    const ax = (vel.x - g._pv.x) / Math.max(dt, 1e-3), az = (vel.z - g._pv.z) / Math.max(dt, 1e-3);
    g._acc += (Math.hypot(ax, az) - g._acc) * Math.min(1, dt / 0.1);
    g._pv.x = vel.x; g._pv.z = vel.z;
  } else g._pv = { x: vel.x, z: vel.z };
  if (g._acc > 9 && !g.auto && (g.step === 'gegriffen' || (g.busy > 0 && g.busyKind !== 'schliessen'))) dropShell(v);
  // Gestell auffüllen: steht (< 1 m/s) nahe einem Stellplatz des eigenen Teams
  const cap = v.def.ammo;
  let refill = false;
  if (Math.abs(v.body.speed) < 1 && Object.keys(cap).some((k) => g.rack[k] < cap[k])) {
    const team = v.team;
    const pos = v.body.pos;
    for (const sp of (v.sys && v.sys.spawns) || []) {
      if (team == null || sp.team !== team) continue;
      const dx = sp.position.x - pos.x, dz = sp.position.z - pos.z;
      if (dx * dx + dz * dz <= REFILL_DIST * REFILL_DIST) { refill = true; break; }
    }
  }
  g.refilling = refill;
  if (refill) {
    g._refT += dt;
    if (g._refT >= REFILL_EVERY) {
      g._refT = 0;
      const types = Object.keys(cap);
      for (let k = 0; k < types.length; k++) {
        const t = types[(g._refK + k) % types.length];
        if (g.rack[t] < cap[t]) { g.rack[t] += 1; g._refK = (g._refK + k + 1) % types.length; break; }
      }
    }
  } else g._refT = 0;
}

/**
 * Ladeschützen-Hinweis (HUD): nächster Schritt, Taste, Richtung zum Ziel, Fortschritt.
 * keyFor(action) → Tastenname; → { stepText, doHtml, ask, progress, turn: −1|0|1, next }
 */
export function loaderHint(v, seat, keyFor, touch = false) {
  const g = v.gun;
  if (!g) return null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const key = (a, fb) => `<kbd>${esc(touch ? 'Laden' : keyFor(a) || fb)}</kbd>`;
  const wish = ammoWish(v);
  const ask = wish && wish !== g.select && !g.held && g.step === 'leer' ? `Gefordert: ${SHORT[wish] || wish} – ${touch ? '„PG/SG“' : esc(keyFor('swap') || 'Mausrad')} wechselt` : '';
  const out = { stepText: '', doHtml: '', ask, progress: 0, turn: 0, next: null };
  const turnTo = (which) => {
    if (facing(v, seat, which)) return 0;
    return wrap(yawToPoint(v, which) - seat.look.relYaw) > 0 ? -1 : 1; // Gier positiv = links
  };
  if (g.auto) {
    out.stepText = 'Automatik';
    out.doHtml = `Lädt ${SHORT[ammoWish(v)] || ''} … ${g.autoT.toFixed(1).replace('.', ',')} s`;
    out.progress = g.autoMax > 0 ? 1 - g.autoT / g.autoMax : 0;
    return out;
  }
  if (g.busy > 0) {
    out.stepText = { greifen: 'Schritt 2/4', einschieben: 'Schritt 3/4', schliessen: 'Schritt 4/4' }[g.busyKind] || '';
    out.doHtml = { greifen: 'Granate greifen …', einschieben: 'Einschieben …', schliessen: 'Verschluss schließen …' }[g.busyKind] || '';
    out.progress = g._busyMax > 0 ? 1 - g.busy / g._busyMax : 0;
    return out;
  }
  switch (g.step) {
    case 'geladen':
      out.stepText = 'Kanone geladen';
      out.doHtml = `${SHORT[g.loaded] || ''} im Rohr – bereit`;
      out.progress = 1;
      break;
    case 'leer':
      if (!(g.rack[g.select] > 0) && !Object.values(g.rack).some((n) => n > 0)) { out.stepText = 'Gestell leer'; out.doHtml = 'Zum eigenen Stellplatz fahren'; break; }
      out.turn = turnTo('rack');
      out.stepText = 'Schritt 1/4 · Gestell';
      out.doHtml = out.turn ? 'Zum Munitionsgestell drehen' : `${key('reload', 'R')} Granate greifen (${SHORT[g.select]})`;
      out.next = out.turn ? null : 'greifen';
      break;
    case 'gegriffen':
      out.turn = turnTo('breech');
      out.stepText = `Schritt 3/4 · ${SHORT[g.held] || ''} in der Hand`;
      out.doHtml = out.turn ? 'Zum Verschluss drehen' : `${key('fire', 'LMT')} Einschieben`;
      out.next = out.turn ? null : 'einschieben';
      break;
    case 'eingeschoben':
      out.stepText = 'Schritt 4/4 · Verschluss';
      out.doHtml = `${key('reload', 'R')} Verschluss schließen`;
      out.next = 'schliessen';
      break;
  }
  return out;
}

/** Anzeigetexte der Ablehnungsgründe. */
export const WHY_TEXT = {
  schritt: 'Falscher Schritt', blick: 'Erst hinsehen (Gestell/Verschluss)', leer: 'Keine Granate dieser Sorte', busy: 'Noch beschäftigt', sitz: 'Nur als Ladeschütze (Sitz 4)',
  besetzt: 'Sitz besetzt', weit: 'Zu weit weg', feind: 'Feindliches Fahrzeug', blockiert: 'Ausstieg blockiert', tot: 'Fahrzeug zerstört', sperre: 'Bitte warten',
};
