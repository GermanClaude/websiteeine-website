// NULLPUNKT — Karte „Altstadt“: Glocke von Sant Aurel + Turmuhr (Owner: world).
//
// Stundenschlag: zu jeder vollen Stunde der echten Uhrzeit (wie die Armbanduhr im Spiel) schlägt die Glocke die
// Stundenzahl – 12-Stunden-Zählung: 21 Uhr → 9 Schläge, 12 Uhr → 12. Die Turmuhr zeigt dieselbe Zeit.
// Geläut: ab und zu (im Mittel alle 5 Minuten) läutet die Glocke eine Weile. Die Zeitpunkte kommen aus der gemeinsamen
// Uhr (online Host-Zeit, sonst Spielzeit) und der Kartensaat → alle Spieler hören/sehen dasselbe Läuten.
// Die Schwingstellung ist eine reine Funktion der Zeit (keine Integration über Bilder, kein Math.random); die Glocke
// hat keine Kollision und liegt nicht in der Kugel-BVH (nur Optik) – der Glockenstuhl darunter ist statisch.
// Klang: Atmo-Ereignis 'amb_bell' (engine/audio/ambience.js, additive Glockenteiltöne), räumlich vom Turm aus und
// um die Schalllaufzeit verzögert (erst sieht man den Schwung, dann kommt der Schlag).
//
// Einbau (altstadt.js): const bell = createBell(b, { x, z, pivotY, floorY, seed, faces }); im Ergebnis der Karte
// attach(world, G) { bell.attach(world, G); }. Prüfhilfe: __game.world.glocke.test(9) bzw. .test('laeuten').
import * as THREE from 'three';
import { craneClock, partBuilder, partGroup, place, inView } from '../crane-anim.js';

// Stundenschlag (Wanduhr): Schwingdauer, Ausschlag, Anlauf vor dem ersten Schlag (Schlag 1 genau zur vollen Stunde)
const T_HOUR = 4.2, A_HOUR = 0.27, RAMP_HOUR = 2 * T_HOUR;
// Geläut (gemeinsame Uhr): Zyklus, Fenster des Beginns im Zyklus, Dauer, Schwingdauer, Ausschlag
const P_PEAL = 300, PEAL_FROM = 50, PEAL_SPAN = 170, T_PEAL = 2.4, A_PEAL = 0.6, RAMP_PEAL = 3 * T_PEAL;
const SOUND = 343; // m/s
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Ganzzahl-Hash → 0..1 (auf allen Rechnern bitgleich). */
function hash01(a, b) {
  let t = (Math.imul(a | 0, 2654435761) ^ Math.imul((b | 0) + 0x3c6ef372, 0x9E3779B1)) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Stunde zur Wanduhrzeit ms (lokal): Beginn der (nächsten, falls im Anlauf) vollen Stunde + Schlagzahl. */
function hourAt(ms) {
  const d = new Date(ms + RAMP_HOUR * 1000);
  d.setMinutes(0, 0, 0);
  return { t0: d.getTime() / 1000, n: d.getHours() % 12 || 12 };
}

/** Schwingwinkel beim Stundenschlag; s = Sekunden seit der vollen Stunde, n Schläge (bei s = k · T/2). */
function hourAngle(s, n) {
  const last = (n - 1) * T_HOUR / 2;
  if (s < -RAMP_HOUR || s > last + 20) return 0;
  let A = A_HOUR;
  if (s < 0) A *= smooth((s + RAMP_HOUR) / RAMP_HOUR);
  else if (s > last) A *= Math.exp(-(s - last) / 5) * (1 - smooth((s - last - 12) / 8));
  return A * Math.cos((2 * Math.PI * s) / T_HOUR);
}

/** Geläut im Zyklus k der gemeinsamen Uhr: { t0 (Beginn), hold (s), end (Ende des Ausschwingens) }. */
function pealOf(seed, k) {
  const t0 = k * P_PEAL + PEAL_FROM + hash01(seed, k * 2) * PEAL_SPAN;
  const hold = 16 + hash01(seed, k * 2 + 1) * 8;
  return { t0, hold, end: t0 + RAMP_PEAL + hold + 18 };
}
function pealAmp(u, hold) {
  if (u < 0) return 0;
  if (u < RAMP_PEAL) return A_PEAL * smooth(u / RAMP_PEAL);
  const v = u - RAMP_PEAL - hold;
  if (v <= 0) return A_PEAL;
  return v > 18 ? 0 : A_PEAL * Math.exp(-v / 3.5) * (1 - smooth((v - 10) / 8));
}

/**
 * Glocke + Glockenstuhl + bewegliche Uhrzeiger.
 * o: { x, z (Turmmitte), pivotY (Drehachse der Glocke), floorY (Boden der Glockenstube), seed (Kartensaat),
 *      faces: [[x, y, z, ry], …] (Mitte der Zifferblätter, ry = Blickrichtung nach außen) }
 */
export function createBell(b, o) {
  const { x, z, pivotY, floorY } = o;
  const seed = (o.seed | 0) ^ 0x51a7;
  const P = { collide: false, minimap: false, grad: false };
  const BRONZE = '#b08a48', OAK = '#5a3f2b', IRON = '#2b2d30';

  // --- Glockenstuhl (statisch): zwei Querbalken (entlang z) in den Seitenwänden über der Glocke, Lager hängen daran
  //     (so steht nichts zwischen Platz und Glocke; die Balken liegen hinter dem Bogenscheitel)
  for (const sx of [-1, 1]) {
    const px = x + sx * 1.18;
    b.box(px, pivotY + 0.07, z, 0.24, 0.28, o.span ?? 4.4, 'wood_dark', { tint: OAK, ...P });
    for (const sz of [-1, 1]) b.box(px, pivotY - 0.08, z + sz * 0.1, 0.12, 0.17, 0.035, 'metal_painted', { tint: IRON, ...P, ao: false });
    b.box(px, pivotY - 0.1, z, 0.14, 0.05, 0.24, 'metal_painted', { tint: IRON, ...P, ao: false });
  }
  void floorY;

  // --- Schwingende Teile um die Drehachse (lokal: Achse = x, Glocke hängt nach −y)
  const pb = partBuilder(b);
  // Joch (Holz) mit Eisenbändern und Zapfen
  pb.box(0, -0.17, 0, 1.9, 0.34, 0.42, 'wood_dark', { tint: OAK, ...P });
  for (const lx of [-0.62, 0.62]) pb.box(lx, -0.19, 0, 0.06, 0.38, 0.45, 'metal_painted', { tint: IRON, ...P, ao: false });
  pb.cyl(0, 0, 0, 0.05, 2.36, 'metal_painted', { axis: 'x', tint: IRON, seg: 8, ...P, ao: false });
  // Krone (Henkel) zwischen Joch und Glocke
  const top = -0.3; // Oberkante der Glocke
  for (const lx of [-0.12, 0.12]) pb.box(lx, top - 0.02, 0, 0.07, 0.17, 0.18, 'metal_painted', { tint: BRONZE, ...P });
  pb.box(0, top - 0.02, 0, 0.36, 0.06, 0.24, 'metal_painted', { tint: BRONZE, ...P });
  // Glocke (Drehkörper: innen hinab, um die Schärfe, außen hinauf → Außen- und Innenseite zeigen richtig)
  const prof = [
    [0, 1.35], [0.18, 1.34], [0.32, 1.30], [0.37, 1.22], [0.39, 1.08], [0.41, 0.9], [0.45, 0.68], [0.51, 0.46], [0.58, 0.28], [0.66, 0.14],
    [0.7, 0.05], [0.74, 0], [0.8, 0], [0.815, 0.025], [0.79, 0.07], [0.74, 0.15], [0.66, 0.28], [0.58, 0.46], [0.52, 0.68], [0.48, 0.9],
    [0.46, 1.08], [0.45, 1.22], [0.43, 1.31], [0.38, 1.37], [0.3, 1.405], [0.18, 1.418], [0, 1.42],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bellGeo = new THREE.LatheGeometry(prof, 22);
  const lip = top - 1.42;
  pb.geom(bellGeo, 0, lip, 0, 'metal_painted', { tint: BRONZE, ...P, uv: 'world' });
  // Zierringe (Schlagring, Schulter) + Klöppel
  pb.cyl(0, lip + 0.16, 0, 0.745, 0.035, 'metal_painted', { tint: '#8a6a32', seg: 22, ...P, caps: false, ao: false });
  pb.cyl(0, lip + 1.2, 0, 0.455, 0.03, 'metal_painted', { tint: '#8a6a32', seg: 18, ...P, caps: false, ao: false });
  pb.cyl(0, lip + 0.32, 0, 0.03, 0.98, 'metal_painted', { tint: IRON, seg: 6, ...P, ao: false });
  pb.cyl(0, lip + 0.2, 0, 0.11, 0.16, 'metal_painted', { tint: IRON, r1: 0.08, seg: 10, ...P, ao: false });
  pb.cyl(0, lip + 0.02, 0, 0.04, 0.18, 'metal_painted', { tint: IRON, r1: 0.06, seg: 6, ...P, ao: false });
  const swing = partGroup(b, pb, { name: 'glocke' });
  swing.name = 'glocke-sant-aurel';
  place(swing, x, pivotY, z, 0);
  const sx0 = x, sy0 = pivotY - 1.0, sz0 = z; // Klangquelle (Mitte der Glocke)

  // --- Uhrzeiger: ein Mesh (Minute + Stunde je Zifferblatt), einmal je Minute neu gestellt
  const hp = partBuilder(b);
  hp.box(0, -0.5, 0, 1, 1, 1, 'black', { ...P, ao: false });
  const handTpl = partGroup(b, hp, { name: 'zeiger', cast: false }).children[0];
  const faces = o.faces || [];
  const HANDS = []; // [Zifferblatt, Minute?]
  for (const f of faces) HANDS.push([f, true], [f, false]);
  const tg = handTpl.geometry, nv = tg.attributes.position.count;
  const geo = new THREE.BufferGeometry();
  const rep = (a, k) => { const out = new Float32Array(a.length * HANDS.length); for (let i = 0; i < HANDS.length; i++) out.set(a, i * a.length); return new THREE.BufferAttribute(out, k); };
  geo.setAttribute('position', rep(tg.attributes.position.array, 3));
  geo.setAttribute('normal', rep(tg.attributes.normal.array, 3));
  geo.setAttribute('uv', rep(tg.attributes.uv.array, 2));
  geo.setAttribute('color', rep(tg.attributes.color.array, 3));
  const tplP = tg.attributes.position.array.slice(), tplN = tg.attributes.normal.array.slice();
  tg.dispose();
  const hands = new THREE.Mesh(geo, handTpl.material);
  hands.name = 'turmuhr-zeiger';
  hands.matrixAutoUpdate = false;
  hands.castShadow = false;
  hands.receiveShadow = true;
  if (faces.length) {
    const c = faces.reduce((s, f) => [s[0] + f[0] / faces.length, s[1] + f[1] / faces.length, s[2] + f[2] / faces.length], [0, 0, 0]);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(...c), faces.reduce((r, f) => Math.max(r, Math.hypot(f[0] - c[0], f[1] - c[1], f[2] - c[2])), 0) + 1.2);
  }
  const M = new THREE.Matrix4(), Mf = new THREE.Matrix4(), Mh = new THREE.Matrix4(), Nm = new THREE.Matrix3(), v = new THREE.Vector3();
  let shownMin = -1;
  function setHands(ms) {
    const d = new Date(ms), min = d.getMinutes(), h = d.getHours() % 12;
    const am = (min / 60) * Math.PI * 2, ah = ((h + min / 60) / 12) * Math.PI * 2;
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    HANDS.forEach(([f, isMin], i) => {
      const L = isMin ? 0.66 : 0.44, tail = 0.12, w = isMin ? 0.045 : 0.07, dz = isMin ? 0.105 : 0.12;
      Mf.makeRotationY(f[3]).setPosition(f[0], f[1], f[2]);
      Mh.makeTranslation(0, 0, dz).multiply(new THREE.Matrix4().makeRotationZ(-(isMin ? am : ah)))
        .multiply(new THREE.Matrix4().makeTranslation(0, (L - tail) / 2, 0)).multiply(new THREE.Matrix4().makeScale(w, L + tail, 0.012));
      M.multiplyMatrices(Mf, Mh);
      Nm.getNormalMatrix(M);
      for (let k = 0; k < nv; k++) {
        v.fromArray(tplP, k * 3).applyMatrix4(M).toArray(pos, (i * nv + k) * 3);
        v.fromArray(tplN, k * 3).applyMatrix3(Nm).normalize().toArray(nor, (i * nv + k) * 3);
      }
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
  }
  setHands(Date.now());

  // --- Zeitplan, Klang, Stellung
  const clock = craneClock();
  let G = null, lastWall = null, lastShared = null, reqT = -1e9, test = null;

  function ring(vol, fadeAt) {
    const a = G?.audio, st = G?.match?.state;
    if (!a || typeof a.play !== 'function' || (st !== 'playing' && st !== 'countdown')) return;
    if (G.settings?.get?.('glocke') === false) return; // Liste 2: Läuten abschaltbar (Einstellung folgt) – fehlt sie, läutet es
    const L = a.listener, dist = L && L.valid ? Math.hypot(sx0 - L.x, sy0 - L.y, sz0 - L.z) : 40;
    try {
      a.play('amb_bell', {
        position: { x: sx0, y: sy0, z: sz0 }, volume: vol, bus: 'amb', priority: 1, ref: 28, env: 0, er: 0, loud: null,
        pitchJit: 0, occlusion: false, delay: dist / SOUND, fadeAt, fadeLen: fadeAt ? 1.6 : undefined,
      });
    } catch { /* Ton ist Beiwerk */ }
  }

  /** Klang bereitstellen (nach dem Atmo-Start der Karte, der fremde Atmo-Klänge freigibt). */
  function prepare(now) {
    const a = G?.audio;
    if (!a || typeof a.prerender !== 'function' || now - reqT < 15) return;
    if (a.ambienceId !== 'desert') return;
    reqT = now;
    try { a.prerender(['amb_bell']); } catch { /* */ }
  }

  /** Aktueller Stundenschlag (Wanduhr, s) oder null. */
  function hourEvent(tw) {
    if (test && test.kind === 'hour') {
      const s = tw - test.t0;
      if (s <= (test.n - 1) * T_HOUR / 2 + 20) return { t0: test.t0, n: test.n, s };
      test = null;
    }
    const H = hourAt(tw * 1000), s = tw - H.t0;
    return s <= (H.n - 1) * T_HOUR / 2 + 20 ? { t0: H.t0, n: H.n, s } : null;
  }
  /** Laufendes Geläut (gemeinsame Uhr) oder null. */
  function pealEvent(ts, tw) {
    if (test && test.kind === 'peal') {
      const u = tw - test.t0;
      if (u <= RAMP_PEAL + test.hold + 18) return { u, hold: test.hold, wall: true };
      test = null;
    }
    const k = Math.floor(ts / P_PEAL), pe = pealOf(seed, k);
    return ts >= pe.t0 && ts <= pe.end ? { u: ts - pe.t0, hold: pe.hold, wall: false } : null;
  }

  const update = (dt, camera) => {
    const ms = Date.now(), tw = ms / 1000, ts = clock.now();
    if (Math.floor(ms / 60000) !== shownMin) { shownMin = Math.floor(ms / 60000); setHands(ms); }
    if (G) prepare(tw);
    // Rücksprung (neues Match, Zeitabgleich) → nichts nachholen
    if (lastWall === null || tw < lastWall - 1 || tw - lastWall > 5) lastWall = tw;
    if (lastShared === null || ts < lastShared - 1 || ts - lastShared > 5) lastShared = ts;
    const H = hourEvent(tw);
    let theta = 0;
    if (H) {
      theta = hourAngle(H.s, H.n);
      for (let k = 0; k < H.n; k++) {
        const t = H.t0 + (k * T_HOUR) / 2;
        if (t > lastWall && t <= tw && tw - t < 0.75) ring(0.95);
      }
    } else {
      const E = pealEvent(ts, tw);
      if (E) {
        const t1 = E.wall ? tw : ts, t0p = t1 - E.u, prev = E.wall ? lastWall : lastShared;
        theta = pealAmp(E.u, E.hold) * Math.sin((2 * Math.PI * E.u) / T_PEAL);
        // Schläge an den Umkehrpunkten (Klöppel schlägt an), sobald die Glocke hoch genug schwingt
        const k0 = Math.max(0, Math.floor(((prev - t0p) - T_PEAL / 4) / (T_PEAL / 2)));
        for (let k = k0; k < k0 + 4; k++) {
          const u = T_PEAL / 4 + (k * T_PEAL) / 2, t = t0p + u;
          if (t > t1) break;
          const amp = pealAmp(u, E.hold) / A_PEAL;
          if (t > prev && t1 - t < 0.75 && amp > 0.42) ring(0.45 + 0.4 * amp, 3.2);
        }
      }
    }
    lastWall = tw; lastShared = ts;
    if (camera && !inView(camera, x, pivotY - 0.8, z, 2.5, 20)) return;
    place(swing, x, pivotY, z, theta);
  };
  update(0, null);
  b.object(swing, { update });
  if (HANDS.length) b.object(hands);

  return {
    attach(world, g) {
      G = g || null;
      clock.attach(g);
      // Prüfhilfe (Konsole): test(9) → 9 Schläge jetzt, test('laeuten') → Geläut jetzt (nur lokal)
      if (world) world.glocke = {
        test(n = 9) {
          const tw = Date.now() / 1000;
          test = n === 'laeuten' || n === 'peal' ? { kind: 'peal', t0: tw, hold: 18 } : { kind: 'hour', t0: tw + RAMP_HOUR, n: Math.max(1, Math.min(12, n | 0)) };
          return test;
        },
        /** Nächstes Geläut auf der gemeinsamen Uhr (s) und die aktuelle Uhr. */
        next() { const ts = clock.now(), k = Math.floor(ts / P_PEAL); let pe = pealOf(seed, k); if (pe.end < ts) pe = pealOf(seed, k + 1); return { now: ts, start: pe.t0, hold: pe.hold }; },
        get angle() { return swing.rotation.x; },
      };
    },
  };
}
