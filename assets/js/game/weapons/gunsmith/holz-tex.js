// Holz- und Bakelit-Baukasten für Waffen-Atlanten (25.10.2026, gemeinsamer Baukasten G1 – zuerst für die KV-47,
// danach Bulldog, LM-8, Donnerkeil, Kobra-Griff, Zwilling, Elster, Amboss …). Gezeichnet wird Pixel für Pixel in
// Modellmaßen (u entlang der Waffe, v hoch; Meter), damit die Maserung auf jedem Bauteil in Faserrichtung läuft und
// über Atlas-Grenzen hinweg gleich dicht ist. Ein Durchgang liefert Farbe (sRGB), Rauheit und Höhe zugleich.
//   paintWood(px, area, toModel, o)      – Lackholz (Birke/Buche/Walnuss): Jahresringe als lange Streifen, verzogen,
//                                            Markstrahlen (helle Spiegel), Poren, Farbwolken, Druckstellen
//   paintBakelite(px, area, toModel, o)  – Pressstoff (rotbraun marmoriert, glänzend)
//   checkering(px, area, poly, o)        – Fischhaut (Rautenraster) als Höhe in einem Polygon (Atlas-Pixel)
// px = { W, H, a: Uint8ClampedArray RGBA, r: Float32Array, h: Float32Array }; area = [ix0, iy0, ix1, iy1] (Atlas-Pixel);
// toModel(ix, iy) → [u, v] (Meter). Die Aufrufer legen die Atlas-Aufteilung fest (siehe kv47-tex.js).

// ---------------------------------------------------------------- Rauschen (2D-Wertrauschen, glatt, ohne Kacheln)
const hash2 = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
export function vn(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export const fbm2 = (x, y, s = 0, oct = 4) => { let t = 0, a = 0.5, n = 0; for (let o = 0; o < oct; o++) { t += vn(x, y, s + o * 17) * a; n += a; a *= 0.5; x *= 2.03; y *= 2.03; } return t / n; };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Farbtafeln (sRGB 0…255): früh/spät = helle/dunkle Holzzone, linie = Spätholzlinie, fleck = Markstrahlen. */
export const WOOD = {
  // Ostblock-Buche/Birke, rotbraun lackiert (AKM-Schaft). Prüfung 25.10.: dunkler und satter (Foto oben ohne Glanzlicht
  // Median 94/31/13, Streuung 30–61 – das Modell lag bei 124/62/48 und 74–80, also zu hell, zu rosa, zu gleichmäßig);
  // der rosa Schleier kam vom Grundglanz (Lackholz: specularIntensity 0,4 in materials.js), danach Ton etwas
  // brauner/oranger (Foto Mitteltöne G ≈ 0,5 · R)
  akBirke: { early: [108, 46, 16], late: [48, 19, 6], linie: [33, 13, 4], fleck: [186, 104, 40], dark: [25, 10, 4], lack: 0.46, ringe: 420 },
  // Handschutz derselben Waffe: im Foto gleich hell, etwas röter
  akHand: { early: [112, 46, 15], late: [50, 19, 6], linie: [33, 12, 4], fleck: [186, 100, 38], dark: [24, 9, 4], lack: 0.44, ringe: 460 },
  // Hirnholz (Stirnflächen): saugt mehr Lack, deutlich dunkler, kaum Glanz
  akHirn: { early: [70, 26, 10], late: [36, 12, 5], linie: [26, 9, 3], fleck: [96, 44, 18], dark: [20, 8, 3], lack: 0.5, ringe: 900 },
  walnuss: { early: [128, 84, 52], late: [80, 48, 28], linie: [52, 30, 18], fleck: [150, 102, 64], dark: [40, 24, 14], lack: 0.4, ringe: 260 },
};

/**
 * Lackholz in einen Atlas-Bereich malen (25.10.: ruhiger, nach Foto – feine dunkle Faserlinien statt breiter Streifen,
 * kleine helle Markstrahlen, große Farbwolken; Lack glatt, also kaum Relief; 25.10. Flammung und Randabdunklung).
 * o: { pal (WOOD.*), seed, wear (0…1, Druckstellen/Kratzer), skip(ix, iy) → true = Pixel auslassen, edge(u, v) → Abstand
 * zum Bauteilumriss in m (nur im Grobraster abgefragt) }. 6 Rauschabfragen je Pixel.
 */
export function paintWood(px, area, toModel, o = {}) {
  const P = o.pal || WOOD.akBirke, s = o.seed ?? 1, wear = o.wear ?? 0.5;
  const ax0 = Math.max(0, area[0] | 0), ay0 = Math.max(0, area[1] | 0), ax1 = Math.min(px.W, area[2]), ay1 = Math.min(px.H, area[3]);
  if (!(ax1 > ax0 && ay1 > ay0)) return;
  // Großräumige Anteile (Faserverzug, Farbwolken, Masken) auf einem Raster je 4 Pixel vorrechnen und bilinear lesen –
  // halbiert die Rauschabfragen je Pixel (toModel ist je Bereich affin, das Raster also exakt genug)
  // Kanal 4 (25.10.): Flammung – wellige, längs gestreckte Hell-Dunkel-Bänder; Kanal 5: Randabdunklung (o.edge(u, v) →
  // Abstand zum Umriss in m; Lack und Schmutz sammeln sich an den Kanten, im Foto deutlich dunkler)
  const S = 4, NC = 6, cw = Math.ceil((ax1 - ax0) / S) + 2, ch = Math.ceil((ay1 - ay0) / S) + 2, LF = new Float32Array(cw * ch * NC);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const [u, v] = toModel(ax0 + cx * S, ay0 + cy * S), k = (cy * cw + cx) * NC;
    LF[k] = (vn(u * 6, v * 18, s) - 0.5) * 9 + (vn(u * 26, v * 70, s + 5) - 0.5) * 1.8;
    LF[k + 1] = vn(u * 4, v * 7, s + 9) * 0.65 + vn(u * 14, v * 24, s + 10) * 0.35;
    LF[k + 2] = sstep(0.45, 0.75, vn(u * 16, v * 30, s + 22));
    LF[k + 3] = sstep(0.6, 0.8, vn(u * 7, v * 7, s + 52));
    LF[k + 4] = vn(u * 9, v * 95 + 3.5 * vn(u * 2.2, v * 6, s + 71), s + 73) - 0.5;
    LF[k + 5] = o.edge ? 1 - sstep(0, 0.009, o.edge(u, v, ax0 + cx * S, ay0 + cy * S)) : 0;
  }
  for (let iy = ay0; iy < ay1; iy++) for (let ix = ax0; ix < ax1; ix++) {
    if (o.skip && o.skip(ix, iy)) continue;
    const [u, v] = toModel(ix, iy);
    const gx = (ix - ax0) / S, gy = (iy - ay0) / S, gi = gx | 0, gj = gy | 0, fx = gx - gi, fy = gy - gj;
    const k00 = (gj * cw + gi) * NC, k10 = k00 + NC, k01 = k00 + cw * NC, k11 = k01 + NC;
    const lf = (c) => (LF[k00 + c] * (1 - fx) + LF[k10 + c] * fx) * (1 - fy) + (LF[k01 + c] * (1 - fx) + LF[k11 + c] * fx) * fy;
    // Faserverlauf: lange, sanft verzogene Linien entlang u; Abstand und Stärke je Linie verschieden, nur zart sichtbar
    const t = v * P.ringe + lf(0);
    const ti = Math.floor(t), f = t - ti, ri = hash2(ti, 7, s);
    const line = (1 - sstep(0.0, 0.06 + 0.1 * ri, f)) * ri * ri;
    // Farbwolken (groß, kräftig – im Foto hell/dunkel geflammt) und feine Längsstreifen
    const cloud = lf(1), flame = lf(4), edge = lf(5);
    const streak = vn(u * 28, v * 1500, s + 13) - 0.5;
    const k = Math.max(0, Math.min(1, 0.5 + 1.6 * (cloud - 0.5) + flame * 0.9 + streak * 0.18 - edge * 0.45));
    let R = lerp(P.late[0], P.early[0], k), G = lerp(P.late[1], P.early[1], k), B = lerp(P.late[2], P.early[2], k);
    const ln = line * 0.38;
    R = lerp(R, P.linie[0], ln); G = lerp(G, P.linie[1], ln); B = lerp(B, P.linie[2], ln);
    // Markstrahlen: kurze helle Striche (Buche/Birke, im Foto orange Sprenkel), gehäuft in einzelnen Feldern
    const fleck = sstep(0.8, 0.93, vn(u * 320, v * 1150, s + 21)) * lf(2);
    R = lerp(R, P.fleck[0], fleck * 0.7); G = lerp(G, P.fleck[1], fleck * 0.7); B = lerp(B, P.fleck[2], fleck * 0.7);
    // Poren (dunkle Pünktchen, längs gezogen)
    const pore = sstep(0.9, 0.98, vn(u * 1300, v * 4200, s + 31));
    // Gebrauchsspuren: Druckstellen als dunkle, matte, unregelmäßige Flecken (Schmutz in der Delle; Prüfung 25.10.: die
    // runden Mulden mit starker Normalen wirkten wie erhabene Tropfen), feine Kratzer
    const dent = sstep(0.5, 0.78, vn(u * 150, v * 260, s + 51) * vn(u * 90 + 3.1, v * 330 - 1.7, s + 53)) * lf(3) * wear;
    const scr = sstep(0.975, 0.995, vn(u * 22 + v * 300, v * 16 - u * 5, s + 61)) * wear;
    const dk = Math.min(0.85, pore * 0.35 + dent * 0.65 + edge * 0.25);
    R = lerp(R, P.dark[0], dk) + scr * 22; G = lerp(G, P.dark[1], dk) + scr * 15; B = lerp(B, P.dark[2], dk) + scr * 10;
    const i = iy * px.W + ix, j = i * 4;
    px.a[j] = R; px.a[j + 1] = G; px.a[j + 2] = B; px.a[j + 3] = 255;
    // Rauheit: Lack glänzt, wolkig abgegriffen; in Poren/Druckstellen/Kratzern stumpf
    px.r[i] = Math.min(1, P.lack + 0.14 * (cloud - 0.5) + pore * 0.2 + dent * 0.35 + scr * 0.3 + edge * 0.08);
    // Höhe: unter dem Lack fast glatt, Poren leicht vertieft, Druckstellen nur flach (Farbe trägt sie)
    px.h[i] = 0.5 - line * 0.006 - pore * 0.025 - dent * 0.015 - scr * 0.03;
  }
}

/** Pressstoff (Bakelit/Phenolharz mit Holzmehl): rotbraun, marmoriert, glänzend. o: { seed, base, light, dark } */
export function paintBakelite(px, area, toModel, o = {}) {
  const s = o.seed ?? 7, base = o.base || [86, 40, 28], light = o.light || [120, 60, 40], dark = o.dark || [50, 22, 15];
  const [x0, y0, x1, y1] = area;
  for (let iy = Math.max(0, y0 | 0); iy < Math.min(px.H, y1); iy++) for (let ix = Math.max(0, x0 | 0); ix < Math.min(px.W, x1); ix++) {
    if (o.skip && o.skip(ix, iy)) continue;
    const [u, v] = toModel(ix, iy);
    // Marmorierung: verwirbelte Schlieren (Fließlinien der Pressmasse)
    const w = fbm2(u * 40, v * 40, s, 3);
    const k = sstep(0.2, 0.85, w * 0.45 + fbm2(u * 110, v * 110, s + 3, 2) * 0.55);       // gewölkt, ohne Streifen
    let R = lerp(dark[0], light[0], k), G = lerp(dark[1], light[1], k), B = lerp(dark[2], light[2], k);
    R = lerp(R, base[0], 0.5); G = lerp(G, base[1], 0.5); B = lerp(B, base[2], 0.5);
    const fleck = sstep(0.9, 0.97, vn(u * 1400, v * 1400, s + 9));                         // Holzmehl-Pünktchen
    R -= fleck * 30; G -= fleck * 18; B -= fleck * 12;
    const i = iy * px.W + ix, j = i * 4;
    px.a[j] = R; px.a[j + 1] = G; px.a[j + 2] = B; px.a[j + 3] = 255;
    px.r[i] = 0.26 + 0.1 * fbm2(u * 30, v * 30, s + 11, 2);
    px.h[i] = 0.5 + 0.02 * (w - 0.5);
  }
}

/**
 * Fischhaut im Polygon poly (Atlas-Pixel): Rautenraster unter ±ang zur Achse, Teilung pitch (Atlas-Pixel), erhabene
 * Pyramiden. Farbe in den Rillen dunkler, Rauheit höher (Schmutz). aspect = Pixelmaß y/x (nicht quadratische Atlanten),
 * rows = [y0, y1] nur diese Atlaszeilen (zeitgeteilt zeichnen).
 */
export function checkering(px, poly, o = {}) {
  const pitch = o.pitch ?? 6, ang = o.ang ?? 0.55, asp = o.aspect ?? 1, rim = o.rim ?? 3;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const inside = (x, y) => { let c = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c; } return c; };
  const segD = (x, y) => { let d = Infinity; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b], dx = xb - xa, dy = (yb - ya) * asp, t = Math.max(0, Math.min(1, ((x - xa) * dx + (y - ya) * asp * dy) / (dx * dx + dy * dy))); d = Math.min(d, Math.hypot(x - xa - t * dx, (y - ya) * asp - t * dy)); } return d; };
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const r0 = o.rows ? Math.max(y0, o.rows[0]) : y0, r1 = o.rows ? Math.min(y1, o.rows[1]) : y1;   // o.rows: nur diese Zeilen (zeitgeteilt)
  for (let iy = Math.max(0, r0 | 0); iy <= Math.min(px.H - 1, r1); iy++) for (let ix = Math.max(0, x0 | 0); ix <= Math.min(px.W - 1, x1); ix++) {
    if (!inside(ix + 0.5, iy + 0.5)) continue;
    const X = ix, Y = iy * asp;
    const p = (X * ca + Y * sa) / pitch, q = (X * ca - Y * sa) / pitch;
    const fp = Math.abs(p - Math.round(p)), fq = Math.abs(q - Math.round(q));
    const pyr = Math.min(fp, fq) * 2;                                                       // 0 in der Rille, 1 auf der Spitze
    const edge = sstep(0, rim, segD(ix + 0.5, iy + 0.5));                                   // glatter Rand am Feld
    const i = iy * px.W + ix, j = i * 4, g = (1 - pyr) * edge;
    px.h[i] += (pyr - 0.5) * 0.35 * edge - 0.08 * edge;
    px.a[j] *= 1 - 0.32 * g; px.a[j + 1] *= 1 - 0.32 * g; px.a[j + 2] *= 1 - 0.32 * g;
    px.r[i] = Math.min(1, px.r[i] + 0.28 * g);
  }
}
