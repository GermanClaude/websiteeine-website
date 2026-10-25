// HK-Baukasten, Texturteil (24.10.2026): Zeichenhilfen für die Atlanten der HK-Familie (VP-9, später Keiler/G-7) – bewusst
// ohne Importe, weil materials.js die Atlanten der Waffen lädt (kein Modulkreis über Builder/sdfkit).

/**
 * Piktogramme des Feuerstoß-Griffstücks auf eine Leinwand zeichnen (Koordinaten der Leinwand in Fotopixeln): Rahmen mit
 * n Patronen (Spitze nach vorn = +x), Sicher als weißes, durchgekreuztes Feld, Zuleitungen zur Wahlhebelachse.
 * items: [{ n, u0, u1, v0, v1, col }] in mm relativ zur Achse (u vorn, v oben); ax/ay = Achse in Fotopixeln, k = px/mm.
 */
export function hkPictograms(g, items, ax, ay, k, { lw = 0.32, line = true } = {}) {
  const X = (mmU) => ax + mmU * k, Y = (mmV) => ay - mmV * k;
  g.lineWidth = lw * k; g.lineJoin = 'round';
  for (const it of items) {
    g.strokeStyle = g.fillStyle = it.col;
    const x0 = X(it.u0), x1 = X(it.u1), y0 = Y(it.v1), y1 = Y(it.v0), h = y1 - y0;
    g.strokeRect(x0, y0, x1 - x0, h);
    const n = Math.max(1, it.n), w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      // Patrone: Hülse (Rechteck) + spitzes Geschoss nach vorn (+x), als Umriss
      const bx = x0 + i * w + w * 0.14, bw = w * 0.72, cy = y0 + h / 2, hh = h * 0.28;
      g.beginPath();
      g.moveTo(bx, cy - hh); g.lineTo(bx + bw * 0.55, cy - hh); g.lineTo(bx + bw, cy); g.lineTo(bx + bw * 0.55, cy + hh); g.lineTo(bx, cy + hh); g.closePath();
      g.stroke();
    }
    if (it.safe) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.moveTo(x0, y1); g.lineTo(x1, y0); g.stroke(); }
    if (line && it.lead) {
      // Zuleitung vom Feld zur Achse (endet am Rand der Hebelnabe)
      const [lu, lv] = it.lead, L = Math.hypot(lu, lv), e = 7.5 / L;
      g.beginPath(); g.moveTo(X(lu), Y(lv)); g.lineTo(X(lu * e), Y(lv * e)); g.stroke();
    }
  }
}
