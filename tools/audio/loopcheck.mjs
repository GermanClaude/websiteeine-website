// Prüft die Schleifennaht: Sprung am Übergang Ende→Anfang verglichen mit der Verteilung der Sample-Schritte
// (Perzentil) und Pegel der letzten/ersten 200 ms. Unter dem 99. Perzentil = kein Knackser.
import { decode } from './analyze.mjs';
for (const f of process.argv.slice(2)) {
  const { chs, sr } = decode(f, 24000);
  for (const [c, x] of chs.entries()) {
    const n = x.length, steps = new Float32Array(n - 1);
    for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(x[i] - x[i - 1]);
    const sorted = Float32Array.from(steps).sort(), pct = p => sorted[Math.floor(p * (sorted.length - 1))];
    const seam = Math.abs(x[0] - x[n - 1]);
    const rank = sorted.findIndex(v => v >= seam) / sorted.length;
    const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const head = rms(x.subarray(0, sr * 0.2)), tail = rms(x.subarray(n - sr * 0.2));
    console.log(`${f.split('/').pop()} ch${c}: Naht ${(20 * Math.log10(seam + 1e-9)).toFixed(1)} dBFS = Perzentil ${(rank * 100).toFixed(1)} % (p99 ${(20 * Math.log10(pct(0.99))).toFixed(1)} dBFS) · Pegel Ende/Anfang ${(20 * Math.log10(tail / head)).toFixed(1)} dB`);
  }
}
