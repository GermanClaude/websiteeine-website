// NULLPUNKT — Punktetabelle (HUD-Tab und Endbildschirm). Arbeitet mit einfachen Zeilen:
// { name, team, score, kills, deaths, assists, extra:{label,value}, isPlayer, isBot, alive, mvp }.
// Kein Ping: das Spiel läuft komplett offline gegen Bots.

import { esc, kd } from './dom.js';
import { ICON } from './icons.js';

/**
 * HTML der Tabelle. opts: { teams, playerTeam, teamNames:{A,B}, teamScores:{A,B}, live }
 */
export function scoreboardHtml(rows, opts = {}) {
  const extraLabel = (rows.find((r) => r.extra) || {}).extra?.label || null;
  const head = `<tr><th class="sb-rank">#</th><th class="sb-name">Name</th><th>Punkte</th><th title="Abschüsse">A</th><th title="Tode">T</th><th title="Unterstützungen">U</th><th class="sb-kd">K/D</th>${extraLabel ? `<th class="sb-extra">${esc(extraLabel)}</th>` : ''}</tr>`;
  const row = (r, i) => {
    const cls = ['sb-row', r.isPlayer ? 'is-me' : '', r.alive === false ? 'is-dead' : '', r.mvp ? 'is-mvp' : ''].join(' ');
    const badge = r.mvp ? `<span class="sb-mvp" title="MVP">${ICON.crown}</span>` : r.teamMvp ? `<span class="sb-mvp sb-tmvp" title="Bester im Team">${ICON.star}</span>` : '';
    const dead = r.alive === false && opts.live ? `<span class="sb-dead">${ICON.skull}</span>` : '';
    return `<tr class="${cls}"><td class="sb-rank">${i + 1}</td><td class="sb-name"><span class="sb-n">${esc(r.name)}</span>${r.isPlayer ? '<span class="sb-you">Du</span>' : ''}${badge}${dead}</td>` +
      `<td class="sb-score">${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td><td class="sb-kd">${kd(r.kills, r.deaths)}</td>` +
      `${extraLabel ? `<td class="sb-extra">${r.extra ? r.extra.value : '–'}</td>` : ''}</tr>`;
  };
  if (!opts.teams) {
    return `<table class="sb-table sb-ffa">${head}${rows.map(row).join('')}</table>`;
  }
  const mine = opts.playerTeam === 'B' ? 'B' : 'A';
  const other = mine === 'A' ? 'B' : 'A';
  const names = opts.teamNames || { A: 'Team A', B: 'Team B' };
  const sc = opts.teamScores || {};
  const block = (team, side) => {
    const list = rows.filter((r) => r.team === team);
    return `<div class="sb-team sb-${side}"><div class="sb-thead"><span class="sb-tname">${esc(names[team] || team)}</span><span class="sb-tside">${side === 'ally' ? 'Dein Team' : 'Gegner'}</span><b class="sb-tscore">${sc[team] ?? ''}</b></div>` +
      `<table class="sb-table">${head}${list.map(row).join('')}</table></div>`;
  };
  return `<div class="sb-teams">${block(mine, 'ally')}${block(other, 'enemy')}</div>`;
}

/** Zeilen aus dem laufenden Modus (Live-Tabelle). */
export function liveRows(mode) {
  const board = mode.scoreboard();
  let top = null;
  for (const r of board) if (!top || r.score > top.score) top = r;
  return board.map((r) => ({ ...r, mvp: top && top.score > 0 && r === top }));
}
