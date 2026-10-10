// NULLPUNKT — Karte „Bibliothek“: alte Zauberbibliothek in einer riesigen Steinhalle (x −55..55, z −40..40, 16 m hoch).
// Regalblöcke links und rechts des Mittelgangs bilden Gassen, Galerien an den Längswänden (5 m) und zwei Holzbrücken
// quer über die Halle geben Höhe; in der Mitte eine Rotunde mit schwebendem Himmelsglobus, Lesetische als Deckung,
// Säulenreihe am Mittelgang. Norden: Eingangshalle (Team A), Süden: Verbotene Abteilung hinter Eisengittern (Team B).
// Magie: fliegende Bücher kreisen über den Regalen und um die Rotunde, schwebende Kerzen, Globus mit Ringen dreht sich
// (alles ohne Kollision, über Kopfhöhe). Licht: Kerzen/Kronleuchter warm, Fensterbänder kühl. (Owner: world)
import * as THREE from 'three';
import { wall, slab, stairs, railing } from '../arch.js';
import { chair, hash01 } from '../props.js';

const X = 55, Z = 40, H = 16, GY = 5; // Halle, Höhe, Galerie-/Brückenhöhe
const STONE = '#9a8f7d', STONE_D = '#7d7262', WOOD = '#5a3b24', WOOD_L = '#7a5233';
const BOOK = ['#7a1f1f', '#1f3f6a', '#2f5a2a', '#6a4a1f', '#4a2a5a', '#8a6a2a', '#2a2a2a', '#5a1f3a'];

export default {
  id: 'bibliothek',
  seed: 7349,
  bounds: { minX: -X, maxX: X, minZ: -Z, maxZ: Z, minY: -2, maxY: H + 2 },
  visualBounds: { minX: -X - 10, maxX: X + 10, minZ: -Z - 10, maxZ: Z + 10 },
  chunkSize: 30,
  ambience: 'industrial',
  defaultSurface: 'wood',
  navSpacing: 1.4,
  groundNoise: 0.08,
  interiorTint: [1, 0.9, 0.78],
  lighting: {
    sun: { elevation: 24, azimuth: 210, color: '#cdd8ff', intensity: 0.4 },
    sky: { turbidity: 6, rayleigh: 2.4, mieCoefficient: 0.01, mieDirectionalG: 0.8, exposure: 0.3, tint: '#5a6080', clouds: { coverage: 0.7, density: 0.5, scale: 0.0002 }, hazeHigh: 0.2, hdri: false },
    hemi: { sky: '#8a7a68', ground: '#3a2a1c', intensity: 1.1 },
    env: { intensity: 1.1, ground: '#3a2c20', groundIntensity: 0.5, tint: '#d8b890' },
    fog: { color: '#3a2c22', near: 30, far: 160, density: 0.009, falloff: 0.06, start: 8, sun: 0.2, sunExp: 4 },
    shadow: { size: 36, bias: -0.0005 },
    exposure: 1.7,
    probes: { bounce: 1.25, flicker: [{ group: 3, amount: 0.25, speed: 7 }] },
    atmos: { beams: 0.02, beamG: 0.5, dust: 2.2, slots: 0.4, outdoor: 0.1 },
  },

  build(b) {
    const zones = [];
    const r = (k) => hash01(k * 1.37, k * 0.71, 11);
    // ------------------------------------------------------------------ Hülle
    b.groundTiled(-X, -Z, X, Z, 'wood_planks', { cell: 1.2, tint: '#6b4a30' });
    b.ground(-4, -Z, 4, Z, 'tiles_pattern', { cell: 1, y: 0.01, collide: false, tint: '#a89a84' });
    b.interior(-X, -Z, X, Z, -0.1, H, 0.55);
    const wl = { h: H, t: 0.8, mat: 'stone_wall', tint: STONE, minimap: 'wall' };
    wall(b, { ...wl, x0: -X, z0: -Z, x1: X, z1: -Z });
    wall(b, { ...wl, x0: X, z0: Z, x1: -X, z1: Z });
    wall(b, { ...wl, x0: -X, z0: Z, x1: -X, z1: -Z });
    wall(b, { ...wl, x0: X, z0: -Z, x1: X, z1: Z });
    b.boxMM(-X - 0.5, H, -Z - 0.5, X + 0.5, H + 0.6, Z + 0.5, 'stone_wall', { tint: STONE_D, minimap: 'roof', grad: false });
    // Deckengewölbe angedeutet: Gurtbögen + Fensterbänder (kühles Mondlicht) in den Längswänden
    for (let z = -32; z <= 32; z += 8) {
      b.box(0, H - 1.2, z, 2 * X, 1.2, 0.8, 'stone_wall', { tint: STONE_D, collide: false, minimap: false, grad: false });
      for (const s of [-1, 1]) {
        b.box(s * (X - 0.42), 8.5, z + 4, 0.05, 6, 2.2, 'lamp_cool', { tint: '#7f96c8', collide: false, minimap: false, ao: false, cast: false });
        b.light('point', s * (X - 2), 10, z + 4, { color: '#8fa6e0', intensity: 14, distance: 18, realtime: false });
      }
    }
    // ------------------------------------------------------------------ Säulen am Mittelgang
    for (let z = -28; z <= 28; z += 8) for (const s of [-1, 1]) {
      b.cyl(s * 6, 0, z, 0.55, H - 1.2, 'stone_wall', { tint: STONE, seg: 12, minimap: 'pillar' });
      b.box(s * 6, 0, z, 1.5, 0.5, 1.5, 'stone_wall', { tint: STONE_D, minimap: false });
    }
    // ------------------------------------------------------------------ Regalblöcke
    const blocks = [[-24, -16], [-10, -2], [2, 10], [16, 24]];
    let k = 0;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const x = s * (10 + i * 5);
        for (const [z0, z1] of blocks) {
          k++;
          // Lichtungen: Lesebereiche statt Regal
          if ((i === 3 && z0 === 2 && s < 0) || (i === 3 && z0 === -10 && s > 0) || (i === 5 && z0 === 16)) continue;
          const tall = (i + (z0 > 0 ? 1 : 0)) % 3 === 0;
          const under = Math.abs(z0) === 2 || Math.abs(z1) === 10 || Math.abs(z0) === 16 || Math.abs(z1) === 16; // an Brücken: niedrig
          shelf(b, x, (z0 + z1) / 2, z1 - z0, tall && !under ? 5.4 : 3.2, k);
        }
      }
    }
    // ------------------------------------------------------------------ Galerien (Längswände) + Brücken
    for (const s of [-1, 1]) {
      const x0 = s * (X - 6.5), x1 = s * (X - 0.4);
      slab(b, Math.min(x0, x1), -26, Math.max(x0, x1), 26, GY - 0.25, 0.25, 'wood_planks', [], { tint: WOOD_L });
      // Geländer zur Halle, offen zu den Brücken (z ±11,5..14,5)
      for (const [za, zb] of [[-26, -14.5], [-11.5, 11.5], [14.5, 26]]) railing(b, x0, za, x0, zb, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      for (let z = -24; z <= 24; z += 6) b.cyl(x0, 0, z, 0.22, GY - 0.25, 'wood_dark', { tint: WOOD, seg: 8, minimap: false });
      // Wandregale auf der Galerie
      for (let z = -21; z <= 21; z += 7) shelf(b, s * (X - 1.2), z, 6, 4.4, 900 + z, { y: GY, along: 'z', wallSide: s });
      // Treppen an beiden Enden (münden an der Stirnseite der Galerie)
      stairs(b, { x: s * (X - 3.5), z: -32, dir: 'n', y0: 0, y1: GY, w: 2.6, run: 6, mat: 'wood_planks', tint: WOOD_L, rail: true });
      stairs(b, { x: s * (X - 3.5), z: 32, dir: 's', y0: 0, y1: GY, w: 2.6, run: 6, mat: 'wood_planks', tint: WOOD_L, rail: true });
    }
    for (const zc of [-13, 13]) {
      slab(b, -X + 6.5, zc - 1.5, X - 6.5, zc + 1.5, GY - 0.25, 0.25, 'wood_planks', [], { tint: WOOD_L });
      railing(b, -X + 6.5, zc - 1.5, X - 6.5, zc - 1.5, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      railing(b, -X + 6.5, zc + 1.5, X - 6.5, zc + 1.5, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      for (let x = -40; x <= 40; x += 10) if (Math.abs(x) > 7) b.cyl(x, 0, zc, 0.2, GY - 0.25, 'wood_dark', { tint: WOOD, seg: 8, minimap: false });
    }
    // ------------------------------------------------------------------ Rotunde (Mitte)
    b.cyl(0, 0, 0, 7.5, 0.3, 'stone_wall', { tint: '#b5a88f', seg: 32, minimap: 'cover' });
    b.cyl(0, 0.3, 0, 2.2, 1.1, 'stone_wall', { tint: STONE_D, seg: 20 }); // Sockel des Globus
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      readingDesk(b, Math.sin(ang) * 5.2, Math.cos(ang) * 5.2, ang, a);
    }
    // ------------------------------------------------------------------ Lesesäle (Lichtungen) + Deckung im Mittelgang
    for (const [x, z] of [[-25, 6], [25, -6], [-35, 20], [35, 20]]) table(b, x, z, Math.PI / 2);
    for (const [x, z] of [[0, 18], [0, -18], [-2, 26], [2, -26], [0, 10], [0, -10]]) bookPile(b, x, z, Math.round(x * 7 + z * 3));
    // ------------------------------------------------------------------ Eingangshalle (Norden, Team A)
    for (const s of [-1, 1]) for (const zz of [30, 36]) b.cyl(s * 14, 0, zz, 0.7, H - 1.2, 'stone_wall', { tint: STONE, seg: 14, minimap: 'pillar' });
    b.box(0, 0, Z - 0.6, 7, 6.5, 0.5, 'wood_dark', { tint: '#4a2e1a', minimap: 'wall' }); // großes Portal (geschlossen)
    zones.push({ x0: -20, z0: 28, x1: 20, z1: Z, kind: 'plaza' });
    // ------------------------------------------------------------------ Verbotene Abteilung (Süden, Team B)
    for (const s of [-1, 1]) {
      const xa = s * 4, xb = s * 46;
      bars(b, xa, -27, xb, -27, 3.6);
    }
    for (let x = -40; x <= 40; x += 10) if (Math.abs(x) > 6) shelf(b, x, -38.9, 6, 4.2, 500 + x, { along: 'x', wallSide: -1, tint: '#3a2418' });
    zones.push({ x0: -46, z0: -Z, x1: 46, z1: -27, kind: 'restricted' });
    // ------------------------------------------------------------------ Licht: Kronleuchter + Kerzen
    for (let z = -24; z <= 24; z += 12) {
      chandelier(b, 0, z);
      b.light('point', 0, 9.5, z, { color: '#ffc27a', intensity: 34, distance: 26, group: 3 });
    }
    for (const [x, z] of [[-25, 6], [25, -6], [-35, 20], [35, 20], [-30, -34], [30, -34], [0, 34]]) b.light('point', x, 2.6, z, { color: '#ffb060', intensity: 9, distance: 10, realtime: false, group: 3 });

    // ------------------------------------------------------------------ Startpunkte & Flaggen
    const spawns = { A: [], B: [], ffa: [] };
    for (const x of [-12, -8, -4, 0, 4, 8, 12, -16, 16, -20, 20, -24]) {
      spawns.A.push({ x, z: 34 + (Math.abs(x) % 3), yaw: 0 });
      spawns.B.push({ x, z: -34 - (Math.abs(x) % 3) + 2, yaw: Math.PI });
    }
    for (const [x, z] of [[-30, 0], [30, 0], [-20, 13], [20, -13], [-45, 20], [45, -20], [-45, -10], [45, 10], [0, 22], [0, -22], [-12, -6], [12, 6], [-38, -20], [38, 20]]) spawns.ffa.push({ x, z });
    b.navPoint(0, 0.4, 0);
    // Magie: fliegende Bücher, schwebende Kerzen, drehender Globus (ohne Kollision)
    magic(b);
    return {
      spawns,
      objectives: { dom: [{ id: 'A', x: -25, z: 6, radius: 5 }, { id: 'B', x: 0, z: 0, radius: 6 }, { id: 'C', x: 25, z: -6, radius: 5 }] },
      zones,
    };
  },
};

/** Bücherregal: Korpus (Kollision) + Bücherreihen (farbige Rücken) auf beiden Seiten bzw. zur Halle. */
function shelf(b, x, z, len, h, seed, o = {}) {
  const y = o.y ?? 0;
  const alongZ = o.along !== 'x';
  const w = 0.7;
  const sx = alongZ ? w : len, sz = alongZ ? len : w;
  b.box(x, y, z, sx, h, sz, 'wood_dark', { tint: o.tint || WOOD, minimap: y > 0 ? false : 'wall' });
  const levels = Math.max(2, Math.floor(h / 0.85));
  const sides = o.wallSide ? [-o.wallSide] : [-1, 1];
  for (const side of sides) {
    for (let l = 0; l < levels; l++) {
      const ly = y + 0.12 + l * (h - 0.2) / levels;
      // Fachboden-Kante + Bücher in Abschnitten (Farbe je Abschnitt)
      const n = Math.max(2, Math.round(len / 1.1));
      for (let i = 0; i < n; i++) {
        const c = BOOK[Math.floor(hash01(seed + i, l * 3 + side, 5) * BOOK.length)];
        const seg = len / n;
        const along = -len / 2 + seg * (i + 0.5);
        const bh = 0.55 + hash01(seed, i + l * 7, 9) * 0.22;
        const off = side * (w / 2 + 0.005);
        if (alongZ) b.box(x + off, ly, z + along, 0.06, bh, seg - 0.06, 'wood_painted', { tint: c, collide: false, minimap: false, grad: false, ao: false });
        else b.box(x + along, ly, z + off, seg - 0.06, bh, 0.06, 'wood_painted', { tint: c, collide: false, minimap: false, grad: false, ao: false });
      }
    }
  }
}

function table(b, x, z, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  b.box(x, 0, z, 3.2, 0.78, 1.1, 'wood_dark', { ry, tint: WOOD_L, minimap: 'cover' });
  for (const t of [-1.0, 0, 1.0]) for (const side of [-1, 1]) chair(b, x + t * c + side * 0.85 * s, z - t * s + side * 0.85 * c, { ry: ry + (side > 0 ? 0 : Math.PI), tint: '#4a2e1a' });
  b.cyl(x, 0.78, z, 0.06, 0.25, 'white', { collide: false, minimap: false, seg: 8 }); // Kerze
  b.glow(x, 1.1, z, { size: 0.8, color: '#ffb060', intensity: 0.8 });
}

function readingDesk(b, x, z, ry, k) {
  b.box(x, 0.3, z, 1.4, 0.9, 0.7, 'wood_dark', { ry, tint: WOOD, minimap: 'cover' });
  b.box(x, 1.2, z, 0.5, 0.06, 0.4, 'wood_painted', { ry: ry + 0.3, tint: BOOK[k % BOOK.length], collide: false, minimap: false }); // offenes Buch
}

function bookPile(b, x, z, seed) {
  for (let i = 0; i < 6; i++) {
    const c = BOOK[Math.floor(hash01(seed, i, 3) * BOOK.length)];
    b.box(x + (hash01(seed, i, 4) - 0.5) * 0.2, i * 0.16, z + (hash01(seed, i, 6) - 0.5) * 0.2, 0.9, 0.16, 0.6, 'wood_painted', { tint: c, ry: hash01(seed, i, 7) * 0.6, collide: i === 0, minimap: i === 0 ? 'cover' : false, grad: false });
  }
  b.box(x, 0, z, 0.9, 0.95, 0.6, 'black', { visual: false, minimap: false });
}

/** Eisengitter (Stäbe, Kollision als dünne Wand ohne Kugelschutz). */
function bars(b, xa, za, xb, zb, h) {
  const L = Math.hypot(xb - xa, zb - za), n = Math.round(L / 0.18);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.cyl(xa + (xb - xa) * t, 0, za + (zb - za) * t, 0.022, h, 'metal_painted', { tint: '#1e1e22', collide: false, seg: 5, minimap: false, ao: false });
  }
  b.box((xa + xb) / 2, h - 0.08, (za + zb) / 2, Math.abs(xb - xa) || 0.1, 0.08, Math.abs(zb - za) || 0.1, 'metal_painted', { tint: '#1e1e22', collide: false, minimap: false });
  b.box((xa + xb) / 2, 0, (za + zb) / 2, Math.abs(xb - xa) || 0.1, h, Math.abs(zb - za) || 0.1, 'black', { visual: false, bullet: false, minimap: 'wall' });
}

function chandelier(b, x, z) {
  b.cyl(x, 10.2, z, 0.04, H - 10.2, 'metal_painted', { tint: '#3a2c1c', collide: false, seg: 6, minimap: false });
  b.cyl(x, 9.8, z, 1.8, 0.12, 'metal_painted', { tint: '#6a5230', collide: false, seg: 18, minimap: false });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.cyl(x + Math.sin(a) * 1.7, 9.92, z + Math.cos(a) * 1.7, 0.05, 0.28, 'white', { collide: false, seg: 6, minimap: false });
    b.glow(x + Math.sin(a) * 1.7, 10.3, z + Math.cos(a) * 1.7, { size: 0.7, color: '#ffbe70', intensity: 1 });
  }
}

/** Fliegende Bücher, schwebende Kerzen und der Himmelsglobus (animierte Einzelobjekte). */
function magic(b) {
  const g = new THREE.Group();
  g.name = 'magie';
  const bookGeo = new THREE.BoxGeometry(0.42, 0.08, 0.3);
  const pageGeo = new THREE.BoxGeometry(0.38, 0.06, 0.27);
  const pageMat = new THREE.MeshStandardMaterial({ color: '#efe4c8', roughness: 0.9 });
  const mats = BOOK.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const books = [];
  for (let i = 0; i < 46; i++) {
    const bk = new THREE.Group();
    const cover = new THREE.Mesh(bookGeo, mats[i % mats.length]);
    const pages = new THREE.Mesh(pageGeo, pageMat);
    pages.position.set(0.015, 0, 0);
    bk.add(cover, pages);
    const ring = i < 16;
    books.push({
      o: bk, ring,
      cx: ring ? 0 : (hash01(i, 1, 2) - 0.5) * 80, cz: ring ? 0 : (hash01(i, 3, 4) - 0.5) * 56,
      r: ring ? 4 + hash01(i, 5, 6) * 3 : 1 + hash01(i, 7, 8) * 2.5,
      y: ring ? 4.5 + hash01(i, 9, 10) * 3 : 6.2 + hash01(i, 11, 12) * 4,
      sp: (0.15 + hash01(i, 13, 14) * 0.25) * (i % 2 ? 1 : -1), ph: hash01(i, 15, 16) * 6.28,
    });
    g.add(bk);
  }
  // schwebende Kerzen über dem Mittelgang
  const candleGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8);
  const candleMat = new THREE.MeshStandardMaterial({ color: '#f2ead8', roughness: 0.6 });
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffcf80' });
  const flameGeo = new THREE.SphereGeometry(0.035, 6, 5);
  const candles = [];
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Group();
    const body = new THREE.Mesh(candleGeo, candleMat);
    const fl = new THREE.Mesh(flameGeo, flameMat);
    fl.position.y = 0.19;
    c.add(body, fl);
    const x = (hash01(i, 21, 22) - 0.5) * 9, z = -30 + (i / 40) * 60, y = 7 + hash01(i, 23, 24) * 2.5;
    c.position.set(x, y, z);
    candles.push({ o: c, y, ph: hash01(i, 25, 26) * 6.28 });
    g.add(c);
  }
  // Himmelsglobus mit Ringen (Rotunde)
  const globe = new THREE.Group();
  globe.position.set(0, 3.6, 0);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.3, 28, 18), new THREE.MeshStandardMaterial({ color: '#2a3d6a', emissive: '#1a2a5a', emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3 }));
  const ringMat = new THREE.MeshStandardMaterial({ color: '#c8a050', roughness: 0.35, metalness: 0.9, emissive: '#3a2a10', emissiveIntensity: 0.4 });
  const rings = [0, 1, 2].map((k2) => { const m = new THREE.Mesh(new THREE.TorusGeometry(1.75 + k2 * 0.3, 0.035, 8, 48), ringMat); m.rotation.x = 0.5 + k2 * 0.7; return m; });
  globe.add(sphere, ...rings);
  g.add(globe);
  let t = 0;
  b.object(g, {
    update(dt) {
      t += dt || 0.016;
      for (const bk of books) {
        const a = bk.ph + t * bk.sp;
        bk.o.position.set(bk.cx + Math.cos(a) * bk.r, bk.y + Math.sin(t * 0.8 + bk.ph) * 0.35, bk.cz + Math.sin(a) * bk.r);
        bk.o.rotation.set(Math.sin(t + bk.ph) * 0.3, -a, Math.sin(t * 1.3 + bk.ph) * 0.25);
      }
      for (const c of candles) c.o.position.y = c.y + Math.sin(t * 0.9 + c.ph) * 0.12;
      globe.rotation.y = t * 0.15;
      sphere.rotation.y = t * 0.35;
      rings.forEach((m, k2) => { m.rotation.z = t * (0.2 + k2 * 0.12) * (k2 % 2 ? -1 : 1); });
      globe.position.y = 3.6 + Math.sin(t * 0.6) * 0.15;
    },
  });
}
