// Deutsche Zahlen, Einheiten und Daten (Dezimalkomma, schmales geschütztes Leerzeichen vor Einheiten).

export const NNBSP = ' ';
const cache = new Map();
function nf(min, max) {
  const k = `${min}:${max}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(k, f);
  }
  return f;
}

/** Zahl mit festen Nachkommastellen: num(2340) → „2.340“, num(1.4, 1) → „1,4“. */
export function num(v, digits = 0, minDigits = digits) {
  if (!Number.isFinite(v)) return '–';
  return nf(minDigits, digits).format(v);
}
/** Millisekunden als Sekunden: sec(480) → „0,48 s“. */
export function sec(ms, digits = 2) { return `${num(ms / 1000, digits)}${NNBSP}s`; }
/** Sekunden: secs(2.35) → „2,35 s“, secs(3) → „3,0 s“. */
export function secs(s, digits = 2) { return `${num(s, digits, Math.min(1, digits))}${NNBSP}s`; }
/** Meter, gerundet: m(24.3) → „24 m“. */
export function m(v, digits = 0) { return `${num(v, digits)}${NNBSP}m`; }
/** Anteil 0…1 als Prozent: pct(.31) → „31 %“. */
export function pct(f, digits = 0) { return `${num((f || 0) * 100, digits)}${NNBSP}%`; }
/** Dauer in Sekunden: dur(11520) → „3 h 12 min“, dur(540) → „9 min“. */
export function dur(s) {
  const t = Math.max(0, Math.round((s || 0) / 60));
  const h = Math.floor(t / 60);
  const min = t % 60;
  if (h) return `${num(h)}${NNBSP}h ${min}${NNBSP}min`;
  return `${min}${NNBSP}min`;
}
/** Matchdauer: clock(598) → „9:58“. */
export function clock(s) {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
/** Datum mit Uhrzeit: „4.10.2026, 21:14“. */
export function date(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** Nur Datum: „4.10.2026“. */
export function day(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** Lang: „4. Oktober, 21:14“. */
export function dateLong(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/**
 * Begriffe wie im Spiel (Endbildschirm, Lobby, Steuerungshilfe): eine Quelle für alle Website-Ansichten.
 * Zählwörter als [Einzahl, Mehrzahl].
 */
export const TERMS = {
  xp: 'EP', // Erfahrungspunkte – wie im Spiel (Lobby, Endbildschirm); nicht „XP“
  xpLong: 'Erfahrungspunkte', // ausgeschrieben für vorgelesene Zusammenfassungen
  kills: ['Abschuss', 'Abschüsse'],
  deaths: ['Tod', 'Tode'],
  assists: ['Unterstützung', 'Unterstützungen'],
  points: ['Punkt', 'Punkte'],
};
/** Anzahl mit Zählwort im richtigen Numerus: count(1, 'kills') → „1 Abschuss“, count(2, 'kills') → „2 Abschüsse“. */
export function count(n, key, { upper = false } = {}) {
  const [one, many] = TERMS[key] || [key, key];
  const s = `${num(n || 0)} ${n === 1 ? one : many}`;
  return upper ? s.toLocaleUpperCase('de-DE') : s;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
