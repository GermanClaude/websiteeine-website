// Farbmessung Video-Vorlage ↔ Spielbild (Grafik-Plan Etappe 2): node tools/assets/vorlage-measure.mjs <ordner mit vf/fNNN.png aus dem Video>
// Mittelwert (sRGB), mittlere Leuchtdichte L und relative Streuung je Ausschnitt – Grundlage für Tint/Farbfaktoren.
import sharp from 'sharp';
const S = process.argv[2], V = `${S}/vf`, G = '/home/user/websiteeine-website/tools/out/vergleich';
const jobs = [
  ['VID boden-sonne', `${V}/f062.png`, 540, 440, 160, 60], ['ICH boden-sonne', `${G}/${process.env.TAG || 'final'}-hafen-container.png`, 1000, 560, 200, 60],
  ['VID boden-schatten', `${V}/f062.png`, 300, 600, 150, 60], ['ICH boden-schatten', `${G}/${process.env.TAG || 'final'}-hafen-container.png`, 300, 640, 200, 60],
  ['VID cont-blau', `${V}/f062.png`, 1060, 300, 180, 180], ['ICH cont-blau', `${G}/${process.env.TAG || 'final'}-hafen-container.png`, 1050, 380, 160, 110],
  ['VID cont-rostrot', `${V}/f062.png`, 1050, 40, 200, 200], ['ICH cont-orange', `${G}/${process.env.TAG || 'final'}-hafen-container.png`, 1060, 60, 120, 110],
  ['VID cont-rot', `${V}/f062.png`, 780, 180, 220, 110], ['ICH cont-rot', `${G}/${process.env.TAG || 'final'}-hafen-container.png`, 1200, 60, 70, 110],
  ['VID cont-gruen', `${V}/f062.png`, 890, 330, 120, 120],
  ['VID halle-wand', `${V}/f001.png`, 30, 120, 240, 260], ['ICH halle-wand', `${G}/${process.env.TAG || 'final'}-hafen-halle.png`, 20, 60, 250, 200],
  ['VID ziegel-gasse', `${V}/f160.png`, 20, 60, 120, 300], ['ICH ziegel-gasse', `${G}/${process.env.TAG || 'final'}-werk-gasse.png`, 20, 60, 120, 300],
  ['VID blauwand-gasse', `${V}/f160.png`, 900, 100, 300, 300],
  ['VID pflaster', `${V}/f200.png`, 500, 600, 400, 100],
  ['VID putz-haus', `${V}/f200.png`, 840, 330, 60, 60], ['VID dach-rot', `${V}/f200.png`, 30, 300, 80, 25],
];
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
for (const [name, f, x, y, w, h] of jobs) {
  try {
    const { data } = await sharp(f).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = w * h; let r = 0, g = 0, b = 0, l2 = 0, l1 = 0;
    for (let i = 0; i < n; i++) { r += data[i * 3]; g += data[i * 3 + 1]; b += data[i * 3 + 2]; const L = 0.2126 * toLin(data[i * 3] / 255) + 0.7152 * toLin(data[i * 3 + 1] / 255) + 0.0722 * toLin(data[i * 3 + 2] / 255); l1 += L; l2 += L * L; }
    const m = l1 / n, sd = Math.sqrt(Math.max(0, l2 / n - m * m));
    console.log(name.padEnd(20), [r, g, b].map((v) => Math.round(v / n).toString().padStart(4)).join(''), '  L', m.toFixed(3), ' rel.sd', (sd / m).toFixed(2));
  } catch (e) { console.log(name, 'FEHLER', e.message); }
}
