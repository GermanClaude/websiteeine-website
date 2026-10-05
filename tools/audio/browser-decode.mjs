// Prüft im echten Browser (Playwright-Chromium), wie decodeAudioData die MP3s liefert:
// Länge gegenüber ffmpeg (Encoder-Verzögerung/Polsterung), Einsatz (führende Stille), Spitzenpegel.
// Aufruf: NP_BASE=http://localhost:8790/ node tools/audio/browser-decode.mjs
import { chromium, BASE } from '../pw.mjs';
import { readFileSync } from 'node:fs';
const man = JSON.parse(readFileSync(new URL('../../assets/lib/audio/manifest.json', import.meta.url), 'utf8'));
const files = [];
for (const [name, s] of Object.entries(man.sounds)) for (const v of s.variants) files.push({ name, file: v.file, dur: v.dur, onsetMs: v.onsetMs, rate: s.rate, loop: s.layer === 'bed' });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(BASE + 'index.html').catch(() => {});
const res = await page.evaluate(async ({ files, base }) => {
  const out = [];
  for (const f of files) {
    try {
      const buf = await (await fetch(base + 'assets/lib/audio/' + f.file)).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, f.rate);
      const ab = await ctx.decodeAudioData(buf);
      const x = ab.getChannelData(0); let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
      let on = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > pk * 0.03) { on = i; break; }
      let lead = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-5) { lead = i; break; }
      let tail = 0; for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 1e-5) { tail = x.length - 1 - i; break; }
      out.push({ name: f.name, file: f.file, rate: ab.sampleRate, len: ab.length, ffLen: Math.round(f.dur * f.rate), onsetMs: +(on / ab.sampleRate * 1000).toFixed(1), ffOnsetMs: f.onsetMs, leadZeros: lead, tailZeros: tail, peakDb: +(20 * Math.log10(pk)).toFixed(1) });
    } catch (e) { out.push({ name: f.name, file: f.file, error: String(e) }); }
  }
  return out;
}, { files, base: BASE });
await browser.close();
let bad = 0;
for (const r of res) {
  if (r.error) { console.log(`FEHLER ${r.file}: ${r.error}`); bad++; continue; }
  const dl = r.len - r.ffLen;
  if (Math.abs(dl) > 2 || Math.abs(r.onsetMs - r.ffOnsetMs) > 2) bad++;
}
const sum = res.filter(r => !r.error);
const dls = sum.map(r => r.len - r.ffLen), dons = sum.map(r => r.onsetMs - r.ffOnsetMs);
console.log(`${res.length} Dateien dekodiert, Fehler ${res.filter(r => r.error).length}`);
console.log(`Längendifferenz Browser−ffmpeg (Samples): min ${Math.min(...dls)} max ${Math.max(...dls)}`);
console.log(`Einsatzdifferenz Browser−ffmpeg (ms): min ${Math.min(...dons).toFixed(1)} max ${Math.max(...dons).toFixed(1)}`);
console.log(`führende Nullen (Samples): min ${Math.min(...sum.map(r => r.leadZeros))} max ${Math.max(...sum.map(r => r.leadZeros))}`);
for (const r of sum.filter(r => Math.abs(r.onsetMs - r.ffOnsetMs) > 2 || Math.abs(r.len - r.ffLen) > 2 || r.name.startsWith("amb_"))) console.log(JSON.stringify(r));
