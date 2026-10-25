// HK-Baukasten, Texturteil (24.10.2026): Zeichenhilfen für die Atlanten der HK-Familie (VP-9, später Keiler/G-7) – bewusst
// ohne Importe, weil materials.js die Atlanten der Waffen lädt (kein Modulkreis über Builder/sdfkit).

/**
 * Piktogramme des Feuerstoß-Griffstücks auf eine Leinwand zeichnen (Koordinaten der Leinwand in Fotopixeln): Rahmen mit
 * n Patronen (Spitzoval, Spitze nach vorn = +x), Sicher als weißes, durchgekreuztes Feld, Zuleitungen zur Wahlhebelachse.
 * items: [{ n, u0, u1, v0, v1, col, outer?, lead?, safe? }] in mm relativ zur Achse (u vorn, v oben); outer = [u0, u1, v0, v1]
 * Doppellinie außen (Dauerfeuer, vorn offen, hinten geschlossen); ax/ay = Achse in Fotopixeln, k = px/mm; hub = Radius der
 * Hebelnabe in mm (dort endet die Zuleitung). 25.10. nach dem PASKAL-Foto (A5-Griffstück).
 */
export function hkPictograms(g, items, ax, ay, k, { lw = 0.32, line = true, hub = 7.5 } = {}) {
  const X = (mmU) => ax + mmU * k, Y = (mmV) => ay - mmV * k;
  g.lineWidth = lw * k; g.lineJoin = 'round'; g.lineCap = 'round';
  for (const it of items) {
    g.strokeStyle = g.fillStyle = it.col;
    const x0 = X(it.u0), x1 = X(it.u1), y0 = Y(it.v1), y1 = Y(it.v0), h = y1 - y0;
    g.strokeRect(x0, y0, x1 - x0, h);
    if (it.outer) {
      const [ou0, ou1, ov0, ov1] = it.outer;
      g.beginPath();
      g.moveTo(X(ou1), Y(ov1)); g.lineTo(X(ou0), Y(ov1)); g.lineTo(X(ou0), Y(ov0)); g.lineTo(X(ou1), Y(ov0));
      g.stroke();
    }
    const n = Math.max(1, it.n), w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      // Patrone als Spitzoval: Boden hinten stumpf gerundet, Spitze vorn (+x)
      const bx = x0 + i * w + w * 0.12, bw = w * 0.76, cy = y0 + h / 2, hh = h * 0.3;
      g.beginPath();
      g.moveTo(bx + bw, cy);
      g.bezierCurveTo(bx + bw * 0.62, cy - hh * 1.25, bx + bw * 0.12, cy - hh * 1.05, bx, cy - hh * 0.45);
      g.quadraticCurveTo(bx - bw * 0.04, cy, bx, cy + hh * 0.45);
      g.bezierCurveTo(bx + bw * 0.12, cy + hh * 1.05, bx + bw * 0.62, cy + hh * 1.25, bx + bw, cy);
      g.closePath(); g.stroke();
    }
    if (it.safe) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.moveTo(x0, y1); g.lineTo(x1, y0); g.stroke(); }
    if (line && it.lead) {
      // Zuleitung vom Feld zur Achse (endet am Rand der Hebelnabe)
      const [lu, lv] = it.lead, L = Math.hypot(lu, lv), e = Math.min(1, hub / L);
      g.beginPath(); g.moveTo(X(lu), Y(lv)); g.lineTo(X(lu * e), Y(lv * e)); g.stroke();
    }
  }
}
