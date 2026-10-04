// Leichtgewichtige UI-Klänge für die Website (hover/click/confirm/back/toggle).
// Erzeugt den AudioContext erst bei der ersten Nutzergeste → keine Autoplay-Warnungen.
import { makeRng, hashString } from './dsp.js';
import { UI_RECIPES } from './sfx-ui.js';

const NAMES = ['hover', 'click', 'confirm', 'back', 'toggle'];
const GAIN = { hover: 0.32, click: 0.5, confirm: 0.38, back: 0.36, toggle: 0.42 };
const VARIANTS = { hover: 3, click: 2 };

/**
 * @param settings  Einstellungs-Store ({ get(k), onChange(fn) }) oder null
 * @returns {{ play(name), hover(), click(), confirm(), back(), toggle(), unlock(), setEnabled(on), dispose(), readonly ready }}
 */
export function createUiSounds(settings = null, { gestures = true } = {}) {
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  let ctx = null, out = null, enabled = true, disposed = false, unsub = null;
  const bufs = {}, last = {};
  const read = (k, d) => { try { const v = settings?.get?.(k); return typeof v === 'number' && isFinite(v) ? v : d; } catch { return d; } };
  const volume = () => Math.max(0, Math.min(1, read('masterVolume', 0.8))) * Math.max(0, Math.min(1, read('uiVolume', 0.7)));

  function applyVolume() { if (out) out.gain.setTargetAtTime(volume() * 0.9, ctx.currentTime, 0.02); }

  function render(name, v) {
    const key = `${name}#${v}`;
    if (bufs[key]) return bufs[key];
    const sr = ctx.sampleRate, R = makeRng(hashString(name) + v * 7919);
    const res = UI_RECIPES[name](sr, R, v), chs = Array.isArray(res) ? res : [res];
    const b = ctx.createBuffer(chs.length, chs[0].length, sr);
    chs.forEach((d, i) => b.getChannelData(i).set(d));
    return (bufs[key] = b);
  }

  function unlock() {
    if (disposed || !AC) return false;
    if (!ctx) {
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return false; } }
      out = ctx.createGain(); out.gain.value = volume() * 0.9; out.connect(ctx.destination);
      // Vorrendern im Leerlauf (winzige Puffer)
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 30));
      idle(() => { if (!disposed) for (const n of NAMES) for (let v = 0; v < (VARIANTS[n] || 1); v++) render(n, v); });
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    removeGestures();
    return true;
  }

  function play(name) {
    if (!enabled || disposed || !ctx || !UI_RECIPES[name] || ctx.state !== 'running') return;
    const n = VARIANTS[name] || 1; let v = Math.floor(Math.random() * n);
    if (n > 1 && v === last[name]) v = (v + 1) % n;
    last[name] = v;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = render(name, v);
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.015;
    g.gain.value = GAIN[name] ?? 0.5;
    src.connect(g).connect(out);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start();
  }

  const onGesture = () => unlock();
  const GESTURES = ['pointerdown', 'keydown', 'touchend'];
  function removeGestures() { if (typeof window !== 'undefined') for (const t of GESTURES) window.removeEventListener(t, onGesture, true); }
  if (gestures && typeof window !== 'undefined') for (const t of GESTURES) window.addEventListener(t, onGesture, { capture: true, passive: true });
  const onVis = () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else ctx.resume().catch(() => {}); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  if (settings?.onChange) { try { unsub = settings.onChange(() => applyVolume()); } catch { unsub = null; } }

  const api = {
    play, unlock,
    hover: () => play('hover'), click: () => play('click'), confirm: () => play('confirm'), back: () => play('back'), toggle: () => play('toggle'),
    setEnabled(on) { enabled = !!on; },
    get ready() { return !!ctx && ctx.state === 'running'; },
    get context() { return ctx; },
    dispose() {
      disposed = true; removeGestures();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      if (typeof unsub === 'function') unsub();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
  return api;
}
