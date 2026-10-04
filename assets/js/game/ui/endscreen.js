// NULLPUNKT — Endbildschirm: Ergebnis (Sieg/Niederlage/Unentschieden bzw. Platz), Teamstand, vollständige
// Punktetabelle mit MVP, persönliche Werte (K/D, Genauigkeit, Kopftreffer, beste Serie …), Medaillen,
// animierter XP-Balken mit Stufen-/Dienstgrad-Aufstieg (rankIcon), neue Freischaltungen.
// Knöpfe: Revanche · Lobby · Zur Website.

import { esc, num, pct, kd, clock, meters, secs } from './dom.js';
import { ICON, medalBadge } from './icons.js';
import { scoreboardHtml } from './scoreboard.js';

const REASON = {
  score: 'Punktelimit erreicht', time: 'Zeit abgelaufen', overtime: 'In der Verlängerung entschieden', forced: 'Match beendet',
  finished: 'Training beendet',
};

export class EndScreen {
  constructor(G) {
    this.G = G;
    this._raf = 0;
    this.root = null;
  }

  /** HTML-Inhalt (ohne Bildschirmrahmen). */
  html(result, progression) {
    const G = this.G;
    const r = result || {};
    const ps = r.playerSummary || {};
    const D = G.data || {};
    const names = D.TEAM_NAMES || { A: 'Team A', B: 'Team B' };
    const p = G.player;
    const mine = p && p.team === 'B' ? 'B' : 'A';
    const other = mine === 'A' ? 'B' : 'A';
    const training = r.training || r.modeId === 'training';
    let outcome = r.draw ? 'draw' : r.playerWon ? 'win' : 'loss';
    let title = { win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden' }[outcome];
    if (training) { outcome = 'train'; title = 'Training beendet'; }
    else if (!r.teams && r.placement) title = r.draw && r.placement === 1 ? 'Gleichstand' : `Platz ${r.placement}`;
    const kicker = [r.modeName, r.mapName, r.duration ? clock(r.duration) : null, REASON[r.reason] || null].filter(Boolean).map(esc).join(' · ');
    let line = '';
    if (r.teams && r.teamScores) {
      line = `<div class="e-teams"><span class="a"><small>${esc(names[mine])}</small><b>${r.teamScores[mine] ?? 0}</b></span><i>:</i><span class="b"><b>${r.teamScores[other] ?? 0}</b><small>${esc(names[other])}</small></span></div>`;
    } else if (!training) {
      const meWin = r.winner && G.player && r.winner === G.player.id;
      const win = meWin ? '<b>Du gewinnst.</b>' : r.winnerName ? `Sieger: <b>${esc(r.winnerName)}</b>` : 'Kein eindeutiger Sieger';
      line = `<div class="e-sub">${win}${r.players ? ` · ${r.players} Spieler` : ''}${r.modeId === 'ffa' ? ' · Platz 1–3 zählt als Sieg' : ''}</div>`;
    }

    // persönliche Werte
    const acc = ps.shotsFired ? ps.shotsHit / ps.shotsFired : 0;
    let cells;
    if (training && r.extra && r.extra.training) {
      const t = r.extra.training;
      const parc = r.extra.parcours;
      cells = [
        ['Treffer', `${t.hits}`, `${t.shots} Schuss`], ['Genauigkeit', t.shots ? pct(t.accuracy) : '–'], ['Kopftreffer', t.hits ? pct(t.headRate) : '–'],
        ['Ziele unten', String(t.down)], ['Ø Zeit bis Ziel', t.avgTtk != null ? secs(t.avgTtk, 2) : '–'], ['Weitester Treffer', t.longest ? meters(t.longest, 1) : '–'],
        ['Schaden', num(t.damage || 0)], ['Parcours', parc ? secs(parc.time, 2) : '–', parc && parc.newBest ? 'Neue Bestzeit' : ''], ['Bestzeit', r.extra.best != null ? secs(r.extra.best, 2) : '–'],
      ];
    } else {
      cells = [
        ['Abschüsse', String(ps.kills ?? 0)], ['Tode', String(ps.deaths ?? 0)], ['K/D', kd(ps.kills || 0, ps.deaths || 0)],
        ['Unterstützung', String(ps.assists ?? 0)], ['Genauigkeit', ps.shotsFired ? pct(acc) : '–', ps.shotsFired ? `${ps.shotsHit}/${ps.shotsFired}` : ''],
        ['Kopftreffer', String(ps.headshots ?? 0)], ['Beste Serie', String(ps.bestStreak ?? 0)], ['Weitester Abschuss', ps.longestKill ? meters(ps.longestKill, 1) : '–'],
        ['Schaden', num(ps.damage || 0)],
      ];
      if (r.modeId === 'dom') cells[8] = ['Eroberungen', String(ps.captures ?? 0)];
    }
    const stats = `<div class="e-stats">${cells.map(([l, v, s]) => `<div class="e-cell"><small>${esc(l)}</small><b>${v}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`).join('')}</div>`;

    // Medaillen
    const M = D.MEDALS || {};
    const medals = Object.entries(ps.medals || {}).filter(([id, n]) => n > 0 && M[id]).sort((a, b) => tierRank(M[b[0]].tier) - tierRank(M[a[0]].tier) || b[1] - a[1]);
    const medalHtml = medals.length
      ? `<div class="e-medals">${medals.map(([id, n]) => `<div class="e-medal tier-${M[id].tier}" title="${esc(M[id].description)}">${medalBadge(M[id].label, M[id].tier)}<span>${esc(M[id].label)}</span>${n > 1 ? `<b>×${n}</b>` : ''}</div>`).join('')}</div>`
      : '<div class="e-medals is-empty">Keine Medaillen in diesem Match.</div>';

    // XP / Stufe
    let xp = '';
    const pr = progression;
    if (pr) {
      const rankIcon = G.profile && G.profile.rankIcon ? G.profile.rankIcon(pr.levelAfter, { size: 44 }) : '';
      const unlocks = (pr.unlocked || []).map((id) => {
        const def = (D.WEAPONS && D.WEAPONS[id]) || (D.EQUIPMENT && D.EQUIPMENT[id]);
        const name = G.profile.unlockName ? G.profile.unlockName(id) : def ? def.name : id;
        return `<div class="e-unlock"><span class="ico">${def && def.icon ? def.icon : ICON.lock}</span><span>${esc(name)}</span></div>`;
      }).join('');
      xp = `
        <div class="e-xp">
          <div class="e-xp-head">
            <div class="e-rank">${rankIcon}</div>
            <div class="e-lvl"><small>${esc(pr.rankAfter ? pr.rankAfter.name : '')}</small><b>Stufe <span data-xp-level>${pr.levelBefore}</span></b></div>
            <div class="e-gain">+<span data-xp-count>0</span> XP</div>
          </div>
          <div class="e-xpbar"><i data-xp-fill></i></div>
          <div class="e-xp-note" data-xp-note>${pr.progressAfter && pr.progressAfter.isMax ? 'Höchststufe erreicht.' : pr.progressAfter ? `${num(pr.progressAfter.xpIntoLevel)} / ${num(pr.progressAfter.xpForNext)} XP bis Stufe ${pr.levelAfter + 1}` : ''}</div>
          <ul class="e-break">${(pr.breakdown || []).map((b, i) => `<li style="--i:${i}"><span>${esc(b.label)}</span><b>${b.xp >= 0 ? '+' : ''}${num(b.xp)}</b></li>`).join('')}</ul>
          ${pr.levelUp ? `<div class="e-up" data-xp-up hidden><b>Aufgestiegen<em>.</em></b> Stufe ${pr.levelAfter}${pr.rankUp ? ` · Neuer Dienstgrad: ${esc(pr.rankAfter.name)}` : ''}</div>` : ''}
          ${unlocks ? `<div class="e-unlocks"><small>Neu freigeschaltet</small>${unlocks}</div>` : ''}
        </div>`;
    }

    const board = (r.scoreboard || []).length
      ? scoreboardHtml(r.scoreboard, { teams: r.teams, playerTeam: mine, teamNames: names, teamScores: r.teamScores, showPing: false })
      : '';
    return `
      <div class="e-wrap m-scroll" data-scrollable>
        <header class="e-head">
          <div class="m-kicker">${kicker}</div>
          <h1 class="e-title is-${outcome}">${esc(title)}<em>.</em></h1>
          ${line}
        </header>
        <div class="e-grid">
          <section class="e-me" aria-label="Deine Bilanz">${xp}${stats}${medalHtml}</section>
          ${board ? `<section class="e-board" aria-label="Punktetabelle"><h2 class="m-h2">Punktetabelle</h2>${board}</section>` : ''}
        </div>
      </div>
      <div class="e-actions m-actions">
        <button type="button" class="m-btn m-primary" data-act="restart">${ICON.restart}<span>${training ? 'Neu starten' : 'Revanche'}</span></button>
        <button type="button" class="m-btn" data-act="lobby">${ICON.map}<span>Lobby</span></button>
        <button type="button" class="m-btn m-ghost" data-act="exit">${ICON.exit}<span>Zur Website</span></button>
      </div>`;
  }

  /** XP-Balken animieren (über Stufenaufstiege hinweg). */
  animate(root, progression) {
    cancelAnimationFrame(this._raf);
    const pr = progression;
    const fill = root.querySelector('[data-xp-fill]');
    const count = root.querySelector('[data-xp-count]');
    const lvlEl = root.querySelector('[data-xp-level]');
    const up = root.querySelector('[data-xp-up]');
    if (!pr || !fill) return;
    const reduced = this.G.settings.get('reducedMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const p0 = pr.progressBefore ? pr.progressBefore.progress : 0;
    const p1 = pr.progressAfter ? pr.progressAfter.progress : 0;
    const levels = Math.max(0, (pr.levelAfter || 0) - (pr.levelBefore || 0));
    // Weg in „Balkenlängen“: Start p0 in levelBefore, Ziel levels + p1
    const total = Math.max(0, levels + p1 - p0);
    const dur = reduced ? 0 : Math.min(3.2, 0.9 + total * 1.1);
    const start = performance.now() + (reduced ? 0 : 450);
    let shownLevel = pr.levelBefore;
    const step = (now) => {
      const t = dur ? Math.max(0, Math.min(1, (now - start) / (dur * 1000))) : 1;
      const e = 1 - Math.pow(1 - t, 3);
      const pos = p0 + total * e;
      const whole = Math.min(levels, Math.floor(pos + 1e-6));
      const lvl = pr.levelBefore + whole;
      const width = t >= 1 ? p1 : pos - whole;
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, width)).toFixed(4)})`;
      count.textContent = num(Math.round((pr.xpGained || 0) * e));
      if (lvl !== shownLevel) {
        shownLevel = lvl;
        lvlEl.textContent = String(lvl);
        fill.parentElement.classList.remove('flash');
        void fill.offsetWidth;
        fill.parentElement.classList.add('flash');
        this.G.events.emit('ui:sound', { name: 'levelup' });
      }
      if (t < 1) this._raf = requestAnimationFrame(step);
      else {
        lvlEl.textContent = String(pr.levelAfter);
        if (up) { up.hidden = false; }
      }
    };
    fill.style.transform = `scaleX(${p0})`;
    this._raf = requestAnimationFrame(step);
  }

  stop() {
    cancelAnimationFrame(this._raf);
  }
}

function tierRank(t) {
  return t === 'gold' ? 3 : t === 'silber' ? 2 : 1;
}
