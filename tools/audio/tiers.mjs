// Speicherbedarf der Aufnahmen je Qualitätsstufe (Download + dekodierter Puffer im RAM).
// Annahmen wie im Hybrid-Vorschlag (dev/audio-lab.html): nur die 8 Katalog-Schussprofile, Atmo nur der aktuellen Karte.
import { readFileSync } from 'node:fs';
const man = JSON.parse(readFileSync(new URL('../../assets/lib/audio/manifest.json', import.meta.url), 'utf8'));
const CORE = new Set(['ar', 'ar_heavy', 'smg', 'lmg', 'sniper', 'shotgun', 'pistol', 'pistol_heavy']);
export const TIERS = {
  // maxVar: Varianten je Layer · rate/ch: Dekodier-Abtastrate/Kanäle je Layer (null = wie Datei)
  high: { label: 'Hoch (Desktop)', maxVar: { near: 4, far: 2, tail: 2, oneshot: 4, mech: 1, bed: 1 }, rate: {}, ch: {} },
  medium: { label: 'Mittel', maxVar: { near: 3, far: 2, tail: 1, oneshot: 3, mech: 1, bed: 1 }, rate: { near: 32000, oneshot: 32000, bed: 22050 }, ch: { tail: 1 } },
  low: { label: 'Niedrig (Handy)', maxVar: { near: 2, far: 1, tail: 1, oneshot: 2, mech: 0, bed: 1 }, rate: { near: 32000, far: 22050, tail: 22050, oneshot: 32000, bed: 16000 }, ch: { near: 1, tail: 1, bed: 1 } },
};
export function tierCost(man, tier, map = 'harbor') {
  let dl = 0, ram = 0, files = 0, secs = 0;
  for (const [name, s] of Object.entries(man.sounds)) {
    if (s.group === 'gun') { const prof = name.replace(/^(gun|gunfar|guntail)_/, ''); if (s.layer !== 'mech' && !CORE.has(prof)) continue; }
    if (s.layer === 'bed' && name !== `amb_bed_${map}`) continue;
    const n = Math.min(s.variants.length, tier.maxVar[s.layer] ?? 4);
    const rate = Math.min(s.rate, tier.rate[s.layer] ?? s.rate), ch = Math.min(s.ch, tier.ch[s.layer] ?? s.ch);
    for (const v of s.variants.slice(0, n)) { dl += v.bytes; ram += v.dur * rate * ch * 4; files++; secs += v.dur; }
  }
  return { files, secs: +secs.toFixed(1), downloadKB: Math.round(dl / 1024), ramMB: +(ram / 1048576).toFixed(1) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Gesamt im Repo: ${man.totals.files} Dateien, ${man.totals.MB} MB, ${man.totals.seconds} s`);
  for (const [k, t] of Object.entries(TIERS)) console.log(k.padEnd(7), JSON.stringify(tierCost(man, t)));
}
