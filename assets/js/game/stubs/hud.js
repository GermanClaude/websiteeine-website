// NULLPUNKT — Stub für ui/hud.js (§9): Fadenkreuz (dynamisch), Treffermarker, Munition, Leben,
// Teamstand + Zeit, Abschussmeldungen, Countdown, Wiedereinstieg, Punktetabelle (Tab), Zielfernrohr.
// Eigene, eingebettete Stile (Präfix .sh-), damit game.css frei für die echte HUD bleibt.

const STYLE = `
.sh-root{position:absolute;inset:0;pointer-events:none;font-family:var(--font-hud);color:var(--np-ink);text-shadow:0 1px 2px rgba(0,0,0,.6);user-select:none}
.sh-root[hidden]{display:none}
.sh-cross{position:absolute;left:50%;top:50%;width:0;height:0}
.sh-cross i{position:absolute;background:var(--sh-cc,#fff);box-shadow:0 0 2px rgba(0,0,0,.8);transition:opacity .1s}
.sh-cross .l,.sh-cross .r{height:2px;width:10px;top:-1px}.sh-cross .t,.sh-cross .b{width:2px;height:10px;left:-1px}
.sh-cross .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
.sh-cross.is-enemy i{background:var(--np-enemy)}
.sh-hit{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px;opacity:0;transform:rotate(45deg)}
.sh-hit::before,.sh-hit::after{content:"";position:absolute;background:#fff;left:50%;top:0;width:2px;height:100%;margin-left:-1px;clip-path:polygon(0 0,100% 0,100% 35%,0 35%,0 65%,100% 65%,100% 100%,0 100%)}
.sh-hit::after{transform:rotate(90deg)}
.sh-hit.kill::before,.sh-hit.kill::after{background:var(--np-enemy)}
.sh-top{position:absolute;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;font-weight:700;font-size:22px}
.sh-team{min-width:54px;padding:2px 10px;text-align:center;border-radius:3px;background:rgba(10,11,13,.55)}
.sh-team.a{border-bottom:3px solid var(--np-ally)}.sh-team.b{border-bottom:3px solid var(--np-enemy)}
.sh-time{font-family:var(--font-mono);font-size:16px;padding:3px 8px;background:rgba(10,11,13,.55);border-radius:3px}
.sh-ammo{position:absolute;right:max(24px,env(safe-area-inset-right));bottom:22px;text-align:right}
.sh-ammo b{font-size:40px;font-weight:700;line-height:1}.sh-ammo span{font-size:20px;color:var(--np-ink-2)}
.sh-ammo .w{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--np-ink-2)}
.sh-ammo.low b{color:var(--np-signal)}
.sh-ammo .rl{font-size:13px;color:var(--np-gold);letter-spacing:.1em}
.sh-hp{position:absolute;left:max(24px,env(safe-area-inset-left));bottom:26px;width:220px}
.sh-hp .bar{height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden}
.sh-hp .fill{height:100%;background:var(--np-ink);transform-origin:left;transition:background .2s}
.sh-hp.low .fill{background:var(--np-enemy)}
.sh-hp .n{font-size:15px;font-weight:600;margin-bottom:4px;letter-spacing:.08em}
.sh-feed{position:absolute;left:max(16px,env(safe-area-inset-left));top:max(70px,calc(env(safe-area-inset-top) + 60px));display:flex;flex-direction:column;gap:3px;font-size:15px;font-weight:600}
.sh-feed div{background:rgba(10,11,13,.55);padding:2px 8px;border-radius:2px;transition:opacity .4s}
.sh-feed .a{color:var(--np-ally)}.sh-feed .b{color:var(--np-enemy)}.sh-feed .me{color:var(--np-gold)}.sh-feed .wpn{color:var(--np-ink-2);font-weight:500}
.sh-center{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%);text-align:center;font-weight:700}
.sh-count{font-size:96px;line-height:1;color:var(--np-ink)}
.sh-msg{font-size:24px;letter-spacing:.06em}
.sh-msg small{display:block;font-size:16px;color:var(--np-ink-2);font-weight:500}
.sh-pop{position:absolute;left:50%;top:58%;transform:translateX(-50%);font-size:20px;font-weight:700;color:var(--np-gold);opacity:0;transition:opacity .25s}
.sh-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(160,0,0,.55) 100%);opacity:0;transition:opacity .2s}
.sh-dmg{position:absolute;left:50%;top:50%;width:0;height:0}
.sh-dmg i{position:absolute;left:-40px;top:-170px;width:80px;height:26px;background:radial-gradient(ellipse at center,rgba(255,40,30,.85),transparent 70%);transform-origin:40px 170px;opacity:0;transition:opacity .5s}
.sh-scope{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at center,transparent 0,transparent 33vmin,#000 33.4vmin)}
.sh-scope::before,.sh-scope::after{content:"";position:absolute;background:#000;left:50%;top:0;width:1.5px;height:100%;margin-left:-.75px}
.sh-scope::after{left:0;top:50%;width:100%;height:1.5px;margin:-.75px 0 0}
.sh-board{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(620px,92vw);background:rgba(10,11,13,.86);border:1px solid var(--np-line-strong);padding:14px 18px;font-size:16px}
.sh-board[hidden]{display:none}
body[data-input-mode="touch"] .sh-ammo{right:auto;left:50%;bottom:calc(3% + 54px);transform:translateX(-50%);text-align:center}
body[data-input-mode="touch"] .sh-ammo b{font-size:30px}
body[data-input-mode="touch"] .sh-hp{width:160px;bottom:12px}
.sh-board table{width:100%;border-collapse:collapse}.sh-board td,.sh-board th{padding:3px 8px;text-align:right}
.sh-board td:first-child,.sh-board th:first-child{text-align:left}
.sh-board th{color:var(--np-ink-2);font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.sh-board tr.a td:first-child{color:var(--np-ally)}.sh-board tr.b td:first-child{color:var(--np-enemy)}.sh-board tr.me td{color:var(--np-gold)}
`;

function fmtTime(s) {
  if (!Number.isFinite(s)) return '∞';
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class HUD {
  constructor(G) {
    this.G = G;
    this.root = null;
    this._subs = null;
    this._feed = [];
    this._hitT = 0;
    this._popT = 0;
    this._countT = 0;
    this._dmg = [];
    this._cache = {};
    this._boardAt = 0;
  }

  _build() {
    if (this.root) return;
    if (!document.getElementById('sh-style')) {
      const st = document.createElement('style');
      st.id = 'sh-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    const host = document.getElementById('hud') || document.body;
    const r = document.createElement('div');
    r.className = 'sh-root';
    r.hidden = true;
    r.innerHTML = `
      <div class="sh-vig"></div>
      <div class="sh-scope"></div>
      <div class="sh-dmg">${'<i></i>'.repeat(4)}</div>
      <div class="sh-cross"><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="d"></i></div>
      <div class="sh-hit"></div>
      <div class="sh-top"><div class="sh-team a">0</div><div class="sh-time">0:00</div><div class="sh-team b">0</div></div>
      <div class="sh-feed"></div>
      <div class="sh-center"><div class="sh-count"></div><div class="sh-msg"></div></div>
      <div class="sh-pop"></div>
      <div class="sh-hp"><div class="n">100</div><div class="bar"><div class="fill"></div></div></div>
      <div class="sh-ammo"><div class="w">—</div><b>0</b> <span>/ 0</span><div class="rl"></div></div>
      <div class="sh-board" hidden></div>`;
    host.appendChild(r);
    const q = (s) => r.querySelector(s);
    this.el = {
      cross: q('.sh-cross'), l: q('.sh-cross .l'), r: q('.sh-cross .r'), t: q('.sh-cross .t'), b: q('.sh-cross .b'), d: q('.sh-cross .d'),
      hit: q('.sh-hit'), teamA: q('.sh-team.a'), teamB: q('.sh-team.b'), time: q('.sh-time'), feed: q('.sh-feed'),
      count: q('.sh-count'), msg: q('.sh-msg'), pop: q('.sh-pop'), hp: q('.sh-hp'), hpN: q('.sh-hp .n'), hpFill: q('.sh-hp .fill'),
      ammo: q('.sh-ammo'), ammoW: q('.sh-ammo .w'), ammoM: q('.sh-ammo b'), ammoR: q('.sh-ammo span'), reload: q('.sh-ammo .rl'),
      vig: q('.sh-vig'), scope: q('.sh-scope'), board: q('.sh-board'), dmg: [...r.querySelectorAll('.sh-dmg i')],
    };
    this.root = r;
  }

  attach(G) {
    this.G = G;
    this.detach();
    this._build();
    this._feed = [];
    this.el.feed.innerHTML = '';
    const s = (this._subs = G.events.scope());
    s.on('actor:hit', ({ attacker, killed, zone }) => {
      if (!attacker || !attacker.isPlayer) return;
      this._hitT = killed ? 0.35 : 0.18;
      this.el.hit.classList.toggle('kill', !!killed || zone === 'head');
    });
    s.on('kill', (e) => this._onKill(e));
    s.on('score', ({ actor, points, reason }) => {
      if (!actor || !actor.isPlayer) return;
      const label = { kill: 'Abschuss', headshot: 'Kopfschuss', assist: 'Assist', firstblood: 'Erstes Blut', longshot: 'Weitschuss', revenge: 'Rache' }[reason] || '';
      this.el.pop.textContent = `+${points} ${label}`;
      this._popT = 1.2;
    });
    s.on('player:damaged', ({ dir }) => this._damageDir(dir));
    s.on('match:countdown', ({ value }) => {
      this.el.count.textContent = value > 0 ? String(value) : 'Los!';
      this._countT = value > 0 ? 1.1 : 0.8;
    });
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
  }

  show() { this._build(); this.root.hidden = false; }
  hide() { if (this.root) this.root.hidden = true; }

  _onKill({ victim, killer, weaponId, headshot }) {
    const G = this.G;
    const cls = (a) => (a && a.isPlayer ? 'me' : a && a.team === 'B' ? 'b' : a && a.team === 'A' ? 'a' : 'b');
    const W = G.data && G.data.WEAPONS;
    const wname = weaponId && W && W[weaponId] ? W[weaponId].name : weaponId === 'frag' ? 'Splittergranate' : weaponId === 'semtex' ? 'Haftgranate' : weaponId === 'world' ? 'Umgebung' : weaponId === 'fall' ? 'Sturz' : weaponId || '';
    const row = document.createElement('div');
    row.innerHTML = killer && killer !== victim
      ? `<span class="${cls(killer)}">${esc(killer.name)}</span> <span class="wpn">[${esc(wname)}${headshot ? ' · Kopf' : ''}]</span> <span class="${cls(victim)}">${esc(victim.name)}</span>`
      : `<span class="${cls(victim)}">${esc(victim.name)}</span> <span class="wpn">[${esc(wname || 'Selbst')}]</span>`;
    this.el.feed.prepend(row);
    this._feed.unshift({ row, t: 5 });
    while (this._feed.length > 5) this._feed.pop().row.remove();
  }

  _damageDir(dir) {
    const G = this.G;
    const p = G.player;
    if (!dir || !p) return;
    // Richtung, aus der der Schuss kam (entgegen dir), relativ zur Blickrichtung
    const ang = Math.atan2(-dir.x, -dir.z);
    const rel = ang - p.yaw;
    const deg = (-rel * 180) / Math.PI + 180;
    const slot = this._dmg.length % this.el.dmg.length;
    const el = this.el.dmg[slot];
    el.style.transform = `rotate(${deg}deg)`;
    el.style.transition = 'none';
    el.style.opacity = '1';
    void el.offsetWidth;
    el.style.transition = 'opacity 1.2s';
    el.style.opacity = '0';
    this._dmg.push(1);
  }

  update(dt) {
    if (!this.root || this.root.hidden) return;
    const G = this.G;
    const p = G.player;
    const w = p && p.weapon;
    const el = this.el;
    const set = (k, v, fn) => { if (this._cache[k] !== v) { this._cache[k] = v; fn(v); } };

    // Fadenkreuz
    const cam = G.camera;
    const spread = w ? w.spread || 0 : 0.03;
    const px = cam ? (Math.tan(spread) / Math.tan((cam.fov * Math.PI) / 360)) * (window.innerHeight / 2) : 10;
    const gap = Math.max(4, Math.min(80, px));
    const ads = w ? w.adsProgress || 0 : 0;
    const style = G.settings.get('crosshairStyle');
    const hideCross = ads > 0.6 || !p || !p.alive || (w && w.isSwitching) || (p && p.sprinting);
    el.cross.style.opacity = hideCross ? '0' : '1';
    el.cross.style.setProperty('--sh-cc', G.settings.get('crosshairColor'));
    el.cross.classList.toggle('is-enemy', !!(G.input && G.input.aimTarget));
    const showLines = style !== 'dot';
    for (const k of ['l', 'r', 't', 'b']) el[k].style.display = showLines ? '' : 'none';
    el.l.style.transform = `translate(${-gap - 10}px,0)`;
    el.r.style.transform = `translate(${gap}px,0)`;
    el.t.style.transform = `translate(0,${-gap - 10}px)`;
    el.b.style.transform = `translate(0,${gap}px)`;
    el.d.style.display = style === 'cross' ? 'none' : '';

    // Treffermarker / Popup / Countdown
    this._hitT = Math.max(0, this._hitT - dt);
    el.hit.style.opacity = this._hitT > 0 ? '1' : '0';
    this._popT = Math.max(0, this._popT - dt);
    el.pop.style.opacity = this._popT > 0 ? '1' : '0';
    this._countT = Math.max(0, this._countT - dt);
    if (this._countT <= 0 && el.count.textContent) el.count.textContent = '';

    // Leben
    if (p) {
      const hp = Math.max(0, Math.round(p.health));
      set('hp', hp, (v) => {
        el.hpN.textContent = String(v);
        el.hpFill.style.transform = `scaleX(${v / (p.maxHealth || 100)})`;
        el.hp.classList.toggle('low', v < 35);
      });
      el.vig.style.opacity = p.alive ? String(Math.max(0, (60 - p.health) / 60) * 0.9) : '0';
    }

    // Munition
    if (w && w.current) {
      const st = w.current;
      const def = st.def;
      set('wname', def.name, (v) => { el.ammoW.textContent = v; });
      set('mag', def.cls === 'melee' ? '—' : String(st.mag), (v) => { el.ammoM.textContent = v; });
      const lethal = w.equipment && w.equipment.lethal;
      set('res', `/ ${def.cls === 'melee' ? '—' : st.reserve}${lethal && lethal.id ? `  ·  ${lethal.count}× Granate` : ''}`, (v) => { el.ammoR.textContent = v; });
      set('low', def.mag > 0 && st.mag <= Math.ceil(def.mag * 0.25), (v) => el.ammo.classList.toggle('low', v));
      const hint = w.isReloading ? 'NACHLADEN …' : def.mag > 0 && st.mag === 0 ? (st.reserve > 0 ? 'NACHLADEN' : 'KEINE MUNITION') : '';
      set('hint', hint, (v) => { el.reload.textContent = v; });
    }
    const vm = G.viewmodel && G.viewmodel.rig;
    el.scope.style.opacity = vm && vm.showScopeOverlay ? '1' : '0';

    // Stand + Zeit
    const mode = G.mode;
    if (mode) {
      if (mode.teams || (mode.scores && 'A' in mode.scores)) {
        const mine = p && p.team === 'B' ? 'B' : 'A';
        const other = mine === 'A' ? 'B' : 'A';
        set('sA', mode.scores[mine] || 0, (v) => { el.teamA.textContent = String(v); });
        set('sB', mode.scores[other] || 0, (v) => { el.teamB.textContent = String(v); });
      } else if (p) {
        const rows = mode.scoreboard();
        const mineRow = rows.find((r) => r.actor === p);
        const lead = rows.find((r) => r.actor !== p);
        set('sA', mineRow ? mineRow.kills : 0, (v) => { el.teamA.textContent = String(v); });
        set('sB', lead ? lead.kills : 0, (v) => { el.teamB.textContent = String(v); });
      }
      set('time', fmtTime(mode.timeLeft), (v) => { el.time.textContent = v; });
    }

    // Wiedereinstieg
    let msg = '';
    if (p && !p.alive && G.match.state === 'playing') {
      const left = p.respawnAt != null ? Math.max(0, p.respawnAt - G.time.elapsed) : 0;
      msg = `${p.killer ? `Ausgeschaltet von ${esc(p.killer.name)}` : 'Ausgeschaltet'}<small>Wiedereinstieg in ${left.toFixed(1).replace('.', ',')} s</small>`;
    }
    set('msg', msg, (v) => { el.msg.innerHTML = v; });

    // Abschussmeldungen ausblenden
    for (let i = this._feed.length - 1; i >= 0; i--) {
      const f = this._feed[i];
      f.t -= dt;
      if (f.t < 1) f.row.style.opacity = String(Math.max(0, f.t));
      if (f.t <= 0) { f.row.remove(); this._feed.splice(i, 1); }
    }

    // Punktetabelle
    const showBoard = !!(G.input && G.input.down('scoreboard')) && mode;
    el.board.hidden = !showBoard;
    if (showBoard && performance.now() - this._boardAt > 250) {
      this._boardAt = performance.now();
      const rows = mode.scoreboard();
      el.board.innerHTML = `<table><tr><th>Name</th><th>Punkte</th><th>A</th><th>T</th><th>U</th></tr>${rows.map((r) => `<tr class="${r.actor && r.actor.isPlayer ? 'me' : r.team === 'B' ? 'b' : 'a'}"><td>${esc(r.name)}</td><td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td></tr>`).join('')}</table>`;
    }
  }
}
