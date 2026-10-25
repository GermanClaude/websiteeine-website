// Kunststoff- und Gussoberflächen für Waffen-Atlanten (25.10.2026, Textur-Teil des Polymer-Baukastens G12 – zuerst für
// die QX-90, danach Keiler, Wespe, K-36, BX-20). Gezeichnet wird mit Leinwand-Pfaden in FOTOPIXELN (der Aufrufer setzt
// die Transformation Fotoausschnitt → Atlasband), je Ebene: 'a' Farbe (sRGB), 'r' Rauheit (Grau = Wert), 'h' Höhe
// (Grau 0,5 = Fläche, heller = erhaben). So liegen Schrift, Kanten und Kratzer genau dort, wo sie im Foto sind.
//   mottle(c, kind, o)                 – Grundton und großflächige Wolkigkeit (Spritzguss: matt, leicht fleckig)
//   moldedText(g, kind, text, x, y, o) – eingeformte (erhabene) oder eingeprägte Schrift
//   edgeWear(g, kind, line, o)         – Abrieb entlang einer Kante (unterbrochene, hellere, glattere Striche)
//   scuffs(g, kind, rect, o)           – Kratzer und Schlieren in einem Rechteck (Fotopixel)
//   ring(g, kind, x, y, r, o)          – flache Ringnut (Senkung um eine Schraube)
import { canvas, fbm, rng } from './textures.js';

const grey = (h) => { const k = Math.max(0, Math.min(255, Math.round(h * 255))); return `rgb(${k},${k},${k})`; };
export const GREY = grey;

/** Grundton einer Ebene + Wolkigkeit (kleines Rauschbild weich hochskaliert, keine Pixelschleife). o: { base: {a, r, h}, seed, amp } */
export function mottle(c, kind, o = {}) {
  const W = c.width, H = c.height, g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = (o.base && o.base[kind]) || { h: grey(0.5), r: grey(0.7), a: 'rgb(48,49,52)' }[kind];
  g.fillRect(0, 0, W, H);
  if (kind === 'h') return;
  const nw = 256, nh = 128, n = fbm(nw, nh, { seed: (o.seed ?? 301) + (kind === 'a' ? 0 : 7), period: o.period ?? 7, octaves: 4 });
  const nc = canvas(nw, nh), ng = nc.getContext('2d'), id = ng.createImageData(nw, nh), amp = (o.amp ?? 1) * (kind === 'a' ? 30 : 70);
  for (let i = 0; i < nw * nh; i++) { const k = 128 + (n[i] - 0.5) * amp; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = k; id.data[i * 4 + 3] = 255; }
  ng.putImageData(id, 0, 0);
  g.globalCompositeOperation = 'soft-light'; g.imageSmoothingEnabled = true; g.drawImage(nc, 0, 0, W, H); g.globalCompositeOperation = 'source-over';
}

/**
 * Schrift im Fotomaßstab: x, y = linke Grundlinie (Fotopixel), o: { size (px), weight, raised (true = eingeformt/erhaben,
 * false = eingeprägt), mirror (gespiegelt – linke Seite, damit sie von links gelesen richtig steht), font, track }.
 */
export function moldedText(g, kind, text, x, y, o = {}) {
  const size = o.size ?? 14, up = o.raised !== false;
  g.save(); g.translate(x, y); if (o.mirror) g.scale(-1, 1);
  g.font = `${o.weight ?? 700} ${size}px ${o.font ?? 'Arial, Helvetica, sans-serif'}`; g.textBaseline = 'alphabetic';
  if (o.track) g.letterSpacing = `${o.track}px`;
  const col = { h: up ? grey(0.66) : grey(0.32), a: up ? 'rgba(78,80,84,0.55)' : 'rgba(10,10,12,0.6)', r: up ? grey(0.55) : grey(0.8) }[kind];
  if (kind === 'h') { g.fillStyle = up ? grey(0.58) : grey(0.4); g.fillText(text, 0.6, 0.6); }   // Schatten-/Lichtkante (weicher Rand)
  g.fillStyle = col; g.fillText(text, 0, 0);
  g.restore();
}

/** Abrieb an einer Kante: line = [[x, y], …] (Fotopixel), o: { width, alpha, seed, inset (px nach innen, Normalenrichtung egal) } */
export function edgeWear(g, kind, line, o = {}) {
  if (kind === 'h') return;
  const rr = rng(o.seed ?? 17), w = o.width ?? 3, al = o.alpha ?? 0.4;
  const col = (a) => (kind === 'a' ? `rgba(${o.col || '120,122,126'},${a})` : `rgba(60,60,60,${a})`);
  g.lineCap = 'round';
  for (let i = 0; i < line.length - 1; i++) {
    const [xa, ya] = line[i], [xb, yb] = line[i + 1], L = Math.hypot(xb - xa, yb - ya) || 1, nx = -(yb - ya) / L, ny = (xb - xa) / L;
    for (let s = 0; s < L;) {
      const l = 6 + rr() * 40;
      if (rr() > 0.35) {
        // Stück in 4-px-Schritten: an den Enden ausgedünnt (kein Strich mit harter Kante), leicht quer versetzt
        const a = al * (0.35 + 0.65 * rr()), lw = w * (0.5 + rr() * 0.7), n = Math.max(2, Math.ceil(l / 4));
        let off = (rr() - 0.5) * w * 0.6;
        for (let k = 0; k < n; k++) {
          const t0 = Math.min(1, (s + l * k / n) / L), t1 = Math.min(1, (s + l * (k + 1) / n) / L), f = Math.sin(Math.PI * (k + 0.5) / n);
          const o2 = off + (rr() - 0.5) * w * 0.25;
          g.strokeStyle = col(a * (0.3 + 0.7 * f)); g.lineWidth = lw * (0.45 + 0.55 * f);
          g.beginPath(); g.moveTo(xa + (xb - xa) * t0 + nx * off, ya + (yb - ya) * t0 + ny * off); g.lineTo(xa + (xb - xa) * t1 + nx * o2, ya + (yb - ya) * t1 + ny * o2); g.stroke();
          off = o2;
        }
      }
      s += l + rr() * 30;
    }
  }
}

/**
 * Kratzer/Schlieren: rect = [x0, y0, x1, y1] (Fotopixel), o: { n, seed, len, alpha, col (Farbe heller Kratzer 'r,g,b'),
 * dir (Vorzugswinkel), height (auch in den Höhenkanal – Standard nein: feine Kratzer sind Farbe und Glanz, als Rillen
 * in der Normal-Map wirkte die Fläche wie Hammerschlaglack, Prüfung QX-90 25.10.) }
 */
export function scuffs(g, kind, rect, o = {}) {
  if (kind === 'h' && !o.height) return;
  const rr = rng(o.seed ?? 29), n = o.n ?? 60, [x0, y0, x1, y1] = rect, len = o.len ?? 30, al = o.alpha ?? 0.14;
  for (let k = 0; k < n; k++) {
    const x = x0 + rr() * (x1 - x0), y = y0 + rr() * (y1 - y0), l = len * (0.15 + rr()), a = (o.dir ?? 0) + (rr() - 0.5) * (o.spread ?? 0.8);
    if (kind === 'a') g.strokeStyle = `rgba(${o.col || '150,152,158'},${al * (0.3 + rr())})`;
    else if (kind === 'r') g.strokeStyle = `rgba(${o.rough ?? 40},${o.rough ?? 40},${o.rough ?? 40},${0.25 + rr() * 0.3})`;
    else g.strokeStyle = `rgba(90,90,90,${0.2 + rr() * 0.25})`;
    g.lineWidth = 0.5 + rr() * 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}

/** Flache Ringnut (z. B. Senkung um einen Schraubenkopf): dunkler Rand, leicht vertieft. */
export function ring(g, kind, x, y, r, o = {}) {
  g.lineWidth = o.width ?? 1.6;
  g.strokeStyle = { h: grey(0.38), a: 'rgba(8,8,10,0.45)', r: grey(0.82) }[kind];
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}
