// NULLPUNKT – Mehrspieler: Interpolation der Puppen deterministisch prüfen (dev/net-interp.html, virtuelle Uhr, ohne WebGL).
// Der echte ClientSync-Code (Wiedergabe-Uhr, Interpolation, Glättung) bekommt 20-Hz-Schnappschüsse einer bekannten Bahn mit
// Laufzeit/Schwankung/Verlust; je Bild (60/s) wird der Darstellungsverzug gemessen. Zum Vergleich die alte Rechnung.
// Voraussetzung: Server auf 8765. Aufruf: node tools/net-interp-test.mjs
import { chromium, BASE } from './pw.mjs';

let fail = 0;
let count = 0;
const check = (ok, text) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; };
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}dev/net-interp.html`);
  await page.waitForFunction(() => window.__interp && window.__interp.done, null, { timeout: 120000 });
  const res = await page.evaluate(() => window.__interp.results);
  const f = (m) => `Verzug ${m.delayMs} ms, Schwankung ${m.spreadMs} ms, rückwärts ${m.back}, größte Abweichung/Bild ${m.maxJumpCm} cm${m.overshootCm != null ? `, Überschwingen ${m.overshootCm} cm` : ''}`;
  for (const r of res) {
    // Schwankung des Darstellungsverzugs = Ruckeln (bei 4,5 m/s: 50 ms ≙ 22 cm)
    const spreadMax = r.lag >= 300 ? 120 : r.jitter >= 60 ? 150 : 60;
    // langsamer, unregelmäßiger Host: Fortschreiben endet nach 0,25 s, dann steht die Puppe bis zum nächsten Schnappschuss –
    // Sprünge sind dort unvermeidlich, aber sie darf nie rückwärts laufen
    const okNew = r.lowRate
      ? r.frames > 400 && r.back === 0
      : r.frames > 400 && r.spreadMs <= spreadMax && r.back === 0 && r.maxJumpCm <= 15 && (r.overshootCm == null || r.overshootCm <= 30);
    check(okNew, `${r.name}: neu ${f(r)} | alt ${f(r.old)}`);
  }
  check(!errors.length, `keine Seitenfehler${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
