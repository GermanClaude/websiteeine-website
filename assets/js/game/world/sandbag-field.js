// NULLPUNKT — Sandsackwände aus einzelnen Säcken (21.10., eigene Geometrie) (Owner: world).
// Jeder Sack ist eine Instanz eines kissenförmigen Körpers: flache Oberseite, gewölbte Stirn, eingeschnürte Enden
// (dort klaffen die dunklen Fugen zwischen den Säcken), Knitterfalten je Variante. Wände im Läuferverband (jede zweite
// Lage halb versetzt), Säcke leicht verdreht/gestaucht, untere Lagen nass und dunkler. Drei Stufen nach Abstand:
// nah (96 Dreiecke je Sack, Schatten ab „hoch“), mittel (24 Dreiecke), fern ausgeblendet (in Gräben verdeckt).
// Nur Optik – Kollision und Kugeln trifft die Grabenwand des Geländes dahinter.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
/** Abstände [nah, mittel] je Stufe (m) und Obergrenze der Nahstufe (Instanzen). */
const LOD = { low: [0, 32], medium: [14, 70], high: [20, 95], ultra: [28, 120] };
const NEAR_CAP = { low: 0, medium: 1800, high: 3200, ultra: 4800 };

/**
 * Sackkörper (Länge 1 entlang x, Tiefe 1 entlang z, Höhe 1 entlang y; Stirn bei +z), Profil über Oberseite und Stirn
 * bis unter die Unterkante. cols: Teilungen entlang x, prof: Profilpunkte. seed: Knitter-Variante.
 */
function bagGeometry(detailed, seed, tiny = false) {
  // Querschnitt: Superellipse (prall gefüllt, Ober-/Unterseite leicht abgeflacht, unten etwas breiter – Last),
  // geschlossener Ring (z, y, Helligkeit); vorn bei +z
  const nP = detailed ? 12 : tiny ? 4 : 6, pe = 2.6;
  const prof = [];
  for (let k = 0; k < nP; k++) {
    const th = Math.PI / 2 - (k / nP) * Math.PI * 2;      // oben → vorn → unten → hinten
    const c = Math.cos(th), sn = Math.sin(th);
    const z = 0.5 * Math.sign(c) * Math.pow(Math.abs(c), 2 / pe), y0 = 0.5 * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / pe);
    const y = y0 < 0 ? y0 * 0.94 : y0;
    prof.push([z * (y < 0 ? 1.04 : 1), y, 0.82 + 0.18 * (y + 0.5)]);
  }
  // Teilung entlang der Länge: dicht an den Enden (stumpfe, umgeschlagene Zipfel)
  const us = detailed ? [-1, -0.93, -0.72, -0.36, 0, 0.36, 0.72, 0.93, 1] : tiny ? [-1, 1] : [-1, -0.86, 0.86, 1];
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 233280 + 49297) % 2147483647) / 2147483647);
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const P = [], U = [], C = [], I = [];
  let arc = 0;
  const arcs = prof.map((p, k) => (k ? (arc += Math.hypot(p[0] - prof[k - 1][0], p[1] - prof[k - 1][1])) : 0));
  for (const u of us) {
    const au = Math.abs(u);
    // Querschnitt bleibt bis kurz vor dem Ende voll und fällt dann auf die Hälfte (stumpfes Ende)
    const e = Math.min(1, Math.max(0, (au - 0.7) / 0.3)), pinch = 1 - 0.5 * e * e * (3 - 2 * e) * (au > 0.97 ? 1 : 0.7);
    const back = 0.06 * e * e;
    for (let k = 0; k < prof.length; k++) {
      const [pz, py, sh] = prof[k];
      // Knitter: wenige Falten quer über die Stirn, stärker zu den Enden
      const wr = detailed ? (Math.sin(u * 7 + ph[0] + py * 3) * 0.02 + Math.sin(u * 13 + ph[1] - pz * 5) * 0.01) * (0.4 + au) : 0;
      const x = u * 0.5 * (1 - 0.05 * Math.abs(py));
      const y = py * pinch + wr * 0.6;
      const z = pz * (0.88 + 0.12 * pinch) - back + (pz > 0 ? wr : 0);
      P.push(x, y, z);
      U.push(u * 0.5 + seed * 0.37, arcs[k] * 0.5 + seed * 0.61); // je Variante andere Stelle der Textur (Schlammflecken)
      const c = sh * (1 - e * 0.25);
      C.push(c, c, c);
    }
  }
  const cols = us.length - 1;
  const n = prof.length;
  // Mantel geschlossen (letzter Profilpunkt → erster: Rückseite), damit Säcke auch von hinten/unten voll wirken
  for (let i = 0; i < cols; i++) for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const a = i * n + k, b = (i + 1) * n + k, c = (i + 1) * n + k1, d = i * n + k1;
    I.push(a, d, b, b, d, c);
  }
  // Stirnseiten (eingeschnürte Enden) als Fächer
  // Ring läuft von +x gesehen gegen den Uhrzeigersinn: Fächer (0, k, k+1) zeigt nach +x → Ende bei u = −1 umdrehen
  for (const [i, flip] of [[0, false], [cols, true]]) {
    const base = i * n;
    for (let k = 1; k < n - 1; k++) { if (flip) I.push(base, base + k, base + k + 1); else I.push(base, base + k + 1, base + k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class SandbagField {
  /** quality: 'low'|'medium'|'high'|'ultra'; shadow: Nahstufe wirft Schatten. */
  constructor({ quality = 'high', shadow = false, tint = '#5d5850' } = {}) {
    this.quality = quality; this.shadow = shadow; this.tint = new THREE.Color(tint);
    this.bags = []; // { m (Matrix4), x, z, v (Variante), col }
    this.group = new THREE.Group();
    this.group.name = 'sandsaecke';
    this.stats = { bags: 0, near: 0, mid: 0 };
    this._last = new THREE.Vector3(1e9, 0, 1e9);
  }

  /**
   * Wand aus Säcken: Mitte unten (cx, y0, cz), Drehung ry (lokal +z = Stirnseite, x = Wandrichtung), Länge L, Höhe H.
   * o: { lean (Rückneigung m/m), bagL, bagH, bagD, wet (Lagen bis zu dieser Höhe nass/dunkel), tone, seed }
   */
  addWall(cx, y0, cz, ry, L, H, o = {}) {
    let s = (o.seed || 1) * 7919 + 17;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const bagL = o.bagL ?? 0.5, bagH = o.bagH ?? 0.13, bagD = o.bagD ?? 0.32, lean = o.lean ?? 0.14, wet = o.wet ?? 0.5, tone = o.tone ?? 1;
    const c = Math.cos(ry), sn = Math.sin(ry);
    let y = 0, row = 0;
    while (y < H - bagH * 0.4) {
      const h = bagH * (0.88 + r() * 0.24);
      let x = -L / 2 + (row % 2 ? -bagL * 0.5 : 0) + (r() - 0.5) * 0.1;
      while (x < L / 2 - bagL * 0.15) {
        const l = bagL * (0.9 + r() * 0.2);
        const lx = Math.max(-L / 2 + l * 0.35, Math.min(L / 2 - l * 0.35, x + l / 2)); // Randsäcke nicht aus der Wand ragen lassen
        const lz = -lean * (y + h / 2) + (r() - 0.5) * 0.03 - bagD * 0.5 + 0.04;
        const wx = cx + lx * c + lz * sn, wz = cz - lx * sn + lz * c;
        _e.set((r() - 0.5) * 0.06 - lean * 0.6, ry + (r() - 0.5) * 0.09, (r() - 0.5) * 0.07, 'YXZ');
        _q.setFromEuler(_e);
        _s.set(l * 1.04, h * 1.06, bagD * (0.9 + r() * 0.2));
        _p.set(wx, y0 + y + h / 2, wz);
        const wetK = y < wet ? 0.62 + 0.38 * (y / Math.max(0.01, wet)) : 1;
        this.bags.push({ m: _m.compose(_p, _q, _s).clone(), x: wx, z: wz, v: Math.floor(r() * 3), col: tone * wetK * (0.78 + r() * 0.34) });
        x += l;
      }
      y += h * 0.97; row++;
    }
  }

  build(getMaterial) {
    const q = this.quality;
    const mat = getMaterial('sackleinen', { vertexColors: true });
    const mk = (geom, n, name, shadow) => {
      const m = new THREE.InstancedMesh(geom, mat, Math.max(1, n));
      m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const byV = [0, 0, 0];
    for (const b of this.bags) byV[b.v]++;
    const nearCap = NEAR_CAP[q] ?? 3200;
    this.meshes = [0, 1, 2].map((v) => ({
      near: nearCap ? mk(bagGeometry(true, v + 1), Math.min(byV[v], nearCap), 'sandsack-nah', this.shadow) : null,
      mid: mk(bagGeometry(false, v + 1, q === 'low'), byV[v], 'sandsack', false),
    }));
    this.stats.bags = this.bags.length;
    return this.group;
  }

  update(camera, force = false) {
    const p = camera.position;
    if (!force && this._last.distanceToSquared(p) < 9) return;
    this._last.copy(p);
    const [dn, dm] = LOD[this.quality] || LOD.high;
    const n2 = dn * dn, m2 = dm * dm;
    const cN = [0, 0, 0], cM = [0, 0, 0];
    for (const b of this.bags) {
      const dx = b.x - p.x, dz = b.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 >= m2) continue;
      const M = this.meshes[b.v];
      let mesh, k;
      if (d2 < n2 && M.near && cN[b.v] < M.near.instanceMatrix.count) { mesh = M.near; k = cN[b.v]++; }
      else { mesh = M.mid; k = cM[b.v]++; }
      b.m.toArray(mesh.instanceMatrix.array, k * 16);
      const ca = mesh.instanceColor.array, T = this.tint; ca[k * 3] = b.col * T.r; ca[k * 3 + 1] = b.col * T.g; ca[k * 3 + 2] = b.col * T.b;
    }
    let nn = 0, nm = 0;
    this.meshes.forEach((M, v) => {
      for (const [mesh, c] of [[M.near, cN[v]], [M.mid, cM[v]]]) {
        if (!mesh) continue;
        mesh.count = c; mesh.visible = c > 0;
        if (c) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
      }
      nn += cN[v]; nm += cM[v];
    });
    this.stats.near = nn; this.stats.mid = nm;
  }

  dispose() { this.group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.dispose(); o.dispose(); } }); }
}
