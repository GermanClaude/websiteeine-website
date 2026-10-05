// NULLPUNKT — Lobby-Reiter „Fortschritt“: Herausforderungen (täglich/wöchentlich, offline aus dem Datum gewürfelt),
// Meilensteine (Bronze → Nullpunkt), Tarnungen je Waffe (weapons.data.js CAMOS, Freischaltung aus dem Profil),
// Outfit-Ausführungen je Klasse und die Sammlung der Geheimnisse (Easter Eggs).

import { challengeView, milestoneState, MILESTONE_TIERS, SECRETS, OPERATOR_TIERS, dayKey } from '../../shared/modes.data.js';
import { CLASSES, SOLDIER_CLASS_ORDER } from '../../shared/classes.data.js';
import { esc, num } from './dom.js';
import { ICON } from './icons.js';
import { camoCtx, swatch } from './loadout-panel.js';

const SECTIONS = [['challenges', 'Herausforderungen'], ['camos', 'Tarnungen'], ['outfits', 'Outfits'], ['secrets', 'Geheimnisse']];

export class ProgressView {
  constructor(G) {
    this.G = G;
    this.sec = 'challenges';
    this.host = null;
    this._click = (e) => {
      const b = e.target.closest('[data-psec]');
      if (!b) return;
      this.sec = b.dataset.psec;
      this.G.events.emit('ui:sound', { name: 'click' });
      this.render();
    };
  }

  mount(host) {
    this.unmount();
    this.host = host;
    host.addEventListener('click', this._click);
    this.render();
  }

  unmount() {
    if (this.host) this.host.removeEventListener('click', this._click);
    this.host = null;
  }

  render() {
    if (!this.host) return;
    let prof;
    try { prof = this.G.profile.get(); } catch { prof = {}; }
    const tabs = SECTIONS.map(([id, label]) => `<button type="button" role="radio" data-psec="${id}" aria-checked="${id === this.sec}">${esc(label)}</button>`).join('');
    const body = this.sec === 'camos' ? this._camos(prof) : this.sec === 'outfits' ? this._outfits(prof) : this.sec === 'secrets' ? this._secrets(prof) : this._challenges(prof);
    this.host.innerHTML = `<div class="pg"><div class="m-seg pg-seg" role="radiogroup" aria-label="Fortschritt">${tabs}</div><div class="pg-body">${body}</div></div>`;
  }

  _challenges(prof) {
    const store = prof.challenges || {};
    const item = (c) => {
      const p = Math.min(1, c.value / c.target);
      return `<li class="pg-ch${c.done ? ' is-done' : ''}"><span class="pg-ct"><b>${esc(c.text)}</b><small>${c.done ? 'Erledigt' : `${num(c.value)} / ${num(c.target)}`}</small></span>
        <i class="pg-bar"><u style="transform:scaleX(${p.toFixed(3)})"></u></i><em>+${num(c.xp)} EP</em>${c.done ? `<span class="pg-ok">${ICON.check}</span>` : ''}</li>`;
    };
    const now = new Date();
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const h = Math.max(0, Math.floor((mid - now) / 3600000));
    const dow = (now.getDay() + 6) % 7; // Montag = 0
    const daysLeft = 7 - dow;
    const ms = milestoneState(store, { kills: prof.kills | 0, headshots: prof.headshots | 0, wins: prof.wins | 0, medals: Object.values(prof.medals || {}).reduce((a, b) => a + b, 0) });
    const mrow = (m) => {
      const goal = m.next ?? m.tiers[m.tiers.length - 1];
      const prev = m.tier > 0 ? m.tiers[m.tier - 1] : 0;
      const p = m.next == null ? 1 : Math.min(1, (m.value - prev) / Math.max(1, goal - prev));
      return `<li class="pg-ms" data-tier="${m.tier}"><span class="pg-ct"><b>${esc(m.text)}</b><small>${m.tier ? esc(MILESTONE_TIERS[m.tier - 1]) : 'Noch keine Stufe'} · ${num(m.value)}${m.next != null ? ` / ${num(m.next)}` : ''}</small></span>
        <i class="pg-bar"><u style="transform:scaleX(${p.toFixed(3)})"></u></i><span class="pg-pips">${m.tiers.map((_, i) => `<i class="${i < m.tier ? 'on' : ''}"></i>`).join('')}</span></li>`;
    };
    return `<section><h3 class="m-h2">Täglich <small>neu in ${h} h · ${esc(dayKey(now).split('-').reverse().join('.'))}</small></h3><ul class="pg-list">${challengeView(store, 'daily', now).map(item).join('')}</ul></section>
      <section><h3 class="m-h2">Wöchentlich <small>neu in ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tagen'}</small></h3><ul class="pg-list">${challengeView(store, 'weekly', now).map(item).join('')}</ul></section>
      <section><h3 class="m-h2">Meilensteine</h3><ul class="pg-list">${ms.map(mrow).join('')}</ul></section>`;
  }

  _camos(prof) {
    const D = this.G.data || {};
    if (!D.CAMOS) return '<p class="lb-note">Tarnungen sind in dieser Version nicht verfügbar.</p>';
    const W = D.WEAPONS || {};
    const eq = (prof.cosmetics && prof.cosmetics.equipped && prof.cosmetics.equipped.weapon) || {};
    const all = Object.values(D.CAMOS);
    const rows = Object.values(W).filter((w) => w.slot === 'primary' || w.slot === 'secondary').map((w) => {
      const ctx = camoCtx(this.G, w.id);
      const free = all.filter((cm) => typeof D.isCamoUnlocked !== 'function' || D.isCamoUnlocked(cm.id, ctx));
      const cur = D.CAMOS[eq[w.id]] || all[0];
      const next = all.find((cm) => !free.includes(cm));
      return `<li class="pg-cw"><span class="pg-sw" style="background:${swatch(cur)}"></span><span class="pg-ct"><b>${esc(w.name)}</b><small>${esc(cur ? cur.name : '')} · ${free.length}/${all.length} frei${next && typeof D.camoUnlockText === 'function' ? ` · Nächste: ${esc(next.name)} (${esc(D.camoUnlockText(next.id))})` : ''}</small></span>
        <i class="pg-bar"><u style="transform:scaleX(${(free.length / all.length).toFixed(3)})"></u></i></li>`;
    }).join('');
    return `<p class="lb-note">Tarnungen wählst du in der Ausrüstung bei der jeweiligen Waffe. Seltene Muster gibt es für Abschüsse und Kopftreffer mit der Waffe, Gold für alle seltenen.</p><ul class="pg-list">${rows}</ul>`;
  }

  _outfits(prof) {
    const lvl = prof.level || 1;
    const eq = (prof.cosmetics && prof.cosmetics.equipped && prof.cosmetics.equipped.operator) || {};
    return `<p class="lb-note">Jede Klasse hat drei Ausführungen. Die Teamfarbe an Ärmel und Helm bleibt immer erkennbar.</p><ul class="pg-list">${SOLDIER_CLASS_ORDER.map((id) => {
      const c = CLASSES[id];
      const cur = (eq[id] || `${id}:standard`).split(':')[1];
      return `<li class="pg-out"><span class="pg-cls">${ICON[id] || ICON.user}</span><span class="pg-ct"><b>${esc(c.name)}</b><small>${esc(c.role)}</small></span>
        <span class="pg-tiers">${OPERATOR_TIERS.map((t) => `<em class="${lvl >= t.level ? 'on' : ''}${cur === t.id ? ' cur' : ''}" title="${esc(lvl >= t.level ? t.text : `Ab Stufe ${t.level}`)}">${esc(t.name)}</em>`).join('')}</span></li>`;
    }).join('')}</ul>`;
  }

  _secrets(prof) {
    const found = prof.secrets || {};
    const known = new Set(SECRETS.map((s) => s.id));
    const MAPS = (this.G.data && this.G.data.MAPS) || {};
    const list = [...SECRETS, ...Object.entries(found).filter(([id]) => !known.has(id)).map(([id, v]) => ({ id, name: v.name, map: v.map, hint: '' }))];
    const n = list.filter((s) => found[s.id]).length;
    return `<p class="pg-count"><b>${n}</b> / ${list.length} Geheimnisse gefunden</p><ul class="pg-list">${list.map((s) => {
      const f = found[s.id];
      const map = MAPS[s.map] ? MAPS[s.map].name : s.map || '';
      return `<li class="pg-sec${f ? ' is-found' : ''}"><span class="pg-cls">${f ? ICON.star : ICON.secret}</span><span class="pg-ct"><b>${f ? esc(s.name) : '???'}</b><small>${f ? `${esc(map)}${f.at ? ` · gefunden am ${new Date(f.at).toLocaleDateString('de-DE')}` : ''}` : esc(s.hint || map)}</small></span></li>`;
    }).join('')}</ul>`;
  }
}
