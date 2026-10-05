// Einsätze (Schüsse/Schläge) in einer Datei finden: Schwelle relativ zur Dateispitze, Sperrzeit.
// Aufruf: node tools/audio/onsets.mjs <datei> [schwelle_dB=-20] [sperre_s=0.4]
// Ausgabe je Einsatz: Zeit (s, 1 ms genau, 2 ms vor Schwellenüberschreitung), Spitze (dBFS), Abstand zum nächsten.
import { decode } from './analyze.mjs';

export function onsets(file, thrDb = -20, hold = 0.4) {
  const { chs, sr } = decode(file);
  const n = chs[0].length, a = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) a[i] = Math.max(a[i], Math.abs(c[i]));
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, a[i]);
  const thr = pk * 10 ** (thrDb / 20), out = [];
  for (let i = 0; i < n; i++) {
    if (a[i] < thr) continue;
    let s = i; const quiet = pk * 10 ** ((thrDb - 24) / 20);
    while (s > 0 && i - s < sr * 0.01 && a[s - 1] > quiet) s--;
    let lp = 0; const end = Math.min(n, i + Math.round(sr * 0.05)); for (let j = i; j < end; j++) lp = Math.max(lp, a[j]);
    out.push({ t: +(s / sr - 0.002).toFixed(3), peakDb: +(20 * Math.log10(lp)).toFixed(1) });
    i += Math.round(sr * hold);
  }
  for (let k = 0; k < out.length; k++) out[k].gap = k + 1 < out.length ? +(out[k + 1].t - out[k].t).toFixed(3) : +((n / sr) - out[k].t).toFixed(3);
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [f, thr = '-20', hold = '0.4'] = process.argv.slice(2);
  for (const o of onsets(f, +thr, +hold)) console.log(`${o.t.toFixed(3)}s  ${o.peakDb} dBFS  → ${o.gap}s`);
}
