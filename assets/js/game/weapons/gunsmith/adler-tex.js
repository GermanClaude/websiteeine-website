// Adler .50: eigene Oberflächen nach dem Referenzfoto (adler-ref.js, 25.10.2026). EIN Atlas für alle Stahl- und Griffteile
// (Schlitten, Lauf, Rahmen, Magazinboden, Wickelgriff), gezeichnet in Fotopixeln und entlang x projiziert:
//   – Edelstahl je Bereich wie am Vorbild: Schlitten gebürstet, Lauf poliert (Seitenfläche spiegelnd), Rahmen und Magazinboden
//     seidenmatt gestrahlt; Bürstenstrich längs, 14 schräge Griffrillen (Höhe → Normalen, wie die P-9-Sägezähne), Trennfugen,
//     Kantenabrieb (blank gerieben) und Kratzer;
//   – Gravuren mit eigener Beschriftung (keine Herstellerzeichen): Lauf rechts/links, Nummer rechts am Rahmen;
//   – Griff: Kieselstruktur mit glattem Rand, rundes Feld mit dem NULLPUNKT-Zeichen (Fadenkreuz-Null) statt Herstellerlogo.
// Linke Seite: nur dort eigene Bänder, wo links etwas anderes steht als rechts (Gravurfeld am Lauf, Nummernfeld am Rahmen) –
// sonst stünde die Schrift spiegelverkehrt; alles andere ist spiegelgleich und nimmt die rechte Fotoprojektion.
// Ober-/Unterseiten von Schlitten und Lauf ins gebürstete Blankfeld, Stirn-/Rückflächen, Rahmenunterseiten und Innenwände ins
// gestrahlte Mattfeld (beide isotrop: gleicher Maßstab längs und quer), Griffrücken/-vorderseite ins Kieselfeld.
// 25.10. (Prüfung): Bereich je DREIECK nach dem Schwerpunkt (atlasUVTri) statt je Ecke – Dreiecke über einer Bereichsgrenze
// bekamen UVs aus zwei weit entfernten Atlasbereichen (schwarzer Strich links über Schlitten und Rahmen, Streifen am Bügel);
// Blank-/Mattfeld waren quer 4–6× gestaucht (gestreckte „Wellenmaserung“ am Schlittenheck im Anschlag, an Mündung und Boden).
// Größe je Stufe (Bauanleitung §8.3): PC hoch 2048 × 1024, PC niedrig/mittel 1536 × 768, Handy 1024 × 512 ohne Rauheitskarte.
import { canvas, toTexture, cached, rng } from './textures.js';
import { CPU, grey, path, slantGrooves, engrave, pebblePattern, streak, scratches, noiseCanvas, brushCanvas, grainCanvas, readHeight, blur, normalTex } from './pistol-tex.js';
import * as R from './adler-ref.js';

// ---------------------------------------------------------------- Atlas-Abbildung (Fotopixel → Atlas)
const F = { W: 2048, H: 1024, x0: 90, x1: 2650, y0: 100, y1: 1350 };
// Bänder der linken Seite: src = Fotorechteck (Zuordnung je Dreieck über den Schwerpunkt), d = Versatz im Atlas (Fotopixel).
// Gezeichnet wird src + BM Rand (≥ halbe Dreiecksgröße am Handy), damit Ecken über der Grenze nichts Fremdes greifen; Abrieb
// und Kratzer sind links wie rechts gleich – an den Bandgrenzen gibt es keine Naht.
const BM = 16;
const LBANDS = [
  { src: [1150, 270, 1690, 372], d: [-264, 552] },   // Gravurfeld Lauf links → Atlas x 870…1442, y 806…940
  { src: [620, 415, 860, 462], d: [856, 407] },     // Nummernfeld Rahmen (links ohne Nummer) → x 1460…1732, y 806…885
];
const BLANK = [870, 950, 2640, 1154];                          // gebürstet (Ober-/Unterseiten Schlitten und Lauf, Lagerteil)
const MATT = [870, 1160, 2640, 1348];                          // gestrahlt (Stirn-/Rückflächen, Rahmenunterseiten)
const INNER = [1340, 545, 2240, 785];                          // Innenwände: gestrahlt und dunkler (wenig Licht, Bügel-Innenstück)
const KB = 0.82, KC = 0.6, KM = 0.6;                           // Maßstab Blankfeld, Lagerteil, Mattfeld (Atlas-Fotopixel je Fotopixel)
const PEB = [2262, 102, 2648, 832];                            // Kieselfeld (Griffrücken, -vorderseite, -boden)
const photoX = (u) => R.XA + (u - R.UA) * R.PPM, photoY = (v) => R.YA - (v - R.VA) * R.PPM;
const at = (px, py) => [(px - F.x0) / (F.x1 - F.x0), 1 - (py - F.y0) / (F.y1 - F.y0)];
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const clampX = (x, h) => Math.max(-h, Math.min(h, x));
const inRect = ([x0, y0, x1, y1], x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
// Felder: gebürstet längs u (Fotopixel px, Querlage x); gestrahlt isotrop, große Flächen in Stücken (Feld ist gleichförmig)
const blankTop = (px, x) => at(BLANK[0] + 16 + (Math.min(2250, Math.max(300, px)) - 300) * KB, BLANK[1] + 2 + (clampX(x, 0.0152) + 0.0152) * R.PPM * KB);
const blankSide = (px, py) => at(BLANK[0] + 16 + (px - 300) * KC, BLANK[1] + 6 + (py - 140) * KC);
const mattFace = (py, x) => at(MATT[0] + 14 + (py - 100) * KM, MATT[1] + 12 + (clampX(x, 0.0175) + 0.0175) * R.PPM * KM);
const chunk = (c, o, n) => o + Math.floor((c - o) / n) * n;
const mattUnder = (px, x, cpx) => at(MATT[0] + 14 + (px - chunk(cpx, 96, 1500)) * KM, MATT[1] + 12 + (clampX(x, 0.0175) + 0.0175) * R.PPM * KM);
const mattWall = (px, py, cpx, cpy) => at(INNER[0] + 14 + (px - chunk(cpx, 96, 1400)) * KM, INNER[1] + 12 + (py - chunk(cpy, 100, 300)) * KM);

/**
 * Atlas-UV der Stahlteile (atlasUVTri: Flächennormale n und Schwerpunkt c = [x, v, u] je Dreieck): Seiten aus der Foto-
 * projektion (links Bänder für die Gravuren), Ober-/Unterseiten gebürstet bzw. gestrahlt, Stirn-/Rückflächen gestrahlt.
 */
export function adlerSteelUV(x, v, u, nx, ny, nz, c) {
  const px = photoX(u), py = photoY(v), cx = c ? c[0] : x, cpx = c ? photoX(c[2]) : px, cpy = c ? photoY(c[1]) : py;
  if (Math.abs(nx) > 0.55) {
    // Innenwände weit innerhalb der Außenhaut: gestrahlt und dunkler statt Fotoprojektion (sonst trügen sie die Schlittenrillen) –
    // Wände von Auswurffenster, Abzugs-/Hahnschlitz und Schacht (Normale zur Mitte) und der Mittelsteg in der Bügelöffnung;
    // nicht die Außenflächen schmaler Teile (Bügel ± 5,6 mm, Rundung des Sporns)
    if (Math.abs(cx) < 0.0108 && cpx < 1250 && (nx * cx < 0 || inPoly(R.OPEN_OUT, cpx, cpy))) return mattWall(px, py, cpx, cpy);
    if (nx < 0) for (const B of LBANDS) if (inRect(B.src, cpx, cpy)) return at(px + B.d[0], py + B.d[1]);
    return at(px, py);
  }
  if (Math.abs(ny) >= Math.abs(nz)) return cpy < R.FRAME_TOP_Y - 1 ? blankTop(px, x) : mattUnder(px, x, cpx);
  return mattFace(py, x);
}
/**
 * Atlas-UV von Lauf + Rahmen: wie adlerSteelUV, aber der Laufteil unter dem Schlitten (Patronenlager, nur bei zurücklaufendem
 * Schlitten sichtbar) bekommt das gebürstete Blankfeld – sonst trüge er die Griffrillen und die Sicherung des Schlittens.
 */
export function adlerBodyUV(x, v, u, nx, ny, nz, c) {
  const cpx = c ? photoX(c[2]) : photoX(u), cpy = c ? photoY(c[1]) : photoY(v);
  if (cpx < R.SLIDE_FRONT_X && cpy < R.FRAME_TOP_Y - 1 && inPoly(R.SLIDE, cpx, cpy)) {
    const px = photoX(u), py = photoY(v), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return blankTop(px, x);
    return az > ax ? at(BLANK[0] + 16 + (clampX(x, 0.0152) + 0.0152) * R.PPM * KC, BLANK[1] + 6 + (py - 140) * KC) : blankSide(px, py);
  }
  return adlerSteelUV(x, v, u, nx, ny, nz, c);
}
/** Atlas-UV des Griffs: Seiten aus der Fotoprojektion (beidseitig gleich, Zeichen symmetrisch), sonst Kieselfeld. */
export function adlerGripUV(x, v, u, nx, ny, nz) {
  const px = photoX(u), py = photoY(v);
  if (Math.abs(nx) > 0.55) return at(px, py);
  return at(PEB[0] + clamp01((x + 0.018) / 0.036) * (PEB[2] - PEB[0]), PEB[1] + clamp01((py - 400) / 760) * (PEB[3] - PEB[1]));
}
export const CAMO_REPEAT = [(F.x1 - F.x0) / R.PPM / 0.2, (F.y1 - F.y0) / R.PPM / 0.2];

// ---------------------------------------------------------------- Zeichnen
function ctxIn(c) {
  const g = c.getContext('2d', CPU);
  const sx = c.width / (F.x1 - F.x0), sy = c.height / (F.y1 - F.y0);
  g.setTransform(sx, 0, 0, sy, -F.x0 * sx, -F.y0 * sy);
  return g;
}
const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const STEEL_A = '#b9bdc1';
// Oberfläche je Bereich: Albedo (Edelstahl, leicht unterschiedlich getönt) und Rauheit (gebürstet/poliert/gestrahlt)
const FINISH = {
  slide: { a: 'rgba(188,192,197,1)', r: 0.3 },
  barrel: { a: 'rgba(196,199,203,1)', r: 0.15 },
  panel: { a: 'rgba(200,203,207,1)', r: 0.11 },
  frame: { a: 'rgba(176,179,183,1)', r: 0.42 },
  plate: { a: 'rgba(174,177,181,1)', r: 0.4 },
};

// eine Waffenseite zeichnen (Inhalt in Fotopixeln); L = linke Seite (in ein Band verschoben und beschnitten, siehe layer):
// gleiche Flächen, Muster, Abrieb und Kratzer wie rechts – nur die Gravuren unterscheiden sich
function drawSide(g, kind, L, pats) {
  g.save();
  const fill = (pts, f) => { path(g, pts); g.fillStyle = kind === 'a' ? f.a : kind === 'r' ? grey(f.r) : grey(0.5); g.fill(); };
  if (kind !== 'h') {
    fill(R.FRAME, FINISH.frame);
    fill(R.BARREL, FINISH.barrel);
    fill(R.PANEL_L, FINISH.panel);
    fill(R.SLIDE, FINISH.slide);
    fill(R.MAGPLATE, FINISH.plate);
  }
  // Strahlmattierung Rahmen (Muster in Fotopixeln). 25.10.: eigener Pfad je Umriss – vorher begann path() für den Magazin-
  // boden einen neuen Pfad, der Clip hielt nur ihn (rechter Rahmen ohne Mattierung, Boden rau wie Putz)
  g.save(); path(g, R.FRAME); g.clip();
  g.globalAlpha = kind === 'h' ? 0.008 : kind === 'r' ? 0.08 : 0.04; g.globalCompositeOperation = 'overlay';
  g.fillStyle = pats.grain; g.fillRect(90, 360, 2200, 1000);
  g.restore();
  // Magazinboden seidenmatt: Korn nur in Albedo/Rauheit und schwach (keine Höhe – sonst rau wie Sandpapier)
  if (kind !== 'h') {
    g.save(); path(g, R.MAGPLATE); g.clip();
    g.globalAlpha = kind === 'r' ? 0.05 : 0.02; g.globalCompositeOperation = 'overlay';
    g.fillStyle = pats.grain; g.fillRect(140, 1130, 680, 215);
    g.restore();
  }
  // Bürstenstrich: Schlitten deutlich, polierter Lauf nur angedeutet
  g.save(); path(g, R.SLIDE); g.clip();
  g.globalAlpha = kind === 'h' ? 0.015 : kind === 'r' ? 0.14 : 0.045; g.globalCompositeOperation = 'overlay';   // fein wie im Foto
  g.fillStyle = pats.brush; g.fillRect(300, 120, 760, 260);
  g.restore();
  g.save(); path(g, R.BARREL); g.clip();
  g.globalAlpha = kind === 'h' ? 0.01 : kind === 'r' ? 0.07 : 0.03; g.globalCompositeOperation = 'overlay';
  g.fillStyle = pats.brush; g.fillRect(700, 160, 1600, 220);
  g.restore();
  // ---- Schlitten: Griffrillen (enden an der Mulde der Sicherung), Mulde rauer/dunkler, Absatz oben, Fase hinten
  g.save(); path(g, R.SLIDE); g.clip();
  slantGrooves(g, kind, R.SERR, (x, y) => inPoly(R.SAFETY_RECESS, x, y) || y < R.SERR.top);
  path(g, R.SAFETY_RECESS);
  if (kind === 'h') { g.strokeStyle = grey(0.3); g.lineWidth = 3; g.stroke(); }
  else { g.fillStyle = kind === 'a' ? 'rgba(120,124,130,0.25)' : grey(0.5); g.fill(); }
  g.restore();
  // ---- Lauf: Rand der vertieften Seitenfläche (feine Kante), Trennlinie Schiene
  if (kind !== 'r') {
    g.strokeStyle = kind === 'h' ? grey(0.4) : 'rgba(70,72,76,0.35)'; g.lineWidth = 1.6;
    path(g, R.PANEL_L); g.stroke();
    g.beginPath(); g.moveTo(1020, R.RIB.base); g.lineTo(R.RIB.x1, R.RIB.base); g.stroke();
  }
  // ---- Rahmen: Absatz der Führungsleiste, Trennfuge des Vorderstücks, Abzugsschlitz-Schatten
  g.strokeStyle = kind === 'h' ? grey(0.34) : kind === 'a' ? 'rgba(60,62,66,0.45)' : grey(0.55); g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(330, R.RAIL_LINE_Y); g.lineTo(R.FRONT_SEAM_X, R.RAIL_LINE_Y); g.stroke();
  g.beginPath(); g.moveTo(R.FRONT_SEAM_X, R.FRAME_TOP_Y + 2); g.quadraticCurveTo(R.FRONT_SEAM_X - 6, 450, R.FRONT_SEAM_X - 18, 505); g.stroke();
  // ---- Gravuren (eigene Beschriftung), rechts lesbar; links gespiegelt gezeichnet (Atlasrichtung zeigt dort nach links)
  const [lx0, ly0] = R.MARKS.laufR;
  if (!L) {
    engrave(g, kind, 'NULLPUNKT WAFFENWERK (NPW) GMBH', lx0 + 4, ly0 + 27, 34, { stretch: 0.88 });
    engrave(g, kind, 'KAL. .50 AE · NORDHAFEN', lx0 + 118, ly0 + 58, 30, { stretch: 0.88 });
    const [nx0, , , ny1] = R.MARKS.nummer;
    engrave(g, kind, 'NP 50 0713', nx0 + 6, ny1 - 3, 30, { stretch: 0.92, weight: '500' });
  } else {
    engrave(g, kind, 'ADLER .50 AE PISTOLE', lx0 + 150, ly0 + 27, 34, { stretch: 0.88, mirror: true });
    engrave(g, kind, 'NULLPUNKT WAFFENWERK · NORDHAFEN', lx0 + 30, ly0 + 58, 30, { stretch: 0.88, mirror: true });
  }
  // ---- Abrieb und Kratzer (Albedo/Rauheit): Holster und Hand reiben Kanten blank, polierter Lauf mit feinen Wischern
  // (links dieselbe Folge wie rechts – die Bänder der linken Seite schließen ohne Naht an die Fotoprojektion an)
  if (kind !== 'h') {
    const rw = rng(311);
    const wear = (a) => (kind === 'a' ? `rgba(236,238,241,${a})` : `rgba(30,30,30,${a})`);
    streak(g, rw, 420, 1005, R.SLIDE_TOP_Y + 1, 3, 0.55, wear);                 // Oberkante Schlitten
    streak(g, rw, 340, 940, R.SLIDE_BOTTOM_Y - 3, 2.5, 0.45, wear);             // Unterkante Schlitten
    streak(g, rw, 1030, 2200, R.RIB.top + 1, 2.5, 0.5, wear);                  // Schienenkante
    streak(g, rw, 1050, 2230, R.SHOULDER_Y - 1, 2.2, 0.4, wear);               // Schulter Lauf
    streak(g, rw, 1300, 2180, 506, 3, 0.55, wear);                              // Staubschutz unten (Holster)
    streak(g, rw, 905, 1210, 693, 3, 0.5, wear);                                // Bügel unten
    let gr = g.createLinearGradient(R.MUZZLE_X, 0, R.MUZZLE_X - 40, 0); gr.addColorStop(0, wear(0.7)); gr.addColorStop(1, wear(0));
    g.fillStyle = gr; g.fillRect(R.MUZZLE_X - 40, 172, 40, 340);                 // Mündung/Vorderstück blank
    gr = g.createLinearGradient(330, 0, 360, 0); gr.addColorStop(0, wear(0.5)); gr.addColorStop(1, wear(0));
    g.fillStyle = gr; g.fillRect(320, 141, 40, 232);                             // Schlittenheck
    const sc = (k) => (kind === 'a' ? `rgba(${k > 0.5 ? '240,242,245' : '120,123,128'},${0.06 + k * 0.12})` : `rgba(${k > 0.5 ? '20,20,20' : '120,120,120'},${0.25 + k * 0.3})`);
    scratches(g, rw, [400, 150, 1000, 360], 70, sc);
    scratches(g, rw, [1040, 180, 2230, 365], 110, sc, { len: [4, 45], spread: 0.25 });
    scratches(g, rw, [1250, 380, 2220, 505], 60, sc);
    // Wischspuren/Fingerabdrücke auf dem polierten Lauf (nur Rauheit/Albedo, weich)
    for (let i = 0; i < 9; i++) {
      const x = 1100 + rw() * 1050, y = 200 + rw() * 150, r0 = 18 + rw() * 30;
      const rg = g.createRadialGradient(x, y, 0, x, y, r0);
      rg.addColorStop(0, kind === 'a' ? 'rgba(150,153,158,0.12)' : 'rgba(150,150,150,0.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
    }
  }
  g.restore();
}

// Griff (nur rechte Projektion – beide Seiten gleich): Grund, Kieselfeld mit glattem Rand, rundes Feld mit Zeichen
function drawGrip(g, kind, pats) {
  const base = { h: grey(0.5), a: 'rgb(28,29,31)', r: grey(0.78) }[kind];
  g.save(); path(g, R.PANEL); g.fillStyle = base; g.fill(); g.clip();
  g.fillStyle = pats.pebble; g.fillRect(100, 380, 760, 780);
  // glatter Rand (≈ 2 mm) und Formtrennung
  g.strokeStyle = base; g.lineWidth = 34; path(g, R.PANEL); g.stroke();
  g.strokeStyle = kind === 'h' ? grey(0.44) : kind === 'a' ? 'rgba(12,12,14,0.5)' : grey(0.86); g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(140, 1112); g.lineTo(700, 1106); g.stroke();
  // rundes Feld: glatt, erhabener Ring, darin das Fadenkreuz-Null (eigenes Zeichen)
  const [mx, my, mr] = R.MEDALLION;
  g.fillStyle = kind === 'h' ? grey(0.56) : kind === 'a' ? 'rgb(34,35,37)' : grey(0.6);
  g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  g.strokeStyle = kind === 'h' ? grey(0.72) : kind === 'a' ? 'rgb(48,49,52)' : grey(0.5); g.lineWidth = 7;
  g.beginPath(); g.arc(mx, my, mr - 6, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.arc(mx, my, mr * 0.42, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(mx - mr * 0.7, my); g.lineTo(mx + mr * 0.7, my); g.moveTo(mx, my - mr * 0.7); g.lineTo(mx, my + mr * 0.7); g.stroke();
  // Griffspuren (speckig, glatter) im Handbereich
  if (kind !== 'h') {
    const rw = rng(321);
    for (let i = 0; i < 12; i++) {
      const x = 260 + rw() * 360, y = 560 + rw() * 420, r0 = 30 + rw() * 40;
      const rg = g.createRadialGradient(x, y, 0, x, y, r0);
      rg.addColorStop(0, kind === 'a' ? 'rgba(60,62,66,0.16)' : 'rgba(80,80,80,0.3)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
    }
  }
  g.restore();
  // Kieselfeld für Griffrücken/-vorderseite/-boden
  g.fillStyle = base; g.fillRect(PEB[0], PEB[1], PEB[2] - PEB[0], PEB[3] - PEB[1]);
  g.fillStyle = pats.pebble; g.fillRect(PEB[0], PEB[1], PEB[2] - PEB[0], PEB[3] - PEB[1]);
}

function layer(kind, W, H, shared) {
  const c = canvas(W, H), g0 = c.getContext('2d', CPU);
  g0.fillStyle = kind === 'a' ? STEEL_A : kind === 'r' ? grey(0.3) : grey(0.5);
  g0.fillRect(0, 0, W, H);
  // wolkige Fleckung (Albedo/Rauheit) weich skaliert
  if (kind !== 'h') {
    g0.save(); g0.globalCompositeOperation = 'overlay'; g0.globalAlpha = kind === 'a' ? 0.08 : 0.3; g0.imageSmoothingQuality = 'low';
    g0.drawImage(shared.noise, 0, 0, W, H); g0.restore();
  }
  const g = ctxIn(c), k = W / F.W, sx = c.width / (F.x1 - F.x0), sy = c.height / (F.y1 - F.y0);
  // Bänder der linken Seite: Grund und Fleckung der Fotoprojektion an die Bandstelle kopieren (gleiche Wolken wie rechts)
  for (const { src, d } of LBANDS) {
    const x0 = (src[0] - BM - F.x0) * sx, y0 = (src[1] - BM - F.y0) * sy, w = (src[2] - src[0] + 2 * BM) * sx, h = (src[3] - src[1] + 2 * BM) * sy;
    g0.drawImage(c, x0, y0, w, h, x0 + d[0] * sx, y0 + d[1] * sy, w, h);
  }
  const pat = (src, s, sy2 = 1) => { const p = g.createPattern(src, 'repeat'); if (p.setTransform && typeof DOMMatrix === 'function') p.setTransform(new DOMMatrix().scale(s, s * sy2)); return p; };
  // Muster in Atlaspixeln (Fotopixel → Atlas: 0,8 Texel/px) – Bürstenstrich längs gestreckt
  const pats = {
    grain: pat(shared.grain, 1 / (0.8 * k)),
    brush: pat(shared.brush, 1 / (0.8 * k), 0.6),
    pebble: pebblePattern(g, kind, { size: 150, scale: 0.8 * k, r0: 2.0, r1: 3.8, n: 700, seed: kind === 'a' ? 7 : 9 }),
  };
  // Blankfeld (gebürstet) für Ober-/Unterseiten von Schlitten und Lauf; Muster im Feldmaßstab (gleich fein wie an den Seiten)
  g.fillStyle = kind === 'a' ? FINISH.slide.a : kind === 'r' ? grey(0.32) : grey(0.5);
  g.fillRect(BLANK[0], BLANK[1], BLANK[2] - BLANK[0], BLANK[3] - BLANK[1]);
  g.save(); g.globalAlpha = kind === 'h' ? 0.03 : kind === 'r' ? 0.14 : 0.05; g.globalCompositeOperation = 'overlay';
  g.fillStyle = pat(shared.brush, KB / (0.8 * k), 0.6); g.fillRect(BLANK[0], BLANK[1], BLANK[2] - BLANK[0], BLANK[3] - BLANK[1]); g.restore();
  // gestrahltes Feld: genau die Rahmenseite (Ton, Rauheit, Korn im selben Weltmaßstab) – an den gerundeten Kanten wechselt
  // die Abbildung von der Fotoprojektion hierher, ohne sichtbare Naht (25.10.: vorher dunkler → Sägezahn am Sporn)
  g.fillStyle = kind === 'a' ? FINISH.frame.a : kind === 'r' ? grey(FINISH.frame.r) : grey(0.5);
  g.fillRect(MATT[0], MATT[1], MATT[2] - MATT[0], MATT[3] - MATT[1]);
  g.save(); g.globalAlpha = kind === 'h' ? 0.008 : kind === 'r' ? 0.08 : 0.04; g.globalCompositeOperation = 'overlay';
  g.fillStyle = pat(shared.grain, KM / (0.8 * k)); g.fillRect(MATT[0], MATT[1], MATT[2] - MATT[0], MATT[3] - MATT[1]); g.restore();
  // Innenwände: wie gestrahlt, aber dunkler (Fenster-, Schlitz- und Bügelinnenflächen bekommen kaum Licht)
  g.fillStyle = kind === 'a' ? 'rgb(112,115,120)' : kind === 'r' ? grey(0.55) : grey(0.5);
  g.fillRect(INNER[0], INNER[1], INNER[2] - INNER[0], INNER[3] - INNER[1]);
  g.save(); g.globalAlpha = kind === 'h' ? 0.008 : kind === 'r' ? 0.1 : 0.05; g.globalCompositeOperation = 'overlay';
  g.fillStyle = pat(shared.grain, KM / (0.8 * k)); g.fillRect(INNER[0], INNER[1], INNER[2] - INNER[0], INNER[3] - INNER[1]); g.restore();
  drawSide(g, kind, false, pats);
  // linke Seite nur in den Bändern (Inhalt in Fotopixeln, verschoben; Muster wandern mit – gleiche Lage wie rechts)
  for (const { src, d } of LBANDS) {
    g.save(); g.translate(d[0], d[1]);
    g.beginPath(); g.rect(src[0] - BM, src[1] - BM, src[2] - src[0] + 2 * BM, src[3] - src[1] + 2 * BM); g.clip();
    drawSide(g, kind, true, pats);
    g.restore();
  }
  drawGrip(g, kind, pats);
  return c;
}

// Kantenlänge je Stufe: PC hoch 2048 × 1024 (≈ 0,16 mm je Texel), PC niedrig/mittel 1536 × 768, Handy 1024 × 512 (nur Albedo +
// Normalen, Rauheit konstant im Material). Normalenstärke mit der Texelgröße skaliert. Handy: Normalenkarte halb so groß
// (512 × 256) – 25.10. (Prüfung): sonst 5,8 MB statt ≤ 4 MB (§8.3); Rillen/Gravuren tragen am Handy vor allem die Albedo.
const SIZE = { max: 1, std: 0.75, lite: 0.5 };
function maps(tier) {
  const f = SIZE[tier], W = F.W * f, H = F.H * f, nf = tier === 'lite' ? 0.5 : 1, NW = W * nf, NH = H * nf;
  const shared = { noise: noiseCanvas(331), grain: grainCanvas(337), brush: brushCanvas(339) };
  const h = blur(readHeight(layer('h', NW, NH, shared)), NW, NH);
  return {
    map: toTexture(layer('a', W, H, shared), { srgb: true, repeat: false, aniso: 8 }),
    normalMap: normalTex(h, NW, NH, 3.0 * f * nf),
    roughnessMap: tier === 'lite' ? null : toTexture(layer('r', W, H, shared), { repeat: false, aniso: 8 }),
  };
}

/** Atlas der Adler je Stufe ('max' | 'std' | 'lite'), direkt in dieser Größe gezeichnet (Stahl und Griff teilen ihn). */
export function adlerMaps(tier = 'max') {
  const key = tier === 'max' ? 'adler' : 'adler:' + tier;
  return cached(key, () => ({ key, ...maps(tier) }));
}
