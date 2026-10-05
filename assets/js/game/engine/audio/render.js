// Rendert ein Katalog-Rezept (Funktion oder Generator) deterministisch zu Float32-Kanälen.
// Läuft im Synthese-Worker (synth.worker.js) und als Rückfall/Offline-Pfad im Hauptthread.
import { CATALOG } from './catalog.js';
import { makeRng, hashString } from './dsp.js';

const seedRng = (name, v) => makeRng(hashString(name) + v * 7919 + 13);
const channels = res => (Array.isArray(res) ? res : [res]);

/** Komplett in einem Zug rendern → Float32Array[] (ein Eintrag je Kanal). */
export function renderEntry(name, v, sr) {
  const e = CATALOG[name];
  if (!e) throw new Error(`Unbekannter Klang: ${name}`);
  let res = e.render(sr, seedRng(name, v), v);
  if (res && typeof res.next === 'function') { let r = res.next(); while (!r.done) r = res.next(); res = r.value; }
  return channels(res);
}

/** Als Iterator: Generator-Rezepte pausieren zwischen ihren Schritten (Rückfall ohne Worker). */
export function* renderSteps(name, v, sr) {
  const e = CATALOG[name];
  if (!e) throw new Error(`Unbekannter Klang: ${name}`);
  let res = e.render(sr, seedRng(name, v), v);
  if (res && typeof res.next === 'function') { let r = res.next(); while (!r.done) { yield; r = res.next(); } res = r.value; }
  return channels(res);
}
