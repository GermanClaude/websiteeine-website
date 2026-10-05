// NULLPUNKT — Reiter „Steuerung“: Empfindlichkeiten (auch je Zoomstufe), Halten/Umschalten, freies Zielen,
// Controller (Kurve mit Live-Vorschau, Totzonen, Stick-Anzeige), Touch und Gyro (Erlaubnis, Kalibrierung des
// Nullpunkts, Live-Anzeige). Sprungmarken oben; Reihenfolge nach dem gerade benutzten Gerät.

import { esc, num } from '../dom.js';
import { ICON } from '../icons.js';
import { rowHtml, headHtml, bindRows, syncRows, setRowDisabled } from './rows.js';
import { HINTS } from './schema-page.js';

const SECTIONS = {
  touch: { label: 'Touch', keys: ['touchSensitivity', 'touchOpacity', 'touchButtonScale'] },
  // Zielhilfe + Auto-Feuer stufenlos (core-mechanics: aimAssistLevel 0 = leichtes Bremsen … 1 = Einrasten; autoFireLevel)
  zielhilfe: { label: 'Zielhilfe', keys: ['aimAssist', 'aimAssistLevel', 'aimAssistDevices', 'autoFire', 'autoFireLevel', 'autoFireDevices'] },
  gyro: { label: 'Gyro', keys: ['gyroMode', 'gyroSensitivityX', 'gyroSensitivityY'] },
  maus: { label: 'Maus', keys: ['sensitivity'] },
  zielen: {
    label: 'Zielen',
    keys: ['sensitivityY', 'invertY', 'adsSensitivity', 'adsSensitivityMid', 'adsSensitivityHigh', 'zoomSensitivityCoef', 'freeAim'],
  },
  modus: { label: 'Halten / Umschalten', keys: ['adsMode', 'sprintMode', 'crouchMode', 'leanMode'] },
  pad: {
    label: 'Controller',
    keys: ['padSensitivity', 'padCurve', 'padDeadzone', 'padOuterDeadzone', 'padSwapSticks', 'padVibration'],
  },
};
const ORDER = {
  touch: ['touch', 'zielhilfe', 'gyro', 'zielen', 'modus', 'pad', 'maus'],
  pad: ['pad', 'zielhilfe', 'zielen', 'modus', 'maus', 'touch', 'gyro'],
  desktop: ['maus', 'zielen', 'modus', 'zielhilfe', 'pad', 'touch', 'gyro'],
};
const LABELS = { adsSensitivity: 'Im Anschlag · 1×', adsSensitivityMid: 'Im Anschlag · 2–4×', adsSensitivityHigh: 'Im Anschlag · ab 6×' };

/* ------------------------------------------------------------ Controller-Kurve (wie engine/input.js) */

/** Ausgabe 0..1 für Stick-Auslenkung m (radial), wie input._pollGamepad (ohne Rand-Beschleunigung). */
export function padResponse(m, { curve = 'classic', dz = 0.13, outer = 0.97 } = {}) {
  const o = Math.max(dz + 0.05, outer);
  if (m < dz) return 0;
  const k = Math.min(1, (m - dz) / Math.max(0.05, o - dz));
  if (curve === 'classic') return Math.pow(k, 1.8);
  if (curve === 'dynamic') return 0.3 * k + 0.7 * k * k * k;
  return k;
}

function curvePath(opts) {
  let d = '';
  for (let i = 0; i <= 48; i++) {
    const m = i / 48;
    const y = padResponse(m, opts);
    d += `${i ? 'L' : 'M'}${(m * 100).toFixed(1)} ${(100 - y * 100).toFixed(1)}`;
  }
  return d;
}

/* ------------------------------------------------------------ Seite */

export function controlsPage(P) {
  const G = P.G;
  const S = P.settings;
  let host = null;
  let off = null;
  let raf = 0;
  let io = null;
  let motionOn = false;
  let cal = null; // laufende Kalibrierung
  const live = { rate: [0, 0, 0], at: 0, n: 0 };
  const onMotion = (e) => {
    const r = e.rotationRate;
    if (!r) return;
    live.rate = [r.beta || 0, r.gamma || 0, r.alpha || 0];
    live.at = performance.now();
    live.n++;
    if (cal) cal.samples.push(live.rate.slice());
  };

  const device = () => {
    const i = G.input;
    if (!i) return 'desktop';
    if (i.mode === 'touch') return 'touch';
    return i.lastDevice === 'gamepad' ? 'pad' : 'desktop';
  };

  const gyroInfo = () => {
    const g = (G.input && G.input.gyro) || { supported: false, permission: 'unsupported' };
    const iosAsk = typeof window.DeviceMotionEvent !== 'undefined' && typeof window.DeviceMotionEvent.requestPermission === 'function';
    return { ...g, iosAsk };
  };

  function gyroCard() {
    return `
      <div class="gy" data-gy-card>
        <div class="gy-head">${ICON.gyro}<div><b data-gy-state></b><small data-gy-sub></small></div></div>
        <div class="gy-live" aria-hidden="true">
          ${['Nicken', 'Gieren', 'Rollen'].map((l, i) => `<div class="gy-axis" data-ax="${i}"><span>${l}</span><i><u></u></i><output>0,0</output></div>`).join('')}
        </div>
        <div class="gy-cal" hidden data-gy-cal><i><u></u></i><span data-gy-calt>Gerät still halten …</span></div>
        <div class="m-actions gy-actions">
          <button type="button" class="m-btn" data-gy="perm">${ICON.check}<span>Sensor erlauben</span></button>
          <button type="button" class="m-btn" data-gy="cal">${ICON.target}<span>Kalibrieren</span></button>
          <button type="button" class="m-btn m-ghost" data-gy="zero">${ICON.restart}<span>Nullpunkt löschen</span></button>
        </div>
      </div>`;
  }

  function padCard() {
    return `
      <div class="pc" data-pad-card>
        <figure class="pc-curve" aria-label="Reaktionskurve">
          <svg viewBox="-6 -6 112 112" aria-hidden="true">
            <rect class="pc-dz" x="0" y="0" width="0" height="100"/>
            <rect class="pc-od" x="100" y="0" width="0" height="100"/>
            <path class="pc-grid" d="M0 0V100H100M25 100V97M50 100V97M75 100V97M0 25H3M0 50H3M0 75H3"/>
            <path class="pc-lin" d="M0 100L100 0"/>
            <path class="pc-line" d=""/>
            <circle class="pc-dot" r="3.2" cx="0" cy="100"/>
          </svg>
          <figcaption><span>Auslenkung</span><span>Drehung</span></figcaption>
        </figure>
        <div class="pc-sticks" aria-hidden="true">
          ${['Links', 'Rechts'].map((l, i) => `<div class="pc-stick" data-st="${i}"><svg viewBox="-55 -55 110 110"><circle class="pc-ring" r="50"/><circle class="pc-in" r="6.5"/><circle class="pc-out" r="48.5"/><circle class="pc-raw" r="5" cx="0" cy="0"/></svg><span>${l}</span></div>`).join('')}
          <p class="pc-none" data-pad-none>Kein Controller verbunden. Eine Taste am Controller drücken.</p>
        </div>
      </div>`;
  }

  function sectionHtml(id) {
    const sec = SECTIONS[id];
    const rows = sec.keys.map((k) => rowHtml(P, k, { hint: HINTS[k], label: LABELS[k] })).join('');
    let extra = '';
    if (id === 'pad') extra = padCard();
    if (id === 'gyro') extra = gyroCard();
    if (id === 'touch') extra = `<div class="sp-linkrow"><button type="button" class="m-btn" data-act="touch-edit">${ICON.layout}<span>Touch-Layout bearbeiten</span></button><small>Knöpfe verschieben, Größe und Deckkraft je Knopf, Vorlagen.</small></div>`;
    if (id === 'modus') extra = '<p class="sp-tip">Touch-Knöpfe schalten immer um. Lehnen gilt für beide Seiten.</p>';
    const head = headHtml(sec.label, id);
    if (id === 'pad') return head + rows.replace(/(<div class="sp-row[^"]*" data-k="padDeadzone")/, `${extra}$1`);
    return head + (id === 'gyro' ? extra + rows : rows + extra);
  }

  function refreshGyro() {
    if (!host) return;
    const g = gyroInfo();
    const state = host.querySelector('[data-gy-state]');
    const sub = host.querySelector('[data-gy-sub]');
    if (!state) return;
    const bias = [S.get('gyroBiasX') || 0, S.get('gyroBiasY') || 0, S.get('gyroBiasZ') || 0];
    const hasBias = bias.some((b) => Math.abs(b) > 1e-4);
    let st;
    let sb;
    if (!g.supported) { st = 'Kein Bewegungssensor erkannt'; sb = 'Gyro-Zielen gibt es auf Handys und Tablets.'; }
    else if (g.permission === 'denied') { st = 'Zugriff verweigert'; sb = 'In den Browser-Einstellungen „Bewegung und Ausrichtung“ erlauben und die Seite neu laden.'; }
    else if (g.iosAsk && g.permission !== 'granted') { st = 'Erlaubnis nötig'; sb = 'Antippen von „Sensor erlauben“ fragt einmal nach.'; }
    else if (live.n > 0) { st = 'Sensor aktiv'; sb = hasBias ? `Nullpunkt: ${bias.map((b) => num(b, 2)).join(' · ')} °/s` : 'Nicht kalibriert. Zum Kalibrieren Gerät flach hinlegen.'; }
    else { st = 'Sensor bereit'; sb = hasBias ? `Nullpunkt: ${bias.map((b) => num(b, 2)).join(' · ')} °/s` : 'Noch keine Messwerte. Gerät kurz bewegen.'; }
    state.textContent = st;
    sub.textContent = sb;
    const card = host.querySelector('[data-gy-card]');
    card.classList.toggle('is-off', !g.supported || g.permission === 'denied');
    const perm = host.querySelector('[data-gy="perm"]');
    perm.hidden = !(g.supported && g.iosAsk && g.permission !== 'granted');
    host.querySelector('[data-gy="cal"]').disabled = !g.supported || g.permission === 'denied' || !!cal;
    host.querySelector('[data-gy="zero"]').disabled = !hasBias;
    for (const k of SECTIONS.gyro.keys) setRowDisabled(host, k, !g.supported, !g.supported ? 'Nur auf Geräten mit Bewegungssensor.' : '');
  }

  function startMotion() {
    const g = gyroInfo();
    if (motionOn || !g.supported || g.permission === 'denied') return;
    if (g.iosAsk && g.permission !== 'granted') return;
    window.addEventListener('devicemotion', onMotion);
    motionOn = true;
  }
  function stopMotion() {
    if (!motionOn) return;
    window.removeEventListener('devicemotion', onMotion);
    motionOn = false;
  }

  function calibrate() {
    if (cal) return;
    startMotion();
    const box = host.querySelector('[data-gy-cal]');
    const txt = host.querySelector('[data-gy-calt]');
    box.hidden = false;
    box.classList.remove('is-bad', 'is-ok');
    txt.textContent = 'Gerät flach hinlegen und still halten …';
    cal = { t0: performance.now(), samples: [], dur: 2600 };
    P.sound('click');
    refreshGyro();
  }

  function finishCalibration() {
    const c = cal;
    cal = null;
    const box = host && host.querySelector('[data-gy-cal]');
    if (!box) return;
    const txt = host.querySelector('[data-gy-calt]');
    const n = c.samples.length;
    if (n < 10) {
      box.classList.add('is-bad');
      txt.textContent = 'Keine Sensordaten. Erlaubnis prüfen und erneut versuchen.';
      P.sound('back');
      refreshGyro();
      return;
    }
    const mean = [0, 1, 2].map((i) => c.samples.reduce((s, v) => s + v[i], 0) / n);
    const sd = [0, 1, 2].map((i) => Math.sqrt(c.samples.reduce((s, v) => s + (v[i] - mean[i]) ** 2, 0) / n));
    if (sd.some((v) => v > 1.6) || mean.some((v) => Math.abs(v) > 4.5)) {
      box.classList.add('is-bad');
      txt.textContent = 'Zu viel Bewegung. Gerät flach hinlegen und erneut kalibrieren.';
      P.sound('back');
    } else {
      S.patch({ gyroBiasX: mean[0], gyroBiasY: mean[1], gyroBiasZ: mean[2] });
      box.classList.add('is-ok');
      txt.textContent = `Kalibriert. Rest-Drift ${num(Math.max(...sd), 2)} °/s.`;
      P.sound('confirm');
    }
    refreshGyro();
  }

  /** Attribut nur bei Änderung schreiben (jede Schreibung kostet über dem unscharfen Menühintergrund ein ganzes Bild). */
  const setA = (n, k, v) => { if (n && n.getAttribute(k) !== v) n.setAttribute(k, v); };

  /** Live-Anzeigen (nur solange die Seite offen ist): Controller-Sticks + Kurvenpunkt, Gyro-Achsen, Kalibrierung. */
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!host) return;
    // Controller
    let pad = null;
    if (typeof navigator.getGamepads === 'function') for (const p of navigator.getGamepads() || []) if (p && p.connected) { pad = p; break; }
    const none = host.querySelector('[data-pad-none]');
    if (none) none.hidden = !!pad;
    const sticks = host.querySelectorAll('.pc-stick');
    if (pad && sticks.length) {
      const swap = !!S.get('padSwapSticks');
      const ax = pad.axes;
      const L = [ax[0] || 0, ax[1] || 0];
      const R = [ax[2] || 0, ax[3] || 0];
      const look = swap ? L : R;
      [L, R].forEach((v, i) => {
        const d = sticks[i].querySelector('.pc-raw');
        setA(d, 'cx', (v[0] * 48).toFixed(1));
        setA(d, 'cy', (v[1] * 48).toFixed(1));
        sticks[i].classList.toggle('is-look', v === look);
      });
      const m = Math.min(1, Math.hypot(look[0], look[1]));
      const y = padResponse(m, { curve: S.get('padCurve'), dz: S.get('padDeadzone'), outer: S.get('padOuterDeadzone') });
      const dot = host.querySelector('.pc-dot');
      setA(dot, 'cx', (m * 100).toFixed(1));
      setA(dot, 'cy', (100 - y * 100).toFixed(1));
    }
    for (const s of sticks) s.classList.toggle('is-idle', !pad);
    // Gyro
    if (motionOn) {
      const fresh = performance.now() - live.at < 400;
      const bias = [S.get('gyroBiasX') || 0, S.get('gyroBiasY') || 0, S.get('gyroBiasZ') || 0];
      host.querySelectorAll('.gy-axis').forEach((n, i) => {
        const v = fresh ? live.rate[i] - bias[i] : 0;
        const u = n.querySelector('u');
        const k = Math.max(-1, Math.min(1, v / 90));
        const tr = `translateX(${k < 0 ? (k * 50).toFixed(1) : 0}%) scaleX(${Math.abs(k).toFixed(2)})`;
        if (u.__tr !== tr) { u.__tr = tr; u.style.transform = tr; }
        const o = n.querySelector('output');
        const t = num(v, 1);
        if (o.textContent !== t) o.textContent = t;
      });
    }
    if (cal) {
      const p = Math.min(1, (performance.now() - cal.t0) / cal.dur);
      const u = host.querySelector('[data-gy-cal] u');
      if (u) u.style.transform = `scaleX(${p.toFixed(3)})`;
      if (p >= 1) finishCalibration();
    }
  }

  function updateCurve() {
    if (!host) return;
    const opts = { curve: S.get('padCurve'), dz: S.get('padDeadzone'), outer: S.get('padOuterDeadzone') };
    const line = host.querySelector('.pc-line');
    if (line) line.setAttribute('d', curvePath(opts));
    const dz = host.querySelector('.pc-dz');
    if (dz) dz.setAttribute('width', (opts.dz * 100).toFixed(1));
    const od = host.querySelector('.pc-od');
    const o = Math.max(opts.dz + 0.05, opts.outer);
    if (od) { od.setAttribute('x', (o * 100).toFixed(1)); od.setAttribute('width', ((1 - o) * 100).toFixed(1)); }
    host.querySelectorAll('.pc-in').forEach((c) => c.setAttribute('r', (opts.dz * 48.5).toFixed(1)));
    host.querySelectorAll('.pc-out').forEach((c) => c.setAttribute('r', (o * 48.5).toFixed(1)));
  }

  let jumpLock = null;
  function setJump(id) {
    host.querySelectorAll('[data-jump]').forEach((b) => b.classList.toggle('is-on', b.dataset.jump === id));
  }

  function syncModeHint() {
    if (!host) return;
    const touch = G.input && G.input.mode === 'touch';
    for (const k of SECTIONS.modus.keys) setRowDisabled(host, k, touch, touch ? 'Auf Touch schalten die Knöpfe immer um.' : '');
    setRowDisabled(host, 'freeAim', touch, touch ? 'Nur mit Maus oder Controller.' : '');
  }

  return {
    keys: [...new Set(Object.values(SECTIONS).flatMap((s) => s.keys))],
    resetLabel: 'Steuerung',
    mount(h) {
      host = h;
      const order = ORDER[device()];
      host.innerHTML = `
        <nav class="sp-jump" aria-label="Abschnitte">${order.map((id, i) => `<button type="button" class="sp-chip${i === 0 ? ' is-on' : ''}" data-jump="${id}">${esc(SECTIONS[id].label)}</button>`).join('')}</nav>
        ${order.map((id) => `<section class="sp-sec" data-sec-id="${id}">${sectionHtml(id)}</section>`).join('')}`;
      off = bindRows(host, { ...P, after: (k) => { if (k === 'padCurve' || k === 'padDeadzone' || k === 'padOuterDeadzone') updateCurve(); } });
      host.addEventListener('click', onClick);
      updateCurve();
      refreshGyro();
      syncModeHint();
      startMotion();
      raf = requestAnimationFrame(frame);
      // Sprungmarke des Abschnitts, der gerade oben im Rollbereich steht, hervorheben (einmal je Bild beim Scrollen)
      const scroller = host.closest('.sp-body');
      if (scroller) {
        let pend = false;
        const mark = () => {
          pend = false;
          if (!host) return;
          // Nach einem Sprung bleibt die gewählte Marke, solange der Bereich ans Ende stößt (letzte Abschnitte)
          const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
          if (jumpLock && (performance.now() < jumpLock.until || atEnd)) return;
          jumpLock = null;
          const top = scroller.getBoundingClientRect().top + 60;
          let id = null;
          for (const s of host.querySelectorAll('.sp-sec')) { if (s.getBoundingClientRect().top <= top) id = s.dataset.secId; }
          if (!id) { const f = host.querySelector('.sp-sec'); id = f && f.dataset.secId; }
          setJump(id);
        };
        const onScroll = () => { if (!pend) { pend = true; requestAnimationFrame(mark); } };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        io = { disconnect: () => scroller.removeEventListener('scroll', onScroll) };
      }
      this._offGyro = G.events ? G.events.on('input:gyro', () => { startMotion(); refreshGyro(); }) : null;
    },
    unmount() {
      cancelAnimationFrame(raf);
      raf = 0;
      stopMotion();
      cal = null;
      if (io) io.disconnect();
      io = null;
      if (this._offGyro) this._offGyro();
      if (off) off();
      if (host) host.removeEventListener('click', onClick);
      host = null;
    },
    sync(key) {
      if (!host) return;
      syncRows(host, P, key);
      if (key === 'padCurve' || key === 'padDeadzone' || key === 'padOuterDeadzone') updateCurve();
      if (key.startsWith('gyroBias')) refreshGyro();
    },
    reset() {
      const patch = {};
      for (const k of this.keys) patch[k] = S.defaults[k];
      Object.assign(patch, { gyroBiasX: 0, gyroBiasY: 0, gyroBiasZ: 0 });
      S.patch(patch);
    },
  };

  function onClick(e) {
    const j = e.target.closest('[data-jump]');
    if (j) {
      const sec = host.querySelector(`.sp-sec[data-sec-id="${j.dataset.jump}"]`);
      jumpLock = { until: performance.now() + 900 };
      setJump(j.dataset.jump);
      if (sec) sec.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      P.sound('click');
      return;
    }
    const a = e.target.closest('[data-act="touch-edit"]');
    if (a) { P.openTouchEditor(); return; }
    const g = e.target.closest('[data-gy]');
    if (!g || g.disabled) return;
    const what = g.dataset.gy;
    if (what === 'perm' && G.input && typeof G.input.requestGyroPermission === 'function') {
      // iOS: nur direkt aus der Nutzergeste
      G.input.requestGyroPermission().then(() => { startMotion(); refreshGyro(); });
    } else if (what === 'cal') calibrate();
    else if (what === 'zero') { S.patch({ gyroBiasX: 0, gyroBiasY: 0, gyroBiasZ: 0 }); P.sound('back'); refreshGyro(); }
  }
}
