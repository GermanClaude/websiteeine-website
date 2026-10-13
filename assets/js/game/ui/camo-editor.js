// NULLPUNKT — Editor für eigene Tarnmuster (nur Spieler der ersten Stunde, Nutzer 13.10.2026). Drei Plätze; je Muster:
// Name, Musterart, 2–4 Farben, Größe, Oberfläche, Vorschau. Gespeichert im Browser (shared/customcamo.js), erscheint
// danach in der Tarnungsauswahl jeder Waffe und wird online mitgeschickt.
import { CUSTOM_SLOTS, CUSTOM_PATTERNS, CUSTOM_FINISHES, loadDesigns, saveDesign, cleanDesign } from '../../shared/customcamo.js';
import { designCanvas } from '../weapons/gunsmith/camos.js';

const START = { name: 'Eigenes Muster', pattern: 'splinter', colors: ['#3d4a2c', '#1d2118', '#7a6a45', '#c9a34a'], scale: 1, finish: 'matt' };
const CSS = `
.cmed-back{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:12px;background:rgba(5,6,8,.74);backdrop-filter:blur(4px);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e9e6df}
.cmed{width:min(640px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#121417;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:18px}
.cmed h2{margin:0 0 4px;font-size:18px}.cmed p.s{margin:0 0 14px;color:#a9a59c;font-size:13px}
.cmed-slots{display:flex;gap:6px;margin-bottom:14px}.cmed-slots button{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(255,255,255,.16);border-radius:4px;min-height:36px}
.cmed-slots button[aria-pressed=true]{border-color:#e9b949;background:rgba(233,185,73,.1)}.cmed-slots i{width:22px;height:22px;border-radius:3px;background:#2a2d30;display:block}
.cmed-grid{display:grid;grid-template-columns:180px 1fr;gap:16px}@media(max-width:560px){.cmed-grid{grid-template-columns:1fr}}
.cmed canvas{width:180px;height:180px;border-radius:4px;border:1px solid rgba(255,255,255,.12);display:block}
.cmed label{display:block;margin:0 0 10px;font-size:12px;color:#a9a59c}.cmed label>*{display:block;margin-top:4px}
.cmed input[type=text],.cmed select{width:100%;box-sizing:border-box;background:#1b1e22;color:#e9e6df;border:1px solid rgba(255,255,255,.16);border-radius:4px;padding:7px 8px;font:inherit}
.cmed label>.cmed-cols,.cmed-cols{display:flex;gap:8px;flex-wrap:wrap}.cmed-cols span{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px}
.cmed-cols input[type=color]{width:42px;height:34px;padding:0;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:none}
.cmed input[type=range]{width:100%}
.cmed-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.cmed-row button{all:unset;cursor:pointer;padding:9px 14px;border-radius:4px;border:1px solid rgba(255,255,255,.22);font-weight:600;min-height:20px}
.cmed-row .go{background:#e9b949;color:#151515;border-color:#e9b949}.cmed-msg{min-height:18px;margin-top:8px;font-size:12px;color:#e9b949}
`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Editor öffnen. onClose(changed) nach dem Schließen (Auswahl neu zeichnen). */
export function openCamoEditor({ onClose } = {}) {
  if (typeof document === 'undefined' || document.querySelector('.cmed-back')) return;
  if (!document.getElementById('cmed-css')) { const st = document.createElement('style'); st.id = 'cmed-css'; st.textContent = CSS; document.head.appendChild(st); }
  let designs = loadDesigns();
  let slot = Math.max(0, designs.findIndex((d) => !d));
  if (designs.every(Boolean)) slot = 0;
  let cur = { ...(designs[slot] || START), colors: [...(designs[slot] || START).colors] };
  let nCol = cur.colors.length;
  let changed = false;
  const back = document.createElement('div');
  back.className = 'cmed-back';
  back.innerHTML = `<div class="cmed" role="dialog" aria-modal="true" aria-labelledby="cmed-h">
    <h2 id="cmed-h">Eigene Tarnung</h2>
    <p class="s">Nur für Spieler der ersten Stunde. Bis zu drei eigene Muster – danach in der Tarnungsauswahl jeder Waffe. Online sehen die anderen dein Muster.</p>
    <div class="cmed-slots" role="group" aria-label="Platz"></div>
    <div class="cmed-grid"><div><canvas width="180" height="180" aria-label="Vorschau"></canvas></div><div>
      <label>Name<input type="text" maxlength="20" data-k="name"></label>
      <label>Muster<select data-k="pattern">${Object.entries(CUSTOM_PATTERNS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Farben (2–4)<div class="cmed-cols"></div></label>
      <label>Größe <b data-v="scale"></b><input type="range" min="0.5" max="2" step="0.1" data-k="scale"></label>
      <label>Oberfläche<select data-k="finish">${Object.entries(CUSTOM_FINISHES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
    </div></div>
    <div class="cmed-row"><button type="button" class="go" data-a="save">Speichern</button><button type="button" data-a="del">Platz leeren</button><button type="button" data-a="close">Schließen</button></div>
    <div class="cmed-msg" role="status" aria-live="polite"></div></div>`;
  document.body.appendChild(back);
  const $ = (s) => back.querySelector(s);
  const canvas = $('canvas');
  const msg = (t) => { $('.cmed-msg').textContent = t; };

  const drawSlots = () => {
    $('.cmed-slots').innerHTML = CUSTOM_SLOTS.map((_, i) => {
      const d = designs[i];
      const bg = d ? `linear-gradient(135deg, ${d.colors.join(', ')})` : '#2a2d30';
      return `<button type="button" data-slot="${i}" aria-pressed="${i === slot}"><i style="background:${bg}"></i>${d ? esc(d.name) : `Platz ${i + 1} (leer)`}</button>`;
    }).join('');
  };
  const drawCols = () => {
    $('.cmed-cols').innerHTML = [0, 1, 2, 3].map((i) => `<span><input type="color" data-c="${i}" value="${cur.colors[i] || START.colors[i]}"${i >= nCol ? ' disabled' : ''} aria-label="Farbe ${i + 1}">${i >= 2 ? `<input type="checkbox" data-on="${i}"${i < nCol ? ' checked' : ''} aria-label="Farbe ${i + 1} verwenden">` : `${i + 1}`}</span>`).join('');
  };
  const preview = () => {
    const d = cleanDesign({ ...cur, colors: cur.colors.slice(0, nCol) });
    if (!d) return;
    const c = designCanvas({ pattern: d.pattern, colors: d.colors, scale: d.scale }, 180);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 180, 180);
    ctx.drawImage(c, 0, 0);
    $('[data-v="scale"]').textContent = `${d.scale.toFixed(1)}×`;
  };
  const fill = () => {
    $('[data-k="name"]').value = cur.name;
    $('[data-k="pattern"]').value = cur.pattern;
    $('[data-k="scale"]').value = String(cur.scale);
    $('[data-k="finish"]').value = cur.finish;
    drawSlots(); drawCols(); preview();
  };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (typeof onClose === 'function') onClose(changed); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  back.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k === 'name') cur.name = t.value;
    else if (t.dataset.k === 'scale') cur.scale = Number(t.value);
    else if (t.dataset.c != null) cur.colors[Number(t.dataset.c)] = t.value;
    preview();
  });
  back.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.k === 'pattern') cur.pattern = t.value;
    else if (t.dataset.k === 'finish') cur.finish = t.value;
    else if (t.dataset.on != null) {
      const i = Number(t.dataset.on);
      nCol = t.checked ? Math.max(nCol, i + 1) : Math.min(nCol, i);
      for (let k = 0; k < 4; k++) if (!cur.colors[k]) cur.colors[k] = START.colors[k];
      drawCols();
    }
    preview();
  });
  back.addEventListener('click', (e) => {
    if (e.target === back) { close(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.slot != null) {
      slot = Number(b.dataset.slot);
      const d = designs[slot] || START;
      cur = { ...d, colors: [...d.colors] };
      nCol = d.colors.length;
      fill(); msg(''); return;
    }
    if (b.dataset.a === 'close') { close(); return; }
    if (b.dataset.a === 'del') {
      saveDesign(slot, null); changed = true; designs = loadDesigns();
      cur = { ...START, colors: [...START.colors] }; nCol = 4; fill(); msg(`Platz ${slot + 1} geleert.`); return;
    }
    if (b.dataset.a === 'save') {
      const d = saveDesign(slot, { ...cur, colors: cur.colors.slice(0, nCol) });
      if (!d) { msg('Bitte mindestens zwei Farben wählen.'); return; }
      changed = true; designs = loadDesigns(); drawSlots();
      msg(`Gespeichert: „${d.name}“ ist jetzt in der Tarnungsauswahl jeder Waffe.`);
    }
  });
  fill();
  $('[data-k="name"]').focus();
}
