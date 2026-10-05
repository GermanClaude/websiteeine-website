// NULLPUNKT — Synthese-Worker (Owner: audio). Rendert Klangrezepte abseits des Hauptthreads.
// Eingang: { key, name, v, sr } · Ausgang: { key, chs: Float32Array[], ms } mit übertragenen Puffern
// oder { key, error }. Der Hauptthread kopiert die Kanäle nur noch in einen AudioBuffer.
import { renderEntry } from './render.js';

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

self.onmessage = (ev) => {
  const { key, name, v, sr } = ev.data || {};
  const t0 = clock();
  try {
    const seen = new Set();
    // Übertragbar nur, wenn jeder Kanal seinen Puffer allein und vollständig belegt
    const chs = renderEntry(name, v, sr).map((c) => {
      const own = c.byteOffset === 0 && c.byteLength === c.buffer.byteLength && !seen.has(c.buffer);
      const out = own ? c : c.slice();
      seen.add(out.buffer);
      return out;
    });
    self.postMessage({ key, chs, ms: clock() - t0 }, chs.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ key, error: String((err && err.stack) || err) });
  }
};
