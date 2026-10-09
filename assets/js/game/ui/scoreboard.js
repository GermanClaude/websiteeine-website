// NULLPUNKT — Punktetabelle (HUD-Tab und Endbildschirm). Arbeitet mit einfachen Zeilen:
// { name, team, score, kills, deaths, assists, extra:{label,value}, isPlayer, isBot, alive, mvp }.
// Mehrspieler (optional je Zeile): ping (ms), isHost, isHuman, device ('pc'|'mobile'|'vr') – sobald eine Zeile ein Feld
// „ping“ hat (oder opts.online gesetzt ist), erscheint die Ping-Spalte; Menschen bekommen das Symbol ihres Geräts
// (PC/Handy/VR-Brille), der Host ein Abzeichen. Offline wie bisher.
// Nur Messer: cheat = Cheat-Menü aktiv (modes/knife.js, cheats.js) → kleines Symbol hinter dem Namen (Stil: ui/cheat-menu.js).

import { esc, kd } from './dom.js';
import { ICON, deviceOf } from './icons.js';

/** Ping-Zelle: Bots „BOT“, Host „–“ (läuft dort), sonst Millisekunden mit Farbstufe. */
function pingCell(r) {
  if (r.isBot && !r.isHuman) return '<td class="sb-ping is-bot">BOT</td>';
  if (r.isHost) return '<td class="sb-ping is-host" title="Host – kein Ping">–</td>';
  const p = Number(r.ping);
  if (!(p > 0)) return '<td class="sb-ping">–</td>';
  const tone = p < 80 ? 'good' : p < 150 ? 'ok' : 'bad';
  return `<td class="sb-ping is-${tone}">${Math.round(p)}</td>`;
}

/**
 * HTML der Tabelle. opts: { teams, playerTeam, teamNames:{A,B}, teamScores:{A,B}, live, squads, online }
 */
export function scoreboardHtml(rows, opts = {}) {
  const extraLabel = (rows.find((r) => r.extra) || {}).extra?.label || null;
  const online = opts.online != null ? !!opts.online : rows.some((r) => r.ping !== undefined);
  const head = `<tr><th class="sb-rank">#</th><th class="sb-name">Name</th><th>Punkte</th><th title="Abschüsse">A</th><th title="Tode">T</th><th title="Unterstützungen">U</th><th class="sb-kd">K/D</th>${extraLabel ? `<th class="sb-extra">${esc(extraLabel)}</th>` : ''}${online ? '<th class="sb-ping" title="Ping in Millisekunden">Ping</th>' : ''}</tr>`;
  const mySq = opts.squads ? (rows.find((r) => r.isPlayer) || {}).squad : null;
  const row = (r, i) => {
    const cls = ['sb-row', r.isPlayer ? 'is-me' : '', r.alive === false ? 'is-dead' : '', r.mvp ? 'is-mvp' : '', mySq && r.squad === mySq ? 'is-mysq' : '', online && r.isHuman && !r.isPlayer ? 'is-human' : '', r.cheat ? 'is-cheat' : ''].join(' ');
    const sq = opts.squads && r.squad ? `<span class="sb-sq">${esc(r.squad)}</span>` : '';
    const badge = r.mvp ? `<span class="sb-mvp" title="MVP">${ICON.crown}</span>` : r.teamMvp ? `<span class="sb-mvp sb-tmvp" title="Bester im Team">${ICON.star}</span>` : '';
    const dead = r.alive === false && opts.live ? `<span class="sb-dead">${ICON.skull}</span>` : '';
    // Mehrspieler: Menschen mit Gerät (PC/Handy/VR-Brille; ohne Angabe das Personensymbol) und Host kennzeichnen
    const dev = r.device ? deviceOf(r.device) : null;
    const who = r.isPlayer ? 'Du' : 'Mitspieler';
    const human = online && r.isHuman && (dev || !r.isPlayer)
      ? `<span class="sb-human"${dev ? ` data-dev="${esc(r.device)}"` : ''} title="${dev ? `${who} · ${esc(dev.label)}` : who}">${dev ? dev.icon : ICON.user}</span>` : '';
    const hostTag = online && r.isHost ? '<span class="sb-host" title="Host">Host</span>' : '';
    const cheat = r.cheat ? `<span class="sb-cheat" title="Cheat-Menü aktiv" aria-label="Cheat-Menü aktiv">${ICON.crosshair}</span>` : '';
    return `<tr class="${cls}"><td class="sb-rank">${i + 1}</td><td class="sb-name">${sq}${human}<span class="sb-n">${esc(r.name)}</span>${r.isPlayer ? '<span class="sb-you">Du</span>' : ''}${hostTag}${cheat}${badge}${dead}</td>` +
      `<td class="sb-score">${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td><td class="sb-kd">${kd(r.kills, r.deaths)}</td>` +
      `${extraLabel ? `<td class="sb-extra">${r.extra ? r.extra.value : '–'}</td>` : ''}${online ? pingCell(r) : ''}</tr>`;
  };
  const tcls = `sb-table${online ? ' sb-online' : ''}`;
  if (!opts.teams) {
    return `<table class="${tcls} sb-ffa">${head}${rows.map(row).join('')}</table>`;
  }
  const mine = opts.playerTeam === 'B' ? 'B' : 'A';
  const other = mine === 'A' ? 'B' : 'A';
  const names = opts.teamNames || { A: 'Team A', B: 'Team B' };
  const sc = opts.teamScores || {};
  const block = (team, side) => {
    let list = rows.filter((r) => r.team === team);
    // Eroberung: nach Trupps gruppiert (eigener Trupp zuerst), innerhalb nach Punkten
    if (opts.squads) {
      const best = new Map();
      for (const r of list) if (r.squad) best.set(r.squad, Math.max(best.get(r.squad) ?? -1, r.score));
      list = [...list].sort((a, b) => (b.squad === mySq) - (a.squad === mySq) || (best.get(b.squad) ?? -1) - (best.get(a.squad) ?? -1)
        || String(a.squad).localeCompare(String(b.squad)) || b.score - a.score);
    }
    return `<div class="sb-team sb-${side}"><div class="sb-thead"><span class="sb-tname">${esc(names[team] || team)}</span><span class="sb-tside">${side === 'ally' ? 'Dein Team' : 'Gegner'}</span><b class="sb-tscore">${sc[team] ?? ''}</b></div>` +
      `<table class="${tcls}">${head}${list.map(row).join('')}</table></div>`;
  };
  return `<div class="sb-teams">${block(mine, 'ally')}${block(other, 'enemy')}</div>`;
}

/**
 * Mehrspieler-Felder ergänzen (nur wenn G.net.online): ping/isHost aus dem Roster (über actor.netId), isHuman aus
 * dem Akteur (Spieler oder Puppe eines Menschen). Vorhandene Felder der Zeile (z. B. vom Modus) haben Vorrang.
 */
export function netRows(G, rows) {
  const net = G && G.net;
  if (!net || !net.online) return rows;
  const roster = Array.isArray(net.roster) ? net.roster : [];
  return rows.map((r) => {
    const a = r.actor || null;
    const id = Number.isInteger(r.netId) ? r.netId : a && Number.isInteger(a.netId) ? a.netId : null;
    const entry = id != null ? roster.find((e) => e.id === id) || null : null;
    const isHuman = r.isHuman != null ? !!r.isHuman : !!(entry || (a && (a.isPlayer || a.isRemoteHuman || a.isHuman)) || r.isPlayer);
    const isHost = r.isHost != null ? !!r.isHost : !!(entry && entry.isHost);
    let ping = r.ping != null ? r.ping : entry && Number.isFinite(entry.ping) ? entry.ping : null;
    // Eigene Zeile auf dem Client: gemessene Laufzeit zum Host, falls das Roster noch keinen Wert hat
    if (ping == null && r.isPlayer && net.role === 'client' && typeof net.peerRtt === 'function') {
      try { const v = net.peerRtt(1); if (v > 0) ping = Math.round(v); } catch { /* */ }
    }
    // Gerät aus dem Roster (eigene Zeile notfalls lokal)
    let device = r.device || (entry && entry.device) || null;
    if (!device && r.isPlayer && typeof net.localDevice === 'function') { try { device = net.localDevice(); } catch { /* */ } }
    return { ...r, netId: id, isHuman, isHost, ping: isHuman ? ping : null, isBot: isHuman ? false : r.isBot, device: isHuman ? device : null };
  });
}

/** Zeilen aus dem laufenden Modus (Live-Tabelle). */
export function liveRows(mode) {
  const board = netRows(mode && mode.G, mode.scoreboard());
  let top = null;
  for (const r of board) if (!top || r.score > top.score) top = r;
  return board.map((r) => ({ ...r, mvp: top && top.score > 0 && r === top }));
}
