// §04 Arsenal: Schriftmusterbuch. Der Name feuert, das Modell erscheint nur in den Buchstaben.
// Dazu Typenbalken, Datenblatt, „Auf Distanz“ (Rangliste nach Duellzeit) mit Duell und Ausrüstung.
import { h, $, signalLost } from './dom.js';
import { fit, glyphModel } from './fit.js';
import { resplit, split, Kinetic } from './kinetic.js';
import { createFire } from './fire.js';
import { makeBallistics } from './ballistics.js';
import { ui } from './state.js';
import { announce } from './live.js';
import { reduced, calm, flip, ease, pointerCoarse, onReducedChange } from './motion.js';
import { loop } from './loop.js';
import { num, NNBSP, clamp } from './fmt.js';
import { cutW, cutG } from './cuts.js';

const DEG = Math.PI / 180;
const STATS = [['damage', 'SCHADEN', 'Schaden'], ['fireRate', 'KADENZ', 'Kadenz'], ['range', 'REICHWEITE', 'Reichweite'], ['accuracy', 'PRÄZISION', 'Präzision'], ['mobility', 'MOBILITÄT', 'Mobilität'], ['control', 'KONTROLLE', 'Kontrolle']];

export { cutW, cutG };
const up = (s) => String(s).toLocaleUpperCase('de-DE');
const dec = (v, d = 2) => num(v, d, Math.min(1, d));
/** Ganze Zahlen ohne „,0“, sonst höchstens eine Nachkommastelle: 25 · 3,5 */
const int1 = (v) => num(v, 1, 0);
/** Weiche Trennstellen in langen Klassenwörtern (SCHARF­SCHÜTZEN­GEWEHR). */
const SHY = '\u00AD';
export function softHyphens(word) {
  return String(word)
    .replace(/(SCHARF)(SCHÜTZEN)/gi, `$1${SHY}$2`)
    .replace(/(.{4,})(GEWEHR|FLINTE|PISTOLE|KAMPF)$/i, `$1${SHY}$2`);
}
/** Ein Wert aus Teilen „a · b“: jedes Teil bleibt zusammen, getrennt wird nur an den Punkten. */
const parts = (...xs) => xs.filter(Boolean).flatMap((x, i) => [i ? ' · ' : null, h('span.nw', {}, x)]).filter((x) => x !== null);
const yieldTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));

export async function init(sec, D, ctx) {
  const root = $('#arsenal-root', sec);
  if (!D.ok.weapons || !D.W) { signalLost(root, 'Waffendaten fehlen. Das Arsenal bleibt eine Liste.'); return; }
  const W = D.W;
  const B = makeBallistics(W);
  const P = D.profile;
  const snd = ctx.sound;
  const ids = W.WEAPON_IDS;
  const groups = typeof W.listByClass === 'function'
    ? W.listByClass().map((g) => ({ cls: g.cls, name: g.name, ids: g.weapons.map((w) => w.id).filter((id) => ids.includes(id)) }))
    : [{ cls: 'all', name: 'Waffen', ids }];
  for (const id of ids) if (!groups.some((g) => g.ids.includes(id))) groups.push({ cls: W.WEAPONS[id].cls, name: W.WEAPON_CLASSES?.[W.WEAPONS[id].cls] || '', ids: [id] });

  // Vorauswahl: eine schon getroffene Wahl (z. B. aus dem Profil) gewinnt, sonst die letzte Primärwaffe, sonst der Falke.
  const fav = D.settings.get('lastLoadout')?.primary;
  if (!ui.get('weaponPicked') || !ids.includes(ui.get('weapon'))) ui.set('weapon', ids.includes(fav) ? fav : (ids.includes('ar_m17') ? 'ar_m17' : ids[0]));

  const unlocked = (id) => { try { return P ? P.isUnlocked(id) : true; } catch { return true; } };
  const unlockLevel = (id) => W.WEAPONS[id]?.unlockLevel ?? W.EQUIPMENT?.[id]?.unlockLevel ?? 1;

  root.querySelector('.static')?.remove();
  $('#w-index-rail')?.remove();

  /* ------------------------------------------------------------ Index */
  const index = h('div.w-index', { role: 'group', 'aria-label': 'Waffen nach Klasse' });
  const btnById = {};
  for (const g of groups) {
    const box = h('div.w-group');
    box.append(h('p.mono-s.w-cls', { 'aria-hidden': 'true' }, softHyphens(up(g.name || ''))));
    for (const id of g.ids) {
      const def = W.WEAPONS[id];
      const nm = h('span.nm', { 'data-fit': '', 'data-fit-grow': '0', 'data-fit-wdth': cutW(def).toFixed(1) }, def.name);
      const b = h('button.w-btn', { type: 'button', 'aria-pressed': 'false', 'data-id': id, style: { '--wdth': cutW(def).toFixed(1), '--wght': String(Math.round(cutG(def))) } },
        nm, h('span.lk', { hidden: true, 'aria-hidden': 'true' }), h('span.sr-only.lk-sr'), h('span.sr-only.cls', {}, `, ${g.name}`));
      b.addEventListener('click', () => { select(id, true); snd?.ui('click'); });
      box.append(b);
      btnById[id] = b;
    }
    index.append(box);
  }

  /* ------------------------------------------------------------ Bühne */
  // Bild (nur in den Buchstaben sichtbar) und darunter ein schwarzes HUD-Band: nichts liegt auf den Glyphen.
  const stage = h('div.stage', { tabindex: '0', role: 'group', 'aria-label': 'Waffenvitrine' });
  const pic = h('div.pic', { 'aria-hidden': 'true' });
  const maskName = h('p.mask-name', { 'data-fit': '' });
  const mask = h('div.mask', { 'aria-hidden': 'true' }, maskName);
  const hitm = h('div.hitm', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 28 28"><g stroke="currentColor" stroke-width="1.5"><line x1="5" y1="5" x2="10" y2="10"/><line x1="23" y1="5" x2="18" y2="10"/><line x1="5" y1="23" x2="10" y2="18"/><line x1="23" y1="23" x2="18" y2="18"/></g></svg>' });
  const load = h('span.hud-load', { 'aria-hidden': 'true', hidden: true }, 'LÄDT …');
  const picBox = h('div.pic-box', {}, pic, mask, hitm, load);
  const resetBtn = h('button.txt-btn.hud-reset', { type: 'button', hidden: true }, 'Ansicht zurücksetzen');
  const load3d = h('button.txt-btn.hud-3d', { type: 'button', hidden: true }, '3D laden');
  const btnR = h('button.hud-btn.rl', { type: 'button', 'aria-label': 'Nachladen' }, 'R');
  const btnAds = h('button.hud-btn.ads', { type: 'button', 'aria-pressed': 'false' }, 'Zielen');
  const btnFire = h('button.hud-btn.fire', { type: 'button' }, 'Feuer');
  const ammoNum = h('span.num', { 'aria-hidden': 'true' });
  const ammoMode = h('span.fmode');
  const reloadLine = h('span.reload-line');
  const ammo = h('div.hud-ammo', {}, ammoNum, ammoMode, reloadLine);
  const info = h('p.hud-info');
  const infoBox = h('div.hud-text', {}, info, h('p.hud-tools', {}, resetBtn, load3d));
  const band = h('div.hud-band', {}, infoBox, ammo, h('div.hud-btns', {}, btnR, btnAds, btnFire));
  stage.append(picBox, band);
  const stageCol = h('div.stage-col');
  const srLive = h('p.sr-only.w-sel');

  /* ------------------------------------------------------------ Werte & Daten */
  const stats = h('div.stats');
  const statRows = {};
  for (const [k, word, label] of STATS) {
    // Der Balken ist die Linie (gemeinsame Spur für alle sechs Zeilen); das Wort trägt den Wert zusätzlich als Breite.
    const sr = h('span.sr-only');
    const wd = h('span.stat-word', {}, word);
    const bar = h('span.stat-track', {}, h('i.stat-rule'), h('i.stat-tick'));
    const val = h('span.stat-val', { 'aria-hidden': 'true' });
    const row = h('div.stat', {}, sr, h('div.stat-bar', { 'aria-hidden': 'true' }, wd, bar), val);
    statRows[k] = { sr, wd, bar, row, val, label };
    stats.append(row);
  }
  const facts = h('dl.facts');
  const desc = h('p.w-desc');
  const role = h('p.w-role');
  stageCol.append(stage, stats, h('div.facts-wrap', {}, facts), h('div', {}, desc, role), srLive);

  const main = h('div.span.ars-main');
  const mainR = h('div.r');
  const mainM = h('div.m', {}, stageCol);
  main.append(mainR, mainM);

  /* ------------------------------------------------------------ Auf Distanz */
  const dist = h('div.span.ars-dist');
  const distH = h('h3.sub-h.rail-h', { id: 'auf-distanz', tabindex: '-1', 'data-fit': '', 'data-fit-grow': '0', 'data-fit-wdth': '100' }, 'AUF DISTANZ.');
  const distR = h('div.r', {}, distH,
    h('p.kicker', {}, 'Zieh den Messwert. Die Liste sortiert sich nach Duellzeit.'),
    h('p.legend-line', { style: { 'margin-top': '16px' } }, 'Duellzeit = Anschlag + Zeit bis Abschuss. 100 Lebenspunkte; wie viele Schüsse treffen, folgt aus Streuung, Rückstoß und Entfernung.'));
  const readout = h('p.dist-read', { 'aria-hidden': 'true' });
  const range = h('input', { type: 'range', min: '0', max: '100', step: '1', id: 'dist-range' });
  const rangeBox = h('div.range');
  rangeBox.append(h('span.track'));
  for (let m = 0; m <= 100; m += 10) rangeBox.append(h('span.tick' + (m % 50 === 0 ? '.major' : ''), { style: { left: `${m}%` } }));
  for (const m of [0, 25, 50, 75, 100]) rangeBox.append(h('span.tlabel', { style: { left: `${m}%`, transform: m === 100 ? 'translateX(-100%)' : m === 0 ? 'none' : '' } }, `${m}${NNBSP}m`));
  const thumb = h('span.thumb');
  rangeBox.append(thumb, range);
  const head = h('input', { type: 'checkbox', id: 'dist-head' });
  const ctl = h('div.dist-ctl', {},
    h('label', { for: 'dist-range', class: 'mono-s' }, 'Distanz'), readout, rangeBox,
    h('label.chk', {}, head, h('span', {}, 'Kopftreffer')));
  const rankList = h('ol.rank-list', { 'aria-label': 'Rangliste nach Duellzeit' });
  const duelGo = h('button.duel-go', { type: 'button', 'data-kill': '' }, 'Duell', h('span.o', {}, '.'));
  // Jeder Name passt in seine Spalte (gemessen im Siegerschnitt 900); der Siegerpunkt steht außerhalb des beschnittenen Felds.
  const duelL = h('p.duel-name', { 'data-fit': '', 'data-fit-grow': '0' });
  const duelR = h('p.duel-name.right', { 'data-fit': '', 'data-fit-grow': '0' });
  const tagL = h('span.duel-tag');
  const tagR = h('span.duel-tag');
  const arena = h('div.duel-arena', { 'aria-hidden': 'true', hidden: true },
    h('div.duel-side', {}, h('div.duel-line', {}, duelL), tagL),
    h('span.vs', {}, 'GEGEN'),
    h('div.duel-side.right', {}, h('div.duel-line', {}, duelR), tagR));
  const duelRes = h('p.duel-result');
  const duel = h('div.duel', {}, duelGo, arena, duelRes);
  const distM = h('div.m', {}, ctl, rankList, duel);
  dist.append(distR, distM);
  ctl.style.marginBottom = '40px';

  /* ------------------------------------------------------------ Ausrüstung */
  const gear = h('div.span.ars-gear');
  const gearList = h('ul.gear');
  for (const id of W.EQUIPMENT_IDS || []) {
    const e = W.EQUIPMENT[id];
    if (!e) continue;
    gearList.append(h('li', { 'data-id': id },
      h('span.gi', { 'aria-hidden': 'true', html: e.icon || '' }),
      h('span', {}, h('span.gn', {}, e.name), h('br'), h('span.gf', {}, `Zünder ${dec(e.fuse, 1)}${NNBSP}s · Radius ${dec(e.radius, 1)}${NNBSP}m`)),
      h('span.gl', {}, `ab Stufe ${e.unlockLevel ?? 1}`)));
  }
  gear.append(h('div.r', {}, h('h3.sub-h.rail-h', { 'data-fit': '', 'data-fit-grow': '0', 'data-fit-wdth': '100' }, 'AUSRÜSTUNG.'), h('p.kicker', {}, 'Eine Granate pro Leben.')), h('div.m', {}, gearList));
  if (!gearList.children.length) gear.hidden = true;

  // Einhängen: unter die Kopfzeile des Abschnitts (Raster-Unterzeilen)
  sec.append(main, dist, gear);
  root.remove();
  await yieldTask(); // Aufbau in Etappen: kein langer Block auf schwachen Telefonen

  // Index: Randspalte ab 1024 px, sonst unter der Bühne
  const wide = window.matchMedia('(min-width: 1024px)');
  const placeIndex = () => {
    if (wide.matches) mainR.append(index); else stage.after(index);
    for (const el of index.querySelectorAll('[data-fit]')) fit(el);
  };
  placeIndex();
  for (const el of sec.querySelectorAll('.rail-h')) fit(el);
  wide.addEventListener?.('change', placeIndex);

  /* ------------------------------------------------------------ Zustand */
  let def = W.WEAPONS[ui.get('weapon')];
  let kin = null;
  let stage3d = null;
  let picMode = 'icon';
  let recoil = { x: 0, y: 0 };
  let adsOn = false;
  let reloading = null;
  let dissolved = false;
  let idleT = 0;

  const fineMq = window.matchMedia('(pointer: fine)');
  const lineWdth = (i) => {
    const li = kin.lineOf[i];
    const m = glyphModel(kin.lines[li]) || glyphModel(maskName);
    return m?.wdth ?? 100;
  };
  const restW = (i) => (adsOn ? 62 - lineWdth(i) : 0);
  const restG = () => (adsOn ? 900 - cutG(def) : 0);

  /**
   * Glyphenfläche der Maske in Anteilen der Bildfläche (0 = links/oben): Die 3D-Bühne setzt das Modell darauf,
   * statt auf die Bühnenmitte (bei zweizeiligen Namen läge die im Zeilenzwischenraum).
   */
  function glyphRegion() {
    const P = picBox.getBoundingClientRect();
    const vis = maskName.querySelector('.vis');
    if (!P.width || !P.height || !vis) return null;
    const lines = [...vis.querySelectorAll(':scope > .fl')];
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const u of lines.length ? lines : [vis]) {
      const r = u.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Zeilenbreite in Ruhe aus dem Satzmodell (unabhängig von laufenden Schnitt-Animationen); gesetzt wird zentriert.
      const m = glyphModel(u) || glyphModel(maskName);
      let w = r.width;
      if (m?.a?.length) w = Math.min(w, m.a.reduce((sum, a, i) => sum + a + (m.b[i] || 0) * (m.wdth - 62), 0));
      const cx = r.left + r.width / 2;
      x0 = Math.min(x0, cx - w / 2); x1 = Math.max(x1, cx + w / 2);
      y0 = Math.min(y0, r.top); y1 = Math.max(y1, r.bottom);
    }
    if (!(x1 > x0 && y1 > y0)) return null;
    return { x0: (x0 - P.left) / P.width, x1: (x1 - P.left) / P.width, y0: (y0 - P.top) / P.height, y1: (y1 - P.top) / P.height };
  }
  const frame3d = () => { const r = stage3d && glyphRegion(); if (r) stage3d.frame(r); };
  maskName.addEventListener('fitted', () => requestAnimationFrame(frame3d));

  function maskSize() {
    const H = mask.clientHeight || picBox.clientHeight || 300;
    const lines = maskName.querySelectorAll('.fl').length || 1;
    const fs = H * (lines > 1 ? 0.56 : 0.62);
    maskName.style.setProperty('--mfs', `${fs.toFixed(1)}px`);
    maskName.fitOpts = { max: fs, weight: true };
  }

  function setName(d, animate) {
    const go = () => {
      const parts = up(d.name).split(' ').filter(Boolean);
      const lines = parts.length > 1 ? [parts[0], parts.slice(1).join(' ')] : null;
      resplit(maskName, up(d.name), { lines, sr: d.name });
      maskName.style.setProperty('--wght', String(Math.max(500, Math.round(cutG(d)))));
      maskSize();
      fit(maskName, { now: !!animate });
      if (!kin) kin = new Kinetic(maskName, { conserve: true, limit: () => (mask.clientWidth || 300) * 0.93 }); else kin.refresh();
      maskName.querySelector('.vis').style.transform = '';
      recoil = { x: 0, y: 0 };
      if (animate && !calm()) {
        for (let i = 0; i < kin.n; i++) kin.setOffset(i, 62 - lineWdth(i), 100 - cutG(d));
        kin.write(true);
        kin.to('all', { w: restW, g: restG() }, 240, ease.out);
      } else kin.to('all', { w: restW, g: restG() }, 0);
    };
    if (animate && kin && !calm()) {
      kin.to('all', { w: (i) => 62 - lineWdth(i), g: 100 - cutG(def) }, 120, ease.in);
      setTimeout(go, 120);
    } else go();
  }

  function setPic(d) {
    if (picMode === '3d') return;
    pic.classList.toggle('hatch', !d.icon);
    pic.innerHTML = d.icon || '';
    const svg = pic.querySelector('svg');
    if (svg) { svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); }
  }

  function setInfo(d) {
    const lines = [];
    if (!unlocked(d.id)) lines.push(`<span class="lock">Gesperrt bis Stufe ${unlockLevel(d.id)}.</span>`);
    if (picMode === 'nowebgl') lines.push('3D-Ansicht braucht WebGL. Hier: Strichzeichnung.');
    else if (picMode === 'failed') lines.push('Modell nicht verfügbar.');
    else if (picMode === 'savedata') lines.push('Datensparmodus: Strichzeichnung.');
    const melee = d.cls === 'melee';
    const turn = picMode === '3d' || picMode === 'icon';
    lines.push(fineMq.matches
      ? (melee ? `Maus klicken: stechen.${turn ? ' Ziehen: drehen.' : ''}` : `Maus halten: feuern.${turn ? ' Ziehen: drehen.' : ''} Rechts: zielen.`)
      : (melee ? `STECHEN tippen.${turn ? ' Quer wischen: drehen.' : ''}` : `FEUER halten.${turn ? ' Quer wischen: drehen.' : ''}`));
    info.innerHTML = lines.join('<br>');
  }

  function setHud(d) {
    const melee = d.cls === 'melee';
    btnFire.textContent = melee ? 'Stechen' : 'Feuer';
    btnAds.hidden = melee;
    btnR.hidden = melee;
    ammoMode.textContent = melee ? 'NAHKAMPF' : up(W.FIRE_MODES?.[d.fireMode] || d.fireMode);
    stage.setAttribute('aria-label', `Waffenvitrine ${d.name}. Pfeiltasten drehen${melee ? '' : ', R lädt nach'}, Pos1 setzt die Ansicht zurück.`);
  }

  function showAmmo(mag, reserve) {
    if (def.cls === 'melee') { ammoNum.textContent = '—'; return; }
    if (reloading) return;
    ammoNum.innerHTML = `${mag} <small>/ ${reserve}</small>`;
  }

  function setStats(d, prev) {
    for (const [k] of STATS) {
      const r = statRows[k];
      const v = clamp(Number(d.stats?.[k] ?? 50), 0, 100);
      r.wd.style.fontStretch = `${(62 + 0.63 * v).toFixed(1)}%`;
      r.row.style.setProperty('--v', String(v));
      r.val.textContent = String(v);
      r.sr.textContent = `${r.label} ${v} von 100`;
    }
  }

  function ttkText(d, m) {
    const t = B.ttk(d, m);
    if (!Number.isFinite(t)) return 'außer Reichweite';
    return t === 0 ? '1 Treffer' : `${num(t / 1000, 2, 2)}${NNBSP}s`;
  }

  function setFacts(d) {
    const rows = [];
    const melee = d.cls === 'melee';
    const dm = d.damage;
    const u = (v, unit) => `${v}${NNBSP}${unit}`;
    if (melee) {
      rows.push(['Schaden', parts(`${num(dm.max)}`, 'ein Stoß')],
        ['Reichweite', parts(u(int1(d.melee?.range ?? d.range), 'm'), `Ausfallschritt ${u(int1(d.melee?.lungeRange ?? 4.5), 'm')}`)],
        ['Tempo', parts(`${num(d.rpm)} Stöße/min`)], ['Visier', parts('—')], ['Feuermodus', parts('Nahkampf')]);
    } else {
      const dmg = d.pellets > 1 ? `${d.pellets} × ${int1(dm.max)}–${int1(dm.min)}` : `${int1(dm.max)}–${int1(dm.min)}`;
      rows.push(['Schaden', parts(dmg, `Kopf ×${num(d.headMult, 2, 0)}`)]);
      rows.push(['Abfall', parts(u(`${int1(dm.rangeStart)}–${int1(dm.rangeEnd)}`, 'm'), `max. ${u(num(d.range), 'm')}`)]);
      rows.push(['Kadenz', parts(`${num(d.rpm)} Schuss/min`)]);
      rows.push(['Magazin', parts(`${d.mag} / ${d.reserve}`)]);
      rows.push(['Nachladen', d.perShellReload
        ? parts(`je Patrone ${u(dec(d.reloadTime), 's')}`, `leer ${u(dec(d.reloadEmptyTime), 's')}`)
        : parts(u(dec(d.reloadTime), 's'), `leer ${u(dec(d.reloadEmptyTime), 's')}`)]);
      rows.push(['Anschlag', parts(u(dec(d.adsTime), 's'))]);
      rows.push(['Zeit bis Abschuss', parts(`10${NNBSP}m: ${ttkText(d, 10)}`, `50${NNBSP}m: ${ttkText(d, 50)}`)]);
      rows.push(['Visier', parts(W.SIGHTS?.[d.sight]?.name || '—')]);
      rows.push(['Feuermodus', parts(W.FIRE_MODES?.[d.fireMode] || d.fireMode)]);
    }
    rows.push(['Freischaltung', parts(`ab Stufe ${unlockLevel(d.id)}`)]);
    facts.replaceChildren(...rows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
    desc.textContent = d.description || '';
    role.textContent = W.CLASS_INFO?.[d.cls]?.role || '';
  }

  function setLocks() {
    for (const id of ids) {
      const b = btnById[id];
      const locked = !unlocked(id);
      b.classList.toggle('locked', locked);
      const lk = b.querySelector('.lk');
      lk.hidden = !locked;
      lk.textContent = locked ? `AB STUFE ${unlockLevel(id)}` : '';
      b.querySelector('.lk-sr').textContent = locked ? `, ab Stufe ${unlockLevel(id)}` : '';
    }
    for (const li of gearList.children) {
      const locked = !unlocked(li.dataset.id);
      li.querySelector('.gl').style.color = locked ? '' : 'var(--np-ink)';
    }
    setInfo(def);
  }

  /* ------------------------------------------------------------ Feuern */
  function patternAt(i) {
    const p = def.recoil?.pattern;
    if (!Array.isArray(p) || !p.length) return [0, 1];
    if (i < p.length) return p[i];
    const k = Math.min(4, p.length);
    return p[p.length - k + ((i - p.length) % k)];
  }

  let fireTaskOn = false;
  let lastFireT = 0;
  function fireTask(dt) {
    // Kadenz nach echter Zeit (die Schleife kappt dt für Federn bei 0,1 s)
    const now = performance.now();
    const real = lastFireT ? Math.min(0.5, (now - lastFireT) / 1000) : dt;
    lastFireT = now;
    fireCtl.update(real);
    const r = def.recoil?.recovery || 8;
    const f = Math.exp(-r * dt);
    if (recoil.x || recoil.y) {
      recoil.x *= f;
      recoil.y *= f;
      if (Math.abs(recoil.x) < 0.05 && Math.abs(recoil.y) < 0.05) recoil = { x: 0, y: 0 };
      const vis = maskName.querySelector('.vis');
      if (vis) vis.style.transform = recoil.x || recoil.y ? `translate(${recoil.x.toFixed(2)}px, ${recoil.y.toFixed(2)}px)` : '';
    }
    if (reloading) {
      const p = clamp((performance.now() - reloading.t0) / reloading.ms, 0, 1);
      reloadLine.style.setProperty('--rp', p.toFixed(3));
      if (!reloading.out && p >= 0.25) { reloading.out = true; snd?.play('reload_mag_out'); }
      if (!reloading.in && p >= 0.7) { reloading.in = true; snd?.play('reload_mag_in'); }
    }
    const busy = fireCtl.busy || recoil.x || recoil.y || reloading;
    if (!busy) { fireTaskOn = false; lastFireT = 0; return false; }
    return true;
  }
  function wakeFire() { if (!fireTaskOn) { fireTaskOn = true; loop.add(fireTask); } }

  const fireCtl = createFire(def, {
    onShot(i) {
      const fs = parseFloat(getComputedStyle(maskName).fontSize) || 100;
      if (!calm()) {
        const k = Math.min(1, (60 / Math.max(1, def.rpm || 600)) / 0.18);
        if (loop.level < 1) kin.wave(18 * k, 260 * k, { stagger: 6 }); // Wächter Stufe 1: nur die Wellen aus
        const [ph, pv] = patternAt(i);
        const v = (def.recoil?.vertical || 0) * pv * 900 * (i === 0 ? def.recoil?.firstShotMult || 1 : 1);
        const hz = (def.recoil?.horizontal || 0) * (ph + (Math.random() * 0.7 - 0.35)) * 900;
        // Rückstoß bleibt im Spielraum, den der Name (88 % der Breite) in der Maske hat
        const lim = 0.12 * fs;
        const limX = Math.min(lim, (mask.clientWidth || 300) * 0.045);
        recoil.y = clamp(recoil.y - v, -lim, lim);
        recoil.x = clamp(recoil.x + hz, -limX, limX);
      }
      stage3d?.shot(def);
      hitm.classList.remove('on');
      void hitm.offsetWidth;
      hitm.classList.add('on');
      if (def.cls === 'melee') snd?.play('melee_swing'); else snd?.shot(def);
      wakeFire();
    },
    onCycle(ms) {
      if (!calm()) {
        kin.to('all', { w: (i) => 62 - lineWdth(i) }, ms * 0.4, ease.in);
        setTimeout(() => { if (!reloading) kin.to('all', { w: restW }, ms * 0.6, ease.out); }, ms * 0.4);
      }
      setTimeout(() => snd?.play(def.fireMode === 'pump' ? 'pump' : 'bolt'), ms * 0.15);
    },
    onReload(ms, empty) {
      reloading = { t0: performance.now(), ms, out: false, in: false };
      ammoNum.textContent = calm() ? `NACHLADEN ${dec(ms / 1000)}${NNBSP}s` : 'NACHLADEN';
      if (!calm()) {
        kin.to('all', { w: (i) => 62 - lineWdth(i), g: 100 - cutG(def) }, 120, ease.in);
        const n = kin.n;
        kin.to('all', { w: restW, g: restG() }, 240, ease.out, (i) => 120 + (i / n) * Math.max(0, ms - 240));
      }
      announce(`Nachladen, ${dec(ms / 1000)} Sekunden.`);
      wakeFire();
    },
    onReloadStep(mag) {
      ammoNum.innerHTML = `${mag} <small>/ ${fireCtl.state.reserve}</small>`;
    },
    onReloadEnd() {
      reloading = null;
      reloadLine.style.setProperty('--rp', '0');
      showAmmo(fireCtl.state.mag, fireCtl.state.reserve);
      if (!calm()) kin.to('all', { w: restW, g: restG() }, 120, ease.out);
      announce('Geladen.');
    },
    onAds(on, ms) {
      adsOn = on;
      btnAds.setAttribute('aria-pressed', String(on));
      if (!calm()) kin.to('all', { w: restW, g: restG() }, ms, ease.inOut);
      stage3d?.ads(on, reduced() ? 1 : ms);
      if (snd) snd.play(on ? 'ads_in' : 'ads_out');
    },
    onAmmo(mag, reserve) { showAmmo(mag, reserve); },
  });

  /* ------------------------------------------------------------ Auswahl */
  function select(id, user = false) {
    const nd = W.WEAPONS[id];
    if (!nd) return;
    const changed = nd !== def;
    const prev = def;
    def = nd;
    ui.set('weapon', id);
    for (const [bid, b] of Object.entries(btnById)) b.setAttribute('aria-pressed', String(bid === id));
    if (adsOn) fireCtl.ads(false);
    reloading = null;
    reloadLine.style.setProperty('--rp', '0');
    fireCtl.setDef(nd);
    setName(nd, changed && user);
    setPic(nd);
    setHud(nd);
    setInfo(nd);
    setStats(nd, prev);
    setFacts(nd);
    stage3d?.show(nd); // dreht die Pose in die Grundstellung zurück
    if (changed) rotated(false);
    markRank();
    if (user) {
      announce(`${nd.name} ausgewählt.`, { now: true });
      if (!wide.matches) stage.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    }
  }

  /* ------------------------------------------------------------ Eingabe auf der Bühne */
  let press = null;
  let pendingT = 0;
  let lastMove = null;
  const swell = () => kin.to('all', { w: (i) => 125 - lineWdth(i), g: 900 - cutG(def) }, 200, ease.out);

  // „Ansicht zurücksetzen“ erscheint erst, wenn die Ansicht gedreht ist.
  const rotated = (on) => { resetBtn.hidden = !(on && picMode === '3d'); };
  function startDrag() {
    clearTimeout(idleT);
    rotated(true);
    if (!dissolved) {
      dissolved = true;
      if (!calm()) swell();
      setTimeout(() => { if (dissolved) { stage.classList.add('dissolved'); stage3d?.dissolve(true); } }, calm() ? 0 : 200);
    }
    stage3d?.drag(true);
  }
  function endDrag(vx = 0, vy = 0) {
    stage3d?.drag(false);
    if (!reduced()) stage3d?.fling(vx, vy);
    clearTimeout(idleT);
    idleT = setTimeout(restore, 1600);
  }
  function restore() {
    if (!dissolved) return;
    dissolved = false;
    stage.classList.remove('dissolved');
    stage3d?.dissolve(false);
    kin.to('all', { w: restW, g: restG() }, 240, ease.out, 240);
  }

  picBox.addEventListener('contextmenu', (e) => e.preventDefault());
  picBox.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { fireCtl.ads(true); wakeFire(); press = { ads: true, id: e.pointerId }; return; }
      if (e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'pending', mouse: true, t: performance.now() };
      picBox.setPointerCapture(e.pointerId);
      clearTimeout(pendingT);
      pendingT = setTimeout(() => {
        if (press?.mode === 'pending') { press.mode = 'fire'; fireCtl.press(); wakeFire(); }
      }, 90);
    } else {
      press = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'pending', mouse: false, t: performance.now() };
    }
    lastMove = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
  });
  picBox.addEventListener('pointermove', (e) => {
    if (!press || press.ads || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (press.mode !== 'drag') {
      if (Math.hypot(dx, dy) <= 4) return;
      if (picMode !== '3d') return; // Strichzeichnung: nichts zu drehen
      if (!press.mouse && Math.abs(dy) > Math.abs(dx)) { press = null; return; } // vertikal = scrollen
      clearTimeout(pendingT);
      if (press.mode === 'fire') fireCtl.release();
      press.mode = 'drag';
      if (!press.mouse) { try { picBox.setPointerCapture(e.pointerId); } catch { /* egal */ } }
      startDrag();
    }
    const now = performance.now();
    const mx = e.clientX - lastMove.x;
    const my = e.clientY - lastMove.y;
    const dt = Math.max(1, now - lastMove.t) / 1000;
    stage3d?.rotate(mx * 0.4 * DEG, press.mouse ? my * 0.4 * DEG : 0);
    lastMove = { x: e.clientX, y: e.clientY, t: now, vx: (mx * 0.4 * DEG) / dt, vy: press.mouse ? (my * 0.4 * DEG) / dt : 0 };
  });
  const up_ = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.ads) { if (e.type !== 'pointermove') { fireCtl.ads(false); press = null; } return; }
    clearTimeout(pendingT);
    if (press.mode === 'pending' && press.mouse && e.type === 'pointerup') { fireCtl.press(); fireCtl.release(); wakeFire(); }
    else if (press.mode === 'fire') fireCtl.release();
    else if (press.mode === 'drag') {
      const fresh = performance.now() - lastMove.t < 80;
      endDrag(fresh ? clamp(lastMove.vx, -12, 12) : 0, fresh ? clamp(lastMove.vy, -8, 8) : 0);
    }
    press = null;
  };
  picBox.addEventListener('pointerup', up_);
  picBox.addEventListener('pointercancel', up_);
  picBox.addEventListener('lostpointercapture', (e) => { if (press && !press.ads && press.mode !== 'pending') up_(e); });

  stage.addEventListener('keydown', (e) => {
    if (e.target !== stage) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); stage3d?.rotate((k === 'ArrowLeft' ? -15 : 15) * DEG, 0); rotated(true); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); stage3d?.rotate(0, (k === 'ArrowUp' ? -10 : 10) * DEG); rotated(true); }
    else if (k === 'Home') { e.preventDefault(); stage3d?.reset(); restore(); rotated(false); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); fireCtl.reload(); wakeFire(); }
  });
  stage.addEventListener('keydown', (e) => {
    if (!stage.contains(e.target) || e.target === stage) return;
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fireCtl.reload(); wakeFire(); }
  });

  // FEUER: halten (Zeiger), Leertaste/Enter halten (Tastatur)
  let keyHeld = false;
  let lastKey = 0;
  btnFire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btnFire.setPointerCapture?.(e.pointerId);
    btnFire.classList.add('held');
    fireCtl.press();
    wakeFire();
  });
  const fireUp = () => { btnFire.classList.remove('held'); fireCtl.release(); };
  btnFire.addEventListener('pointerup', fireUp);
  btnFire.addEventListener('pointercancel', fireUp);
  btnFire.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    lastKey = performance.now();
    if (e.repeat || keyHeld) return;
    keyHeld = true;
    btnFire.classList.add('held');
    fireCtl.press();
    wakeFire();
  });
  btnFire.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    keyHeld = false;
    fireUp();
  });
  btnFire.addEventListener('click', (e) => {
    // Hilfstechnik ohne Zeiger-/Tastenereignisse: ein Schuss
    if (e.detail === 0 && performance.now() - lastKey > 400 && !keyHeld) { fireCtl.press(); fireCtl.release(); wakeFire(); }
  });
  btnAds.addEventListener('click', () => { fireCtl.ads(!adsOn); wakeFire(); });
  btnR.addEventListener('click', () => { fireCtl.reload(); wakeFire(); });
  resetBtn.addEventListener('click', () => { stage3d?.reset(); restore(); rotated(false); stage.focus({ preventScroll: true }); snd?.ui('back'); });

  /* ------------------------------------------------------------ 3D laden */
  // three.js und die Modelle werden eine Bildschirmhöhe vorher nur geholt (modulepreload). Gebaut wird erst,
  // wenn die Bühne zu einem Viertel sichtbar ist und das Scrollen 150 ms ruht; zwischen den Schritten gibt
  // der Aufbau den Hauptfaden frei, und die Shader werden vor dem ersten Bild vorbereitet.
  function fallback(mode) {
    picMode = mode;
    if (stage3d) { try { stage3d.dispose(); } catch { /* egal */ } stage3d = null; }
    picBox.querySelector('canvas')?.remove();
    pic.hidden = false;
    load.hidden = true;
    resetBtn.hidden = true;
    stage.classList.toggle('lines', mode !== '3d');
    setPic(def);
    setInfo(def);
  }
  let loading = null;
  function load3D() {
    if (loading) return loading;
    load.hidden = false;
    load3d.hidden = true;
    loading = (async () => {
      try {
        const { createStage } = await import('./stage3d.js');
        await yieldTask();
        const canvas = h('canvas', { 'aria-hidden': 'true' });
        const st = createStage(canvas, {
          coarse: pointerCoarse(),
          quality: () => D.settings.get('quality'),
          onLost: () => fallback('failed'),
        });
        await yieldTask();
        await st.prepare(def);
        picBox.prepend(canvas);
        stage3d = st;
        picMode = '3d';
        stage.classList.remove('lines');
        pic.hidden = true;
        stage3d.show(def);
        stage3d.resize();
        frame3d();
        setInfo(def);
      } catch (err) {
        console.warn('[NULLPUNKT] 3D-Vitrine nicht verfügbar:', err?.message || err);
        fallback(ctx.webgl ? 'failed' : 'nowebgl');
      }
      load.hidden = true;
    })();
    return loading;
  }
  load3d.addEventListener('click', () => load3D());

  function prefetch3D() {
    for (const href of ['../../vendor/three/three.module.min.js', './stage3d.js', '../game/weapons/models.js']) {
      const url = new URL(href, import.meta.url).href;
      if (document.querySelector(`link[rel=modulepreload][href="${url}"]`)) continue;
      document.head.append(h('link', { rel: 'modulepreload', href: url }));
    }
  }
  function gate3D() {
    if (!('IntersectionObserver' in window)) { load3D(); return; }
    const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.disconnect(); prefetch3D(); } }, { rootMargin: '100% 0px' });
    near.observe(stage);
    let visible = false;
    let quietT = 0;
    let lastScroll = 0;
    const tryLoad = () => {
      clearTimeout(quietT);
      if (!visible || loading) return;
      const wait = 150 - (performance.now() - lastScroll);
      if (wait > 0) { quietT = setTimeout(tryLoad, wait + 10); return; }
      cleanup();
      load3D();
    };
    const onScroll = () => { lastScroll = performance.now(); if (visible) { clearTimeout(quietT); quietT = setTimeout(tryLoad, 160); } };
    const seen = new IntersectionObserver((es) => {
      for (const e of es) visible = e.isIntersecting && e.intersectionRatio >= 0.25;
      if (visible) tryLoad(); else clearTimeout(quietT);
    }, { threshold: [0, 0.25, 0.5] });
    const cleanup = () => { seen.disconnect(); window.removeEventListener('scroll', onScroll); };
    window.addEventListener('scroll', onScroll, { passive: true });
    seen.observe(picBox);
  }

  /* ------------------------------------------------------------ Auf Distanz */
  const rows = {};
  for (const id of ids.filter((i) => W.WEAPONS[i].cls !== 'melee')) {
    const d = W.WEAPONS[id];
    const b = h('button.rank-row', { type: 'button', 'aria-pressed': 'false' },
      h('span.rk'), h('span.nm', {}, d.name), h('span.vl'));
    b.addEventListener('click', () => { select(id, true); snd?.ui('click'); });
    const li = h('li', { 'data-id': id }, b);
    rows[id] = { li, b, rk: b.querySelector('.rk'), vl: b.querySelector('.vl') };
    rankList.append(li);
  }
  let lastOrder = '';
  let started = false;
  let lastFlip = 0;
  let flipT = 0;
  let ranking = [];

  function markRank() {
    for (const [id, r] of Object.entries(rows)) r.b.setAttribute('aria-pressed', String(id === def.id));
    duelGo.disabled = def.cls === 'melee';
  }

  function updateRanking(force = false) {
    const d = ui.get('distance');
    const zone = head.checked ? 'head' : 'body';
    readout.textContent = `${d}${NNBSP}m`;
    thumb.style.setProperty('--v', String(d));
    range.value = String(d);
    range.setAttribute('aria-valuetext', `${d} Meter`);
    ranking = B.rankAt(d, zone);
    const finite = ranking.filter((r) => Number.isFinite(r.ms));
    const fc = finite.length;
    ranking.forEach((r, i) => {
      const row = rows[r.id];
      if (!row) return;
      const inf = !Number.isFinite(r.ms);
      row.b.classList.toggle('inf', inf);
      row.rk.textContent = String(i + 1).padStart(2, '0');
      const wg = inf ? 100 : Math.round(900 - 600 * (fc > 1 ? i / (fc - 1) : 0));
      row.b.style.setProperty('--rw', String(wg));
      // Nötige Treffer, dazu die erwartete Schusszahl, wenn nicht jeder Schuss sitzt
      const hits = `${r.shots} Treffer${r.fired > r.shots ? ` aus ${r.fired} Schuss` : ''}`;
      row.vl.textContent = inf ? 'außer Reichweite' : `${num(r.ms / 1000, 2, 2)}${NNBSP}s · ${hits}`;
      row.b.setAttribute('aria-label', `${String(i + 1).padStart(2, '0')}. ${r.def.name}: ${inf ? 'außer Reichweite' : `${num(r.ms / 1000, 2, 2)} Sekunden, ${hits}`}`);
    });
    const order = ranking.map((r) => r.id).join();
    if (order !== lastOrder) {
      const now = performance.now();
      const doFlip = () => {
        lastFlip = performance.now();
        lastOrder = ranking.map((r) => r.id).join();
        const mutate = () => { for (const r of ranking) rankList.append(rows[r.id].li); };
        // Beim Aufbau ohne FLIP (keine erzwungenen Layouts), danach mit
        if (!started) mutate(); else flip(rankList, mutate);
      };
      clearTimeout(flipT);
      if (force || now - lastFlip >= 120) doFlip();
      else flipT = setTimeout(doFlip, 120 - (now - lastFlip));
    }
  }

  range.addEventListener('input', () => { ui.set('distance', Number(range.value)); });
  head.addEventListener('change', () => { ui.set('zone', head.checked ? 'head' : 'body'); updateRanking(true); });
  ui.onChange((k, v) => {
    if (k === 'distance') updateRanking();
    if (k === 'weapon' && v !== def.id && W.WEAPONS[v]) select(v, false);
  });
  document.addEventListener('np:weapon', (e) => { if (W.WEAPONS[e.detail?.id]) select(e.detail.id, true); });

  /* ------------------------------------------------------------ Duell */
  let duelKins = [];
  function duelSet(el, d) {
    el.style.transition = 'none';
    el.style.setProperty('--wdth', cutW(d).toFixed(1));
    el.dataset.fitWdth = cutW(d).toFixed(1);
    el.style.fontStretch = `${cutW(d).toFixed(1)}%`;
    el.classList.remove('won');
    el.textContent = '';
    el.append(d.name, h('span.ddot.o', {}, '.'));
    split(el, { sr: d.name });
    // Im breitesten Endzustand (900) messen, dann zurück in den Ruheschnitt
    el.style.setProperty('--wght', '900');
    el.style.fontWeight = '900';
    fit(el, { now: true });
    el.style.setProperty('--wght', String(Math.round(cutG(d))));
    el.style.fontWeight = String(Math.round(cutG(d)));
  }
  duelGo.addEventListener('click', () => {
    if (def.cls === 'melee') return;
    const dd = ui.get('distance');
    const zone = head.checked ? 'head' : 'body';
    const list = B.rankAt(dd, zone);
    const opp = list[0]?.id === def.id ? list[1] : list[0];
    if (!opp) return;
    const a = { def, ms: B.duelTime(def, dd, zone), n: B.shotsNeeded(def, dd, zone).shots };
    const b = { def: opp.def, ms: opp.ms, n: opp.fired };
    arena.hidden = false;
    duelSet(duelL, a.def);
    duelSet(duelR, b.def);
    tagL.textContent = '';
    tagR.textContent = '';
    duelRes.textContent = '';
    for (const k of duelKins) k.destroy();
    duelKins = [new Kinetic(duelL, { conserve: true, limit: () => duelL.clientWidth }), new Kinetic(duelR, { conserve: true, limit: () => duelR.clientWidth })];
    const aWins = a.ms <= b.ms;
    const tie = a.ms === b.ms;
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;
    const wEl = aWins ? duelL : duelR;
    const lEl = aWins ? duelR : duelL;
    const lTag = aWins ? tagR : tagL;
    const sTime = (x) => (Number.isFinite(x.ms) ? `${dec(x.ms / 1000)}${NNBSP}s` : 'außer Reichweite');
    const line = tie
      ? `Auf ${dd}${NNBSP}m: Gleichstand, beide ${sTime(a)}.`
      : `Auf ${dd}${NNBSP}m gewinnt ${winner.def.name} in ${sTime(winner)} gegen ${loser.def.name} ${Number.isFinite(loser.ms) ? `mit ${sTime(loser)}` : '(außer Reichweite)'}.`;
    const finish = () => {
      if (!Number.isFinite(winner.ms)) { duelRes.textContent = `Auf ${dd}${NNBSP}m trifft keiner.`; announce(duelRes.textContent, { now: true }); return; }
      wEl.style.fontWeight = '900';
      wEl.style.setProperty('--wght', '900');
      wEl.classList.add('won');
      if (!tie) {
        lEl.style.transition = reduced() ? 'none' : '--wght 640ms var(--ease-out), font-weight 640ms var(--ease-out)';
        lEl.style.setProperty('--wght', '100');
        lEl.style.fontWeight = '100';
        lTag.textContent = 'ausgeschaltet';
      }
      duelRes.textContent = line;
      announce(line, { now: true });
    };
    if (calm()) { finish(); return; }
    // Echtzeit: Anschlag (Stauchen), dann Schüsse im echten Takt
    const t0 = performance.now();
    const sides = [[a, duelKins[0]], [b, duelKins[1]]];
    for (const [s, k] of sides) {
      if (!Number.isFinite(s.ms)) continue;
      const adsMs = (s.def.adsTime || 0) * 1000;
      k.to('all', { w: 62 - cutW(s.def) }, adsMs, ease.inOut);
      for (let i = 0; i < s.n; i++) {
        const at = adsMs + B.shotTime(s.def, i) * 1000;
        setTimeout(() => { k.to('all', { w: 0 }, 60, ease.out); k.wave(10, 160, { stagger: 6 }); }, at);
      }
    }
    const end = Math.min(Number.isFinite(winner.ms) ? winner.ms : 0, 4000);
    setTimeout(finish, Math.max(0, end - (performance.now() - t0)) + 30);
    snd?.ui('confirm');
  });

  /* ------------------------------------------------------------ Start */
  if ('ResizeObserver' in window) {
    let rs = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(rs);
      rs = requestAnimationFrame(() => { maskSize(); fit(maskName); stage3d?.resize(); });
    }).observe(picBox);
  }
  ui.set('distance', clamp(Math.round(ui.get('distance') ?? 20), 0, 100));
  if (ui.get('zone') === 'head') head.checked = true;
  select(def.id, false);
  updateRanking(true);
  setLocks();
  started = true;
  if (P) {
    P.ready?.then?.(() => { setLocks(); setFacts(def); });
    P.onChange(() => setLocks());
  }
  fineMq.addEventListener?.('change', () => setInfo(def));

  if (!ctx.webgl) fallback('nowebgl');
  else if (ctx.saveData) { picMode = 'savedata'; stage.classList.add('lines'); setInfo(def); load3d.hidden = false; }
  else { stage.classList.add('lines'); gate3D(); }
}
