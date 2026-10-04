// NULLPUNKT — stilisierte Minikarte (Draufsicht, Norden oben) aus den Footprints des Builders (Owner: world)
// Gebäude hell und erhöht, Deckung mittel, Treppen schraffiert, Wasser blau, Außenbereich schraffiert.

const STYLE = {
  bg: '#0d1013',
  outside: '#15191d',
  ground: '#262c31',
  zone: { road: '#2b3136', plaza: '#33383b', grass: '#27322a', sand: '#3a3529', dirt: '#302b25', water: '#173246', dock: '#2e3439', hall: '#30363b', lane: '#2e3540' },
  kinds: {
    building: [148, 156, 163], roof: [148, 156, 163], wall: [120, 128, 136], cover: [92, 102, 112], container: [104, 116, 128],
    vehicle: [96, 104, 112], pillar: [126, 134, 142], prop: [82, 90, 98], catwalk: [112, 124, 136], stairs: [130, 140, 150], floor: null,
  },
};

/**
 * @param {object} p { footprints, zones:[{x0,z0,x1,z1,kind}], bounds:{minX,maxX,minZ,maxZ}, size (px), tint }
 * @returns {{ canvas, worldToMap(x,z):{u,v}, size:{x,z}, center:{x,z}, scale }}
 */
export function createMinimap(p) {
  const S = p.size || 512;
  const b = p.bounds;
  const margin = 4;
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + margin * 2;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const k = S / extent;
  const X = x => (x - cx) * k + S / 2, Z = z => (z - cz) * k + S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  // Hintergrund + schraffierter Außenbereich
  ctx.fillStyle = STYLE.bg; ctx.fillRect(0, 0, S, S);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 2;
  for (let i = -S; i < S * 2; i += 9) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke(); }
  ctx.restore();
  // Spielfläche
  ctx.fillStyle = STYLE.ground;
  ctx.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
  // Zonen (Straßen, Wasser, Plätze)
  for (const zn of p.zones || []) {
    const col = STYLE.zone[zn.kind] || zn.color;
    if (!col) continue;
    ctx.fillStyle = col;
    ctx.fillRect(X(Math.min(zn.x0, zn.x1)), Z(Math.min(zn.z0, zn.z1)), Math.abs(zn.x1 - zn.x0) * k, Math.abs(zn.z1 - zn.z0) * k);
    if (zn.kind === 'water') {
      ctx.save(); ctx.strokeStyle = 'rgba(120,190,230,0.12)'; ctx.lineWidth = 1;
      for (let y = Z(Math.min(zn.z0, zn.z1)) + 3; y < Z(Math.max(zn.z0, zn.z1)); y += 6) { ctx.beginPath(); ctx.moveTo(X(Math.min(zn.x0, zn.x1)), y); ctx.lineTo(X(Math.max(zn.x0, zn.x1)), y); ctx.stroke(); }
      ctx.restore();
    }
  }
  // Footprints nach Höhe sortiert (hohe zuletzt)
  const fps = p.footprints.filter(f => f.kind !== 'floor' && f.kind !== false && f.y1 > -1).slice().sort((a, b2) => a.y1 - b2.y1);
  const drawBox = (f, fill, stroke, shadow) => {
    ctx.save();
    ctx.translate(X(f.x), Z(f.z));
    ctx.rotate(-f.ry); // Weltrotation um +Y dreht im Kartenbild (Norden oben) gegen den Uhrzeigersinn
    const w = Math.max(1.2, f.hw * 2 * k), h = Math.max(1.2, f.hd * 2 * k);
    if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-w / 2 + 1.5, -h / 2 + 1.5, w, h); }
    ctx.fillStyle = fill; ctx.fillRect(-w / 2, -h / 2, w, h);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1); }
    if (f.kind === 'stairs') {
      ctx.strokeStyle = 'rgba(20,24,28,0.7)'; ctx.lineWidth = 1;
      const n = Math.max(3, Math.round(Math.max(w, h) / 3));
      for (let i = 1; i < n; i++) {
        if (h >= w) { const y = -h / 2 + (h * i) / n; ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke(); }
        else { const x = -w / 2 + (w * i) / n; ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); ctx.stroke(); }
      }
    }
    ctx.restore();
  };
  for (const f of fps) {
    if (f.kind === 'water' || f.kind === 'zone') continue;
    const base = STYLE.kinds[f.kind] || STYLE.kinds.cover;
    if (!base) continue;
    const lift = Math.min(1, Math.max(0, f.y1) / 12) * 46;
    const c = base.map(v => Math.round(Math.min(255, v + lift)));
    const fill = `rgb(${c[0]},${c[1]},${c[2]})`;
    const stroke = `rgba(${Math.round(c[0] * 0.55)},${Math.round(c[1] * 0.55)},${Math.round(c[2] * 0.55)},0.9)`;
    drawBox(f, fill, f.hw * k > 2 && f.hd * k > 2 ? stroke : null, f.y1 - f.y0 > 1.5);
  }
  // Rahmen der Spielfläche
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);

  return {
    canvas: cv,
    size: { x: extent, z: extent },
    center: { x: cx, z: cz },
    scale: k / S,
    /** Weltkoordinaten → Kartenkoordinaten 0..1 (u nach Osten, v nach Süden; Norden oben) */
    worldToMap(x, z) { return { u: (x - cx) / extent + 0.5, v: (z - cz) / extent + 0.5 }; },
  };
}
