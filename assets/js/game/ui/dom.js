// NULLPUNKT — kleine DOM-/Format-Helfer für HUD und Menüs (deutsche Zahlen, Zeiten, Escaping).

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Element mit Klasse und optionalem HTML. */
export function el(tag, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** 1234.5 → „1.234,5“ (digits Nachkommastellen). */
export function num(v, digits = 0) {
  const n = Number(v) || 0;
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Prozent 0..1 → „57 %“. */
export function pct(v, digits = 0) {
  return `${num((Number(v) || 0) * 100, digits)} %`;
}

/** Sekunden → „9:05“ (∞ ohne Limit). */
export function clock(s) {
  if (!Number.isFinite(s)) return '∞';
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Sekunden → „3,4 s“. */
export function secs(s, digits = 1) {
  return `${num(s, digits)} s`;
}

/** Meter → „23 m“. */
export function meters(m, digits = 0) {
  return `${num(m, digits)} m`;
}

/** Dauer in s → „7 min 12 s“. */
export function duration(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(t / 60);
  return m ? `${m} min ${t % 60} s` : `${t} s`;
}

/** K/D mit zwei Stellen. */
export function kd(k, d) {
  return num(d ? k / d : k, 2);
}

/** Setzt Text nur bei Änderung (spart Layout). */
export function setText(node, value) {
  const v = String(value);
  if (node.__t !== v) {
    node.__t = v;
    node.textContent = v;
  }
}

export function setHtml(node, value) {
  if (node.__h !== value) {
    node.__h = value;
    node.innerHTML = value;
  }
}

/** Toggle-Klasse nur bei Änderung. */
export function toggle(node, cls, on) {
  const k = `__c_${cls}`;
  const v = !!on;
  if (node[k] !== v) {
    node[k] = v;
    node.classList.toggle(cls, v);
  }
}

export function setStyle(node, prop, value) {
  const k = `__s_${prop}`;
  if (node[k] !== value) {
    node[k] = value;
    if (prop.startsWith('--')) node.style.setProperty(prop, value);
    else node.style[prop] = value;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Waffenname / Sonderfälle für Killfeed und Todesanzeige. */
export function weaponName(G, id) {
  const W = (G.data && G.data.WEAPONS) || {};
  const EQ = (G.data && G.data.EQUIPMENT) || {};
  const S = (G.data && G.data.STREAKS) || {};
  if (W[id]) return W[id].name;
  if (EQ[id]) return EQ[id].name;
  if (S[id]) return S[id].name;
  return { fall: 'Sturz', world: 'Umgebung', sentry: 'Wachgeschütz', strike: 'Präzisionsschlag' }[id] || (id ? String(id) : 'Umgebung');
}
