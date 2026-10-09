// NULLPUNKT — Antriebsanzeige im Fahrzeug-HUD (docs/planung/panzer-mp.md §A.6): Gangleiste (R2 R1 N 1 … 5, aktueller
// Gang hervorgehoben, Zielgang blinkt beim Schalten; Automatik mit „A“), Drehzahlbalken 0 … Abregeldrehzahl mit grünem
// Drehmomentband und rotem Bereich über Nenndrehzahl, Getriebeart, Hinweise („Drehzahl zu niedrig – runterschalten“,
// „Erst anhalten“) und die Touch-Knöpfe „Gang +“/„Gang −“. Liest nur vehicle.body.drive (läuft auch auf Abbildern).
// Eigene Styles; DOM-Schreibzugriffe nur bei Änderung (wie VehicleHUD._set).
import { gearList, gearName } from './drivetrain.js';

const CSS = `
.vd-root{margin:5px 0 2px}
.vd-root[hidden]{display:none}
.vd-gears{display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.vd-gears span{min-width:19px;padding:1px 3px;border-radius:3px;text-align:center;opacity:.45;background:rgba(233,230,223,.08)}
.vd-gears span.is-on{opacity:1;color:#111;background:#ffc23d}
.vd-gears span.is-target{opacity:1;color:#ffc23d;box-shadow:inset 0 0 0 1.5px #ffc23d;animation:vd-blink .36s steps(2,start) infinite}
.vd-gears em{margin-left:auto;font-style:normal;font-size:11px;font-weight:600;letter-spacing:.04em;opacity:.75}
@keyframes vd-blink{to{visibility:hidden}}
.vd-rpm{position:relative;height:7px;margin:5px 0 1px;border-radius:2px;background:rgba(233,230,223,.14);overflow:hidden}
.vd-rpm i{position:absolute;top:0;bottom:0}
.vd-rpm .vd-band{background:rgba(93,196,104,.42)}
.vd-rpm .vd-red{right:0;background:rgba(226,73,47,.5)}
.vd-rpm b{position:absolute;inset:0 auto 0 0;width:100%;background:#e9e6df;transform-origin:left;transform:scaleX(0);opacity:.85}
.vd-rpm.is-red b{background:#e2492f}.vd-rpm.is-band b{background:#7fd88a}
.vd-row{display:flex;justify-content:space-between;gap:6px;font-size:11px;opacity:.85;font-variant-numeric:tabular-nums}
.vd-msg{color:#ffc23d;font-weight:700}
.vd-msg[hidden]{display:none}
.vd-hint{margin-top:3px;font-size:11px;opacity:.6}
body[data-input-mode="touch"] .vd-hint,body[data-input-mode="touch"] .vd-gears em{display:none}
body[data-input-mode="touch"] .vd-gears{font-size:11px}body[data-input-mode="touch"] .vd-gears span{min-width:15px;padding:0 2px}
@media (max-height:560px),(max-width:820px){body:not([data-input-mode="touch"]) .vd-hint{display:none}.vd-gears{font-size:11px}}
.vc-gear{display:none;--s:50;left:calc(3% + env(safe-area-inset-left) + var(--tc-u) * 134);border-radius:12px}
.vc-gear-up{bottom:calc(60% + var(--tc-u) * 28 + env(safe-area-inset-bottom))}
.vc-gear-down{bottom:calc(60% - var(--tc-u) * 28 + env(safe-area-inset-bottom))}
body[data-vehicle="mbt"][data-vehicle-drive="1"] .vc-gear{display:grid}
body[data-vehicle-gearbox="auto"] .vc-gear{display:none!important}
`;

const TOUCH = [
  ['vc-gear-up', 'v_gear_up', 'Gang +'],
  ['vc-gear-down', 'v_gear_down', 'Gang −'],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class DriveHUD {
  constructor(vehicleHud) {
    this.hud = vehicleHud;
    this.G = vehicleHud && vehicleHud.G;
    this._c = {};
    this._def = null;
    this._gearEls = new Map();
    this._msgT = 0;
    this._msg = '';
    if (!document.getElementById('vehicle-drive-css')) {
      const st = document.createElement('style');
      st.id = 'vehicle-drive-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const root = document.createElement('div');
    root.className = 'vd-root';
    root.hidden = true;
    root.innerHTML = `
      <div class="vd-gears"></div>
      <div class="vd-rpm"><i class="vd-band"></i><i class="vd-red"></i><b></b></div>
      <div class="vd-row"><span class="vd-rpmn"></span><span class="vd-msg" hidden></span></div>
      <div class="vd-hint"></div>`;
    const panel = vehicleHud && vehicleHud.el && vehicleHud.el.panel;
    const head = panel && panel.querySelector('.vh-head');
    if (head) head.after(root); else if (panel) panel.prepend(root);
    this.root = root;
    const q = (s) => root.querySelector(s);
    this.el = { gears: q('.vd-gears'), rpm: q('.vd-rpm'), band: q('.vd-band'), red: q('.vd-red'), bar: q('.vd-rpm b'), rpmn: q('.vd-rpmn'), msg: q('.vd-msg'), hint: q('.vd-hint') };
    // Touch-Knöpfe (input.js verarbeitet .tc-btn[data-action] selbst)
    this.touch = [];
    const tui = document.getElementById('touch-ui');
    if (tui) {
      for (const [cls, action, label] of TOUCH) {
        const b = document.createElement('div');
        b.className = `tc-btn vc-btn vc-gear ${cls}`;
        b.dataset.action = action;
        b.setAttribute('role', 'button');
        b.setAttribute('aria-label', label);
        b.innerHTML = `<span>${label}</span>`;
        tui.appendChild(b);
        this.touch.push(b);
      }
    }
    // Meldung bei verweigertem Richtungswechsel (eigenes Fahrzeug)
    this._off = this.G && this.G.events && typeof this.G.events.on === 'function'
      ? this.G.events.on('vehicle:gear', (e) => {
        if (!e || !e.blocked || !this._veh || e.vehicle !== this._veh) return;
        this._msg = 'Erst anhalten'; this._msgT = 1.6;
      })
      : null;
  }

  _set(key, el, prop, val) {
    if (this._c[key] === val) return;
    this._c[key] = val;
    if (prop === 'hidden') el.hidden = !!val;
    else if (prop === 'html') el.innerHTML = val;
    else if (prop === 'text') el.textContent = val;
    else if (prop === 'class') el.className = val;
    else if (prop === 'scale') el.style.transform = `scaleX(${val})`;
    else if (prop === 'left') el.style.left = val;
    else if (prop === 'width') el.style.width = val;
  }

  _body(key, val) {
    const b = document.body.dataset;
    if (this._c['b:' + key] === val) return;
    this._c['b:' + key] = val;
    if (val == null) delete b[key]; else b[key] = val;
  }

  /** Gangleiste und Drehzahlskala für ein Fahrzeugmuster aufbauen (einmal je Typ). */
  _build(def) {
    this._def = def;
    const E = def.engine || {};
    let h = '';
    for (const g of gearList(def)) h += `<span data-g="${g}">${esc(gearName(def, g))}</span>`;
    h += '<em></em>';
    this.el.gears.innerHTML = h;
    this._gearEls.clear();
    for (const sp of this.el.gears.querySelectorAll('span')) this._gearEls.set(+sp.dataset.g, sp);
    this._modeEl = this.el.gears.querySelector('em');
    this._c.gear = this._c.target = this._c.mode = undefined;
    const cut = E.cutRpm || E.ratedRpm || 1;
    const lo = (E.converter && E.converter.coupleRpm) || E.idleRpm || 0;
    const hi = (E.cruiseRpm || E.ratedRpm || cut) + 100;
    this.el.band.style.left = `${(lo / cut * 100).toFixed(1)}%`;
    this.el.band.style.width = `${(Math.max(0, hi - lo) / cut * 100).toFixed(1)}%`;
    this.el.red.style.width = `${(Math.max(0, cut - (E.ratedRpm || cut)) / cut * 100).toFixed(1)}%`;
    this._band = [lo, hi];
  }

  /** s wie VehicleHUD.update (seated, vehicle, seat, keyFor …). */
  update(dt, s) {
    this._msgT = Math.max(0, this._msgT - (dt || 0));
    const v = s && s.seated ? s.vehicle : null;
    const seat = s && s.seat;
    const D = v && v.body && v.body.drive;
    if (!v || !seat || !seat.def.drive || !D || s.visible === false) {
      this._veh = null;
      this._set('rootH', this.root, 'hidden', true);
      this._body('vehicleDrive', null);
      this._body('vehicleGearbox', null);
      return;
    }
    this._veh = v;
    if (this._def !== v.def) this._build(v.def);
    const E = v.def.engine || {};
    this._set('rootH', this.root, 'hidden', false);
    this._body('vehicleDrive', '1');
    const mode = D.gearbox === 'hold' ? 'hold' : 'auto';
    this._body('vehicleGearbox', mode);
    // Gangleiste
    const gear = D.gear | 0, target = D.targetGear | 0;
    const pending = D.shifting || target !== gear;
    if (this._c.gear !== gear || this._c.target !== (pending ? target : null)) {
      this._c.gear = gear; this._c.target = pending ? target : null;
      for (const [g, sp] of this._gearEls) sp.className = g === gear && !(D.shifting && g !== target) ? 'is-on' : pending && g === target ? 'is-target' : '';
    }
    if (this._modeEl) this._set('mode', this._modeEl, 'text', mode === 'hold' ? 'Gang halten' : 'A · Automatik');
    // Drehzahl
    const cut = E.cutRpm || E.ratedRpm || 1;
    const rpm = Math.max(0, +D.rpm || 0);
    this._set('bar', this.el.bar, 'scale', (Math.round(Math.min(1, rpm / cut) * 100) / 100).toFixed(2));
    const zone = rpm > (E.ratedRpm || cut) ? ' is-red' : rpm >= this._band[0] && rpm <= this._band[1] ? ' is-band' : '';
    this._set('rpmC', this.el.rpm, 'class', 'vd-rpm' + zone);
    this._set('rpmN', this.el.rpmn, 'text', rpm > 0 ? `${Math.round(rpm / 50) * 50} /min` : 'Motor aus');
    // Meldungen
    let msg = '';
    if (this._msgT > 0) msg = this._msg;
    else if (D.lugging) msg = 'Drehzahl zu niedrig – runterschalten';
    else if (D.slip > 0.35) msg = 'Ketten rutschen';
    this._set('msg', this.el.msg, 'text', msg);
    this._set('msgH', this.el.msg, 'hidden', !msg);
    // Tastenhinweis
    const k = typeof s.keyFor === 'function' ? s.keyFor : () => null;
    let hint;
    if (mode === 'hold') {
      const fw = k('move_forward'), bw = k('move_back');
      const shiftKeys = fw && bw ? `${fw}/${bw}` : 'Stick ▲/▼';
      const pad = [k('gear_up'), k('gear_down')].filter(Boolean).join('/');
      const lr = [k('move_left'), k('move_right')].filter(Boolean).join('/') || 'Stick';
      hint = `${shiftKeys}${pad && !fw ? ` oder ${pad}` : ''} tippen: schalten · ${fw || 'Stick'} halten: Vollgas · ${k('jump') || 'Leertaste'}: Bremse · N + ${lr}: drehen`;
    } else {
      hint = `${[k('move_forward'), k('move_back')].filter(Boolean).join('/') || 'Stick'} halten: fahren · ${k('jump') || 'Leertaste'}: ${v.body.tracked ? 'Bremse' : 'Handbremse'}`;
    }
    this._set('hint', this.el.hint, 'text', hint);
  }

  dispose() {
    if (this._off) { try { this._off(); } catch { /* egal */ } this._off = null; }
    this._body('vehicleDrive', null);
    this._body('vehicleGearbox', null);
    this.root.remove();
    for (const b of this.touch) b.remove();
    this.touch = [];
  }
}
