// NULLPUNKT — Stub für ui/menus.js (§9): Lobby (Modus, Karte, Schwierigkeit, Teamgrößen, Ausrüstung),
// Ladeanzeige, Pause (Fortsetzen, Einstellungen, Steuerung, Match verlassen), Endbildschirm
// (Ergebnis, Tabelle, XP, Levelfortschritt, Revanche/Lobby/Zur Website). Stile eingebettet (.sm-).

const STYLE = `
.sm-screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:rgba(10,11,13,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:var(--np-ink);font-family:var(--font-display);pointer-events:auto;overflow:auto}
.sm-screen.solid{background:radial-gradient(ellipse at 30% 20%,#1a1d22 0,var(--np-black) 70%)}
.sm-panel{width:min(760px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:14px}
.sm-brand{font-weight:900;font-stretch:125%;letter-spacing:.02em;font-size:clamp(28px,5vw,46px);line-height:1}
.sm-brand em{font-style:normal;color:var(--np-signal)}
.sm-sub{color:var(--np-ink-2);font-size:14px;letter-spacing:.06em;text-transform:uppercase;font-family:var(--font-hud);font-weight:600}
.sm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sm-label{font-family:var(--font-hud);font-weight:600;letter-spacing:.1em;text-transform:uppercase;font-size:12px;color:var(--np-dim);width:100%}
.sm-btn{appearance:none;border:1px solid var(--np-line-strong);background:rgba(233,230,223,.04);color:var(--np-ink);font:600 15px var(--font-hud);letter-spacing:.06em;padding:9px 14px;border-radius:2px;cursor:pointer;min-height:40px}
.sm-btn:hover,.sm-btn:focus-visible{border-color:var(--np-ink);outline:none}
.sm-btn[aria-pressed="true"]{background:var(--np-ink);color:var(--np-black);border-color:var(--np-ink)}
.sm-btn[disabled]{opacity:.35;cursor:not-allowed}
.sm-btn.primary{background:var(--np-signal);border-color:var(--np-signal);color:#160800;font-size:18px;padding:12px 22px;font-weight:700}
.sm-btn.primary:hover{filter:brightness(1.08)}
.sm-select,.sm-num{background:var(--np-black-2);color:var(--np-ink);border:1px solid var(--np-line-strong);font:500 15px var(--font-hud);padding:8px;border-radius:2px;min-height:40px}
.sm-num{width:72px}
.sm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.sm-bar{height:4px;background:var(--np-line);overflow:hidden}.sm-bar i{display:block;height:100%;background:var(--np-signal);transform-origin:left;transition:transform .25s}
.sm-title{font-weight:900;font-stretch:120%;font-size:clamp(34px,7vw,64px);line-height:.95}
.sm-title.win{color:var(--np-ok)}.sm-title.loss{color:var(--np-enemy)}.sm-title.draw{color:var(--np-gold)}
.sm-table{width:100%;border-collapse:collapse;font-family:var(--font-hud);font-size:15px}
.sm-table td,.sm-table th{padding:4px 8px;text-align:right;border-bottom:1px solid var(--np-line)}
.sm-table td:first-child,.sm-table th:first-child{text-align:left}
.sm-table th{color:var(--np-dim);font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.sm-table tr.a td:first-child{color:var(--np-ally)}.sm-table tr.b td:first-child{color:var(--np-enemy)}.sm-table tr.me td{color:var(--np-gold)}
.sm-xp{display:flex;justify-content:space-between;font-family:var(--font-hud);font-size:15px}
.sm-kbd{font-family:var(--font-mono);font-size:13px;color:var(--np-ink-2)}
.sm-set{display:grid;grid-template-columns:1fr auto;gap:10px 16px;align-items:center;font-family:var(--font-hud);font-size:15px}
.sm-set input[type=range]{width:min(260px,40vw)}
`;

const MODE_ORDER = ['tdm', 'ffa', 'dom', 'gun', 'training'];
const DIFFS = [['rekrut', 'Rekrut'], ['regulaer', 'Regulär'], ['veteran', 'Veteran'], ['elite', 'Elite']];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Menus {
  constructor(G) {
    this.G = G;
    this.root = document.getElementById('menu-root') || document.body;
    this.current = null;
    this.onStart = null;
    this.onResume = null;
    this.onRestart = null;
    this.onQuit = null;
    this.onExit = null;
    if (!document.getElementById('sm-style')) {
      const st = document.createElement('style');
      st.id = 'sm-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    this._onKey = (e) => {
      if (e.code !== 'Escape') return;
      if (this.current === 'pause' && this.onResume) { e.preventDefault(); this.onResume(); }
      else if (this.current === 'settings' || this.current === 'controls') { e.preventDefault(); this.showPause(); }
    };
    window.addEventListener('keydown', this._onKey);
  }

  _screen(name, html, solid = false) {
    this.root.innerHTML = `<div class="sm-screen${solid ? ' solid' : ''}" data-screen="${name}">${html}</div>`;
    this.current = name;
    const s = this.root.firstElementChild;
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && this.G.audio && this.G.audio.ui) this.G.audio.ui('click');
    });
    return s;
  }

  hideAll() {
    this.root.innerHTML = '';
    this.current = null;
  }

  /* ------------------------------------------------------------ Lobby */

  showLobby() {
    const G = this.G;
    const s = G.settings;
    const MODES = (G.data && G.data.MODES) || {};
    const MAPS = (G.data && G.data.MAPS) || {};
    const W = (G.data && G.data.WEAPONS) || {};
    const EQ = (G.data && G.data.EQUIPMENT) || {};
    const prof = G.profile.get();
    const level = prof.level;
    const last = s.get('lastLoadout') || {};
    const cfg = {
      modeId: MODES[s.get('lastMode')] ? s.get('lastMode') : 'tdm',
      mapId: MAPS[s.get('lastMap')] ? s.get('lastMap') : Object.keys(MAPS)[0] || 'hafen',
      difficulty: s.get('difficulty'),
      primary: W[last.primary] ? last.primary : 'ar_m17',
      secondary: W[last.secondary] ? last.secondary : 'pi_p9',
      lethal: EQ[last.lethal] ? last.lethal : 'frag',
    };
    const opt = (id, def, sel) => {
      const locked = def.unlockLevel > level;
      return `<option value="${id}"${id === sel ? ' selected' : ''}${locked ? ' disabled' : ''}>${esc(def.name)}${locked ? ` (Level ${def.unlockLevel})` : ''}</option>`;
    };
    const weaponsFor = (slot) => Object.values(W).filter((d) => d.slot === slot);
    const rank = G.profile.rankFor(level);
    const html = `
      <div class="sm-panel">
        <div><div class="sm-brand">NULL<em>PUNKT</em></div><div class="sm-sub">${esc(prof.name)} · ${esc(rank.name)} · Level ${level}</div></div>
        <div class="sm-row" data-group="mode"><div class="sm-label">Modus</div>${MODE_ORDER.filter((m) => MODES[m]).map((m) => `<button class="sm-btn" data-mode="${m}" aria-pressed="${m === cfg.modeId}">${esc(MODES[m].name)}</button>`).join('')}</div>
        <div class="sm-row" data-group="map"><div class="sm-label">Karte</div>${Object.values(MAPS).map((m) => `<button class="sm-btn" data-map="${m.id}" aria-pressed="${m.id === cfg.mapId}">${esc(m.name)}</button>`).join('')}</div>
        <div class="sm-row" data-group="diff"><div class="sm-label">Bots</div>${DIFFS.map(([id, n]) => `<button class="sm-btn" data-diff="${id}" aria-pressed="${id === cfg.difficulty}">${n}</button>`).join('')}
          <label class="sm-kbd">Verbündete <input class="sm-num" type="number" min="0" max="7" step="1" data-k="allies"></label>
          <label class="sm-kbd">Gegner <input class="sm-num" type="number" min="1" max="9" step="1" data-k="enemies"></label></div>
        <div class="sm-grid">
          <label><div class="sm-label">Primärwaffe</div><select class="sm-select" data-slot="primary">${weaponsFor('primary').map((d) => opt(d.id, d, cfg.primary)).join('')}</select></label>
          <label><div class="sm-label">Sekundärwaffe</div><select class="sm-select" data-slot="secondary">${weaponsFor('secondary').map((d) => opt(d.id, d, cfg.secondary)).join('')}</select></label>
          <label><div class="sm-label">Granate</div><select class="sm-select" data-slot="lethal">${Object.values(EQ).map((d) => opt(d.id, d, cfg.lethal)).join('')}</select></label>
        </div>
        <div class="sm-row"><button class="sm-btn primary" data-act="start">Einsatz starten</button><button class="sm-btn" data-act="exit">Zur Website</button></div>
      </div>`;
    const el = this._screen('lobby', html, true);
    const counts = () => {
      const m = MODES[cfg.modeId] || {};
      const teams = m.teams !== false && cfg.modeId !== 'ffa' && cfg.modeId !== 'gun';
      el.querySelector('[data-k="allies"]').value = teams ? (m.defaultAllies ?? m.allies ?? 5) : 0;
      el.querySelector('[data-k="allies"]').disabled = !teams;
      el.querySelector('[data-k="enemies"]').value = m.defaultEnemies ?? m.enemies ?? (teams ? 6 : 7);
    };
    counts();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const [attr, key] of [['mode', 'modeId'], ['map', 'mapId'], ['diff', 'difficulty']]) {
        if (b.dataset[attr]) {
          cfg[key] = b.dataset[attr];
          el.querySelectorAll(`[data-${attr}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          if (attr === 'mode') counts();
        }
      }
      if (b.dataset.act === 'start' && this.onStart) {
        const loadout = {};
        el.querySelectorAll('[data-slot]').forEach((sel) => { loadout[sel.dataset.slot] = sel.value; });
        const allies = parseInt(el.querySelector('[data-k="allies"]').value, 10) || 0;
        const enemies = parseInt(el.querySelector('[data-k="enemies"]').value, 10) || 1;
        this.onStart({ modeId: cfg.modeId, mapId: cfg.mapId, difficulty: cfg.difficulty, allies, enemies, loadout });
      }
      if (b.dataset.act === 'exit' && this.onExit) this.onExit();
    });
    el.querySelector('[data-act="start"]').focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ Laden */

  showLoading(p = 0) {
    if (this.current !== 'loading') {
      const G = this.G;
      const MAPS = (G.data && G.data.MAPS) || {};
      const map = MAPS[G.match && G.match.mapId];
      this._screen('loading', `
        <div class="sm-panel" style="width:min(520px,100%)">
          <div class="sm-sub">Einsatz wird vorbereitet</div>
          <div class="sm-brand" style="font-size:clamp(26px,4vw,40px)">${esc(map ? map.name : 'Testgelände')}</div>
          <div class="sm-bar"><i style="transform:scaleX(0)"></i></div>
          <div class="sm-kbd" data-pct>0 %</div>
        </div>`, true);
    }
    const v = Math.max(0, Math.min(1, p));
    const bar = this.root.querySelector('.sm-bar i');
    const pct = this.root.querySelector('[data-pct]');
    if (bar) bar.style.transform = `scaleX(${v})`;
    if (pct) pct.textContent = `${Math.round(v * 100)} %`;
  }

  /* ------------------------------------------------------------ Pause */

  showPause() {
    const el = this._screen('pause', `
      <div class="sm-panel" style="width:min(420px,100%)">
        <div class="sm-title">Pause</div>
        <button class="sm-btn primary" data-act="resume">Fortsetzen</button>
        <button class="sm-btn" data-act="settings">Einstellungen</button>
        <button class="sm-btn" data-act="controls">Steuerung</button>
        <button class="sm-btn" data-act="quit">Match verlassen</button>
      </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'resume' && this.onResume) this.onResume();
      if (b.dataset.act === 'settings') this.showSettings();
      if (b.dataset.act === 'controls') this._showControls();
      if (b.dataset.act === 'quit' && this.onQuit) this.onQuit();
    });
    el.querySelector('[data-act="resume"]').focus({ preventScroll: true });
  }

  showSettings() {
    const s = this.G.settings;
    const range = (k, min, max, step, label) => `<label for="sm-${k}">${label}</label><input id="sm-${k}" type="range" min="${min}" max="${max}" step="${step}" value="${s.get(k)}" data-k="${k}">`;
    const el = this._screen('settings', `
      <div class="sm-panel" style="width:min(560px,100%)">
        <div class="sm-title" style="font-size:40px">Einstellungen</div>
        <div class="sm-set">
          ${range('sensitivity', 0.1, 5, 0.05, 'Mausempfindlichkeit')}
          ${range('touchSensitivity', 0.2, 3, 0.05, 'Touch-Empfindlichkeit')}
          ${range('fov', 60, 110, 1, 'Sichtfeld')}
          ${range('masterVolume', 0, 1, 0.05, 'Lautstärke')}
          <label for="sm-quality">Grafikqualität</label><select id="sm-quality" class="sm-select" data-k="quality">${['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<option value="${q}"${s.get('quality') === q ? ' selected' : ''}>${{ auto: 'Automatisch', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' }[q]}</option>`).join('')}</select>
          <label for="sm-showFps">FPS anzeigen</label><input id="sm-showFps" type="checkbox" data-k="showFps"${s.get('showFps') ? ' checked' : ''}>
          <label for="sm-invertY">Y-Achse umkehren</label><input id="sm-invertY" type="checkbox" data-k="invertY"${s.get('invertY') ? ' checked' : ''}>
          <label for="sm-aimAssist">Zielhilfe (Touch/Controller)</label><input id="sm-aimAssist" type="checkbox" data-k="aimAssist"${s.get('aimAssist') ? ' checked' : ''}>
        </div>
        <button class="sm-btn" data-act="back">Zurück</button>
      </div>`);
    el.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      s.set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="back"]')) this.showPause(); });
  }

  _showControls() {
    const el = this._screen('controls', `
      <div class="sm-panel" style="width:min(560px,100%)">
        <div class="sm-title" style="font-size:40px">Steuerung</div>
        <table class="sm-table">
          <tr><td>Bewegen</td><td class="sm-kbd">W A S D</td></tr><tr><td>Feuern / Zielen</td><td class="sm-kbd">Linke / rechte Maustaste</td></tr>
          <tr><td>Sprinten</td><td class="sm-kbd">Umschalt</td></tr><tr><td>Ducken / Rutschen</td><td class="sm-kbd">C oder Strg</td></tr>
          <tr><td>Springen</td><td class="sm-kbd">Leertaste</td></tr><tr><td>Nachladen</td><td class="sm-kbd">R</td></tr>
          <tr><td>Granate</td><td class="sm-kbd">G oder Q</td></tr><tr><td>Messer</td><td class="sm-kbd">V</td></tr>
          <tr><td>Waffe wechseln</td><td class="sm-kbd">1 / 2 / Mausrad</td></tr><tr><td>Serien</td><td class="sm-kbd">3 / 4 / 5</td></tr>
          <tr><td>Punktetabelle / Pause</td><td class="sm-kbd">Tab / Esc</td></tr>
        </table>
        <button class="sm-btn" data-act="back">Zurück</button>
      </div>`);
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="back"]')) this.showPause(); });
  }

  /* ------------------------------------------------------------ Ende */

  showEnd(result, progression) {
    const G = this.G;
    const r = result || {};
    const ps = r.playerSummary || {};
    const outcome = r.draw ? 'draw' : r.playerWon ? 'win' : 'loss';
    const title = { win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden' }[outcome];
    const mine = G.player && G.player.team === 'B' ? 'B' : 'A';
    const ts = r.teamScores;
    const scoreLine = ts ? `${ts[mine] ?? 0} : ${ts[mine === 'A' ? 'B' : 'A'] ?? 0}` : '';
    const rows = (r.scoreboard || []).slice(0, 12).map((x) => `<tr class="${x.isPlayer ? 'me' : x.team === 'B' ? 'b' : 'a'}"><td>${esc(x.name)}</td><td>${x.score}</td><td>${x.kills}</td><td>${x.deaths}</td><td>${x.assists}</td></tr>`).join('');
    const pr = progression;
    const prog = pr && pr.progressAfter ? pr.progressAfter : null;
    const xpHtml = pr ? `
      <div class="sm-xp"><span>+${pr.xpGained} XP</span><span>Level ${pr.levelAfter}${pr.levelUp ? ' · Aufgestiegen!' : ''}${pr.rankUp ? ` · ${esc(pr.rankAfter.name)}` : ''}</span></div>
      <div class="sm-bar"><i style="transform:scaleX(${prog ? prog.progress : 0})"></i></div>
      <div class="sm-kbd">${pr.breakdown.map((b) => `${esc(b.label)} +${b.xp}`).join(' · ')}${pr.unlocked.length ? ` · Neu freigeschaltet: ${pr.unlocked.map((id) => esc(G.profile.unlockName(id))).join(', ')}` : ''}</div>` : '';
    const el = this._screen('end', `
      <div class="sm-panel">
        <div class="sm-sub">Match beendet${ps.kills !== undefined ? ` · ${ps.kills} Abschüsse · ${ps.deaths} Tode` : ''}</div>
        <div class="sm-title ${outcome}" data-result="${outcome}">${title}${scoreLine ? ` <span style="font-size:.5em;color:var(--np-ink)">${scoreLine}</span>` : ''}</div>
        ${xpHtml}
        <table class="sm-table"><tr><th>Name</th><th>Punkte</th><th>Abschüsse</th><th>Tode</th><th>Assists</th></tr>${rows}</table>
        <div class="sm-row"><button class="sm-btn primary" data-act="restart">Revanche</button><button class="sm-btn" data-act="lobby">Lobby</button><button class="sm-btn" data-act="exit">Zur Website</button></div>
      </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'restart' && this.onRestart) this.onRestart();
      if (b.dataset.act === 'lobby' && this.onQuit) this.onQuit();
      if (b.dataset.act === 'exit' && this.onExit) this.onExit();
    });
    el.querySelector('[data-act="restart"]').focus({ preventScroll: true });
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.hideAll();
  }
}
