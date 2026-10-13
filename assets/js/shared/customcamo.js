// NULLPUNKT — Eigene Tarnmuster (Nutzer 13.10.2026: Spieler der ersten Stunde dürfen eigene Muster entwerfen und auf ihre
// Waffen legen). Ein Entwurf ist klein und beschreibend (Muster, 2–4 Farben, Größe, Oberfläche) – so lässt er sich online
// mitschicken und überall gleich aufbauen (gunsmith/camos.js malt ihn wie die festen Muster).
//
// Lokal: drei Plätze 'eigen1' … 'eigen3' (localStorage 'nullpunkt:eigene-tarnungen'), registriert in CAMOS.
// Online: aus 'eigenN' wird eine Inhalts-Id 'cx…' (Prüfsumme des Entwurfs), dazu loadout.cc { [id]: Entwurf }; Empfänger
// registrieren sie als fremde Muster (remote: in keiner Auswahlliste, nur zum Anzeigen/Aufheben).
import { CAMOS } from './weapons.data.js';

export const CUSTOM_KEY = 'nullpunkt:eigene-tarnungen';
export const CUSTOM_SLOTS = ['eigen1', 'eigen2', 'eigen3'];
export const CUSTOM_PATTERNS = {
  solid: 'Einfarbig', blobs: 'Flecken', flecks: 'Tupfen', splinter: 'Splitter', digital: 'Digital', hex: 'Waben',
  tiger: 'Tiger', stripes: 'Streifen', carbon: 'Karbon', marble: 'Marmor', damask: 'Damast', brushed: 'Gebürstet',
  rust: 'Rost', aurora: 'Polarlicht', glitter: 'Glitzer',
};
export const CUSTOM_FINISHES = {
  matt: { name: 'Matt', finish: { roughness: 0.82 } },
  seidig: { name: 'Seidig', finish: { roughness: 0.48 } },
  glanz: { name: 'Glänzend', finish: { roughness: 0.2, metalness: 0.2 } },
  metall: { name: 'Metallisch', finish: { roughness: 0.24, metalness: 1 } },
};
const HEX = /^#[0-9a-f]{6}$/;
const listeners = new Set();

/** Entwurf prüfen/bereinigen → { name, pattern, colors[2..4], scale 0.5–2, finish } | null */
export function cleanDesign(d) {
  if (!d || typeof d !== 'object') return null;
  const pattern = CUSTOM_PATTERNS[d.pattern] ? d.pattern : null;
  const colors = Array.isArray(d.colors) ? d.colors.map((c) => String(c).toLowerCase()).filter((c) => HEX.test(c)).slice(0, 4) : [];
  if (!pattern || colors.length < 2) return null;
  const scale = Math.min(2, Math.max(0.5, Math.round((Number(d.scale) || 1) * 10) / 10));
  const finish = CUSTOM_FINISHES[d.finish] ? d.finish : 'matt';
  const name = String(d.name || 'Eigenes Muster').replace(/[<>&"]/g, '').trim().slice(0, 20) || 'Eigenes Muster';
  return { name, pattern, colors, scale, finish };
}

/** Prüfsummen-Id eines Entwurfs ('cx' + 8 Zeichen) – gleicher Entwurf, gleiche Id auf allen Geräten. */
export function designId(d) {
  const s = JSON.stringify([d.pattern, d.colors, d.scale, d.finish]);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 'cx' + h.toString(36).padStart(7, '0').slice(0, 8);
}

function register(id, d, extra = {}) {
  CAMOS[id] = {
    id, name: d.name, pattern: d.pattern, colors: d.colors.slice(), scale: d.scale,
    finish: { ...CUSTOM_FINISHES[d.finish].finish }, rarity: 'legendaer', unlock: { type: 'og' }, custom: true, design: d, ...extra,
  };
  for (const fn of listeners) { try { fn(id); } catch { /* Anzeige ist Beiwerk */ } }
}

function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

/** Gespeicherte Entwürfe (Länge 3, leere Plätze null). */
export function loadDesigns() {
  let arr = [];
  try { arr = JSON.parse((store() && store().getItem(CUSTOM_KEY)) || '[]'); } catch { arr = []; }
  return CUSTOM_SLOTS.map((_, i) => cleanDesign(Array.isArray(arr) ? arr[i] : null));
}

/** Entwurf speichern (null = Platz leeren) und sofort registrieren. → bereinigter Entwurf | null */
export function saveDesign(slotIndex, design) {
  const all = loadDesigns();
  const d = design ? cleanDesign(design) : null;
  all[slotIndex] = d;
  try { store() && store().setItem(CUSTOM_KEY, JSON.stringify(all)); } catch { /* gesperrt */ }
  const id = CUSTOM_SLOTS[slotIndex];
  if (d) register(id, d);
  else { delete CAMOS[id]; for (const fn of listeners) { try { fn(id); } catch { /* */ } } }
  return d;
}

/** Bei jeder Änderung eines eigenen Musters (Zwischenspeicher der Texturen leeren). → Abmeldefunktion */
export function onCustomChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Fremdes Muster (online) registrieren: { [cx-Id]: Entwurf } – nur gültige, nie überschreibend. */
export function importCC(cc) {
  if (!cc || typeof cc !== 'object') return;
  for (const [id, raw] of Object.entries(cc).slice(0, 6)) {
    if (!/^cx[0-9a-z]{4,10}$/.test(id) || CAMOS[id]) continue;
    const d = cleanDesign(raw);
    if (d && designId(d) === id) register(id, d, { remote: true });
  }
}

/** Ausrüstung zum Verschicken: eigene Plätze ('eigenN') → Inhalts-Id + loadout.cc mit den Entwürfen. */
export function exportLoadoutCamos(lo) {
  if (!lo || typeof lo !== 'object' || !lo.camo || typeof lo.camo !== 'object') return lo;
  const camo = { ...lo.camo };
  const cc = { ...(lo.cc && typeof lo.cc === 'object' ? lo.cc : {}) };
  for (const [w, id] of Object.entries(camo)) {
    const c = CAMOS[id];
    if (!c || !c.custom || c.remote || !c.design) continue;
    const cid = designId(c.design);
    if (!CAMOS[cid]) register(cid, c.design, { remote: true });
    camo[w] = cid;
    cc[cid] = c.design;
  }
  return Object.keys(cc).length ? { ...lo, camo, cc } : { ...lo, camo };
}

// Beim Laden: eigene Entwürfe registrieren (Auswahl, Vorschau, Ego-Modell)
loadDesigns().forEach((d, i) => { if (d) register(CUSTOM_SLOTS[i], d); });
