// Ton (standardmäßig aus). UI-Klänge aus engine/audio/ui-sounds.js, Waffenklänge aus der Audio-Engine
// des Spiels (erst bei Bedarf geladen), sonst eine winzige WebAudio-Synthese.
// Spielt nie vor einem ausdrücklichen Einschalten; startet erst nach einer Nutzergeste.
import { site } from './state.js';

let settings = null;
let enabled = false;
let uiSnd = null;
let engine = null;
let loading = null;
let engineLoading = null;
let synth = null;
let lastHover = 0;
const shotTimes = [];

function vol(k, d) { const v = settings?.get?.(k); return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d; }

/* ----------------------------------------------------- Rückfall-Synthese */
function makeSynth() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ctx;
  try { ctx = new AC(); } catch { return null; }
  const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  function burst(at, len, gain, f0, f1, type = 'bandpass') {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, at);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, at + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(at, 0, len + 0.01);
  }
  return {
    ctx,
    ui(name) {
      const t = ctx.currentTime + 0.005;
      const g = vol('masterVolume', 0.8) * vol('uiVolume', 0.7);
      if (name === 'confirm' || name === 'levelup') { burst(t, 0.004, g * 0.5, 3200); burst(t + 0.04, 0.004, g * 0.5, 4200); }
      else if (name === 'hover') burst(t, 0.002, g * 0.18, 3600);
      else if (name === 'back') burst(t, 0.006, g * 0.35, 1800);
      else burst(t, 0.002, g * 0.45, 3200);
    },
    shot() { const t = ctx.currentTime + 0.005; burst(t, 0.03, vol('masterVolume', 0.8) * vol('sfxVolume', 1) * 0.6, 4000, 400, 'lowpass'); },
    reload() { const t = ctx.currentTime + 0.005; const g = vol('masterVolume', 0.8) * vol('sfxVolume', 1) * 0.4; burst(t, 0.003, g, 2400); burst(t + 0.18, 0.003, g, 2800); },
    resume() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },
  };
}

/** Leichte UI-Klänge (eigener kleiner Kontext); bei Fehlern die Rückfall-Synthese. */
function ensure() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const m = await import('../game/engine/audio/ui-sounds.js');
      if (typeof m.createUiSounds === 'function') {
        uiSnd = m.createUiSounds(settings, { gestures: false });
        uiSnd.unlock();
      }
    } catch { uiSnd = null; }
    if (!uiSnd && !synth) synth = makeSynth();
  })();
  return loading;
}

/** Die volle Spiel-Engine (Waffen, Nachladen, Aufstieg) erst beim ersten Bedarf. */
function ensureEngine() {
  if (engine || engineLoading) return engineLoading;
  engineLoading = (async () => {
    try {
      const mod = await import('../game/engine/audio.js');
      if (mod?.AudioEngine) {
        engine = new mod.AudioEngine({ settings, events: null }, { autoUnlock: false, autoMusic: false });
        await engine.unlock();
      }
    } catch { engine = null; }
    if (!engine && !synth) synth = makeSynth();
    return engine;
  })();
  return engineLoading;
}
function getEngine() {
  if (!engine) ensureEngine();
  return engine;
}

function setButton() {
  const b = document.getElementById('sound-toggle');
  if (!b) return;
  b.setAttribute('aria-pressed', String(enabled));
  b.textContent = enabled ? 'Ton: an' : 'Ton: aus';
}

export const sound = {
  get enabled() { return enabled; },

  init(S) {
    settings = S;
    const b = document.getElementById('sound-toggle');
    // Gespeichert „an“: erst die erste Geste startet tatsächlich Audio.
    if (site.get('sound')) {
      enabled = true;
      const arm = () => {
        ensure().then(() => { uiSnd?.unlock?.(); synth?.resume(); });
        window.removeEventListener('pointerdown', arm, true);
        window.removeEventListener('keydown', arm, true);
      };
      window.addEventListener('pointerdown', arm, true);
      window.addEventListener('keydown', arm, true);
    }
    setButton();
    b?.addEventListener('click', async () => {
      enabled = !enabled;
      site.set('sound', enabled);
      setButton();
      if (enabled) {
        await ensure();
        uiSnd?.unlock?.();
        synth?.resume();
        sound.ui('toggle');
      }
    });
    site.onChange((k, v) => { if (k === 'sound' && v !== enabled) { enabled = !!v; setButton(); } });
  },

  ui(name) {
    if (!enabled || document.hidden) return;
    const now = performance.now();
    if (name === 'hover') { if (now - lastHover < 80) return; lastHover = now; }
    if (name === 'levelup') { const e = getEngine(); if (e) { e.ui('levelup'); return; } name = 'confirm'; }
    if (uiSnd) { uiSnd.play(['hover', 'click', 'confirm', 'back', 'toggle'].includes(name) ? name : 'click'); return; }
    if (!loading) ensure();
    synth?.ui(name);
  },

  /** Schuss: Profil-Name ('ar', 'sniper' …) oder Waffendefinition. Höchstens 12 pro Sekunde. */
  shot(p, pitch = 1) {
    if (!enabled || document.hidden) return;
    const now = performance.now();
    while (shotTimes.length && now - shotTimes[0] > 1000) shotTimes.shift();
    if (shotTimes.length >= 12) return;
    shotTimes.push(now);
    const profile = typeof p === 'string' ? p : p?.sound?.profile || 'ar';
    const pt = typeof p === 'object' ? p?.sound?.pitch || pitch : pitch;
    const e = getEngine();
    if (e) { e.play(profile, { pitch: pt, player: true }); return; }
    synth?.shot();
  },

  /** Handhabungsgeräusch (reload_mag_out, reload_mag_in, bolt, pump …). */
  play(name) {
    if (!enabled || document.hidden) return;
    const e = getEngine();
    if (e) { e.play(name, { player: true }); return; }
    if (name.startsWith('reload')) synth?.reload();
  },
};
