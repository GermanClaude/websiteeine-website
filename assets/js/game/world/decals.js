// NULLPUNKT — env-look: Verwitterungs-Decals an Wänden (Owner: world/env-look). Nur medium+ (low bleibt unverändert).
//
// Ein eigener kleiner Atlas (8 Zellen à 256², 1024×512 RGBA ≈ 2,8 MB GPU inkl. Mipmaps, einmal je Sitzung) mit
// Rostläufen, Wasser-/Kalkfahnen, Schmutzsockel, Rissen, Leckflecken, Plakaten, Sprühzeichen und Rußfahnen.
// Platzierung nach dem Weltaufbau per Strahltest gegen die Kugel-BVH (world.raycast): auf einem gestreuten Raster
// werden waagerechte Strahlen geschossen; senkrechte Treffer bekommen je nach Material (Container, Wellblech, Beton,
// Putz, Ziegel) ein passendes Decal, wenn die ganze Fläche des Decals auf derselben Wand liegt (4 Eckstrahlen).
// Gesät über die Kartenkennung → jedes Laden gleich. Je 24-m-Zelle ein InstancedMesh (Frustum-Culling), Ausblenden
// ab ≈ 34–48 m im Shader. Höchstens 140/220/300 Decals (medium/high/ultra).
//
// placeLookDecals(world, group, { quality, seed, def }) → { count, meshes, ms }
import * as THREE from 'three';

export const LOOK_DECAL = { rust: 0, water: 1, grime: 2, cracks: 3, leak: 4, poster: 5, tag: 6, soot: 7 };
const CAP = { medium: 140, high: 220, ultra: 300 };
const CELL = 24;

let atlas = null;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function drawAtlas(ctx) {
  const C = 256, r = rng(4242);
  const cell = (i, fn) => { ctx.save(); ctx.translate((i % 4) * C, Math.floor(i / 4) * C); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip(); fn(); ctx.restore(); };
  const streaks = (n, col, a0, len0, w0, drip) => {
    for (let k = 0; k < n; k++) {
      const x = 20 + r() * 216, w = w0 * (0.4 + r()), len = len0 * (0.45 + r() * 0.55);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(${col},${a0})`); g.addColorStop(0.55, `rgba(${col},${a0 * 0.55})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - w / 2, 0);
      let xx = x;
      for (let y = 0; y <= len; y += 8) { xx += (r() - 0.5) * 1.6; ctx.lineTo(xx - w / 2 * (1 - y / len * 0.6), y); }
      for (let y = len; y >= 0; y -= 8) ctx.lineTo(xx + w / 2 * (1 - y / len * 0.6), y);
      ctx.closePath(); ctx.fill();
      if (drip && r() < 0.5) { ctx.fillStyle = `rgba(${col},${a0 * 0.8})`; ctx.beginPath(); ctx.arc(xx, len * 0.9, w * 0.25, 0, 7); ctx.fill(); }
    }
  };
  // 0 Rostlauf (von oben, orange-braun, Tropfnasen)
  cell(0, () => { streaks(20, '108,62,32', 0.4, 250, 8, true); streaks(12, '66,40,22', 0.36, 200, 4, true); });
  // 1 Wasser-/Kalkfahne (grau-dunkel, breit, weich)
  cell(1, () => { streaks(10, '28,28,26', 0.32, 256, 34, false); streaks(6, '205,200,188', 0.18, 200, 20, false); });
  // 2 Schmutzsockel (unten dunkel, Spritzer, nach oben auslaufend)
  cell(2, () => {
    const g = ctx.createLinearGradient(0, 256, 0, 40);
    g.addColorStop(0, 'rgba(40,34,26,0.62)'); g.addColorStop(0.35, 'rgba(52,44,34,0.32)'); g.addColorStop(1, 'rgba(52,44,34,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) { const y = 256 - Math.pow(r(), 2.2) * 150; ctx.fillStyle = `rgba(36,30,22,${0.15 + r() * 0.35})`; ctx.beginPath(); ctx.arc(r() * 256, y, 0.6 + r() * 2.2, 0, 7); ctx.fill(); }
    // seitlich weich auslaufen (Kanten unsichtbar)
    ctx.globalCompositeOperation = 'destination-in';
    const s = ctx.createLinearGradient(0, 0, 256, 0);
    s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.12, 'rgba(0,0,0,1)'); s.addColorStop(0.88, 'rgba(0,0,0,1)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(0, 0, 256, 256);
  });
  // 3 Wandrisse (verästelt, mit hellem Kantenausbruch)
  cell(3, () => {
    ctx.lineCap = 'round';
    const crack = (x, y, a, len, w) => {
      ctx.strokeStyle = 'rgba(18,16,14,0.85)'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y);
      for (let i = 0; i < len; i++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * 5; y += Math.sin(a) * 5; ctx.lineTo(x, y); if (r() < 0.07 && w > 0.7) { ctx.stroke(); crack(x, y, a + (r() - 0.5) * 2.2, len * 0.45, w * 0.6); ctx.strokeStyle = 'rgba(18,16,14,0.85)'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); } }
      ctx.stroke();
    };
    crack(128, 20, Math.PI / 2 + 0.2, 34, 2.2); crack(128, 128, 0.3, 18, 1.6);
  });
  // 4 Leckfleck (dunkler Fleck mit Läufen nach unten)
  cell(4, () => {
    for (let i = 0; i < 9; i++) { const x = 128 + (r() - 0.5) * 90, y = 50 + (r() - 0.5) * 40, rr = 30 + r() * 40; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(30,28,24,0.38)'); g.addColorStop(1, 'rgba(30,28,24,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256); }
    ctx.save(); ctx.translate(40, 50); ctx.scale(0.7, 0.8); streaks(8, '30,28,24', 0.4, 240, 14, true); ctx.restore();
  });
  // 5 Plakat (verblichen, eingerissen; Text ohne echte Marken)
  cell(5, () => {
    ctx.fillStyle = '#d9cfb8'; ctx.fillRect(28, 14, 200, 228);
    ctx.fillStyle = '#9c3b2a'; ctx.fillRect(40, 28, 176, 64);
    ctx.fillStyle = '#efe6d2'; ctx.font = '700 34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ZUTRITT', 128, 72);
    ctx.fillStyle = '#3b3a36'; for (let i = 0; i < 9; i++) ctx.fillRect(44, 112 + i * 13, 120 + r() * 50, 6);
    ctx.fillStyle = '#2d4a63'; ctx.fillRect(40, 220 - 18, 176, 14);
    // Verwitterung: ausgebleicht, Ränder eingerissen, Flecken
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 60; i++) { ctx.globalAlpha = 0.5 + r() * 0.5; ctx.beginPath(); const e = r() < 0.5; ctx.arc(e ? (r() < 0.5 ? 28 : 228) + (r() - 0.5) * 16 : 28 + r() * 200, e ? 14 + r() * 228 : (r() < 0.5 ? 14 : 242) + (r() - 0.5) * 16, 3 + r() * 10, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(150, 242); ctx.lineTo(228, 150); ctx.lineTo(228, 242); ctx.fill();
    ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = 1;
    for (let i = 0; i < 12; i++) { const x = r() * 256, y = r() * 256, rr = 20 + r() * 50; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(80,66,44,0.35)'); g.addColorStop(1, 'rgba(80,66,44,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256); }
  });
  // 6 Sprühzeichen (Schablonen-Nummer + Pfeil, übergesprüht)
  cell(6, () => {
    ctx.fillStyle = 'rgba(240,236,226,0.82)'; ctx.font = '700 92px monospace'; ctx.textAlign = 'center'; ctx.fillText('B7', 128, 130);
    ctx.fillRect(64, 160, 110, 16); ctx.beginPath(); ctx.moveTo(170, 145); ctx.lineTo(210, 168); ctx.lineTo(170, 191); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 500; i++) { ctx.globalAlpha = r() * 0.6; ctx.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); }
  });
  // 7 Rußfahne (Brand-/Abgasspur, nach oben breiter)
  cell(7, () => {
    for (let i = 0; i < 14; i++) { const y = 256 - i * 16, x = 128 + (r() - 0.5) * 30, rr = 30 + i * 6; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(14,12,10,${0.28 - i * 0.012})`); g.addColorStop(1, 'rgba(14,12,10,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256); }
  });
}

function getAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  drawAtlas(c.getContext('2d'));
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  atlas.name = 'np:look-decals';
  return atlas;
}

function decalMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: getAtlas(), transparent: true, depthWrite: false, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.name = 'look-decals';
  m.userData.disposable = true; m.userData.surface = 'concrete';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aCell.xy + uv * aCell.zw;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      // Atlas ist weich gezeichnet (mittlere Deckung 0,1–0,2) → Verstärkung, sonst verschwinden die Läufe auf dunklen Wänden
      diffuseColor.a = clamp( diffuseColor.a * 2.1, 0.0, 1.0 ) * ( 1.0 - smoothstep( 34.0, 48.0, length( vViewPosition ) ) );`);
  };
  m.customProgramCacheKey = () => 'np-look-decals-v2';
  return m;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3();
const _col = new THREE.Color();

/** Welches Decal passt zu einer Wand? → [Zelle, Breite, Höhe, Mittenhöhe über Boden] | null */
function pick(name, r) {
  const n = name || '';
  const k = r();
  if (/container/.test(n)) return k < 0.65 ? [LOOK_DECAL.rust, 0.5 + r() * 0.8, 1.0 + r() * 0.9, 2.59 - 0.5] : k < 0.85 ? [LOOK_DECAL.water, 0.8 + r(), 1.4 + r(), 1.6] : [LOOK_DECAL.tag, 0.9, 0.9, 1.3 + r() * 0.4];
  if (/corrugated|cladding|shutter|metal_rust/.test(n)) return k < 0.55 ? [LOOK_DECAL.rust, 0.6 + r() * 0.9, 1.2 + r() * 1.2, 2.2] : k < 0.8 ? [LOOK_DECAL.grime, 1.6 + r() * 1.6, 0.7, 0.35] : [LOOK_DECAL.water, 1 + r(), 1.6 + r(), 1.8];
  if (/brick/.test(n)) return k < 0.4 ? [LOOK_DECAL.grime, 1.8 + r() * 2, 0.8, 0.4] : k < 0.65 ? [LOOK_DECAL.water, 0.9 + r() * 1.2, 1.8 + r() * 1.4, 2.0] : k < 0.8 ? [LOOK_DECAL.soot, 1.0 + r() * 0.8, 1.6 + r(), 1.9] : k < 0.92 ? [LOOK_DECAL.leak, 0.9, 1.2, 1.9] : [LOOK_DECAL.poster, 0.62, 0.8, 1.55];
  if (/concrete|plaster|stone|panel/.test(n)) return k < 0.35 ? [LOOK_DECAL.grime, 1.8 + r() * 2, 0.8, 0.4] : k < 0.55 ? [LOOK_DECAL.water, 0.9 + r() * 1.3, 1.8 + r() * 1.4, 2.0] : k < 0.7 ? [LOOK_DECAL.cracks, 0.9 + r() * 0.8, 0.9 + r() * 0.8, 1.2 + r()] : k < 0.82 ? [LOOK_DECAL.leak, 1.0, 1.3, 1.9] : k < 0.93 ? [LOOK_DECAL.poster, 0.62, 0.8, 1.55] : [LOOK_DECAL.tag, 0.9, 0.9, 1.4];
  return null;
}

export function placeLookDecals(world, group, { quality = 'high', seed = 1, def = {} } = {}) {
  const t0 = performance.now();
  const cap = CAP[quality] || 0;
  if (!cap || !world?.raycast || !world.bounds) return { count: 0, meshes: 0, ms: 0 };
  const opt = def.lookDecals || {};
  const density = opt.density ?? 1;
  const r = rng(seed);
  const b = world.bounds, step = (opt.step ?? 2.6) / Math.sqrt(density);
  const items = [];
  const taken = new Map(); // grobe Belegung (0,8 m) gegen Häufungen
  const key = (x, y, z) => `${Math.round(x / 0.8)}|${Math.round(y / 0.8)}|${Math.round(z / 0.8)}`;
  const cells = [];
  for (let z = b.min.z + step / 2; z < b.max.z; z += step) for (let x = b.min.x + step / 2; x < b.max.x; x += step) cells.push([x + (r() - 0.5) * step, z + (r() - 0.5) * step]);
  // gemischte Reihenfolge → bei Kappung gleichmäßig über die Karte verteilt
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  for (const [x, z] of cells) {
    if (items.length >= cap) break;
    const gy = world.groundHeight ? world.groundHeight(x, z, 3.2) : 0;
    if (gy == null || gy > 3) continue;
    const a = r() * Math.PI * 2;
    _o.set(x, gy + 1.1, z); _d.set(Math.cos(a), 0, Math.sin(a));
    const h = world.raycast(_o, _d, 3.2);
    if (!h || Math.abs(h.normal.y) > 0.12 || h.distance < 0.25) continue;
    const name = h.object?.name || h.object?.material?.name || h.surface || '';
    const sel = pick(name, r);
    if (!sel) continue;
    let [cell, w, hh, cy] = sel;
    // Normale zur Strahlquelle drehen (die BVH liefert die Dreiecksnormale ohne Ausrichtung)
    _n.copy(h.normal).setY(0).normalize();
    if (_n.dot(_d) > 0) _n.negate();
    _t.set(-_n.z, 0, _n.x); // waagerecht entlang der Wand
    const baseY = gy;
    // Container: Rost von der Oberkante (Höhe aus Strahl nach oben suchen wäre teuer → Containerhöhe)
    let py = baseY + cy;
    if (cell === LOOK_DECAL.rust || cell === LOOK_DECAL.water || cell === LOOK_DECAL.soot || cell === LOOK_DECAL.leak) py = baseY + cy - hh / 2 + 0.3;
    if (cell === LOOK_DECAL.grime) py = baseY + hh / 2 - 0.02;
    _p.copy(h.point).setY(py);
    const k = key(_p.x, _p.y, _p.z);
    if (taken.has(k)) continue;
    // ganze Decal-Fläche auf derselben Wand? (4 Ecken + Mitte, Strahl gegen die Normale)
    let ok = true;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      _o.copy(_p).addScaledVector(_t, u * w).addScaledVector(_n, 0.15); _o.y += v * hh;
      _d.copy(_n).negate();
      const c = world.raycast(_o, _d, 0.4);
      if (!c || Math.abs(c.distance - 0.15) > 0.06 || Math.abs(c.normal.dot(_n)) < 0.95) { ok = false; break; }
    }
    if (!ok) continue;
    taken.set(k, 1);
    items.push({ x: _p.x + _n.x * 0.012, y: _p.y, z: _p.z + _n.z * 0.012, nx: _n.x, nz: _n.z, w, h: hh, cell, tint: 0.82 + r() * 0.3 });
  }
  if (!items.length) return { count: 0, meshes: 0, ms: Math.round(performance.now() - t0) };
  // je Zelle ein InstancedMesh (Frustum-Culling)
  const byCell = new Map();
  for (const it of items) { const ck = `${Math.floor(it.x / CELL)}|${Math.floor(it.z / CELL)}`; if (!byCell.has(ck)) byCell.set(ck, []); byCell.get(ck).push(it); }
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = decalMaterial();
  let meshes = 0;
  for (const list of byCell.values()) {
    const g = geo.clone();
    const cellAttr = new Float32Array(list.length * 4);
    const mesh = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((it, i) => {
      // Ebene: +Z = Wandnormale
      // rechtshändige Basis (x = up × n): sonst Spiegelung → Rückseite zur Kamera, Decal unsichtbar
      _bx.set(it.nz, 0, -it.nx); _by.set(0, 1, 0); _n.set(it.nx, 0, it.nz);
      _m.makeBasis(_bx, _by, _n); _q.setFromRotationMatrix(_m);
      _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.w, it.h, 1));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _col.setScalar(it.tint));
      cellAttr.set([(it.cell % 4) * 0.25, (1 - Math.floor(it.cell / 4)) * 0.5, 0.25, 0.5], i * 4);
    });
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cellAttr, 4));
    mesh.computeBoundingSphere();
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    mesh.name = 'look-decals';
    group.add(mesh);
    meshes++;
  }
  geo.dispose();
  return { count: items.length, meshes, ms: Math.round(performance.now() - t0) };
}
