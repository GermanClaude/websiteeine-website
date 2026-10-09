// NULLPUNKT — HUD der FPV-Drohne (Serienprämie 'drohne', modes/drone.js): Kamerabild einer Funkdrohne über dem Spielbild –
// Rahmen, Vignette und Bildrauschen (nur bei schwachem Signal, leerem Akku oder Treffern – ein ganzflächiges Bild je Takt
// kostet auf schwachen Geräten), Fadenkreuz mit künstlichem Horizont, Akku als
// Balken, Höhe über Grund, Entfernung zum Startpunkt, Tempo, Schub, Warnungen (Signal, Akku, Körper unter Beschuss) und die
// Tastenhinweise („Feuer: Sprengen · F: Abbrechen“). Touch: eigene Knöpfe Hoch/Runter/Schub/Sprengen/Abbrechen in #hud-top
// (über der Touch-Steuerung); der linke Stick fliegt, Wischen rechts schaut. Solange die Drohne fliegt, steht
// body[data-drone="1"] – game.css blendet damit das normale HUD und die übrigen Touch-Knöpfe aus. Anzeigen werden mit
// höchstens UI_HZ aufgefrischt (Text/Balken/Horizont), das Rauschen mit NOISE_HZ.

import { el, esc, setText, setStyle, toggle, clamp } from './dom.js';

const NOISE_W = 128;
const NOISE_H = 72;
const NOISE_HZ = 12;
const UI_HZ = 15;

export class DroneHud {
  /**
   * @param G Spielkontext, host #hud-Wurzel (.h-root), top #hud-top (interaktiv), keyFor(action) → Tastenbeschriftung
   */
  constructor(G, host, top, keyFor) {
    this.G = G;
    this.keyFor = keyFor || (() => '');
    this.on = false;
    this._noiseT = 0;
    this._uiT = 0;
    this._noiseOn = false;
    this._keysKey = '';
    const r = el('div', 'dr-hud');
    r.hidden = true;
    r.setAttribute('aria-hidden', 'true');
    r.innerHTML = `
      <canvas class="dr-noise" width="${NOISE_W}" height="${NOISE_H}" hidden></canvas>
      <div class="dr-vig"></div>
      <div class="dr-frame"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i></div>
      <div class="dr-hor"><i></i></div>
      <div class="dr-cross"><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><b></b></div>
      <div class="dr-tl"><span class="dr-rec"><i></i>FPV</span><span class="dr-ttl">FPV-Drohne</span></div>
      <div class="dr-tr"><span class="dr-sigl">Signal</span><span class="dr-sig"><i></i><i></i><i></i><i></i><i></i></span></div>
      <div class="dr-bat"><span>Akku</span><i><u></u></i><b>25 s</b></div>
      <div class="dr-stats">
        <div><small>Höhe</small><b class="alt">0 m</b></div>
        <div><small>Entfernung</small><b class="dist">0 m</b></div>
        <div><small>Tempo</small><b class="spd">0 km/h</b></div>
      </div>
      <div class="dr-boost"><span>Schub</span><i><u></u></i></div>
      <div class="dr-warn" aria-live="polite"></div>
      <div class="dr-hint"></div>`;
    host.appendChild(r);
    const q = (s) => r.querySelector(s);
    this.el = {
      root: r, noise: q('.dr-noise'), hor: q('.dr-hor'), bat: q('.dr-bat'), batBar: q('.dr-bat u'), batT: q('.dr-bat b'),
      sig: [...r.querySelectorAll('.dr-sig i')], alt: q('.dr-stats .alt'), dist: q('.dr-stats .dist'), spd: q('.dr-stats .spd'),
      boost: q('.dr-boost'), boostBar: q('.dr-boost u'), warn: q('.dr-warn'), hint: q('.dr-hint'),
    };
    this._ctx = this.el.noise.getContext ? this.el.noise.getContext('2d') : null;
    this._img = this._ctx ? this._ctx.createImageData(NOISE_W, NOISE_H) : null;
    // Touch-Knöpfe (über der Touch-Steuerung)
    const t = el('div', 'dr-touch');
    t.hidden = true;
    t.innerHTML = `
      <button type="button" class="dr-tb dr-abort" data-act="interact">Abbrechen</button>
      <button type="button" class="dr-tb dr-up" data-act="jump" aria-label="Steigen">▲<span>Hoch</span></button>
      <button type="button" class="dr-tb dr-down" data-act="crouch" aria-label="Sinken">▼<span>Runter</span></button>
      <button type="button" class="dr-tb dr-boostb" data-act="sprint">Schub</button>
      <button type="button" class="dr-tb dr-boom" data-act="fire">Sprengen</button>`;
    top.appendChild(t);
    this.touch = t;
    this._down = new Map(); // pointerId → Aktion
    const press = (e) => {
      const b = e.target.closest && e.target.closest('.dr-tb');
      if (!b || !this.on) return;
      e.preventDefault();
      e.stopPropagation();
      const act = b.dataset.act;
      const input = this.G.input;
      if (!input || !act) return;
      this._down.set(e.pointerId, act);
      b.classList.add('is-down');
      input._press(act, 'touch');
    };
    const release = (e) => {
      const act = this._down.get(e.pointerId);
      if (!act) return;
      this._down.delete(e.pointerId);
      for (const b of t.querySelectorAll('.dr-tb')) if (b.dataset.act === act) b.classList.remove('is-down');
      const input = this.G.input;
      if (input && ![...this._down.values()].includes(act)) input._release(act, 'touch');
    };
    t.addEventListener('pointerdown', press, { passive: false });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    t.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Je Bild (HUD.update): drone = eigene Drohne (StreakManager.pilot) oder null. */
  update(dt, drone) {
    const on = !!(drone && drone.alive);
    if (on !== this.on) this._toggle(on);
    if (!on) return;
    this._uiT -= dt;
    this._noiseT -= dt;
    if (this._uiT > 0 && this._noiseT > 0) return;
    const G = this.G;
    const P = drone.params;
    const E = this.el;
    this._noise(drone, dt);
    if (this._uiT > 0) return;
    this._uiT = 1 / UI_HZ;
    // Akku
    const bat = drone.batteryFrac;
    setStyle(E.batBar, 'transform', `scaleX(${bat.toFixed(3)})`);
    setText(E.batT, `${Math.max(0, Math.ceil(drone.battery))} s`);
    toggle(E.bat, 'is-low', drone.battery < 6);
    // Signal (5 Balken)
    const sig = drone.signal;
    const bars = Math.max(1, Math.round(sig * 5));
    E.sig.forEach((b, i) => toggle(b, 'is-on', i < bars));
    // Werte
    setText(E.alt, `${Math.round(drone.altitude)} m`);
    setText(E.dist, `${Math.round(drone.distance)} m`);
    setText(E.spd, `${Math.round(drone.speed * 3.6)} km/h`);
    setStyle(E.boostBar, 'transform', `scaleY(${clamp(drone.boostLeft / Math.max(0.1, P.boostTime), 0, 1).toFixed(3)})`);
    toggle(E.boost, 'is-on', drone.boosting);
    // Künstlicher Horizont: Neigung verschiebt, Rollen dreht
    const cam = G.camera;
    const vh = window.innerHeight || 720;
    const fov = cam && cam.fov ? cam.fov : 90;
    const py = clamp((Math.tan(drone.pitch) / Math.tan((fov * Math.PI) / 360)) * (vh / 2), -vh * 0.6, vh * 0.6);
    setStyle(E.hor, 'transform', `translateY(${py.toFixed(1)}px) rotate(${(-drone.roll * 0.55 * 180 / Math.PI).toFixed(2)}deg)`);
    // Warnungen
    const p = G.player;
    const hurt = p && p.alive && G.time.elapsed - (p.lastDamageTime || -1e9) < 1.6;
    let warn = '';
    if (hurt) warn = 'Dein Körper wird getroffen!';
    else if (drone.distance > P.range - 12) warn = 'Signal reißt ab – umkehren!';
    else if (sig < 0.7) warn = 'Signal schwach';
    else if (drone.battery < 6) warn = 'Akku schwach';
    setText(E.warn, warn);
    toggle(E.warn, 'is-on', !!warn);
    toggle(E.warn, 'is-hurt', !!hurt);
    // Hinweise (Belegung kann sich ändern)
    const touch = G.input && G.input.mode === 'touch';
    const key = touch ? 'touch' : ['fire', 'interact', 'jump', 'crouch', 'sprint'].map((a) => this.keyFor(a)).join('|');
    if (key !== this._keysKey) {
      this._keysKey = key;
      if (touch) E.hint.textContent = 'Stick: fliegen · Wischen: schauen';
      else {
        const k = (a, fb) => this.keyFor(a) || fb;
        E.hint.innerHTML = `<span><kbd>${esc(k('fire', 'Feuer'))}</kbd> Sprengen</span><span><kbd>${esc(k('interact', 'F'))}</kbd> Abbrechen</span>` +
          `<span><kbd>${esc(k('jump', 'Leertaste'))}</kbd><kbd>${esc(k('crouch', 'C'))}</kbd> Höhe</span><span><kbd>${esc(k('sprint', 'Umschalt'))}</kbd> Schub</span>`;
      }
    }
  }

  /** Bildrauschen: nur bei schwachem Signal, fast leerem Akku oder Treffern (sonst ausgeblendet, kostet nichts). */
  _noise(drone) {
    if (this._noiseT > 0) return;
    this._noiseT = 1 / NOISE_HZ;
    const E = this.el;
    const level = clamp((1 - drone.signal) * 0.85 + (drone.battery < 3 ? 0.22 : 0) + (drone._hitT > 0 ? 0.45 : 0), 0, 0.9);
    const on = level > 0.06 && !!this._img;
    if (on !== this._noiseOn) { this._noiseOn = on; E.noise.hidden = !on; }
    if (!on) return;
    setStyle(E.noise, 'opacity', level.toFixed(2));
    const d = this._img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    this._ctx.putImageData(this._img, 0, 0);
  }

  _toggle(on) {
    this.on = on;
    this.el.root.hidden = !on;
    this._uiT = 0;
    this._noiseT = 0;
    const touch = this.G.input && this.G.input.mode === 'touch';
    this.touch.hidden = !on || !touch;
    if (on) document.body.dataset.drone = '1';
    else {
      delete document.body.dataset.drone;
      // gehaltene Drohnen-Knöpfe lösen (sonst springt/duckt der Körper danach)
      const input = this.G.input;
      for (const act of new Set(this._down.values())) if (input) input._release(act, 'touch');
      this._down.clear();
      for (const b of this.touch.querySelectorAll('.dr-tb')) b.classList.remove('is-down');
    }
  }

  /** Match vorbei / HUD abgebaut */
  reset() {
    if (this.on) this._toggle(false);
  }
}
