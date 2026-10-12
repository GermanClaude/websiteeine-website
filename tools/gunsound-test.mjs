// NULLPUNKT – Schussklang je Waffe (Nutzer 12.10.): jede Waffe offline durch die komplette Klangkette (Aufnahmen,
// Kaliber-Signatur, Mischung) rendern und messen – eigener Schuss (Pegel, Bass, Nachklingen, Klangfarbe) und Gegner in
// 15/120/400/900 m (hörbar?). Prüft: schwere Kaliber lauter/basslastiger/länger als kleine, Hörweite nach Kaliber,
// keine zwei Waffen klingen gleich. Aufruf: node tools/gunsound-test.mjs [quality]   (Exit-Code ≠ 0 bei Fehlern)
import { chromium, BASE } from './pw.mjs';

const EICHEN = process.argv.includes('--eichen'); // eigenen Schuss je Waffe neutral messen → pcal-Werte ausgeben
const quality = process.argv.slice(2).find((x) => !x.startsWith('--')) || 'high';
let fail = 0, count = 0;
const check = (ok, t, v = '') => { count++; if (!ok) fail++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}${v !== '' ? ` → ${v}` : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + 'dev/data.html').catch(() => {});
const res = await page.evaluate(async ([quality, EICHEN]) => {
  const m = await import('/assets/js/game/engine/audio.js');
  const { WEAPONS } = await import('/assets/js/shared/weapons.data.js');
  const { WEAPON_SOUND, caliberOf } = await import('/assets/js/shared/calibers.data.js');
  const lib = (await import('/assets/js/game/engine/audio/samples.js')).library;
  const { makeRng } = await import('/assets/js/game/engine/audio/dsp.js');
  const names = Object.keys((await (await fetch('/assets/lib/audio/manifest.json')).json()).sounds).filter((n) => /^gun|^mech/.test(n));
  lib.configure({ quality, enabled: true });
  lib.request(names, 100);
  await new Promise((r) => lib.whenReady(names, r, 400000));
  const cam = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.65, 0, 1] }, updateMatrixWorld() {} };
  const SR = 24000, DISTS = [15, 120, 400, 900], SLOT_P = 2.5, SLOT_E = 5.5;
  const mono = (buf, i0, i1) => { const x = new Float32Array(i1 - i0); for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = i0; i < i1; i++) x[i - i0] += d[i] / 2; } return x; };
  const hp = (x, f) => { const a = Math.exp(-2 * Math.PI * f / SR); let y1 = 0, x1 = 0; const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { y1 = a * (y1 + x[i] - x1); x1 = x[i]; y[i] = y1; } return y; };
  const lp = (x, f) => { const a = Math.exp(-2 * Math.PI * f / SR); let y = 0; const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; o[i] = y; } return o; };
  const db = (e) => 10 * Math.log10(e + 1e-14);
  const loud = (x) => { const y = hp(x, 150), W = Math.round(SR * 0.4), hop = Math.round(SR * 0.02); let best = 0; for (let s = 0; s + W <= y.length; s += hop) { let e = 0; for (let i = s; i < s + W; i++) e += y[i] * y[i]; best = Math.max(best, e / W); } return db(best); };
  const energy = (x, n) => { let e = 0; for (let i = 0; i < Math.min(n, x.length); i++) e += x[i] * x[i]; return e / n; };
  // Nachklingen: Zeit vom Spitzenwert, bis die 30-ms-Hüllkurve 30 dB darunter liegt
  const decay = (x) => { const W = Math.round(SR * 0.03); const env = []; for (let s = 0; s + W <= x.length; s += W) env.push(db(energy(x.subarray(s, s + W), W))); const pk = Math.max(...env), ip = env.indexOf(pk); let k = ip; while (k < env.length && env[k] > pk - 30) k++; return (k - ip) * 0.03; };
  // Klangfarbe: Terzbänder 50 Hz … 10 kHz (FFT der ersten 0,68 s, relativ zur Gesamtenergie) + Zeitverlauf
  const fft = (re, im) => { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } } for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } };
  const bands = (x) => {
    const N = 16384, re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < Math.min(N, x.length); i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    const P = (k) => re[k] * re[k] + im[k] * im[k], out = []; let tot = 0; const es = [];
    for (let f = 50; f < 10000; f *= 2 ** (1 / 3)) { const k0 = Math.round(f / SR * N), k1 = Math.max(k0 + 1, Math.round(f * 2 ** (1 / 3) / SR * N)); let e = 0; for (let k = k0; k < k1; k++) e += P(k); es.push(e); tot += e; }
    for (const e of es) out.push(+Math.max(-50, db(e) - db(tot)).toFixed(2));
    // Zeitverlauf: Energie 0–20, 20–80, 80–200, 200–500 ms relativ zur Spitze
    const pk = x.reduce((a, v, i) => (Math.abs(v) > Math.abs(x[a]) ? i : a), 0), seg = [[0, 0.02], [0.02, 0.08], [0.08, 0.2], [0.2, 0.5]];
    const tE = seg.map(([a, b]) => energy(x.subarray(pk + Math.round(a * SR), pk + Math.round(b * SR)), Math.round((b - a) * SR)));
    for (const e of tE) out.push(+Math.max(-50, db(e) - db(tE[0])).toFixed(2));
    return out;
  };
  const ids = Object.keys(WEAPON_SOUND).filter((id) => WEAPONS[id] && WEAPONS[id].cls !== 'melee');
  const rows = [];
  for (const id of ids) {
    const def = WEAPONS[id], prof = def.sound?.profile || 'ar';
    const len = 1 + 2 * SLOT_P + DISTS.length * SLOT_E;
    const ctx = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
    const e = new m.AudioEngine({ settings: null, events: null, camera: cam, params: new URLSearchParams('quality=' + quality) }, { context: ctx, autoUnlock: false, autoMusic: false, recordings: true });
    await e.unlock(); e.update(0); e._rand = makeRng(4711); // gleiche Zufallsfolge für jede Waffe → fairer Vergleich
    const starts = [1, ...DISTS.map((_, k) => 1 + SLOT_P + k * SLOT_E), 1 + SLOT_P + DISTS.length * SLOT_E];
    const plays = [];
    starts.forEach((t, k) => {
      ctx.suspend(t).then(() => {
        e.hdr.top = -60; e._hdrDb = 0; for (const g of [e.hdrQ.gain, e.hdrAmb.gain]) { g.cancelScheduledValues(0); g.value = 1; } e.hearing.reset();
        const sig0 = EICHEN ? { ...e._shotSig(id, def), db: 0, k: 1, pcal: 0, sub: 0, tail: 1, tailPitch: 1 } : null; // Aufnahme + volle Klangfarbe, Pegel neutral
        const o = k === 0 || k === DISTS.length + 1 ? { player: true, weapon: id, variant: k ? 1 : 0, sig: sig0 || undefined } : { position: { x: 0, y: 1.65, z: -DISTS[k - 1] }, weapon: id, variant: 0 };
        plays[k] = !!e.play(prof, o); e.update(0.01); ctx.resume();
      });
    });
    const buf = await ctx.startRendering();
    e.dispose();
    const pl = mono(buf, Math.round(SR), Math.round((1 + SLOT_P) * SR));
    const lowE = db(energy(lp(hp(pl, 30), 120), Math.round(SR * 1)));
    const pl2 = mono(buf, Math.round(starts[DISTS.length + 1] * SR), Math.round((starts[DISTS.length + 1] + SLOT_P) * SR));
    const far = DISTS.map((d, k) => { const x = mono(buf, Math.round(starts[k + 1] * SR), Math.round((starts[k + 1] + SLOT_E) * SR)); let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); return { d, played: plays[k + 1], peak: +(20 * Math.log10(pk + 1e-9)).toFixed(1) }; });
    const cal = caliberOf(id, def);
    rows.push({ id, cal: cal.id, weight: cal.weight, voice: e.voiceFor(id, def, prof), loud: +loud(pl).toFixed(1), bass: +lowE.toFixed(1), decay: +decay(pl).toFixed(2), bands: bands(pl), bands2: bands(pl2), loud2: +loud(pl2).toFixed(1), far });
  }
  return rows;
}, [quality, EICHEN]);
if (EICHEN) {
  const ref = res.find((r) => r.id === 'ar_m17').loud;
  console.log('pcal (dB) je Waffe – in shared/calibers.data.js eintragen:');
  console.log(JSON.stringify(Object.fromEntries(res.map((r) => [r.id, +(ref - r.loud).toFixed(1)]))));
  await browser.close();
  process.exit(0);
}

console.log('Waffe       Kaliber   Stimme        laut   Bass  Nachkl.   15 m   120 m   400 m   900 m');
const fmt = (f) => (f.played ? String(f.peak).padStart(6) : '     –');
for (const r of res) console.log(`${r.id.padEnd(11)} ${r.cal.padEnd(9)} ${String(r.voice).padEnd(12)} ${String(r.loud).padStart(6)} ${String(r.bass).padStart(6)} ${r.decay.toFixed(2).padStart(6)} s ${r.far.map(fmt).join('  ')}`);

const R = Object.fromEntries(res.map((r) => [r.id, r]));
const heard = (id, d) => R[id].far.find((f) => f.d === d)?.played && R[id].far.find((f) => f.d === d).peak > -80;
check(R.sr_titan.loud - R.pi_p9.loud >= 6, '.50 BMG mindestens 6 dB lauter als 9-mm-Pistole (eigener Schuss)', `${(R.sr_titan.loud - R.pi_p9.loud).toFixed(1)} dB`);
check(R.sr_titan.loud > R.sr_brecher.loud && R.sr_brecher.loud > R.ar_m17.loud && R.ar_m17.loud > R.pi_p9.loud && R.pi_p9.loud > R.smg_wespe.loud - 1, 'Lautheit folgt dem Kaliber (.50 > .338 > 5,56 > 9 mm ≥ 4,6 mm)', ['sr_titan', 'sr_brecher', 'ar_m17', 'pi_p9', 'smg_wespe'].map((id) => R[id].loud).join(' > '));
check(R.sr_titan.bass - R.smg_wespe.bass >= 10, 'Schwere Kaliber mit viel mehr Tiefbass 30–120 Hz (.50 BMG vs. 4,6 mm)', `${(R.sr_titan.bass - R.smg_wespe.bass).toFixed(1)} dB`);
check(R.lmg_hm60.bass > R.lmg_lm8.bass && R.ar_kv47.bass > R.ar_m17.bass, 'Bass: 7,62 mm über 5,56 mm (MG und Sturmgewehr)');
check(R.sr_titan.decay > R.smg_wespe.decay && R.sr_brecher.decay > R.pi_p9.decay, 'Schwere Kaliber klingen länger nach', `${R.sr_titan.decay} s vs. ${R.smg_wespe.decay} s`);
check(!heard('pi_p9', 400) && !heard('smg_wespe', 400), '9 mm / 4,6 mm in 400 m nicht mehr hörbar');
check(heard('ar_m17', 400) && !heard('ar_m17', 900), '5,56 mm in 400 m hörbar, in 900 m nicht');
check(heard('sr_titan', 900) && heard('sr_brecher', 900), '.50 BMG und .338 in 900 m noch hörbar');
check(heard('ar_g7', 400) && R.ar_g7.far[2].peak > R.ar_m17.far[2].peak, '7,62×51 in 400 m lauter als 5,56');
// Unterscheidbarkeit: Abstand der Klangprofile (Bänder in dB) + Pegel/Bass/Nachklingen
const vec = (r, two) => [...(two ? r.bands2 : r.bands), two ? r.loud2 : r.loud];
const dist = (a, b, a2 = false, b2 = false) => { const x = vec(a, a2), y = vec(b, b2); let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] - y[i]) ** 2; return Math.sqrt(s / x.length); };
const pairs = [];
const guns = res.filter((r) => !/^(gl_|at_|ub_)/.test(r.id));
for (let i = 0; i < guns.length; i++) for (let j = i + 1; j < guns.length; j++) pairs.push([guns[i].id, guns[j].id, dist(guns[i], guns[j])]);
pairs.sort((a, b) => a[2] - b[2]);
console.log('Ähnlichste Paare:', pairs.slice(0, 5).map(([a, b, d]) => `${a}/${b} ${d.toFixed(2)}`).join(' · '));
// Bezug: wie verschieden sind zwei Schüsse derselben Waffe (andere Aufnahme-Variante)? Andere Waffen müssen sich stärker unterscheiden.
const self = guns.map((r) => dist(r, r, false, true)).sort((a, b) => b - a);
console.log(`Streuung derselben Waffe (Variante 1 vs. 2): max ${self[0].toFixed(2)}, Median ${self[Math.floor(self.length / 2)].toFixed(2)}`);
check(pairs[0][2] >= self[Math.floor(self.length / 2)], 'Keine zwei Schusswaffen klingen gleich (jedes Paar unterscheidet sich mehr als zwei Schüsse derselben Waffe im Mittel)', pairs[0][2].toFixed(2));
check(errs.length === 0, `keine Seitenfehler${errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''}`);
await browser.close();
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
