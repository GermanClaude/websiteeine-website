// NULLPUNKT — Kran-Animation (Owner: world): Fahrpläne, Pendel und bewegte Teile für Portal- und Brückenkräne.
//
// Mehrspieler: Jede Stellung ist eine reine Funktion der gemeinsamen Uhr (online Host-Zeit, sonst Spielzeit) –
// alle Spieler sehen dieselbe Fahrt, auch wer später beitritt. Kein Zustand wird über Bilder integriert, kein
// Math.random: Fahrziele, Pausen und Hubhöhen kommen aus einem Ganzzahl-Hash von (Saat, Zyklusnummer).
// Bewegte Teile haben keine Kollision und liegen nicht in der Kugel-BVH (nur Optik), feste Teile bleiben in der Karte.
//
// Bausteine:
//   craneClock()            gemeinsame Uhr + G-Zugriff (Karte verdrahtet sie in attach(world, G))
//   createTrack(o)          Fahrplan einer Achse (Fahrt mit Trapezprofil, Pausen, Heben/Senken in den Pausen)
//   track.sway(t, L)        Pendelausschlag (rad) des Lasthakens aus den Beschleunigungssprüngen (geschlossene Form)
//   partBuilder(b) + partGroup(b, pb)   Teile mit denselben Primitiven/Materialien wie die Karte, als eigene Meshes
//   inView(camera, x, y, z, r)          Kugel im Sichtkegel? (außerhalb: Stellung nicht nachführen)
import * as THREE from 'three';
import { MapBuilder } from './builder.js';
import { getMaterial } from '../engine/textures.js';

const GRAV = 9.81;

/** Ganzzahl-Zufallsfolge 0..1 (mulberry32) – auf allen Rechnern bitgleich. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;
const ease = u => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * Gemeinsame Uhr: online die Host-Zeit (G.net.serverTime(), auf allen Clients abgeglichen), sonst G.time.elapsed.
 * Bis attach() gerufen wurde (Ladebildschirm), steht sie auf 0 → Ruhestellung.
 */
export function craneClock() {
  let G = null;
  return {
    attach(g) { G = g || null; },
    now() {
      if (!G) return 0;
      const n = G.net;
      if (n && n.online && typeof n.serverTime === 'function') return n.serverTime();
      return G.time?.elapsed ?? 0;
    },
    /** Leiser Atmo-Klang am Kran (Bus „amb“ → Atmo-Lautstärke); nur im laufenden Spiel und in Hörweite. */
    sound(name, x, y, z, vol = 0.4, maxDist = 90) {
      const a = G?.audio, st = G?.match?.state;
      if (!a || typeof a.play !== 'function' || (st !== 'playing' && st !== 'countdown')) return;
      const L = a.listener;
      if (L && L.valid && Math.hypot(x - L.x, y - L.y, z - L.z) > maxDist) return;
      try { a.play(name, { position: { x, y, z }, volume: vol, bus: 'amb', priority: 0, ref: 14, env: 0, er: 0, loud: null }); } catch { /* Ton ist Beiwerk */ }
    },
  };
}

/**
 * Fahrplan einer Achse. Zeit läuft in Zyklen der Länge period; jeder Zyklus beginnt und endet in der Ruhestellung
 * (home, Hubhöhe hoist.up), dazwischen: Wartezeit → 1..n Haltepunkte (Fahrt, Pause mit Senken/Heben) → zurück.
 * o: { seed, period, home, range: [min, max] | spots: [{ x, down?: [lo, hi] }], speed (m/s), ramp (s, Anfahren/Bremsen),
 *      idle: [s, s] (Wartezeit vor der Fahrt), stops: [n0, n1], dwell: [s, s] (Pause ohne Hubzeit), minMove (m),
 *      skip (Anteil Zyklen ohne Fahrt), hoist: { up, down: [lo, hi] (nur range), speed (m/s) } }
 * Ergebnis: { at(t, out) → { x, h, moving }, sway(t, L, zeta, gain) → rad, plan(k) }
 */
export function createTrack(o) {
  const P = o.period, A = o.speed / o.ramp, minMove = Math.max(o.minMove ?? 0, 0.01);
  const hUp = o.hoist?.up ?? 0, hSpeed = o.hoist?.speed ?? 1;
  const cache = new Map();

  /** Fahrt von x0 nach x1 ab t0 (Trapezprofil; kurze Wege dreieckig). */
  function leg(t0, x0, x1) {
    const D = Math.abs(x1 - x0);
    if (D < 1e-6) return { type: 'move', t0, t1: t0, x0, x1, ta: 0, vv: 0, dir: 0 };
    const ta = Math.min(o.ramp, Math.sqrt(D / A)), vv = A * ta;
    return { type: 'move', t0, t1: t0 + D / vv + ta, x0, x1, ta, vv, dir: Math.sign(x1 - x0) };
  }

  function build(k) {
    const R = rng(Math.imul(o.seed | 0, 2654435761) ^ Math.imul(k + 7, 0x9E3779B1) ^ 0x5bd1e995);
    const t0 = k * P, segs = [];
    // Zufallswerte vorab ziehen: das Kürzen (zu wenig Zeit) ändert die Folge nicht
    const uSkip = R(), uIdle = R(), uN = R(), us = [];
    for (let j = 0; j < (o.stops?.[1] ?? 1); j++) us.push([R(), R(), R(), R()]);
    if (uSkip < (o.skip ?? 0)) return { segs, steps: [] };
    const n0 = o.stops?.[0] ?? 1, n1 = o.stops?.[1] ?? 1;
    // Haltepunkte wählen (Abstand ≥ minMove zum vorigen Punkt)
    const targets = [];
    let prev = o.home;
    for (let j = 0; j < n1; j++) {
      const [ux, ud, uh, u2] = us[j];
      let x, down = null;
      if (o.spots) {
        const cand = o.spots.filter(s => Math.abs(s.x - prev) >= minMove);
        if (!cand.length) break;
        const s = cand[Math.floor(ux * cand.length) % cand.length];
        x = s.x; down = s.down ? lerp(s.down, uh) : null;
      } else {
        const [lo, hi] = o.range;
        // Ziel auf der Seite mit mehr Platz, mindestens minMove entfernt
        const room0 = prev - minMove - lo, room1 = hi - (prev + minMove);
        if (room0 <= 0 && room1 <= 0) break;
        const side = room1 <= 0 ? -1 : room0 <= 0 ? 1 : (ux < room1 / (room0 + room1) ? 1 : -1);
        x = side > 0 ? prev + minMove + u2 * room1 : prev - minMove - u2 * room0;
        down = o.hoist?.down ? lerp(o.hoist.down, uh) : null;
      }
      targets.push({ x, down, dwell: lerp(o.dwell, ud) });
      prev = x;
    }
    // so viele Haltepunkte wie gewürfelt und in den Zyklus passen (notfalls weniger, sonst keine Fahrt)
    let n = Math.min(targets.length, n0 + Math.floor(uN * (n1 - n0 + 1)));
    for (; n >= 1; n--) {
      segs.length = 0;
      let t = t0 + lerp(o.idle, uIdle), x = o.home;
      for (let j = 0; j < n; j++) {
        const L = leg(t, x, targets[j].x); segs.push(L); t = L.t1; x = targets[j].x;
        const down = targets[j].down, th = down == null ? 0 : Math.abs(hUp - down) / hSpeed;
        const d = targets[j].dwell + 2 * th;
        segs.push({ type: 'dwell', t0: t, t1: t + d, x, h: down, th });
        t += d;
      }
      const back = leg(t, x, o.home); segs.push(back);
      if (back.t1 <= t0 + P - 2) break;
    }
    if (n < 1) segs.length = 0;
    // Beschleunigungssprünge (für das Pendel): +A beim Anfahren, −A nach der Rampe, −A vor dem Halt, +A beim Halt
    const steps = [];
    for (const s of segs) if (s.type === 'move' && s.dir) {
      const a = s.dir * A;
      steps.push([s.t0, a], [s.t0 + s.ta, -a], [s.t1 - s.ta, -a], [s.t1, a]);
    }
    return { segs, steps };
  }

  function plan(k) {
    let p = cache.get(k);
    if (!p) {
      p = build(k);
      cache.set(k, p);
      if (cache.size > 4) for (const key of cache.keys()) { if (key < k - 1 || key > k + 1) cache.delete(key); }
    }
    return p;
  }

  function at(t, out = {}) {
    const k = Math.floor(t / P), { segs } = plan(k);
    out.x = o.home; out.h = hUp; out.moving = false;
    for (const s of segs) {
      if (t < s.t0) break;
      if (t >= s.t1) { out.x = s.type === 'move' ? s.x1 : s.x; continue; }
      if (s.type === 'move') {
        const u = t - s.t0, D = Math.abs(s.x1 - s.x0);
        let d;
        if (u < s.ta) d = 0.5 * A * u * u;
        else if (u < s.t1 - s.t0 - s.ta) d = 0.5 * A * s.ta * s.ta + s.vv * (u - s.ta);
        else { const r = s.t1 - t; d = D - 0.5 * A * r * r; }
        out.x = s.x0 + s.dir * d;
        out.moving = true;
      } else {
        out.x = s.x;
        if (s.h != null) {
          const u = t - s.t0, len = s.t1 - s.t0;
          out.h = u < s.th ? hUp + (s.h - hUp) * ease(u / s.th) : u > len - s.th ? s.h + (hUp - s.h) * ease((u - (len - s.th)) / s.th) : s.h;
        }
      }
      break;
    }
    return out;
  }

  /**
   * Pendelausschlag (rad, in Fahrtrichtung positiv) einer Last an der Seillänge L: Sprungantworten eines gedämpften
   * Pendels auf die Beschleunigungssprünge des laufenden und vorigen Zyklus (geschlossene Form, keine Integration).
   * gain < 1: Pendeldämpfung der Steuerung („Anti-Sway“).
   */
  function sway(t, L, zeta = 0.1, gain = 1) {
    const w = Math.sqrt(GRAV / Math.max(0.5, L)), wd = w * Math.sqrt(1 - zeta * zeta), zw = zeta * w;
    const k = Math.floor(t / P);
    let phi = 0;
    for (const kk of [k - 1, k]) {
      for (const [tau, a] of plan(kk).steps) {
        const s = t - tau;
        if (s <= 0 || s > 45) continue;
        const e = Math.exp(-zw * s);
        phi += a * (1 - e * (Math.cos(wd * s) + (zw / wd) * Math.sin(wd * s)));
      }
    }
    return -phi / GRAV * gain;
  }

  return { at, sway, plan };
}

/**
 * Baukasten für bewegte Teile: dieselben Primitive (Quader, Zylinder, eigene Geometrie) und Materialien wie die
 * Karte, aber in lokalen Koordinaten und ohne Kollision/Navigation (die Kollisionsdaten des Baukastens verfallen).
 */
export function partBuilder(b) {
  const pb = new MapBuilder({ bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 }, seed: 1, chunkSize: 1e6 });
  pb.lookQuality = b.lookQuality;
  pb.timeOfDay = b.timeOfDay;
  return pb;
}

/**
 * Teile eines partBuilder → THREE.Group mit einem Mesh je Material (+ Schattenwurf): wenige Draw Calls, gleiche
 * (gecachte) Weltmaterialien mit Vertexfarben wie die statische Karte. o: { name, shade: [x, y, z] (gebackenes
 * Innenraumlicht der Karte an dieser Stelle übernehmen), cast (false: kein Schattenwurf) }.
 * Die Matrizen werden nicht automatisch nachgeführt (matrixAutoUpdate = false) – der Aufrufer ruft updateMatrix().
 */
export function partGroup(b, pb, o = {}) {
  const g = new THREE.Group();
  g.name = o.name || 'kran-teile';
  g.matrixAutoUpdate = false;
  let k = 1, tint = null;
  if (o.shade && typeof b._interiorAt === 'function') {
    const v = b._interiorAt(o.shade[0], o.shade[1], o.shade[2]);
    if (v) { k = v.factor; tint = v.tint || null; }
  }
  for (const bk of pb.buckets.values()) {
    const n = bk.pos.n;
    if (!n) continue;
    const col = bk.col.a.slice(0, n);
    if (k !== 1 || tint) for (let i = 0; i < n; i += 3) { col[i] *= k * (tint ? tint[0] : 1); col[i + 1] *= k * (tint ? tint[1] : 1); col[i + 2] *= k * (tint ? tint[2] : 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(bk.pos.a.slice(0, n), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(bk.nor.a.slice(0, n), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(bk.uv.a.slice(0, bk.uv.n), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    b.materials.add(bk.mat); // Textur vorab erzeugen lassen (preloadMaterials der Karte)
    const mesh = new THREE.Mesh(geo, getMaterial(bk.mat, { ...(bk.matOpts || {}), vertexColors: true }));
    mesh.name = 'kran:' + bk.mat;
    mesh.castShadow = bk.cast && o.cast !== false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    g.add(mesh);
  }
  pb._releaseScratch(); // Buckets + Kollisionspuffer des Baukastens freigeben
  return g;
}

/** Objekt (Gruppe) neu positionieren, nur wenn sich etwas geändert hat; liefert true bei Änderung. */
export function place(obj, x, y, z, rx = 0, rz = 0, sy = 1) {
  const p = obj.position, r = obj.rotation;
  if (p.x === x && p.y === y && p.z === z && r.x === rx && r.z === rz && obj.scale.y === sy) return false;
  p.set(x, y, z); r.x = rx; r.z = rz; obj.scale.y = sy;
  obj.updateMatrix();
  return true;
}

const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere();
/** Kugel (x, y, z, r) im Sichtkegel der Kamera oder näher als near (Schatten nahe der Kamera)? Ohne Kamera: true. */
export function inView(camera, x, y, z, r, near = 30) {
  if (!camera || !camera.projectionMatrix) return true;
  const c = camera.matrixWorld.elements;
  if (Math.hypot(c[12] - x, c[14] - z) < near + r) return true;
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _fr.setFromProjectionMatrix(_pm);
  _sp.center.set(x, y, z); _sp.radius = r;
  return _fr.intersectsSphere(_sp);
}
