// NULLPUNKT — Fahrzeug-HUD (deutsch, minimal): Einsteige-Hinweis, Fahrzeugtafel (Zustand, Zonen, Tempo, Waffen mit
// Munition/Nachladebalken, Sitzliste), Optik-Strichplatte mit Vergrößerung, Rohr-Marker (wohin das Rohr wirklich
// zeigt), Treffer-/Schadensblitz, Warnungen und die Touch-Knöpfe fürs Fahren. Eigene Styles (kein game.css-Eingriff).
// DOM-Schreibzugriffe nur bei Änderung (zwischengespeicherte Werte) – kein Layout je Bild.
import * as THREE from 'three';

const CSS = `
.vh-root{position:absolute;inset:0;pointer-events:none;font-family:var(--font-hud,system-ui,sans-serif);color:var(--np-ink,#e9e6df);z-index:4}
.vh-root[hidden]{display:none}
.vh-prompt{position:absolute;left:50%;bottom:26%;transform:translateX(-50%);padding:6px 14px;border-radius:4px;background:rgba(10,11,13,.62);font-size:16px;font-weight:600;letter-spacing:.04em;white-space:nowrap;text-shadow:0 1px 2px #000}
.vh-prompt kbd{display:inline-block;min-width:20px;padding:0 6px;margin-right:8px;border:1.5px solid currentColor;border-radius:3px;font:inherit;text-align:center}
.vh-panel{position:absolute;right:calc(18px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));width:300px;padding:10px 12px 9px;border-radius:6px;background:linear-gradient(180deg,rgba(10,11,13,.66),rgba(10,11,13,.48));box-shadow:0 2px 14px rgba(0,0,0,.35);text-shadow:0 1px 2px rgba(0,0,0,.8)}
.vh-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.vh-name{font-size:17px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.vh-speed{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.vh-speed small{font-size:12px;opacity:.7;margin-left:3px}
.vh-hp{position:relative;height:8px;margin:6px 0 2px;border-radius:2px;background:rgba(233,230,223,.16);overflow:hidden}
.vh-hp i{position:absolute;inset:0 auto 0 0;width:100%;background:#d9d4c8;transform-origin:left;transition:background .2s}
.vh-hp.is-low i{background:#ffc23d}.vh-hp.is-crit i{background:#e2492f}
.vh-hpn{font-size:12px;opacity:.8;font-variant-numeric:tabular-nums}
.vh-zones{display:flex;gap:4px;margin:6px 0}
.vh-zone{flex:1;padding:2px 0;border-radius:3px;font-size:11px;font-weight:600;letter-spacing:.05em;text-align:center;background:rgba(233,230,223,.12)}
.vh-zone.is-hit{background:rgba(255,194,61,.32);color:#ffe2a0}.vh-zone.is-broken{background:rgba(226,73,47,.5);color:#fff}
.vh-weps{display:flex;flex-direction:column;gap:3px;margin-top:4px}
.vh-wep{position:relative;display:flex;justify-content:space-between;gap:6px;padding:3px 6px;border-radius:3px;font-size:13px;opacity:.55;overflow:hidden}
.vh-wep.is-sel{opacity:1;background:rgba(233,230,223,.12)}
.vh-wep b{font-weight:600;z-index:1}.vh-wep span{font-variant-numeric:tabular-nums;z-index:1}
.vh-wep i{position:absolute;left:0;bottom:0;height:2px;width:100%;background:#ffc23d;transform-origin:left;transform:scaleX(0)}
.vh-seats{margin-top:6px;font-size:12px;opacity:.85;line-height:1.35}
.vh-seats .is-me{color:#ffc23d;font-weight:700}
.vh-hint{margin-top:5px;font-size:11px;opacity:.6}
.vh-warn{position:absolute;left:50%;top:22%;transform:translateX(-50%);padding:5px 12px;border-radius:4px;background:rgba(160,30,15,.62);font-size:16px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.vh-warn[hidden],.vh-prompt[hidden],.vh-ret[hidden],.vh-gun[hidden],.vh-zoom[hidden],.vh-panel[hidden]{display:none}
.vh-ret{position:absolute;left:50%;top:50%;width:0;height:0}
.vh-ret svg{position:absolute;left:-160px;top:-160px;width:320px;height:320px;overflow:visible;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.9))}
.vh-gun{position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid rgba(255,194,61,.95);border-radius:2px;box-shadow:0 0 2px #000;will-change:transform}
.vh-gun.is-mg{width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%}
.vh-gun.is-off{border-color:rgba(233,230,223,.5)}
.vh-zoom{position:absolute;left:50%;top:calc(50% + 120px);transform:translateX(-50%);font-size:14px;font-weight:700;letter-spacing:.08em;opacity:.85}
.vh-hit{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0;transition:opacity .25s}
.vh-hit.is-on{opacity:1;transition:none}
.vh-hit::before,.vh-hit::after{content:"";position:absolute;left:50%;top:0;width:3px;height:100%;margin-left:-1.5px;background:#ffc23d;transform:rotate(45deg);box-shadow:0 0 2px #000}
.vh-hit::after{transform:rotate(-45deg)}
.vh-dmg{position:absolute;inset:0;box-shadow:inset 0 0 90px rgba(226,73,47,.0);transition:box-shadow .4s}
.vh-dmg.is-on{box-shadow:inset 0 0 90px rgba(226,73,47,.55);transition:none}
.vh-scope{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 34%,rgba(0,0,0,.55) 46%,rgba(0,0,0,.92) 60%)}
.vh-scope[hidden]{display:none}
body[data-vehicle] .h-cross,body[data-vehicle] .h-weapon,body[data-vehicle] .h-equip,body[data-vehicle] .h-streaks,body[data-vehicle] .h-scope,body[data-vehicle] .h-cook,body[data-vehicle] .h-gunlead{display:none!important}
body[data-input-mode="touch"] .vh-panel{width:236px;padding:7px 9px;right:auto;left:calc(50% - 118px);bottom:auto;top:calc(10px + env(safe-area-inset-top))}
body[data-input-mode="touch"] .vh-hint,body[data-input-mode="touch"] .vh-prompt kbd{display:none}
body[data-input-mode="touch"] .vh-name{font-size:14px}body[data-input-mode="touch"] .vh-speed{font-size:17px}
body[data-input-mode="touch"] .vh-wep{font-size:12px;padding:2px 5px}body[data-input-mode="touch"] .vh-seats{display:none}
.vc-btn{display:none;font:700 calc(var(--tc-u,1px)*13) var(--font-hud,system-ui);letter-spacing:.04em;text-transform:uppercase;text-align:center;line-height:1.05}
body[data-vehicle] .vc-btn.vc-in{display:grid}
body[data-vehicle-near]:not([data-vehicle]) .vc-enter{display:grid}
.vc-enter{--s:78;left:50%;margin-left:calc(max(44px,calc(var(--tc-u)*78))/-2);bottom:calc(34% + env(safe-area-inset-bottom));border-color:rgba(255,194,61,.85);background:rgba(255,194,61,.18)}
.vc-exit{--s:58;right:calc(2.2% + env(safe-area-inset-right));bottom:calc(46% + env(safe-area-inset-bottom))}
.vc-cam{--s:52;right:calc(2.2% + env(safe-area-inset-right));bottom:calc(4% + env(safe-area-inset-bottom))}
.vc-seat{--s:48;right:calc(6.5% + var(--tc-u) * 110 + env(safe-area-inset-right));bottom:calc(52% + env(safe-area-inset-bottom))}
.vc-light{--s:44;right:calc(6.5% + var(--tc-u) * 178 + env(safe-area-inset-right));bottom:calc(9% + env(safe-area-inset-bottom))}
.vc-gas{--s:62;left:calc(3% + env(safe-area-inset-left));bottom:calc(58% + env(safe-area-inset-bottom));border-radius:14px}
.vc-brake{--s:56;left:calc(3% + env(safe-area-inset-left) + var(--tc-u) * 70);bottom:calc(60% + env(safe-area-inset-bottom));border-radius:14px}
body[data-vehicle] .tc-jump,body[data-vehicle] .tc-crouch,body[data-vehicle] .tc-grenade,body[data-vehicle] .tc-tactical,body[data-vehicle] .tc-melee,body[data-vehicle] .tc-reload,body[data-vehicle] .tc-lean-l,body[data-vehicle] .tc-lean-r,body[data-vehicle] .tc-light,body[data-vehicle] .tc-streaks,body[data-vehicle] .tc-adsfire,body[data-vehicle] .tc-fire-l{display:none!important}
body[data-vehicle][data-vehicle-arms="0"] .tc-fire-r,body[data-vehicle][data-vehicle-arms="0"] .tc-ads,body[data-vehicle][data-vehicle-arms="0"] .tc-swap{display:none!important}
`;

const TANK_RET = `<svg viewBox="-160 -160 320 320" fill="none" stroke="#f2efe6" stroke-width="1.6">
<path d="M-150 0H-26M26 0H150M0 26V120"/><path d="M-10 14L0 4L10 14" stroke-width="2"/>
<path d="M-60 -4V4M-100 -4V4M60 -4V4M100 -4V4"/>
<g stroke-width="1.2"><path d="M-14 38H14M-10 58H10M-14 78H14M-10 98H10"/></g>
<g fill="#f2efe6" stroke="none" font-size="10" font-family="system-ui,sans-serif"><text x="18" y="42">4</text><text x="18" y="82">8</text><text x="16" y="122">12</text></g>
</svg>`;
const MG_RET = `<svg viewBox="-160 -160 320 320" fill="none" stroke="#f2efe6" stroke-width="1.6">
<circle r="22"/><path d="M-40 0H-8M8 0H40M0 -40V-8M0 8V40"/><circle r="1.6" fill="#f2efe6"/></svg>`;
const TP_RET = `<svg viewBox="-160 -160 320 320" fill="none" stroke="#f2efe6" stroke-width="1.8">
<path d="M-18 0H-6M6 0H18M0 -18V-6M0 6V18"/><circle r="1.6" fill="#f2efe6" stroke="none"/></svg>`;

const TOUCH = [
  ['vc-enter', 'v_enter', 'Ein-<br>steigen', false],
  ['vc-exit', 'v_exit', 'Aus-<br>steigen', true],
  ['vc-cam', 'v_camera', 'Kamera', true],
  ['vc-seat', 'v_seat', 'Sitz', true],
  ['vc-light', 'v_light', 'Licht', true],
  ['vc-gas', 'v_gas', 'Gas', true],
  ['vc-brake', 'v_brake', 'Brem-<br>se', true],
];

const _v = new THREE.Vector3();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt1 = (x) => x.toFixed(1).replace('.', ',');

export class VehicleHUD {
  constructor(G) {
    this.G = G;
    this._c = {};
    this._hitT = 0;
    this._dmgT = 0;
    if (!document.getElementById('vehicle-hud-css')) {
      const st = document.createElement('style');
      st.id = 'vehicle-hud-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const host = document.getElementById('hud') || document.body;
    const root = document.createElement('div');
    root.className = 'vh-root';
    root.innerHTML = `
      <div class="vh-scope" hidden></div>
      <div class="vh-dmg"></div>
      <div class="vh-ret" hidden></div>
      <div class="vh-gun" hidden></div>
      <div class="vh-hit"></div>
      <div class="vh-zoom" hidden></div>
      <div class="vh-warn" hidden></div>
      <div class="vh-prompt" hidden></div>
      <div class="vh-panel" hidden>
        <div class="vh-head"><span class="vh-name"></span><span class="vh-speed"></span></div>
        <div class="vh-hp"><i></i></div><div class="vh-hpn"></div>
        <div class="vh-zones"></div>
        <div class="vh-weps"></div>
        <div class="vh-seats"></div>
        <div class="vh-hint"></div>
      </div>`;
    host.appendChild(root);
    this.root = root;
    const q = (s) => root.querySelector(s);
    this.el = {
      scope: q('.vh-scope'), dmg: q('.vh-dmg'), ret: q('.vh-ret'), gun: q('.vh-gun'), hit: q('.vh-hit'), zoom: q('.vh-zoom'),
      warn: q('.vh-warn'), prompt: q('.vh-prompt'), panel: q('.vh-panel'), name: q('.vh-name'), speed: q('.vh-speed'),
      hp: q('.vh-hp'), hpBar: q('.vh-hp i'), hpn: q('.vh-hpn'), zones: q('.vh-zones'), weps: q('.vh-weps'), seats: q('.vh-seats'), hint: q('.vh-hint'),
    };
    // Touch-Knöpfe (input.js verarbeitet .tc-btn[data-action] selbst)
    this.touch = [];
    const tui = document.getElementById('touch-ui');
    if (tui) {
      for (const [cls, action, label, inVeh] of TOUCH) {
        const b = document.createElement('div');
        b.className = `tc-btn vc-btn ${cls}${inVeh ? ' vc-in' : ''}`;
        b.dataset.action = action;
        b.setAttribute('role', 'button');
        b.setAttribute('aria-label', label.replace('-<br>', ''));
        b.innerHTML = `<span>${label}</span>`;
        tui.appendChild(b);
        this.touch.push(b);
      }
    }
  }

  _set(key, el, prop, val) {
    if (this._c[key] === val) return;
    this._c[key] = val;
    if (prop === 'hidden') el.hidden = !!val;
    else if (prop === 'html') el.innerHTML = val;
    else if (prop === 'text') el.textContent = val;
    else if (prop === 'class') el.className = val;
    else if (prop === 'transform') el.style.transform = val;
    else if (prop === 'width') el.style.transform = `scaleX(${val})`;
  }

  _body(key, val) {
    const b = document.body.dataset;
    if (this._c['b:' + key] === val) return;
    this._c['b:' + key] = val;
    if (val == null) delete b[key]; else b[key] = val;
  }

  hit() { this._hitT = 0.18; }
  damaged() { this._dmgT = 0.35; }

  /**
   * s = { seated, vehicle, seat, sight, zoom, camera, keyFor(action), near: { vehicle, seatLabel } | null, gunScreen: {x,y,on}|null, touch }
   */
  update(dt, s) {
    const el = this.el;
    this._hitT = Math.max(0, this._hitT - dt);
    this._dmgT = Math.max(0, this._dmgT - dt);
    this._set('hit', el.hit, 'class', this._hitT > 0 ? 'vh-hit is-on' : 'vh-hit');
    this._set('dmg', el.dmg, 'class', this._dmgT > 0 ? 'vh-dmg is-on' : 'vh-dmg');
    const playing = s.visible !== false;
    this._set('root', this.root, 'hidden', !playing);
    // Einsteigen
    if (!s.seated && s.near && playing) {
      const key = s.keyFor('interact');
      this._set('prompt', el.prompt, 'html', `${key ? `<kbd>${esc(key)}</kbd>` : ''}Einsteigen · ${esc(s.near.vehicle.name)} <span style="opacity:.7">(${esc(s.near.seatLabel)})</span>`);
      this._set('promptH', el.prompt, 'hidden', false);
      this._body('vehicleNear', '1');
    } else {
      this._set('promptH', el.prompt, 'hidden', true);
      this._body('vehicleNear', null);
    }
    if (!s.seated) {
      this._body('vehicle', null);
      this._body('vehicleArms', null);
      this._set('panelH', el.panel, 'hidden', true);
      this._set('retH', el.ret, 'hidden', true);
      this._set('gunH', el.gun, 'hidden', true);
      this._set('zoomH', el.zoom, 'hidden', true);
      this._set('warnH', el.warn, 'hidden', true);
      this._set('scopeH', el.scope, 'hidden', true);
      return;
    }
    const v = s.vehicle, seat = s.seat;
    this._body('vehicle', v.type);
    this._body('vehicleArms', seat.weapons.length ? '1' : '0');
    this._set('panelH', el.panel, 'hidden', false);
    this._set('name', el.name, 'text', v.name);
    this._set('speed', el.speed, 'html', `${Math.round(Math.abs(v.body.speed) * 3.6)}<small>km/h</small>`);
    const hpf = Math.max(0, v.health / v.maxHealth);
    this._set('hpw', el.hpBar, 'width', hpf.toFixed(3));
    this._set('hpc', el.hp, 'class', `vh-hp${hpf < 0.2 ? ' is-crit' : hpf < 0.45 ? ' is-low' : ''}`);
    this._set('hpn', el.hpn, 'text', `${Math.ceil(v.health)} / ${v.maxHealth}`);
    let zh = '';
    for (const z of Object.values(v.zones)) {
      const f = z.hp / z.max;
      zh += `<span class="vh-zone${f <= 0 ? ' is-broken' : f < 0.6 ? ' is-hit' : ''}">${esc(z.label)}</span>`;
    }
    this._set('zones', el.zones, 'html', zh);
    // Waffen
    let wh = '';
    seat.weapons.forEach((w, i) => {
      const sel = i === seat.weaponIndex;
      let txt;
      if (w.reloadT > 0) txt = `lädt ${fmt1(w.reloadT)} s`;
      else if (w.def.kind === 'shell') txt = 'geladen';
      else txt = `${w.mag}/${w.def.mag}`;
      const prog = w.reloadT > 0 ? (Math.round((1 - w.reloadT / w.def.reload) * 20) / 20).toFixed(2) : '0';
      wh += `<div class="vh-wep${sel ? ' is-sel' : ''}"><b>${esc(w.def.name)}</b><span>${txt}</span><i style="transform:scaleX(${prog})"></i></div>`;
    });
    if (!seat.weapons.length) wh = `<div class="vh-wep is-sel"><b>${esc(seat.def.label)}</b><span>keine Waffe</span></div>`;
    this._set('weps', el.weps, 'html', wh);
    // Sitze
    let sh = '';
    v.seats.forEach((st, i) => {
      const who = st.actor ? (st.actor === this.G.player ? 'Du' : esc(st.actor.name || 'besetzt')) : 'frei';
      sh += `<div class="${st.actor === this.G.player ? 'is-me' : ''}">${i + 1} · ${esc(st.def.label)} – ${who}</div>`;
    });
    this._set('seats', el.seats, 'html', sh);
    const k = s.keyFor;
    const hint = [`${k('interact') || 'F'} Aussteigen`, `${k('crouch') || 'C'} Kamera`];
    if (seat.weapons.length > 1) hint.push(`${k('swap') || 'Mausrad'} Waffe`);
    if (seat.def.drive) hint.push(`${k('jump') || 'Leertaste'} Handbremse`, `${k('light') || 'T'} Licht`);
    this._set('hint', el.hint, 'text', hint.join(' · '));
    // Warnungen
    let warn = '';
    if (v.disabled) warn = 'Fahrzeug brennt – Aussteigen!';
    else if (v.zones.tracks && v.zones.tracks.hp <= 0) warn = v.body.mods.immobile ? (v.type === 'mbt' ? 'Kette zerstört – bewegungsunfähig' : 'Räder zerstört – bewegungsunfähig') : 'Fahrwerk beschädigt';
    else if (v.zones.engine && v.zones.engine.hp <= 0) warn = 'Motor beschädigt';
    else if (v.zones.turret && v.zones.turret.hp <= 0) warn = 'Turm beschädigt – Schwenken verlangsamt';
    this._set('warn', el.warn, 'text', warn);
    this._set('warnH', el.warn, 'hidden', !warn);
    // Strichplatte
    const w = seat.weapons[seat.weaponIndex];
    const mount = !!seat.def.mount && !!w;
    const ret = !mount ? '' : s.sight ? (w.def.kind === 'shell' ? TANK_RET : MG_RET) : TP_RET;
    this._set('ret', el.ret, 'html', ret);
    this._set('retH', el.ret, 'hidden', !ret);
    this._set('scopeH', el.scope, 'hidden', !(mount && s.zoom > 1.3));
    this._set('zoomH', el.zoom, 'hidden', !(mount && s.zoom > 1.05));
    this._set('zoomT', el.zoom, 'text', `${fmt1(s.zoom)}×`);
    const g = s.gunScreen;
    if (mount && g && g.on) {
      this._set('gunH', el.gun, 'hidden', false);
      this._set('gunC', el.gun, 'class', `vh-gun${w.def.kind === 'mg' ? ' is-mg' : ''}${g.ready ? '' : ' is-off'}`);
      this._set('gunT', el.gun, 'transform', `translate3d(${Math.round(g.x)}px,${Math.round(g.y)}px,0)`);
    } else this._set('gunH', el.gun, 'hidden', true);
  }

  dispose() {
    this._body('vehicle', null);
    this._body('vehicleNear', null);
    this._body('vehicleArms', null);
    this.root.remove();
    for (const b of this.touch) b.remove();
    this.touch = [];
  }
}

/** Weltpunkt → CSS-Pixel (mit Objektiv-Abbildung, falls vorhanden). */
export function projectToScreen(G, p, out = { x: 0, y: 0, on: false }) {
  const cam = G.camera;
  _v.copy(p).project(cam);
  out.on = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
  const lens = G.renderer && G.renderer.lens;
  let x = _v.x, y = _v.y;
  if (lens && typeof lens.toScreen === 'function') {
    try { const r = lens.toScreen({ x, y }); if (r && Number.isFinite(r.x)) { x = r.x; y = r.y; } } catch { /* Identität */ }
  }
  const w = (G.renderer && G.renderer.width) || window.innerWidth;
  const h = (G.renderer && G.renderer.height) || window.innerHeight;
  out.x = (x * 0.5 + 0.5) * w;
  out.y = (-y * 0.5 + 0.5) * h;
  return out;
}
