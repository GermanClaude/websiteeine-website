// NULLPUNKT — Fahrzeugsichten (panzer-mp.md §B.3/§3.5): Sichtdaten-Helfer (Räume hull/turret/gun/cupola/mg, Blick
// mount/rel/relTurret, Zoomstufen, Luke/Schutz je Sicht) und die DOM-Overlays je Sicht: Winkelspiegel (slit),
// Hauptzieloptik mit Strichplatte und Entfernungsmarken nach Ballistik (optic), Weitwinkel (wide), Rundblickperiskop
// mit Richtungsring (peri), Fernglas (binocular) und die Ladeschützen-Schrittanzeige (loader).
// Rein darstellend/rechnend – welche Sichten erlaubt sind und was die Luke bewirkt, entscheidet VehicleSystem.
//
// Sichtformat (data.js seats[].views):
//   { id, label, space: 'hull'|'turret'|'gun'|'cupola'|'mg', pos, look: 'mount'|'rel'|'relTurret', yaw, pitch, zoom,
//     overlay, exposed, hatch, pin, interior, tp: { dist, height, pivot } (nur 'aussen') }
// Sitze ohne views (alte Daten mit fp/tp) bekommen eine Ersatzliste (1P + aussen).
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const FULL = Math.PI * 2 - 0.02;

/** Weltrichtung aus Gier/Nicken (Gier 0 = −Z, positiv = links). */
export function dirFromYawPitch(yaw, pitch, out) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

const FALLBACK = new WeakMap();
/** Sichtliste eines Sitzes (data.js views; Ersatz aus fp/tp für alte Daten). */
export function viewsOf(sd) {
  if (sd.views && sd.views.length) return sd.views;
  let list = FALLBACK.get(sd);
  if (!list) {
    const fp = sd.fp || { space: 'hull', pos: [0, 1.6, 0] };
    const look = sd.mount ? 'mount' : 'rel';
    const space = fp.space === 'cmg' ? 'cupola' : fp.space === 'turret' ? 'gun' : fp.space || 'hull';
    list = [
      { id: 'sitz', label: 'Sitz', space, pos: fp.pos, look, yaw: [-2.1, 2.1], pitch: [-0.7, 0.75], zoom: fp.zoom || [1], exposed: !!sd.exposed },
      { id: 'aussen', label: 'Außenansicht', look, yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: sd.tp || { dist: 9, height: 3.6, pivot: 2 } },
    ];
    FALLBACK.set(sd, list);
  }
  return list;
}

/** Aktuelle Sicht eines Sitzes (Index seat.view, begrenzt). */
export function viewOf(seat, idx = seat.view) {
  const list = viewsOf(seat.def);
  return list[clamp(idx | 0, 0, list.length - 1)];
}
export const isTp = (view) => !!(view && view.tp);
/** Index der ersten 1P-Sicht (Ersatz für 'aussen'). */
export function firstFp(sd) { const i = viewsOf(sd).findIndex((v) => !v.tp); return i < 0 ? 0 : i; }
/** Letzte 1P-Sicht des Sitzes (bestimmt Schutz/Pin in der Außenansicht). */
export function fpViewOf(seat) {
  const list = viewsOf(seat.def);
  const cur = list[seat.view | 0];
  if (cur && !cur.tp) return cur;
  const last = list[seat._fpView ?? -1];
  return last && !last.tp ? last : list[firstFp(seat.def)];
}
/** Erste Optik-Sicht (für Zielen in der Außenansicht): Sicht mit Overlay optic/peri, sonst erste 1P-Sicht. */
export function opticIndex(sd) {
  const list = viewsOf(sd);
  const i = list.findIndex((v) => !v.tp && (v.overlay === 'optic' || v.overlay === 'peri' || v.look === 'mount'));
  return i < 0 ? firstFp(sd) : i;
}
/** Luke offen/verwundbar laut Sicht (Außenansicht: wie die letzte 1P-Sicht). */
export function viewExposed(seat) { const v = fpViewOf(seat); return !!(v && v.exposed); }

/** Vergrößerung einer Sicht: zi 0 = Grund, 1 = Zielen, 2 = Zielen + Wechsel. */
export function viewZoom(view, zi = 0) {
  const z = (view && view.zoom) || [1];
  return z[clamp(zi, 0, z.length - 1)] || 1;
}

/**
 * Punkt/Ausrichtung eines Sichtraums (lokal im Fahrzeug, ohne Wannenlage).
 * → outPos (lokal), outQuat (lokal, Ausrichtung des Raums inkl. Lafette)
 */
export function spaceLocal(vehicle, space, pos, outPos, outQuat) {
  const d = vehicle.def, m = vehicle.mount;
  outPos.fromArray(pos);
  switch (space) {
    case 'turret':
    case 'gun': {
      _q.setFromAxisAngle(Y, m.turretYaw);
      outPos.applyQuaternion(_q).add(_c.fromArray(d.turretPivot || [0, 0, 0]));
      if (outQuat) {
        outQuat.copy(_q);
        if (space === 'gun') outQuat.multiply(_q2.setFromAxisAngle(X, m.gunPitch));
      }
      return outPos;
    }
    case 'cupola': {
      _q.setFromAxisAngle(Y, m.turretYaw);
      outPos.add(_c.fromArray(d.cmgPivot || [0, 0, 0])).applyQuaternion(_q).add(_c.fromArray(d.turretPivot || [0, 0, 0]));
      if (outQuat) outQuat.setFromAxisAngle(Y, m.turretYaw + m.cmgYaw).multiply(_q2.setFromAxisAngle(X, m.cmgPitch));
      return outPos;
    }
    case 'mg': {
      _q.setFromAxisAngle(Y, m.mgYaw);
      outPos.applyQuaternion(_q).add(_c.fromArray(d.mgPivot || [0, 0, 0]));
      if (outQuat) outQuat.copy(_q).multiply(_q2.setFromAxisAngle(X, m.mgPitch));
      return outPos;
    }
    default:
      if (outQuat) outQuat.identity();
      return outPos;
  }
}

/** Kamera-Anker einer Sicht in Weltkoordinaten (Darstellungslage) + Ausrichtung des Raums. */
export function viewAnchor(vehicle, view, outPos, outQuat = null) {
  spaceLocal(vehicle, view.space || 'hull', view.pos || [0, 1.6, 0], _p, outQuat);
  if (outQuat) outQuat.premultiply(vehicle.body.renderQuat);
  return vehicle.body.toWorldRender(_p, outPos);
}

/** Pin (Füße) einer Sicht in Weltkoordinaten; Raum 'turret' dreht mit dem Turm. */
export function pinWorld(vehicle, view, pin, out, render = true) {
  const space = view.space === 'gun' ? 'turret' : view.space === 'cupola' || view.space === 'mg' ? 'hull' : view.space || 'hull';
  spaceLocal(vehicle, space, pin, _p, null);
  return render ? vehicle.body.toWorldRender(_p, out) : vehicle.body.toWorld(_p, out);
}

/** Blickrichtung (Welt) eines Sitzes in einer Sicht: mount = Weltgier/-nicken, rel = Wanne, relTurret = Turm. */
export function viewLookDir(vehicle, seat, view, out) {
  const L = seat.look;
  const look = (view && view.look) || (seat.def.mount ? 'mount' : 'rel');
  if (look === 'mount') return dirFromYawPitch(L.yaw, L.pitch, out);
  _e.set(L.relPitch, L.relYaw + (look === 'relTurret' ? vehicle.mount.turretYaw : 0), 0, 'YXZ');
  _q.setFromEuler(_e);
  return out.set(0, 0, -1).applyQuaternion(_q).applyQuaternion(vehicle.body.renderQuat);
}

/** Relativen Blick in die Grenzen der Sicht legen (volle Drehung: umlaufend). */
export function clampRelLook(L, view) {
  const yl = (view && view.yaw) || [-2.1, 2.1], pl = (view && view.pitch) || [-0.7, 0.75];
  L.relYaw = yl[1] - yl[0] >= FULL ? wrap(L.relYaw) : clamp(L.relYaw, yl[0], yl[1]);
  L.relPitch = clamp(L.relPitch, pl[0], pl[1]);
}

/** Welt-Gier/-Nicken → relativ zur Wanne bzw. zum Turm (beim Wechsel zwischen Blickarten). */
export function worldToRel(vehicle, look, dir, L) {
  _v.copy(dir).applyQuaternion(_q.copy(vehicle.body.renderQuat).invert());
  let yaw = Math.atan2(-_v.x, -_v.z);
  if (look === 'relTurret') yaw -= vehicle.mount.turretYaw;
  L.relYaw = wrap(yaw);
  L.relPitch = Math.asin(clamp(_v.y, -1, 1));
}

/* =================================================================== Overlays (DOM) */

export const VIEW_CSS = `
.vo{position:absolute;inset:0;pointer-events:none}
.vo[hidden],.vo>*[hidden]{display:none}
.vo-slit,.vo-bino{position:absolute;inset:0;width:100%;height:100%}
.vo-optic{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 41vmin,rgba(0,0,0,.94) 43vmin,#000 70vmin)}
.vo-optic::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(40,70,40,.0) 0,rgba(30,45,30,.18) 41vmin,transparent 42vmin)}
.vo-ret{position:absolute;left:50%;top:50%;width:0;height:0}
.vo-ret svg{position:absolute;left:-200px;top:-200px;width:400px;height:400px;overflow:visible;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.9))}
.vo-marks{position:absolute;inset:0}
.vo-mark{position:absolute;left:0;top:0;width:34px;height:0;margin-left:-17px;border-top:1.6px solid #f2efe6;box-shadow:0 0 2px #000;will-change:transform}
.vo-mark b{position:absolute;left:40px;top:-8px;font:600 12px var(--font-hud,system-ui);color:#f2efe6;text-shadow:0 1px 2px #000}
.vo-mark.is-s{width:18px;margin-left:-9px}.vo-mark.is-s b{left:24px}
.vo-ammo{position:absolute;left:50%;top:calc(50% + 34vmin);transform:translateX(-50%);font:700 14px var(--font-hud,system-ui);letter-spacing:.12em;color:#f2efe6;text-shadow:0 1px 2px #000}
.vo-range{position:absolute;left:calc(50% + 14vmin);top:calc(50% + 30vmin);font:700 14px var(--font-hud,system-ui);letter-spacing:.06em;color:#ffc23d;text-shadow:0 1px 2px #000}
.vo-peri{position:absolute;inset:0;box-shadow:inset 0 0 0 7vmin #050505,inset 0 0 12vmin 9vmin rgba(0,0,0,.9);border-radius:2px}
.vo-ring{position:absolute;left:50%;bottom:calc(9vmin + 10px);width:84px;height:84px;margin-left:-42px}
.vo-ring svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.9))}
.vo-wide{position:absolute;left:50%;top:50%;width:0;height:0}
.vo-wide svg{position:absolute;left:-120px;top:-120px;width:240px;height:240px;overflow:visible;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.9))}
.vo-load{position:absolute;left:50%;bottom:calc(16% + env(safe-area-inset-bottom));transform:translateX(-50%);min-width:300px;max-width:92vw;padding:8px 14px;border-radius:6px;background:rgba(10,11,13,.62);font:600 15px var(--font-hud,system-ui);text-align:center;text-shadow:0 1px 2px #000}
.vo-load .vo-step{font-size:12px;opacity:.7;letter-spacing:.08em;text-transform:uppercase}
.vo-load .vo-do{margin-top:3px;font-size:17px}.vo-load kbd{display:inline-block;min-width:20px;padding:0 6px;margin:0 4px;border:1.5px solid currentColor;border-radius:3px;font:inherit}
.vo-load .vo-bar{position:relative;height:4px;margin-top:6px;border-radius:2px;background:rgba(233,230,223,.18);overflow:hidden}
.vo-load .vo-bar i{position:absolute;inset:0;background:#ffc23d;transform-origin:left;transform:scaleX(0)}
.vo-load .vo-ask{margin-top:3px;font-size:13px;color:#ffc23d}
.vo-arrow{position:absolute;top:50%;width:0;height:0;border:22px solid transparent;margin-top:-22px;filter:drop-shadow(0 0 2px #000);animation:vo-pulse 1s ease-in-out infinite}
.vo-arrow.is-l{left:4vw;border-right:30px solid rgba(255,194,61,.9);border-left:0}
.vo-arrow.is-r{right:4vw;border-left:30px solid rgba(255,194,61,.9);border-right:0}
.vo-dot{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(242,239,230,.85);box-shadow:0 0 2px #000}
.vo-target{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border:2px dashed rgba(255,194,61,.9);border-radius:50%;will-change:transform}
.vo-label{position:absolute;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);padding:3px 10px;border-radius:3px;background:rgba(10,11,13,.5);font:700 12px var(--font-hud,system-ui);letter-spacing:.1em;text-transform:uppercase;opacity:.85}
.vo-fade{position:absolute;inset:0;background:#000;opacity:0;display:flex;align-items:center;justify-content:center;font:700 20px var(--font-hud,system-ui);letter-spacing:.08em;color:#e9e6df}
@keyframes vo-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (max-height:560px),(max-width:820px){.vo-ret svg{transform:scale(.72)}.vo-wide svg{transform:scale(.8)}.vo-ring{width:62px;height:62px;margin-left:-31px}.vo-load{min-width:220px;padding:5px 10px;font-size:13px;bottom:calc(30% + env(safe-area-inset-bottom))}.vo-load .vo-do{font-size:14px}.vo-mark b{font-size:10px}}
body[data-input-mode="touch"] .vo-load{bottom:calc(36% + env(safe-area-inset-bottom))}
`;

// Winkelspiegel: dunkel, drei Spiegelfenster (Löcher per evenodd)
const SLIT_SVG = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path fill="#060606" fill-rule="evenodd"
d="M0 0H100V100H0Z M6 34L33 31L33 63L6 60Z M36 30.5H64V63.5H36Z M67 31L94 34L94 60L67 63Z"/>
<g fill="rgba(70,95,80,.16)"><path d="M6 34L33 31L33 63L6 60Z"/><path d="M36 30.5H64V63.5H36Z"/><path d="M67 31L94 34L94 60L67 63Z"/></g>
<g stroke="rgba(0,0,0,.7)" stroke-width=".6" fill="none"><path d="M6 34L33 31L33 63L6 60Z M36 30.5H64V63.5H36Z M67 31L94 34L94 60L67 63Z"/></g></svg>`;
// Fernglas: zwei Kreise
const BINO_SVG = `<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice"><defs><mask id="vo-bm"><rect x="-120" y="-120" width="400" height="330" fill="#fff"/>
<circle cx="57" cy="45" r="35" fill="#000"/><circle cx="103" cy="45" r="35" fill="#000"/></mask></defs>
<rect x="-120" y="-120" width="400" height="330" fill="#040404" mask="url(#vo-bm)"/></svg>`;
// Hauptzieloptik: Winkel, Seitenstriche (Strichplatte), Mitte offen
const OPTIC_RET = `<svg viewBox="-200 -200 400 400" fill="none" stroke="#f2efe6" stroke-width="1.6">
<path d="M-190 0H-30M30 0H190M0 -150V-30"/><path d="M-12 12L0 1L12 12" stroke-width="2"/>
<path d="M-70 -5V5M-110 -5V5M-150 -5V5M70 -5V5M110 -5V5M150 -5V5" stroke-width="1.2"/>
<path d="M0 30V40" stroke-width="1.2"/></svg>`;
const WIDE_RET = `<svg viewBox="-120 -120 240 240" fill="none" stroke="#f2efe6" stroke-width="1.6">
<path d="M-110 0H-14M14 0H110M0 -80V-14M0 14V80"/><circle r="2" fill="#f2efe6" stroke="none"/>
<path d="M-40 -4V4M40 -4V4M-75 -4V4M75 -4V4" stroke-width="1.1"/></svg>`;
const PERI_RET = `<svg viewBox="-120 -120 240 240" fill="none" stroke="#f2efe6" stroke-width="1.4">
<path d="M-60 0H-10M10 0H60M0 -40V-10M0 10V40"/><path d="M-90 -6V6M90 -6V6M-30 -4V4M30 -4V4" stroke-width="1"/></svg>`;
const RING_SVG = `<svg viewBox="-50 -50 100 100" fill="none" stroke="#f2efe6" stroke-width="2">
<circle r="44" stroke-opacity=".6"/><path d="M0 -48V-38" stroke="#ffc23d" stroke-width="3"/>
<g class="vo-hull"><rect x="-13" y="-22" width="26" height="44" rx="3" stroke-opacity=".8"/><path d="M-6 -22L0 -30L6 -22" stroke-opacity=".8"/></g>
<g class="vo-tur"><circle r="9"/><path d="M0 -9V-40" stroke-width="3"/></g></svg>`;

const MARK_D = [200, 400, 600, 800, 1000];
const fmtKm = (d) => String(d / 100);

/**
 * Overlay-Ebene der Sichten (im Fahrzeug-HUD). update(state) mit
 *   { view, sight, zoom, vehicle, seat, camera, project(p) → {x,y,on}, ammo:{short,speed,gravity}|null, lookDir, load, range, fade }
 */
export class ViewOverlay {
  constructor(root) {
    const el = document.createElement('div');
    el.className = 'vo';
    el.innerHTML = `
      <div class="vo-slit" hidden>${SLIT_SVG}</div>
      <div class="vo-optic" hidden></div>
      <div class="vo-bino" hidden>${BINO_SVG}</div>
      <div class="vo-peri" hidden></div>
      <div class="vo-ret" hidden></div>
      <div class="vo-wide" hidden>${WIDE_RET}</div>
      <div class="vo-marks" hidden></div>
      <div class="vo-ammo" hidden></div>
      <div class="vo-range" hidden></div>
      <div class="vo-ring" hidden>${RING_SVG}</div>
      <div class="vo-target" hidden></div>
      <div class="vo-arrow is-l" hidden></div><div class="vo-arrow is-r" hidden></div>
      <div class="vo-dot" hidden></div>
      <div class="vo-load" hidden><div class="vo-step"></div><div class="vo-do"></div><div class="vo-ask"></div><div class="vo-bar"><i></i></div></div>
      <div class="vo-label" hidden></div>
      <div class="vo-fade"></div>`;
    root.insertBefore(el, root.firstChild);
    this.root = el;
    const q = (s) => el.querySelector(s);
    this.el = {
      slit: q('.vo-slit'), optic: q('.vo-optic'), bino: q('.vo-bino'), peri: q('.vo-peri'), ret: q('.vo-ret'), wide: q('.vo-wide'),
      marks: q('.vo-marks'), ammo: q('.vo-ammo'), range: q('.vo-range'), ring: q('.vo-ring'), hull: q('.vo-hull'), tur: q('.vo-tur'),
      target: q('.vo-target'), arrowL: q('.vo-arrow.is-l'), arrowR: q('.vo-arrow.is-r'), dot: q('.vo-dot'),
      load: q('.vo-load'), step: q('.vo-step'), do: q('.vo-do'), ask: q('.vo-ask'), bar: q('.vo-bar i'), label: q('.vo-label'), fade: q('.vo-fade'),
    };
    this.el.ret.innerHTML = OPTIC_RET;
    this.el.marks.innerHTML = MARK_D.map((d, i) => `<i class="vo-mark${i % 2 ? ' is-s' : ''}"><b>${fmtKm(d)}</b></i>`).join('');
    this.marks = [...this.el.marks.children];
    this._c = {};
  }

  _set(key, el, prop, val) {
    if (this._c[key] === val) return;
    this._c[key] = val;
    if (prop === 'hidden') el.hidden = !!val;
    else if (prop === 'html') el.innerHTML = val;
    else if (prop === 'text') el.textContent = val;
    else if (prop === 'transform') el.style.transform = val;
    else if (prop === 'opacity') el.style.opacity = val;
    else if (prop === 'width') el.style.transform = `scaleX(${val})`;
    else if (prop === 'rotate') el.setAttribute('transform', `rotate(${val})`);
  }

  hideAll() {
    for (const k of ['slit', 'optic', 'bino', 'peri', 'ret', 'wide', 'marks', 'ammo', 'range', 'ring', 'target', 'arrowL', 'arrowR', 'dot', 'load', 'label']) this._set(k + 'H', this.el[k], 'hidden', true);
    this._set('fadeO', this.el.fade, 'opacity', '0');
    this._set('fadeT', this.el.fade, 'text', '');
  }

  update(s) {
    const el = this.el;
    const view = s.view;
    const ov = s.sight && view ? view.overlay : null;
    const bino = ov === 'binocular' && s.zoom >= 1.5;
    this._set('slitH', el.slit, 'hidden', ov !== 'slit');
    this._set('opticH', el.optic, 'hidden', ov !== 'optic');
    this._set('retH', el.ret, 'hidden', ov !== 'optic' && ov !== 'peri');
    this._set('retK', el.ret, 'html', ov === 'peri' ? PERI_RET : OPTIC_RET);
    this._set('wideH', el.wide, 'hidden', ov !== 'wide');
    this._set('periH', el.peri, 'hidden', ov !== 'peri');
    this._set('ringH', el.ring, 'hidden', ov !== 'peri');
    this._set('binoH', el.bino, 'hidden', !bino);
    this._set('dotH', el.dot, 'hidden', !(ov === 'loader' || (s.sight && !ov && !s.mount)));
    // Entfernungsmarken der Hauptzieloptik (Ballistik der geladenen bzw. gewählten Munition)
    const marks = ov === 'optic' && s.ammo && s.project && s.camPos && s.lookYaw != null;
    this._set('marksH', el.marks, 'hidden', !marks);
    this._set('ammoH', el.ammo, 'hidden', !marks);
    if (marks) {
      const a = s.ammo;
      this._set('ammoT', el.ammo, 'text', `${a.short} · Entfernung × 100 m`);
      // Beschriftung nur, wo die Marken weit genug auseinanderliegen (geringe Vergrößerung: Marken dicht an der Mitte)
      let lastY = -1e9;
      for (let i = 0; i < MARK_D.length; i++) {
        const d = MARK_D[i];
        const lob = s.lob(a.speed, a.gravity, d, 0);
        dirFromYawPitch(s.lookYaw, s.lookPitch - lob, _d);
        _v.copy(s.camPos).addScaledVector(_d, d);
        const sc = s.project(_v);
        const m = this.marks[i];
        const tf = sc.on ? `translate3d(${sc.x.toFixed(1)}px,${sc.y.toFixed(1)}px,0)` : 'translate3d(-999px,-999px,0)';
        this._set('mk' + i, m, 'transform', tf);
        const lab = sc.on && sc.y - lastY >= 13;
        if (lab) lastY = sc.y;
        this._set('ml' + i, m.firstChild, 'hidden', !lab);
      }
    }
    this._set('rangeH', el.range, 'hidden', !(ov === 'optic' && s.range));
    if (ov === 'optic' && s.range) this._set('rangeT', el.range, 'text', s.range);
    // Periskop: Richtungsring (Wanne und Turm relativ zum Blick)
    if (ov === 'peri' && s.vehicle) {
      const v = s.vehicle;
      const hullRel = wrap(v.body.yaw() - s.lookYaw), turRel = wrap(v.body.yaw() + v.mount.turretYaw - s.lookYaw);
      // SVG: Gier positiv = links → Drehung gegen den Uhrzeigersinn (negativer Winkel)
      this._set('ringHull', el.hull, 'rotate', (-hullRel * 180 / Math.PI).toFixed(1));
      this._set('ringTur', el.tur, 'rotate', (-turRel * 180 / Math.PI).toFixed(1));
    }
    // Ladeschütze: Schrittanzeige + Pfeil zum Ziel (Gestell/Verschluss)
    const L = ov === 'loader' || s.loadAlways ? s.load : null;
    this._set('loadH', el.load, 'hidden', !L);
    if (L) {
      this._set('loadS', el.step, 'text', L.stepText || '');
      this._set('loadD', el.do, 'html', L.doHtml || '');
      this._set('loadA', el.ask, 'text', L.ask || '');
      this._set('loadB', el.bar, 'width', (L.progress || 0).toFixed(2));
    }
    const dir = L && ov === 'loader' ? L.turn : 0;
    this._set('arrowLH', el.arrowL, 'hidden', dir !== -1);
    this._set('arrowRH', el.arrowR, 'hidden', dir !== 1);
    // Sichtname (kurz nach dem Umschalten)
    const lab = s.label || '';
    this._set('labelH', el.label, 'hidden', !lab);
    if (lab) this._set('labelT', el.label, 'text', lab);
    // Abblende beim Sitzwechsel
    const f = clamp(s.fade || 0, 0, 1);
    this._set('fadeO', el.fade, 'opacity', f.toFixed(2));
    this._set('fadeT', el.fade, 'text', f > 0.3 ? (s.fadeText || '') : '');
  }

  dispose() { this.root.remove(); }
}
