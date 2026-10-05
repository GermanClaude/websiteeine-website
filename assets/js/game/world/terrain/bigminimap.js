// NULLPUNKT — Minikarte/Großkarte für Großkarten (Owner: world): Schummerung (Hillshade) + Bodenfarben aus dem
// Splat, Wasser, Straßen, Gebäude-Grundrisse, abgedunkelter Bereich außerhalb der Spielfläche. Norden oben (−z).
// API wie world/minimap.js: { canvas, worldToMap(x, z) → {u, v}, size: {x, z}, center: {x, z}, scale }.

const COL = { grass: [74, 92, 58], dirt: [104, 88, 66], gravel: [118, 112, 100], rock: [112, 106, 98], mud: [84, 70, 54], water: [38, 72, 92], road: [58, 60, 62], building: [176, 170, 160], roof: [150, 92, 76], cover: [120, 116, 108] };

/**
 * @param {{ hf, bounds:{minX,maxX,minZ,maxZ}, size?: number, roads?: Array<{kind,width,points}>, footprints?: Array, margin?: number }} p
 */
export function createBigMinimap(p) {
  const S = p.size || 1024, hf = p.hf, b = p.bounds, margin = p.margin ?? 12;
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + margin * 2;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const k = S / extent;
  const X = x => (x - cx) * k + S / 2, Z = z => (z - cz) * k + S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  const L = [0, 0, 0, 0, 0], n = { x: 0, y: 1, z: 0 };
  // Licht aus Nordwest (Kartenkonvention)
  const lx = -0.55, ly = 0.7, lz = -0.45;
  for (let py = 0; py < S; py++) {
    const z = cz + (py + 0.5 - S / 2) / k;
    for (let px = 0; px < S; px++) {
      const x = cx + (px + 0.5 - S / 2) / k, o = (py * S + px) * 4;
      const y = hf.heightAt(x, z);
      hf.normalAt(x, z, n);
      const shade = Math.max(0.35, Math.min(1.25, 0.25 + 1.1 * (n.x * lx + n.y * ly + n.z * lz)));
      let c;
      if (y < hf.waterY - 0.05) c = COL.water;
      else if (hf.maskAt(x, z) === 1) c = COL.road;
      else {
        hf.layersAt(x, z, L);
        const r = COL.grass[0] * L[0] + COL.dirt[0] * L[1] + COL.gravel[0] * L[2] + COL.rock[0] * L[3] + COL.mud[0] * L[4];
        const g = COL.grass[1] * L[0] + COL.dirt[1] * L[1] + COL.gravel[1] * L[2] + COL.rock[1] * L[3] + COL.mud[1] * L[4];
        const bl = COL.grass[2] * L[0] + COL.dirt[2] * L[1] + COL.gravel[2] * L[2] + COL.rock[2] * L[3] + COL.mud[2] * L[4];
        c = [r, g, bl];
      }
      const s = y < hf.waterY - 0.05 ? 1 : shade;
      // Höhenlinien alle 5 m (dezent)
      const iso = Math.abs(((y % 5) + 5) % 5 - 2.5) > 2.35 ? 0.86 : 1;
      const out = x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ ? 0.45 : 1;
      d[o] = Math.min(255, c[0] * s * iso * out); d[o + 1] = Math.min(255, c[1] * s * iso * out); d[o + 2] = Math.min(255, c[2] * s * iso * out); d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Straßen
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of p.roads || []) {
    ctx.strokeStyle = r.kind === 'asphalt' ? 'rgba(46,48,52,0.95)' : 'rgba(150,130,100,0.75)';
    ctx.lineWidth = Math.max(1.5, r.width * k * (r.kind === 'asphalt' ? 1 : 0.8));
    ctx.beginPath();
    r.points.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Z(q.z)) : ctx.moveTo(X(q.x), Z(q.z))));
    ctx.stroke();
  }
  // Gebäude
  for (const f of p.footprints || []) {
    const kind = f.kind;
    const c = kind === 'building' ? COL.building : kind === 'roof' ? COL.roof : (kind === 'wall' || kind === 'cover' || kind === 'container' || kind === 'vehicle') ? COL.cover : null;
    if (!c) continue;
    ctx.save();
    ctx.translate(X(f.x), Z(f.z));
    ctx.rotate(-(f.ry || 0));
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(-f.hw * k, -f.hd * k, f.hw * 2 * k, f.hd * 2 * k);
    if (kind === 'building' || kind === 'roof') { ctx.strokeStyle = 'rgba(20,22,24,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(-f.hw * k, -f.hd * k, f.hw * 2 * k, f.hd * 2 * k); }
    ctx.restore();
  }
  // Rand der Spielfläche
  ctx.strokeStyle = 'rgba(232,80,60,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.strokeRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
  ctx.setLineDash([]);
  return {
    canvas: cv,
    worldToMap: (x, z) => ({ u: X(x) / S, v: Z(z) / S }),
    size: { x: extent, z: extent },
    center: { x: cx, z: cz },
    scale: k,
  };
}
