// NULLPUNKT – Audio-Engine (WebAudio): hybride Klänge aus CC0-Aufnahmen (assets/lib/audio, audio/samples.js)
// und Synthese (Worker-Klangbank audio/bank.js). Aufnahmen tragen Schüsse (nah/fern/Nachhall), Mechanik,
// Schritte, Einschläge, Explosionen, Atmo-Betten; die Synthese ergänzt Ich-Perspektive (Druckstoß, Verschluss),
// Sub-Druck und Trümmer, und trägt alles, wofür es keine gute Aufnahme gibt (Überschallknall, Metall,
// Stimmen, UI, Musik). Fehlt eine Aufnahme (noch nicht geladen, 404, Einstellung aus), spielt die Synthese.
// Der Hauptthread rendert im Spiel nie synchron (Ersatzklang oder auslassen). Signalfluss:
//   Stimme → [EQ-Zufall] → [Tiefpass Distanz/Verdeckung] → Gain → Panner(HRTF|equalpower) → Bus
//                       ↘ Sends → Innenhall (Faltung, klein/groß) / Außen-Slapback / frühe Reflexionen
//   sfx ← q (leise Klänge: Schritte, Foley …, HDR-Fenster) ;  amb → Duck → HDR
//   sfx/amb → world → muffle(Tiefpass: Pause, Tod, Gehör, wenig Leben) ┐
//   fb/ui/music ──────────────────────────────────────────────────────── master → EQ(Profil) → Glue → Makeup → Limiter → Softclip
import { CATALOG, SOUND_GROUPS, GUN_PROFILES, SURFACES, AMBIENCES, STEM_IDS, REC_ONLY, EXTRA_VOICES, entryOf } from './audio/catalog.js';
import { bank, PRIO, makeBuffer } from './audio/bank.js';
import { makeRng, hashString, clamp, lerp } from './audio/dsp.js';
import { MusicPlayer } from './audio/music.js';
import { MAP_AMBIENCE } from './audio/ambience.js';
import { spaceFor, roomIR, outdoorIR } from './audio/space.js';
import { library, SAMPLE_TIERS } from './audio/samples.js';
import { Acoustics } from './audio/acoustics.js';
import { EarlyReflections } from './audio/reflect.js';
import { Hearing, SHOT_DOSE, NO_MUFFLE } from './audio/hearing.js';
import { MIX_PRESETS, MixChain, HdrWindow, resolveMix } from './audio/mix.js';
export { createUiSounds } from './audio/ui-sounds.js';
export { SOUND_GROUPS, GUN_PROFILES, SURFACES, MIX_PRESETS, SAMPLE_TIERS };

// Waffendaten defensiv laden (Datei gehört einem anderen Modul und kann noch fehlen)
let WEAPONS = null;
const loadWeapons = () => import('../../shared/weapons.data.js').then(m => { WEAPONS = m.WEAPONS || m.default?.WEAPONS || null; }).catch(() => {});
loadWeapons();
let MEDALS = null; // Medaillenstufe → Tonhöhe der Fanfare (bronze/silber/gold)
import('../../shared/modes.data.js').then(m => { MEDALS = m.MEDALS || null; }).catch(() => {});
const MEDAL_PITCH = { bronze: 0.94, silber: 1, silver: 1, gold: 1.1 };

const CLASS_PROFILE = { ar: 'ar', br: 'ar_heavy', smg: 'smg', lmg: 'lmg', sniper: 'sniper', marksman: 'ar_heavy', shotgun: 'shotgun', pistol: 'pistol' };
const ID_PROFILE = { ar_kv47: 'ar_heavy', ar_m17: 'ar', smg_vp9: 'smg', smg_qx90: 'smg', lmg_hm60: 'lmg', mr_sk14: 'ar_heavy', sr_brecher: 'sniper', sg_bulldog: 'shotgun', pi_p9: 'pistol', pi_adler: 'pistol_heavy', sentry: 'lmg' };
const PREFIX_PROFILE = { ar: 'ar', br: 'ar_heavy', smg: 'smg', lmg: 'lmg', mr: 'ar_heavy', sr: 'sniper', sg: 'shotgun', pi: 'pistol', mp: 'pistol' };
const RELOAD_TIME = { ar: 2.1, ar_heavy: 2.3, smg: 1.9, lmg: 4.2, sniper: 2.8, shotgun: 0.5, pistol: 1.5, pistol_heavy: 1.8 };
const SUPERSONIC = { ar: 1, ar_heavy: 1, lmg: 1, sniper: 1, pistol_heavy: 1 };
/** Mündungsgeschwindigkeit (m/s) → Ankunft des Geschosses / Überschallknalls vor dem Mündungsknall. */
const BULLET_SPEED = { ar: 900, ar_heavy: 720, lmg: 820, sniper: 880, pistol_heavy: 450, smg: 380, pistol: 360, shotgun: 400 };
const STREAK_SOUND = { uav: 'uav', strike: 'airstrike', airstrike: 'airstrike', sentry: 'sentry' };
const SURFACE_ALIAS = { asphalt: 'concrete', stone: 'concrete', plaster: 'concrete', brick: 'concrete', rubber: 'fabric', sandbag: 'sand', mud: 'dirt', gravel: 'dirt', ceramic: 'tile', carpet: 'fabric', snow: 'grass' };
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

// ---------------------------------------------------------------- Hybrid-Regeln (Recherche docs/AUDIO_SOURCES.md, dev/audio-lab.html)
/** Aufnahme klingt schlechter als die Synthese → nie verwenden. */
const PREFER_PROC = new Set(['impact_metal']);
/** Synthese bleibt als leise Schicht unter der Aufnahme (ab „medium“) → nicht freigeben. */
const PROC_LAYER = new Set(['impact_concrete', 'impact_wood', 'impact_dirt', 'impact_glass']);
/** Aufnahme und Synthese abwechselnd (Anteil Aufnahme) → mehr hörbare Varianten. */
const MIXED_REC = { hit_flesh: 0.6, bullet_whiz: 0.35, land: 0.5 };
/** Mechanik-Schicht (Aufnahme) unter dem eigenen Schuss. Repetierer/Pumpen haben ihre eigenen Klänge. */
const MECH_OF = { ar: 'mech_rifle', ar_heavy: 'mech_rifle', smg: 'mech_rifle', lmg: 'mech_rifle', pistol: 'mech_pistol', pistol_heavy: 'mech_pistol', dmr: 'mech_rifle' };
const TAIL_DB = -8, MECH_DB = -14;
/**
 * Pegelabgleich der Aufnahmen durch die komplette Kette (tools/out/audio-hybrid/loudness*.mjs: lauteste 400 ms am Ausgang,
 * Mittel über alle Varianten, gegen den bisherigen Synthese-Klang) – zusätzlich zu Manifest mix.matchDb (Rohpuffer).
 * Beton-Schritte bewusst +3 dB über der Synthese (häufigster Boden, Schritte müssen hörbar sein).
 */
const REC_TRIM = {
  step_concrete: 3, step_wood: 4, step_dirt: 4.5, step_gravel: 4, step_metal: 3, step_grass: -10.5,
  impact_concrete: 2.5, impact_wood: 9, impact_dirt: -3.5, impact_glass: -6, hit_flesh: 4.5,
  melee_hit: 4, land: 2.5, explosion: -1.5, explosion_far: 0,
};
/** Eigener Schuss: Aufnahme mit echtem Crest-Faktor läuft in den Limiter → etwas mehr Pegel für gleiche Lautheit. */
const PLAYER_NEAR_DB = 2.5, FAR_DB = 2;
/** Feinabgleich je Profil (eigener Schuss, nach „Körperkamera-Mikro“-Sättigung gemessen). */
const PLAYER_TRIM = { ar: 0.5, ar_heavy: 1.5, smg: 1.5, lmg: 2, sniper: 0.5, shotgun: 1.5, pistol: 2, pistol_heavy: 0 };
/** Hülsen je Untergrund (weiche Böden: fast lautlos → aus). */
const SHELL_SURF = { concrete: 'shell_concrete', tile: 'shell_concrete', metal: 'shell_hard', wood: 'shell_hard', glass: 'shell_hard', dirt: 'soft' };
const FLASH_TYPES = new Set(['flash', 'flashbang', 'blend', 'blendgranate', 'stun', 'tactical_flash']);
const SMOKE_TYPES = new Set(['smoke', 'rauch', 'rauchgranate', 'tactical_smoke']);

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const xyz = p => (p ? { x: +p.x || 0, y: +p.y || 0, z: +p.z || 0 } : null);
const dbg = db => Math.pow(10, db / 20);
const IN_PLAY = new Set(['countdown', 'playing']);
const IN_MATCH = new Set(['loading', 'countdown', 'playing', 'paused']);
// Was im Match zuerst gebraucht wird (neben der eigenen Ausrüstung): Countdown, Treffer, Tod, Explosion …
const CORE_SET = new Set([
  'countdown', 'go', 'spawn', 'hitmarker', 'hitmarker_kill', 'headshot', 'hit_flesh', 'death', 'medal', 'explosion', 'explosion_far',
  'impact_concrete', 'step_concrete', 'bullet_crack', 'bullet_whiz', 'grenade_pin', 'grenade_throw', 'equip', 'ads_in', 'ads_out',
  'reload_mag_out', 'reload_mag_in', 'dryfire', 'boom_sub',
]);
// Website (Engine ohne Ereignisbus): nur, was sie abspielt
const SITE_SET = new Set(['reload_mag_out', 'reload_mag_in', 'reload_bolt', 'bolt', 'pump', 'equip', 'dryfire']);
const DEFER_MS = 1500;      // außerhalb des Spiels: fehlender Klang startet, sobald gerendert (höchstens so spät)
const transientName = n => !!CATALOG[n]?.transient;

export class AudioEngine {
  /**
   * @param G     Spielkontext oder minimal { settings, events }
   * @param opts  { context?: AudioContext|OfflineAudioContext, autoUnlock = true, autoMusic = true, maxVoices, recordings?,
   *                keepProc? (ersetzte Synthese-Puffer nicht freigeben – A/B-Prüfstand) }
   */
  constructor(G = {}, opts = {}) {
    this.G = G || {};
    this.settings = this.G.settings || null;
    this.opts = opts;
    this.ctx = opts.context || null;
    this.offline = !!(this.ctx && typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext);
    this.unlocked = false;
    this.autoMusic = opts.autoMusic !== false;
    this.voices = [];
    this.vol = { master: 0.8, sfx: 1, music: 0.5, ui: 0.7, ambience: 1 };
    this.recordings = true; this.mixSetting = 'auto'; this.protection = false;
    /** Schichten des Hybrid-Klangs (Prüfstand/A-B): Mechanik, Ich-Perspektive, Nachhall-Fahne, frühe Reflexionen, Zufalls-EQ, Sub/Trümmer */
    this.layers = { mech: true, fp: true, tail: true, er: true, eq: true, sub: true, diffract: true };
    // rendered/queued/renderMs/maxSliceMs kommen aus der gemeinsamen Bank (renderMs = Hauptthread-Anteil)
    const B = bank.stats;
    this.stats = {
      played: 0, recorded: 0, dropped: 0, stolen: 0, substituted: 0, missed: 0, lastMissed: null, deferred: 0, errors: 0, lastError: null,
      diffractions: 0, diffractMs: 0, diffractMaxMs: 0,
      get rendered() { return B.rendered; }, get queued() { return bank.queued; }, get renderMs() { return B.mainMs; },
      get maxSliceMs() { return B.maxMainMs; }, get workerMs() { return B.workerMs; },
    };
    this.envMode = 'auto';            // 'auto' | 'indoor' | 'outdoor'
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, rx: 1, rz: 0, valid: false };
    this.acoustics = new Acoustics();
    this.hearing = new Hearing();
    this.hdr = new HdrWindow();
    this._unsubs = [];
    this._warm = false; this._bankLow = null; this._pinAt = new WeakMap(); this._slideVoice = null;
    this._occl = new Map(); this._lastFire = new WeakMap(); this._reloads = new Map();
    this._lastVar = new Map(); this._objOwners = new Map(); this._actorPain = new WeakMap();
    this._tails = new Map(); this._shellAt = new WeakMap(); this._surf = new WeakMap(); this._shots = new WeakMap();
    this._pass = new Map(); this._whiz = new Map(); this._passQueued = false; this._combatWhiz = false; this._casingEvents = false;
    this._wanted = new Set(); this._taps = []; this._erT = 0; this._hdrDb = 0; this._dif = new Map(); this._difT = -9;
    this._foley = { yaw: null, rustleT: 0, sprintT: 0, breaths: 0, breathT: 0, breathIn: true };
    this._indoor = 0; this._indoorT = 0;
    this._hb = 0; this._br = 0; this._brIn = true;
    this._t = { hm: -1, kill: -1, hs: -1, hurt: -1, pain: -1, medal: 0, streak: -9, duck: 0 };
    this._muffle = { pause: false, dead: false, health: NO_MUFFLE, hearing: NO_MUFFLE, current: NO_MUFFLE };
    this._losBudget = 8; this._losWindow = 0;
    this._rand = makeRng((Date.now() & 0xffff) + 1);
    this._space = 'default'; this._spaceKey = '';
    this._wantMusic = false; this._wantAmb = null; this._amb = null; this._music = null;
    this._readSettings();
    if (opts.recordings != null) this.recordings = !!opts.recordings;
    // Die Bibliothek ist seitenweit: nur die Einstellung (nicht Mess-/Offline-Engines) schaltet sie an/aus
    library.configure(opts.recordings == null && !this.offline ? { quality: this._quality(), enabled: this.recordings } : { quality: this._quality() });
    this._libUnsub = library.onLoaded(name => this._onSampleLoaded(name));
    if (this.settings?.onChange) {
      try { const u = this.settings.onChange(() => { this._settingsChanged(); }); if (typeof u === 'function') this._settingsUnsub = u; } catch { /* Store ohne onChange */ }
    }
    if (this.ctx) this._build();
    this._bindLifecycle(this.G.events);
    if (!this.offline && typeof window !== 'undefined') {
      this._onGesture = () => this.unlock();
      if (opts.autoUnlock !== false) for (const t of GESTURES) window.addEventListener(t, this._onGesture, { capture: true, passive: true });
      this._onVis = () => this._visibility();
      document.addEventListener('visibilitychange', this._onVis);
      window.addEventListener('pagehide', this._onVis);
      window.addEventListener('pageshow', this._onVis);
    }
  }

  // ================================================================ Aufbau

  _build() {
    const ctx = this.ctx, gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.master = gain(this.vol.master);
    this.mix = new MixChain(ctx);
    const glue = this.glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.004; glue.release.value = 0.2;
    this.makeup = gain(1);
    const lim = this.limiter = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    // Softclip-Sicherung: Eingang ×0,5, Kurve bildet ±2 auf < ±0,99 ab → nie über 0 dBFS
    this.clipPre = gain(0.5);
    this.clipper = ctx.createWaveShaper();
    const K = 4096, curve = new Float32Array(K);
    for (let i = 0; i < K; i++) {
      const s = (i / (K - 1) * 2 - 1) * 2, a = Math.abs(s);
      curve[i] = Math.sign(s) * (a <= 0.85 ? a : 0.85 + 0.14 * Math.tanh((a - 0.85) / 0.14));
    }
    this.clipper.curve = curve; this.clipper.oversample = '2x';
    this.output = gain(1);
    this.master.connect(this.mix.input); this.mix.output.connect(glue).connect(this.makeup).connect(lim).connect(this.clipPre).connect(this.clipper).connect(this.output).connect(ctx.destination);

    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = NO_MUFFLE; this.muffle.Q.value = 0.5;
    this.world = gain(1); this.world.connect(this.muffle).connect(this.master);
    this.bus = {
      sfx: gain(this.vol.sfx), q: gain(1), amb: gain(1), fb: gain(1), ui: gain(1), music: gain(1),
    };
    // Leise Klänge (Schritte, Foley, Mechanik …) laufen über das HDR-Fenster in den sfx-Bus
    this.hdrQ = gain(1); this.bus.q.connect(this.hdrQ).connect(this.bus.sfx);
    this.ambDuck = gain(1); this.hdrAmb = gain(1);
    this.bus.sfx.connect(this.world);
    this.bus.amb.connect(this.ambDuck).connect(this.hdrAmb).connect(this.world);
    this.bus.fb.connect(this.master); this.bus.ui.connect(this.master); this.bus.music.connect(this.master);
    // Raum: Sends kommen pro Stimme, Rückwege laufen über den sfx-Bus (folgen sfxVolume)
    this.revIn = gain(1); this.revOut = gain(0.9); this.revOut.connect(this.bus.sfx);
    this.revSmallIn = null;
    this.echoIn = gain(1); this.echoOut = gain(1); this.echoOut.connect(this.bus.sfx);
    this.er = new EarlyReflections(ctx, this.bus.sfx);
    // „Körperkamera-Mikro“: eigener Mündungsknall läuft in eine weiche Sättigung (Kamera-/Mikrofon-Begrenzung) –
    // dichter, ohne höhere Spitzen; Kleinsignal unverändert. Ein gemeinsamer Knoten für alle eigenen Schüsse.
    this.drive = { pre: gain(0.4), shaper: ctx.createWaveShaper(), post: gain(1) };
    { const N = 2048, c = new Float32Array(N), k = 2.2, t = Math.tanh(k);
      for (let i = 0; i < N; i++) { const x = i / (N - 1) * 2 - 1; c[i] = Math.tanh(k * x) / t; }
      this.drive.shaper.curve = c; this.drive.shaper.oversample = '2x';
      this.drive.post.gain.value = 1 / (0.4 * k / t); }
    this.drive.pre.connect(this.drive.shaper).connect(this.drive.post).connect(this.bus.sfx);
    this.hearing.attach(ctx, this.bus.fb);
    this._applyVolumes(true);
    this._applyMix(true);
    this.setSpace(this._space, true);
  }

  /** Raumakustik setzen (Kartenname oder Atmo-ID). Erzeugt Impulsantworten und Echo-Taps. */
  setSpace(id = 'default', force = false) {
    id = MAP_AMBIENCE[id] || id;
    this._space = id;
    if (!this.ctx) return;
    const hq = this._quality() !== 'low', key = `${id}|${hq}|${this.ctx.sampleRate}`;
    if (key === this._spaceKey && !force) return;
    this._spaceKey = key;
    const ctx = this.ctx, S = spaceFor(id);
    // Innenhall der Karte (Halle) – Fahne begrenzt (Lehre aus Bodycam v0.8): innen ≤ 2,5 s
    const conv = ctx.createConvolver(); conv.normalize = false;
    conv.buffer = makeBuffer(roomIR(ctx.sampleRate, S, { maxLen: hq ? 2.5 : 1.4, seed: hashString(id) }), ctx.sampleRate, ctx);
    this.revIn.connect(conv); conv.connect(this.revOut);
    const oldConv = this._conv; this._conv = conv;
    if (oldConv) { try { this.revIn.disconnect(oldConv); } catch { /* */ } setTimeout(() => { try { oldConv.disconnect(); } catch { /* */ } }, 3500); }
    // Kleiner Raum (Flur, Büro, Container): kurzer, dichter Hall – ab mittlerer Qualität als zweite Faltung
    if (hq && !this.revSmallIn) {
      this.revSmallIn = ctx.createGain();
      const cs = ctx.createConvolver(); cs.normalize = false;
      cs.buffer = makeBuffer(roomIR(ctx.sampleRate, { rt: 0.45, pre: 0.003, damp: 0.55 }, { maxLen: 0.6, seed: 4711 }), ctx.sampleRate, ctx);
      const g = ctx.createGain(); g.gain.value = 0.8;
      this.revSmallIn.connect(cs).connect(g).connect(this.revOut);
    }
    // Außen: Slapback-Taps + (hohe Qualität) weite Fahne, begrenzt auf 1,5 s
    const old = this._echoNodes || [];
    const nodes = [], lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = S.slapLp; lp.Q.value = 0.5;
    this.echoIn.connect(lp); nodes.push(lp);
    for (const [t, g, pan] of S.slap) {
      const d = ctx.createDelay(1.5), gn = ctx.createGain(); d.delayTime.value = t; gn.gain.value = g;
      let tail = gn;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; gn.connect(p); tail = p; nodes.push(p); }
      lp.connect(d).connect(gn); tail.connect(this.echoOut); nodes.push(d, gn);
    }
    if (hq) {
      const c2 = ctx.createConvolver(); c2.normalize = false;
      c2.buffer = makeBuffer(outdoorIR(ctx.sampleRate, { ...S, tail: Math.min(1.5, S.tail) }, { seed: hashString(id) + 3 }), ctx.sampleRate, ctx);
      const g2 = ctx.createGain(); g2.gain.value = 0.32;
      this.echoIn.connect(c2); c2.connect(g2).connect(this.echoOut); nodes.push(c2, g2);
    }
    this._echoNodes = nodes;
    for (const n of old) { try { this.echoIn.disconnect(n); } catch { /* nicht direkt verbunden */ } }
    setTimeout(() => { for (const n of old) { try { n.disconnect(); } catch { /* */ } } }, 3500);
  }

  // ================================================================ Freischalten & Lebenszyklus

  /** Aus einer Nutzergeste aufrufen; mehrfach aufrufbar. Startet das Vorrendern (falls noch nicht in der Lobby geschehen). */
  unlock() {
    if (this._disposed) return Promise.resolve(false);
    if (!this.ctx) {
      if (!AC) return Promise.resolve(false);
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { try { this.ctx = new AC(); } catch { return Promise.resolve(false); } }
      this._build();
    }
    bank.setContext(this.ctx);
    if (!this.offline) library.setContext(this.ctx);
    if (!this.offline && !this._primed) { // iOS: stummer Puffer entsperrt die Ausgabe
      const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      s.connect(this.ctx.destination); s.start(0); this._primed = true;
    }
    const first = !this.unlocked;
    this.unlocked = true;
    if (typeof window !== 'undefined' && this._onGesture) for (const t of GESTURES) window.removeEventListener(t, this._onGesture, true);
    if (first && !this.offline) this._warmBank();
    const resume = !this.offline && this.ctx.state !== 'running' && this.ctx.state !== 'closed' && !(typeof document !== 'undefined' && document.hidden) ? this.ctx.resume() : Promise.resolve();
    return resume.then(() => {
      if (first) {
        if (this._wantMusic) { this._wantMusic = false; this.startMusic(); }
        if (this._wantAmb) { const a = this._wantAmb; this._wantAmb = null; this.startAmbience(a); }
      }
      return true;
    }).catch(() => false);
  }

  _visibility() {
    if (!this.ctx || this.offline || !this.unlocked) return;
    if (document.hidden) { if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
    else if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); // auch iOS 'interrupted'
  }

  /** Entsperrt und keine Klänge mehr in Arbeit (Synthese und Aufnahmen). */
  get ready() { return this.unlocked && bank.idle && library.idle; }

  /** Gemeinsame Klangbank (Diagnose/Tests): info(), buffers, queued … */
  get bank() { return bank; }
  /** Gemeinsame Aufnahme-Bibliothek (Diagnose/Tests): info(), request(names), whenReady(names, fn) … */
  get samples() { return library; }
  /** Raumschätzung am Hörer: { indoor, enclosure, meanFree, ceiling, openness, valid } */
  get room() { return this.acoustics.state; }

  // ================================================================ Einstellungen

  _readSettings() {
    const s = this.settings;
    const get = (k, d) => { try { const v = s?.get?.(k); return typeof v === 'number' && isFinite(v) ? v : d; } catch { return d; } };
    const raw = (k, d) => { try { const v = s?.get?.(k); return v === undefined || v === null ? d : v; } catch { return d; } };
    this.vol.master = clamp(get('masterVolume', this.vol.master));
    this.vol.sfx = clamp(get('sfxVolume', this.vol.sfx));
    this.vol.music = clamp(get('musicVolume', this.vol.music));
    this.vol.ui = clamp(get('uiVolume', this.vol.ui));
    this.mixSetting = String(raw('audioMix', this.mixSetting));
    this.protection = !!raw('hearingProtection', this.protection);
    this.recordings = raw('audioRecordings', this.recordings) !== false;
    this.hearing.setProtection(this.protection);
  }

  _settingsChanged() {
    const rec = this.recordings, mix = this.mixSetting;
    this._readSettings(); this._applyVolumes();
    if (mix !== this.mixSetting) this._applyMix();
    if (rec !== this.recordings) this.setRecordings(this.recordings);
  }

  /** Lautstärken direkt setzen (0..1); folgt sonst automatisch den Einstellungen. */
  setVolumes({ master, sfx, music, ui, ambience } = {}) {
    if (master != null) this.vol.master = clamp(+master);
    if (sfx != null) this.vol.sfx = clamp(+sfx);
    if (music != null) this.vol.music = clamp(+music);
    if (ui != null) this.vol.ui = clamp(+ui);
    if (ambience != null) this.vol.ambience = clamp(+ambience);
    this._applyVolumes();
  }

  _applyVolumes(immediate = false) {
    if (!this.ctx || !this.bus) return;
    const t = this.ctx.currentTime, set = (p, v) => (immediate ? (p.value = v) : p.setTargetAtTime(v, t, 0.03));
    set(this.master.gain, this.vol.master);
    set(this.bus.sfx.gain, this.vol.sfx);
    set(this.bus.amb.gain, this.vol.sfx * this.vol.ambience * 0.24);
    set(this.bus.fb.gain, this.vol.sfx * 0.9);
    set(this.bus.ui.gain, this.vol.ui * 0.75);
    set(this.bus.music.gain, this.vol.music * 0.55);
    // Musik wurde stumm angefordert und ist jetzt hörbar → jetzt erst rendern (nicht während eines Matchs)
    if (this._wantMusic && !this._music?.playing && !this._musicPending && this.unlocked && !IN_MATCH.has(this.G.match?.state)) this.startMusic();
  }

  /** Wiedergabeprofil: 'auto' | 'kopfhoerer' | 'lautsprecher' | 'handy' (Einstellung audioMix). */
  setMix(id) { this.mixSetting = String(id || 'auto'); this._applyMix(); }
  get mixId() { return this._mixId || resolveMix(this.mixSetting, this._coarse()); }

  _applyMix(immediate = false) {
    this._mixId = resolveMix(this.mixSetting, this._coarse());
    const P = MIX_PRESETS[this._mixId];
    this._preset = P;
    if (!this.ctx || !this.mix) return;
    this.mix.apply(P, this.glue, immediate);
    const t = this.ctx.currentTime;
    if (immediate) this.makeup.gain.value = P.makeup; else this.makeup.gain.setTargetAtTime(P.makeup, t, 0.05);
    this.er?.setLevel(P.er * (this._quality() === 'low' ? 0.8 : 1));
  }

  /** Aufgenommene Klänge an/aus (Einstellung audioRecordings). Aus → nur Synthese, Aufnahmen werden freigegeben. */
  setRecordings(on) {
    this.recordings = !!on;
    library.configure({ enabled: this.recordings });
    if (this.recordings) { this._planSamples(); return; }
    library.release(() => true);
    // Ersetzte Synthese-Klänge wieder bereitstellen
    if (this._warm) for (const e of Object.values(CATALOG)) if (e.tier <= 2 && library.entry(e.name)) this._request(e, this._prioOf(e));
  }

  _coarse() { return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches; }
  _quality() {
    const q = this.G.params?.get?.('quality') || this.G.renderer?.quality || this.settings?.get?.('quality') || 'auto';
    if (q !== 'auto') return q;
    return this._coarse() ? 'low' : 'high';
  }
  _hrtf() { const q = this._quality(); return (q === 'high' || q === 'ultra') && (this._preset?.hrtf ?? true); }
  /** Stimmenbudget (Plan §10 A9): Handy 24, Desktop 48. */
  get maxVoices() { return this.opts.maxVoices || (this._quality() === 'low' ? 24 : 48); }

  // ================================================================ Vorrendern (Klangbank)

  /** Niedrige Qualität → kleinere Abtastraten/weniger Varianten. Einmal je Engine festgelegt (gleiche Schlüssel). */
  _lowBank() { if (this._bankLow == null) this._bankLow = this._quality() === 'low'; return this._bankLow; }
  _rate(e) { return this._lowBank() ? Math.min(e.rate, e.rateLow) : e.rate; }
  _variants(e) { return this._lowBank() && e.variantsLow ? Math.min(e.variants, e.variantsLow) : e.variants; }
  _key(e, v) { return bank.key(e.name, v, this._rate(e)); }
  _request(e, prio) {
    if (!e || e.sampleOnly) return [];
    const n = this._variants(e), keys = []; for (let v = 0; v < n; v++) keys.push(bank.request(e.name, v, this._rate(e), prio)); return keys;
  }
  _anyReady(e) {
    if (!e) return false;
    if (this._recName(e.name, true)) return true;
    if (e.sampleOnly) return false;
    for (let v = 0, n = this._variants(e); v < n; v++) if (bank.has(this._key(e, v))) return true; return false;
  }
  _inPlay() { return IN_PLAY.has(this.G.match?.state); }

  _prioOf(e) {
    if (e.bus === 'ui' && e.tier === 0) return PRIO.ui;
    if (CORE_SET.has(e.name)) return PRIO.core;
    return e.tier <= 1 ? PRIO.t1 : PRIO.t2;
  }

  /** Synthese-Klang wird von einer Aufnahme ersetzt (nicht gemischt, nicht „Synthese besser“). */
  _replaced(name) {
    if (PROC_LAYER.has(name) && this._quality() !== 'low') return false;
    return this._recOn() && !PREFER_PROC.has(name) && MIXED_REC[name] == null && library.known(name);
  }

  /**
   * Match-Bank im Worker vorrendern – im Spiel schon ab der Lobby (kein AudioContext nötig).
   * Klänge, die eine Aufnahme ersetzt, nur noch nachrangig (Rückfall, falls die Aufnahme fehlt).
   * Ohne Ereignisbus (Website) nur Menü-, Waffen- und Nachladeklänge.
   */
  _warmBank() {
    if (this._warm || this._disposed || this.offline) return;
    this._warm = true;
    const game = !!this.G.events?.on;
    const go = () => {
      if (this._disposed) return;
      for (const e of Object.values(CATALOG)) {
        if (e.tier > 2) continue;
        if (!game && !(e.tier === 0 && e.bus === 'ui') && !/^gun(fp)?_/.test(e.name) && !SITE_SET.has(e.name)) continue;
        this._request(e, this._replaced(e.name) ? PRIO.lazy : this._prioOf(e));
      }
      if (game) { this._prioritizeLoadout(); this._planSamples(); }
    };
    if (this._recOn() && !library.man) {
      // Manifest abwarten (≤ 1,2 s), damit Ersetztes nicht unnötig vorne in der Warteschlange landet
      let done = false; const t = setTimeout(() => { if (!done) { done = true; go(); } }, 1200);
      library.manifest().then(() => { if (!done) { done = true; clearTimeout(t); go(); } });
    } else go();
  }

  /** Eigene Ausrüstung zuerst: Schuss nah/fern, Repetier- und Nachladegeräusche (Synthese, falls nicht ersetzt). */
  _prioritizeLoadout(lo = this._loadout()) {
    if (!lo) return;
    for (const id of [lo.primary, lo.secondary]) {
      if (!id) continue;
      const def = this.weaponDef(id), prof = this.profileFor(id, def), names = [`gun_${prof}`, `gunfar_${prof}`, `gunfp_${prof}`];
      const fm = def?.fireMode || (prof === 'shotgun' ? 'pump' : prof === 'sniper' ? 'bolt' : null);
      if (fm === 'pump' || fm === 'bolt') names.push(fm);
      if (def?.perShellReload || prof === 'shotgun') names.push('reload_shell');
      if (prof === 'lmg') names.push('reload_bolt');
      for (const n of names) if (CATALOG[n] && !this._replaced(n)) this._request(CATALOG[n], PRIO.loadout);
    }
  }

  _loadout() {
    let lo = this.G.match?.loadout;
    if (!lo) { try { lo = this.settings?.get?.('lastLoadout'); } catch { lo = null; } }
    return lo && typeof lo === 'object' ? lo : null;
  }

  /** Aufnahmen einer Waffe: Nahschuss, Nachhall, Mechanik, Nachladen/Repetieren. */
  _weaponSamples(id, out = []) {
    if (!id) return out;
    const def = this.weaponDef(id); if (this._isKnife(id, def)) { out.push('melee_swing', 'melee_hit'); return out; }
    const prof = this.profileFor(id, def), voice = this.voiceFor(id, def, prof);
    out.push(`gun_${voice}`, `guntail_${voice}`, `gunfar_${voice}`);
    if (voice !== prof) out.push(`gun_${prof}`, `guntail_${prof}`);
    if (MECH_OF[voice]) out.push(MECH_OF[voice]);
    if (def?.suppressed && (prof === 'pistol' || prof === 'pistol_heavy')) out.push('gunsup_pistol');
    const fm = def?.fireMode || (prof === 'shotgun' ? 'pump' : prof === 'sniper' ? 'bolt' : null);
    if (fm === 'pump' || fm === 'bolt') out.push(fm);
    if (prof === 'pistol' || prof === 'pistol_heavy') out.push('slide_release');
    else if (prof !== 'shotgun') out.push('reload_bolt');
    out.push(prof === 'shotgun' ? 'shell_shotgun' : 'shell_concrete');
    return out;
  }

  /**
   * Aufnahmen bedarfsgerecht laden (Plan §10 A9): eigene Ausrüstung → Karten-Atmo + Kern (Fernschüsse, Explosion,
   * Treffer, Schritte) → Rest (Bot-Waffen, weitere Flächen). Angeheftet = nie von der Speichergrenze verdrängt.
   */
  _planSamples() {
    if (!this._recOn() || this.offline || !this.G.events?.on) return;
    const own = ['dryfire', 'reload_mag_out', 'reload_mag_in', 'grenade_spoon', 'land'];
    const lo = this._loadout();
    if (lo) for (const id of [lo.primary, lo.secondary]) this._weaponSamples(id, own);
    const mapId = this.G.match?.mapId || this.G.world?.id || (() => { try { return this.settings?.get?.('lastMap'); } catch { return null; } })();
    const amb = MAP_AMBIENCE[mapId] || (AMBIENCES[mapId] ? mapId : null);
    // Kern (angeheftet): alle Waffenstimmen nah/fern – Bots tragen jede Waffe –, Explosion, Treffer, häufigste Flächen
    const core = [
      ...Object.keys(GUN_PROFILES).map(p => `gun_${p}`), ...Object.keys(GUN_PROFILES).map(p => `gunfar_${p}`), 'explosion', 'explosion_far',
      'hit_flesh', 'step_concrete', 'impact_concrete', 'bullet_whiz', 'shell_concrete', 'grenade_bounce',
    ];
    if (amb) core.unshift(`amb_bed_${amb}`);
    // Fahnen fremder Waffen nur ab „medium“ (Handy: nur die eigene Fahne, Stimmenbudget)
    const tails = this._quality() === 'low' ? [] : Object.keys(GUN_PROFILES).map(p => `guntail_${p}`);
    const rest = [
      'bodyfall', ...tails,
      ...['wood', 'dirt', 'metal', 'grass', 'gravel'].map(s => `step_${s}`), ...['wood', 'dirt', 'glass'].map(s => `impact_${s}`),
      'melee_swing', 'melee_hit', 'shell_hard', 'shell_shotgun', 'reload_bolt', 'bolt', 'pump', 'slide_release', 'mech_rifle', 'mech_pistol',
    ];
    library.pin([...own, ...core], true);
    library.request(own, PRIO.loadout);
    library.request(core, PRIO.core);
    library.request(rest, PRIO.t1);
    if (amb) library.release(n => n.startsWith('amb_bed_') && n !== `amb_bed_${amb}`);
  }

  /** Stimmen der Bots (z. B. Präzisionsgewehre) nachladen, sobald die Akteure feststehen. */
  _planActorSamples() {
    if (!this._recOn()) return;
    const names = [];
    for (const a of this.G.actors || []) {
      const lo = a?.loadout; if (!lo) continue;
      for (const id of [lo.primary, lo.secondary]) {
        const def = this.weaponDef(id); if (!def || this._isKnife(id, def)) continue;
        const prof = this.profileFor(id, def), v = this.voiceFor(id, def, prof);
        if (v !== prof) names.push(`gun_${v}`, `gunfar_${v}`);
      }
    }
    if (names.length) library.request([...new Set(names)], PRIO.t1);
  }

  /** Puffer anfordern (vorgezogen) und fn(ok) aufrufen, wenn alle fertig sind. */
  _require(names, fn, prio = PRIO.urgent) {
    const keys = [];
    for (const n of names) { const e = CATALOG[n]; if (e) keys.push(...this._request(e, prio)); }
    bank.whenReady(keys, fn);
  }

  /** Rendert die genannten (oder alle Match-)Klänge im Worker; Promise löst nach Fertigstellung auf. */
  prerender(names = null) {
    const list = names || Object.values(CATALOG).filter(e => e.tier <= 2).map(e => e.name);
    return new Promise(res => this._require(list, () => res(), names ? PRIO.urgent : PRIO.t1));
  }

  /** Aufnahmen laden (Namen aus assets/lib/audio/manifest.json); Promise → true, wenn alle bereitstehen. */
  loadSamples(names, timeoutMs = 20000) {
    if (!this._recOn()) return Promise.resolve(false);
    library.request(names, PRIO.urgent);
    return new Promise(res => library.whenReady(names, res, timeoutMs));
  }

  /** Nicht mehr benötigte Klänge freigeben (Speicher). pred(name) */
  _releaseSounds(pred) { bank.release(name => !!CATALOG[name] && pred(name, CATALOG[name])); }

  /** Eine Aufnahme ist da: ersetzte Synthese freigeben (Speicher, Plan §10 A9). */
  _onSampleLoaded(name) {
    if (this._disposed || this.offline || this.opts.keepProc || !this._replaced(name)) return; // keepProc: A/B-Prüfstand
    if (!this.G.events?.on && !name.startsWith('gun_')) return; // Website: nur die Schüsse
    bank.release(n => n === name);
  }

  /**
   * Fertiger Puffer der Variante v – oder eine andere fertige Variante desselben Klangs.
   * Fehlt alles, wird der Klang vorgezogen angefordert. Synchron gerendert wird nur offline (Messung)
   * und für winzige Menüklänge außerhalb des Spiels.
   */
  _buffer(e, v) {
    let b = bank.get(this._key(e, v));
    if (b) return b;
    if (this.offline || (e.cheap && !this._inPlay())) return bank.renderNow(e.name, v, this._rate(e));
    bank.request(e.name, v, this._rate(e), PRIO.urgent);
    const n = this._variants(e);
    for (let k = 1; k < n; k++) { b = bank.get(this._key(e, (v + k) % n)); if (b) { this.stats.substituted++; return b; } }
    return null;
  }

  /** Ähnlicher Ersatzklang (z. B. anderes Gewehrprofil), solange der gewünschte noch rendert. */
  _altBuffer(e) {
    for (const name of e.alt || []) {
      const a = CATALOG[name]; if (!a) continue;
      for (let v = 0, n = this._variants(a); v < n; v++) { const b = bank.get(this._key(a, v)); if (b) { this.stats.substituted++; return b; } }
    }
    return null;
  }

  /**
   * Außerhalb des Spiels (Menü, Endbildschirm, Website): abspielen, sobald der Worker fertig ist.
   * Je Klang höchstens eine wartende Wiedergabe (die jüngste), damit sich nichts aufstaut.
   */
  _defer(e, v, o) {
    const t0 = this.ctx.currentTime, pend = this._pendingPlay || (this._pendingPlay = new Map());
    const entry = { v, o: { ...o, variant: v, position: xyz(o.position), _deferred: true }, t0 };
    this.stats.deferred++;
    if (pend.has(e.name)) { pend.set(e.name, entry); return; }
    pend.set(e.name, entry);
    const key = bank.request(e.name, v, this._rate(e), PRIO.urgent);
    bank.whenReady([key], ok => {
      const p = pend.get(e.name); pend.delete(e.name);
      if (!ok || !p || this._disposed || !this.ctx) return;
      const late = this.ctx.currentTime - p.t0;
      if (late * 1000 > DEFER_MS) return;
      this._spawn(e, { ...p.o, proc: true, variant: bank.has(this._key(e, p.v)) ? p.v : v, delay: Math.max(0, (p.o.delay || 0) - late) });
    }, DEFER_MS);
  }

  /** Sofort abspielen oder – falls noch im Worker – sobald fertig, auch mitten im Spiel (Stinger bei Bedarf). */
  _playSoon(name, opts = {}, maxMs = DEFER_MS) {
    const e = CATALOG[name]; if (!e || !this.ctx || !this.unlocked) return null;
    if (this._anyReady(e) || this.offline) return this.play(name, opts);
    const keys = this._request(e, PRIO.urgent), t0 = this.ctx.currentTime;
    bank.whenReady(keys.slice(0, 1), ok => {
      if (ok && !this._disposed && this.ctx && (this.ctx.currentTime - t0) * 1000 < maxMs) this.play(name, { ...opts, variant: 0 });
    }, maxMs);
    return null;
  }

  // ================================================================ Aufnahmen

  _recOn() { return this.recordings && library.enabled && !library.unavailable; }

  /**
   * Aufnahme für diesen Namen verwenden? (geladen, nicht „Synthese besser“, bei gemischten Klängen per Zufall).
   * Noch nicht geladen, aber vorgesehen → einmalig nachrangig anfordern.
   */
  _recName(name, peek = false) {
    if (!this._recOn() || PREFER_PROC.has(name)) return null;
    if (!library.has(name)) {
      if (!peek && library.man && !this._wanted.has(name) && library.known(name)) { this._wanted.add(name); library.request([name], this._inPlay() ? PRIO.t1 : PRIO.urgent); }
      return null;
    }
    const p = MIXED_REC[name];
    if (!peek && p != null && this._rand() > p) return null;
    return name;
  }

  /** Pegelkorrektur der Aufnahme (Manifest mix.matchDb: so laut wie der bisherige Synthese-Klang). */
  _recGain(name) {
    const m = library.entry(name)?.mix;
    return (m?.matchDb != null ? dbg(m.matchDb) : 1) * dbg(REC_TRIM[name] || 0);
  }

  _pickRec(name, variant) {
    const n = library.count(name); if (!n) return null;
    let i = variant != null ? Math.abs(Math.floor(variant)) % n : Math.floor(this._rand() * n);
    const key = 'rec:' + name;
    if (variant == null && n > 1 && i === this._lastVar.get(key)) i = (i + 1 + Math.floor(this._rand() * (n - 1))) % n;
    this._lastVar.set(key, i);
    return library.get(name, i);
  }

  // ================================================================ Abspielen

  /**
   * Spielt einen Klang. name: Katalogname, Aufnahme-Name (REC_ONLY), Waffenprofil (ar, sniper …), 'footstep', 'impact',
   * 'explosion'. opts: { position, volume, pitch, actor, player, surface, sprint, crouch, suppressed, delay, priority, bus,
   * pan, lowpass, highpass, env, echo, er, indoor, distance, variant, loop, ref, proc (nur Synthese), eq, fadeAt, fadeLen, voice,
   * drive (Körperkamera-Sättigung), loud (HDR-Pegel), quiet (HDR-gedämpft) }
   */
  play(name, opts = {}) {
    if (!this.ctx || !this.unlocked || this._disposed) return null;
    try {
      if (GUN_PROFILES[name]) return this._gunshot(name, opts);
      switch (name) {
        case 'footstep': return this._footstep(opts);
        case 'impact': return opts.surface === 'flesh' ? this.play('hit_flesh', opts) : this.play(`impact_${this._surface(opts.surface)}`, opts);
        case 'impact_flesh': return this.play('hit_flesh', opts);
        case 'explosion': return opts.position ? this._explosion({ position: opts.position, radius: opts.radius, volume: opts.volume, concuss: opts.concuss, type: opts.type }) : this._spawn(CATALOG.explosion, { priority: 3, ...opts });
        case 'hitmarker_headshot': return this.play('headshot', opts);
        case 'airstrike_call': case 'strike': return this.play('airstrike', opts);
      }
      if (name.startsWith('step_') && !entryOf(name)) return this.play(`step_${this._surface(name.slice(5))}`, opts);
      if (name.startsWith('impact_') && !entryOf(name)) return this.play(`impact_${this._surface(name.slice(7))}`, opts);
      const e = entryOf(name);
      if (!e) return null;
      return this._spawn(e, opts);
    } catch (err) { this._error(err); return null; }
  }

  /** UI-/Feedbackklang (auch für die Website). */
  ui(name) {
    const e = CATALOG[name] || CATALOG[{ select: 'click', ok: 'confirm', cancel: 'back', switch: 'toggle' }[name]];
    if (!e) return null;
    return this.play(e.name, { priority: 3, bus: e.bus === 'sfx' ? 'fb' : e.bus });
  }

  /** Dauerschleife (optional positional). Gibt Handle zurück: setPosition, setVolume, setPitch, stop. */
  loop(name, opts = {}) {
    const v = this.play(name, { ...opts, loop: true });
    if (!v) return null;
    const self = this;
    return {
      voice: v,
      get playing() { return !v.stopped; },
      setPosition(p) { v.position = xyz(p); if (v.panner) self._setPannerPos(v.panner, v.position); },
      setVolume(x, ramp = 0.05) { v.baseGain = x * v.entryGain; v.gain.gain.setTargetAtTime(v.baseGain * (v.occluded ? 0.55 : 1), self.ctx.currentTime, ramp); },
      setPitch(r) { v.src.playbackRate.setTargetAtTime(r, self.ctx.currentTime, 0.05); },
      stop(fade = 0.3) { self._kill(v, fade); },
    };
  }

  _surface(s) { s = String(s || 'concrete'); s = SURFACE_ALIAS[s] || s; return SURFACES.includes(s) ? s : 'concrete'; }

  _dist(p) {
    const L = this.listener; if (!p || !L.valid) return 0;
    const dx = p.x - L.x, dy = p.y - L.y, dz = p.z - L.z; return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _spawn(e, o) {
    const ctx = this.ctx, now = ctx.currentTime, L = this.listener;
    let pos = o.position ? xyz(o.position) : null;
    if (pos && !L.valid && o.distance == null) pos = null;     // ohne Hörer: 2D
    const dist = o.distance ?? (pos ? this._dist(pos) : 0);
    if (pos && dist > e.maxDist) { this.stats.dropped++; return null; }
    // Quelle: Aufnahme (falls geladen) oder Synthese-Puffer
    let buffer = null, offset = 0, recGain = 1, recorded = false;
    const rn = o.proc ? null : this._recName(e.name);
    if (rn) {
      const s = this._pickRec(rn, o.variant);
      if (s) { buffer = s.buffer; offset = s.offset; recGain = this._recGain(rn) * (s.gain ?? 1); recorded = true; }
    }
    if (!buffer) {
      if (e.sampleOnly) { this.stats.missed++; this.stats.lastMissed = e.name; this._recName(e.name); return null; }
      const n = this._variants(e);
      let v = o.variant != null ? Math.abs(Math.floor(o.variant)) % n : Math.floor(this._rand() * n);
      if (o.variant == null && n > 1 && v === this._lastVar.get(e.name)) v = (v + 1 + Math.floor(this._rand() * (n - 1))) % n;
      // Nie synchron nachrendern: im Spiel Ersatzklang oder auslassen, sonst nachholen, sobald fertig
      buffer = this._buffer(e, v);
      if (!buffer && this._inPlay()) buffer = this._altBuffer(e);
      if (!buffer) {
        this.stats.missed++; this.stats.lastMissed = e.name;
        if (!this._inPlay() && !o._deferred && !o.loop) this._defer(e, v, o); else this.stats.dropped++;
        return null;
      }
      this._lastVar.set(e.name, v);
    }
    const prio = o.priority ?? (o.player || !pos ? Math.max(e.prio, 2) : dist < 15 ? e.prio + 1 : e.prio);
    if (!this._admit(e, prio)) { this.stats.dropped++; return null; }

    const src = ctx.createBufferSource(); src.buffer = buffer;
    if (o.loop) { src.loop = true; if (offset) { src.loopStart = offset; src.loopEnd = buffer.duration; } }
    const rate = clamp((o.pitch ?? 1) * (1 + this._rand.bi() * (o.pitchJit ?? e.pitchJit)), 0.25, 4);
    src.playbackRate.value = rate;
    const nodes = [src];
    let head = src;
    // Zufalls-EQ je Schuss (Plan §10 A1): Präsenz ±1,5 dB, Bass ±1 dB → keine zwei Schüsse klingen gleich
    if (o.eq) {
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = this._rand.range(1500, 4000); pk.Q.value = 0.9; pk.gain.value = this._rand.range(-1.5, 1.5);
      const ls = ctx.createBiquadFilter(); ls.type = 'lowshelf'; ls.frequency.value = 120; ls.gain.value = this._rand.range(-1, 1);
      head.connect(pk).connect(ls); head = ls; nodes.push(pk, ls);
    }
    if (o.highpass) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o.highpass; hp.Q.value = 0.6;
      head.connect(hp); head = hp; nodes.push(hp);
    }
    // Distanz-/Verdeckungsfilter
    const occluded = pos && !o.player && o.occlusion !== false && e.bus !== 'amb' ? this._occluded(pos, o.actor, o.footstep) : false;
    // Beugung (Plan §10 A4): verdeckte laute Quellen kommen „um die Ecke“ – Richtung des ersten Wegpunkts im
    // Navigationsnetz, Umweg als Verzögerung und Abstand, je Ecke weniger Höhen (statt dumpf durch die Wand)
    const dif = occluded && (o.loud ?? e.loud) != null && this.layers.diffract !== false ? this._diffract(pos, o.actor) : null;
    let lp = o.lowpass || 0;
    if (pos && e.bus !== 'amb') lp = Math.min(lp || NO_MUFFLE, Math.max(2200, 20000 * Math.exp(-dist / 85)));
    if (occluded) lp = dif ? Math.min(lp || NO_MUFFLE, dif.lp) : clamp(Math.min(lp || NO_MUFFLE, 6000) * 0.12, 420, 1300);
    let filter = null;
    if ((lp && lp < 19000) || o.loop) {
      filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = lp || NO_MUFFLE; filter.Q.value = 0.5;
      head.connect(filter); head = filter; nodes.push(filter);
    }
    const g = ctx.createGain();
    const entryGain = e.gain * recGain * (1 + this._rand.bi() * e.gainJit);
    const baseGain = entryGain * (o.volume ?? 1);
    g.gain.value = baseGain * (occluded ? (dif ? dif.gain : 0.55) : 1);
    head.connect(g); nodes.push(g);
    let out = g, panner = null;
    if (pos) {
      panner = ctx.createPanner();
      panner.panningModel = this._hrtf() ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = o.ref || e.ref; panner.rolloffFactor = e.roll; panner.maxDistance = 10000;
      // Punktquelle: Stereo-Aufnahmen vor dem Panner auf Mono (sonst panoramiert der Panner die Kanäle einzeln)
      if (buffer.numberOfChannels > 1) { try { panner.channelCount = 1; panner.channelCountMode = 'explicit'; } catch { /* älterer Browser */ } }
      this._setPannerPos(panner, dif ? dif.pos : pos);
      g.connect(panner); out = panner; nodes.push(panner);
    } else if (o.pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner(); sp.pan.value = clamp(o.pan, -1, 1); g.connect(sp); out = sp; nodes.push(sp);
    }
    const busName = o.bus || e.bus;
    const dest = o.drive && this.drive && busName === 'sfx' ? this.drive.pre : busName === 'sfx' && (o.quiet ?? e.quiet) ? this.bus.q : this.bus[busName] || this.bus.sfx;
    out.connect(dest);
    // Hall-/Echo-Sends (vor dem Panner: Raumanteil ist diffus)
    const envAmt = e.env * (o.env ?? 1);
    if (envAmt > 0.001 && busName === 'sfx') {
      const wetDist = pos ? (0.35 + 0.65 * Math.min(1, dist / 35)) * (e.ref / (e.ref + 0.3 * Math.max(0, dist - e.ref))) : 0.45;
      const room = this._roomOf(pos, o);
      const wet = envAmt * wetDist * (o.volume ?? 1) * entryGain;
      if (room.ind > 0.02) {
        // Raumgröße der Quelle: kleiner Raum → kurzer, dichter Hall; Halle → Kartenhall
        const small = this.revSmallIn ? clamp((14 - room.size) / 9) : 0;
        if (small < 0.98) { const s = ctx.createGain(); s.gain.value = wet * room.ind * 1.9 * (1 - small); head.connect(s).connect(this.revIn); nodes.push(s); }
        if (small > 0.02) { const s = ctx.createGain(); s.gain.value = wet * room.ind * 1.6 * small; head.connect(s).connect(this.revSmallIn); nodes.push(s); }
      }
      if (room.ind < 0.98) { const s = ctx.createGain(); s.gain.value = wet * (1 - room.ind) * 0.62 * (o.echo ?? 1); head.connect(s).connect(this.echoIn); nodes.push(s); }
    }
    // Frühe Reflexionen der Umgebung des Hörers (laute, nahe Ereignisse)
    const erAmt = (o.er ?? e.er) * (pos ? 1 / (1 + dist / 10) : 1);
    if (erAmt > 0.02 && this.er && this.layers.er && busName === 'sfx' && !occluded) {
      const s = ctx.createGain(); s.gain.value = erAmt * baseGain; head.connect(s).connect(this.er.input); nodes.push(s);
    }
    // HDR-Fenster: geschätzter Pegel am Hörer
    const loud = o.loud ?? e.loud;
    if (loud != null) {
      const att = pos ? e.ref / (e.ref + e.roll * Math.max(0, dist - e.ref)) : 1;
      this.hdr.push(loud + 20 * Math.log10(Math.max(1e-4, (o.volume ?? 1) * att * (occluded ? 0.55 : 1))));
      this._applyHdr(true);
    }
    const when = now + Math.max(0, o.delay || 0) + (dif ? dif.extra : 0);
    src.start(when, offset);
    let end = o.loop ? Infinity : when + (buffer.duration - offset) / rate;
    if (o.fadeAt != null && !o.loop) {
      const fa = when + o.fadeAt, fl = Math.max(0.05, o.fadeLen ?? 0.5);
      if (fa < end) { g.gain.setValueAtTime(g.gain.value, fa); g.gain.setTargetAtTime(0, fa, fl / 4); end = Math.min(end, fa + fl); src.stop(end + 0.02); }
    }
    const voice = {
      name: e.name, group: e.group, prio, src, gain: g, filter, panner, nodes, start: when, loop: !!o.loop,
      end, actor: o.actor || null, tag: o.tag || null, recorded,
      position: pos, occluded, baseGain, entryGain, stopped: false, footstep: !!o.footstep,
    };
    src.onended = () => this._release(voice);
    this.voices.push(voice);
    this.stats.played++; if (recorded) this.stats.recorded++;
    return voice;
  }

  _setPannerPos(p, pos) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
  }

  /** Stimmenbegrenzung: Gruppen- und Gesamtlimit, verdrängt niedrigste Priorität/älteste Stimme. */
  _admit(e, prio) {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter(v => !v.stopped && v.end > now - 0.05);
    const pickVictim = list => list.reduce((w, v) => (!w || v.prio < w.prio || (v.prio === w.prio && v.start < w.start) ? v : w), null);
    if (e.group) {
      const same = this.voices.filter(v => v.group === e.group);
      if (same.length >= e.cap) {
        const victim = pickVictim(same);
        if (!victim || victim.prio > prio) return false;
        this._kill(victim, 0.03); this.stats.stolen++;
      }
    }
    const live = this.voices.filter(v => !v.stopped);
    if (live.length >= this.maxVoices) {
      const victim = pickVictim(live.filter(v => !v.loop));
      if (!victim || victim.prio > prio) return false;
      this._kill(victim, 0.03); this.stats.stolen++;
    }
    return true;
  }

  _kill(v, fade = 0.05) {
    if (!v || v.stopped) return;
    v.stopped = true;
    const t = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.005, fade));
      v.src.stop(t + Math.max(0.01, fade) + 0.02);
    } catch { this._release(v); }
  }

  _release(v) {
    v.stopped = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch { /* bereits getrennt */ } }
    const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1);
  }

  /** Alle Stimmen stoppen (Schleifen inklusive). */
  stopAll(fade = 0.1) { for (const v of this.voices.slice()) this._kill(v, fade); }

  // ================================================================ Räumliches

  _v3(p) {
    const T = this.G.THREE;
    return T ? new T.Vector3(p.x, p.y, p.z) : { x: p.x, y: p.y, z: p.z };
  }

  _losAllowed() {
    const ms = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (ms - this._losWindow > 16) { this._losWindow = ms; this._losBudget = 8; }
    return this._losBudget-- > 0;
  }

  /** Verdeckung Hörer↔Quelle über world.lineOfSight, pro Quelle gecacht (0,25 s). */
  _occluded(pos, actor, low = false) {
    const w = this.G.world; if (!w?.lineOfSight || !this.listener.valid) return false;
    const key = actor?.id ?? `${Math.round(pos.x)}|${Math.round(pos.y)}|${Math.round(pos.z)}`;
    const now = this.ctx.currentTime, c = this._occl.get(key);
    if (c && now - c.t < 0.25) return c.v;
    if (!this._losAllowed()) return c ? c.v : false;
    let v = false;
    try {
      const from = this._v3(this.listener), to = this._v3({ x: pos.x, y: pos.y + (low ? 1.2 : 0.1), z: pos.z });
      v = !w.lineOfSight(from, to);
    } catch { v = false; }
    this._occl.set(key, { t: now, v });
    if (this._occl.size > 256) this._occl.delete(this._occl.keys().next().value);
    return v;
  }

  /**
   * Raum der Quelle (Plan §10 A2: Quelle und Hörer getrennt): { ind 0..1, size m }.
   * Spieler/2D = Raum am Hörer. Positional: Sonde an der Quelle (Decke + Seiten, gecacht) gemischt mit dem Hörer.
   */
  _roomOf(pos, o) {
    const S = this.acoustics.state, lsize = S.valid ? S.meanFree : 20;
    if (o.indoor != null) return { ind: o.indoor ? 1 : 0, size: o.indoor ? Math.min(lsize, 12) : 30 };
    if (this.envMode === 'indoor') return { ind: 1, size: lsize };
    if (this.envMode === 'outdoor') return { ind: 0, size: 40 };
    if (!pos) return { ind: this._indoor, size: lsize };
    const key = o.actor?.id ?? `${Math.round(pos.x / 3)}|${Math.round(pos.z / 3)}`;
    const r = this.acoustics.source(pos, key, this.ctx.currentTime, () => this._losAllowed());
    if (!r) return { ind: this._indoor, size: lsize };
    return { ind: 0.55 * r.indoor + 0.45 * this._indoor, size: r.size };
  }
  /**
   * Umweg um Hindernisse über world.nav.findPath (A*), gecacht je Quell-/Hörerzelle (1,5 s), höchstens alle
   * 0,15 s (Handy 0,35 s) eine neue Suche. → { pos (scheinbare Position), extra (s), lp (Hz), gain } | null
   */
  _diffract(pos, actor) {
    const nav = this.G.world?.nav, L = this.listener, T = this.G.THREE;
    if (!nav?.findPath || !L.valid || !T) return null;
    const key = `${Math.round(pos.x / 4)}|${Math.round(pos.z / 4)}|${Math.round(pos.y / 3)}>${Math.round(L.x / 4)}|${Math.round(L.z / 4)}|${Math.round(L.y / 3)}`;
    const now = this.ctx.currentTime, c = this._dif.get(key);
    if (c && now - c.t < 1.5) return c.r;
    if (now - this._difT < (this._quality() === 'low' ? 0.35 : 0.15)) return c ? c.r : null;
    this._difT = now;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let r = null;
    try {
      const feet = this._feet(actor);
      const from = new T.Vector3(L.x, L.y - 1.55, L.z), to = feet ? new T.Vector3(feet.x, feet.y, feet.z) : new T.Vector3(pos.x, pos.y, pos.z);
      const path = nav.findPath(from, to);
      if (path.length) {
        let len = 0, prev = from; for (const q of path) { len += prev.distanceTo(q); prev = q; }
        const straight = from.distanceTo(to);
        if (len < straight * 2.2 + 25) {
          let first = path[0]; if (first.distanceTo(from) < 1.2 && path.length > 1) first = path[1];
          const dx = first.x - from.x, dz = first.z - from.z, dl = Math.hypot(dx, dz) || 1, corners = Math.max(1, path.length - 1);
          r = { pos: { x: L.x + dx / dl * len, y: L.y, z: L.z + dz / dl * len }, extra: Math.max(0, (len - straight) / 343), lp: clamp(9000 / (1 + 0.9 * corners), 1500, 7000), gain: clamp(0.85 - 0.08 * corners, 0.5, 0.8), corners, len };
        }
      }
    } catch { r = null; }
    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    this.stats.diffractions++; this.stats.diffractMs += ms; if (ms > this.stats.diffractMaxMs) this.stats.diffractMaxMs = ms;
    this._dif.set(key, { t: now, r });
    if (this._dif.size > 128) this._dif.delete(this._dif.keys().next().value);
    return r;
  }

  /** Rückwärtskompatibel: nur der Innenanteil. */
  _indoorMix(pos, o) { return this._roomOf(pos, o).ind; }

  /** Umgebung erzwingen ('indoor' | 'outdoor') oder automatisch ('auto'). */
  setEnvironment(mode = 'auto') { this.envMode = mode; if (mode !== 'auto') this._indoor = mode === 'indoor' ? 1 : 0; }

  _updateListener() {
    const cam = this.G.camera, ctx = this.ctx, L = this.listener;
    if (!cam?.matrixWorld) { L.valid = false; return; }
    try { cam.updateWorldMatrix ? cam.updateWorldMatrix(true, false) : cam.updateMatrixWorld?.(); } catch { /* */ }
    const m = cam.matrixWorld.elements;
    L.x = m[12]; L.y = m[13]; L.z = m[14];
    let fx = -m[8], fy = -m[9], fz = -m[10]; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let ux = m[4], uy = m[5], uz = m[6]; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const rl = Math.hypot(m[0], m[2]) || 1;
    L.fx = fx; L.fy = fy; L.fz = fz; L.rx = m[0] / rl; L.rz = m[2] / rl; L.valid = true;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else { l.setPosition(L.x, L.y, L.z); l.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  // ================================================================ Update

  /** Pro Frame: Hörer folgt der Kamera, Raumsonde/Reflexionen, Schleifen-Verdeckung, Gehör, HDR, Foley, Dämpfung. */
  update(dt = 1 / 60) {
    if (!this.ctx || !this.unlocked) return;
    dt = clamp(dt, 0, 0.1);
    this._updateListener();
    // Raum am Hörer: Strahlen reihum (Handy 1, sonst 2 je Bild) oder Sonden-Gitter der Welt
    const w = this.G.world, L = this.listener;
    this.acoustics.setWorld(w, this.G.THREE);
    if (w && L.valid) {
      const st = this.acoustics.update(L, dt, this._quality() === 'low' ? 1 : 2);
      if (this.envMode === 'auto' && st.valid) this._indoor = st.indoor;
      this._erT -= dt;
      if (this._erT <= 0 && this.er) { this._erT = 0.1; this.er.set(this.acoustics.taps({ x: L.rx, z: L.rz }, this._taps)); }
    } else if (this.envMode === 'auto') this._indoor += (0 - this._indoor) * Math.min(1, dt * 2);
    // Positionale Schleifen: Verdeckung nachführen
    for (const v of this.voices) {
      if (!v.loop || !v.position || !v.filter || v.stopped) continue;
      const occ = this._occluded(v.position, v.actor);
      if (occ !== v.occluded) {
        v.occluded = occ; const t = this.ctx.currentTime;
        v.filter.frequency.setTargetAtTime(occ ? 900 : NO_MUFFLE, t, 0.08);
        v.gain.gain.setTargetAtTime(v.baseGain * (occ ? 0.55 : 1), t, 0.08);
      }
    }
    this.hdr.update(dt); this._applyHdr();
    this._muffle.hearing = this.hearing.update(dt);
    this._updateVitals(dt);
    this._updateFoley(dt);
    this._applyMuffle();
  }

  /** HDR-Fenster → Dämpfung der leisen Busse (Angriff sofort, Rückkehr über das Fenster). */
  _applyHdr(now = false) {
    if (!this.hdrQ) return;
    const db = this.hdr.duck();
    if (Math.abs(db - this._hdrDb) < (now ? 0.25 : 0.4)) return;
    const t = this.ctx.currentTime, down = db < this._hdrDb;
    this._hdrDb = db;
    const g = dbg(db), tau = down ? 0.012 : 0.08;
    this.hdrQ.gain.setTargetAtTime(g, t, tau);
    this.hdrAmb.gain.setTargetAtTime(dbg(db * 1.2), t, tau);
  }

  _updateVitals(dt) {
    const p = this.G.player, playing = this.G.match ? this.G.match.state === 'playing' : !!this._attached;
    const hp = p && typeof p.health === 'number' ? p.health : 100;
    if (p && p.alive !== false && hp < 35 && hp > 0 && playing) {
      const sev = 1 - hp / 35;
      this._hb -= dt;
      if (this._hb <= 0) { this.play('heartbeat', { volume: 0.55 + 0.45 * sev }); this._hb = lerp(0.95, 0.55, sev); }
      this._br -= dt;
      if (this._br <= 0) {
        this.play(this._brIn ? 'breath_in' : 'breath_out', { volume: 0.4 + 0.5 * sev });
        this._brIn = !this._brIn; this._br = lerp(this._brIn ? 1.0 : 0.85, this._brIn ? 0.7 : 0.6, sev);
      }
      this._muffle.health = lerp(5200, 1700, sev);
      this._lowHp = true;
    } else {
      this._hb = 0.1; this._br = 0.4; this._brIn = true;
      this._muffle.health = NO_MUFFLE;
      this._lowHp = false;
    }
  }

  /**
   * Foley (Plan §10 A7): Kleidung raschelt beim schnellen Umsehen, Atmen nach dem Sprint (Erschöpfung).
   * Liest nur Kamera und Spielerzustand – keine Abhängigkeit von Eingabegeräten.
   */
  _updateFoley(dt) {
    const F = this._foley, p = this.G.player, L = this.listener;
    if (!p || p.alive === false || this.G.match?.state !== 'playing' || !L.valid || dt <= 0) { F.yaw = null; F.sprintT = 0; F.breaths = 0; return; }
    const yaw = Math.atan2(L.fx, L.fz);
    if (F.yaw != null) {
      let d = yaw - F.yaw; if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      const rate = Math.abs(d) / dt; // rad/s
      F.rustleT -= dt;
      if (rate > 4.2 && F.rustleT <= 0) { F.rustleT = 0.42; this.play('rustle', { player: true, volume: clamp((rate - 4.2) / 7, 0.25, 0.9), pan: d > 0 ? -0.25 : 0.25 }); }
    }
    F.yaw = yaw;
    const exhausted = !!p.weapon?.exhausted;
    if (p.sprinting) F.sprintT += dt;
    else if (F.sprintT > 0) {
      if (F.sprintT > 2.5 && !this._lowHp) { F.breaths = Math.round(clamp(2 + F.sprintT / 1.6, 3, 8)); F.breathT = 0.35; F.breathIn = true; F.level = clamp(0.5 + F.sprintT / 12, 0.5, 1); }
      F.sprintT = 0;
    }
    if (exhausted && F.breaths < 2 && !this._lowHp) { F.breaths = 2; F.level = Math.max(F.level || 0, 0.7); }
    if (F.breaths > 0 && !this._lowHp && !p.sprinting) {
      F.breathT -= dt;
      if (F.breathT <= 0) {
        const lvl = (F.level || 0.6) * (0.55 + 0.45 * Math.min(1, F.breaths / 4));
        this.play(F.breathIn ? 'breath_in' : 'breath_out', { volume: 0.26 * lvl, pitch: 1.07, priority: 2 });
        if (!F.breathIn) F.breaths--;
        F.breathT = F.breathIn ? 0.42 + 0.1 * (1 - lvl) : 0.5 + 0.25 * (1 - lvl);
        F.breathIn = !F.breathIn;
      }
    }
  }

  _muffleTarget() {
    const m = this._muffle;
    return Math.min(m.health, m.hearing, m.pause ? 900 : NO_MUFFLE, m.dead ? 1100 : NO_MUFFLE);
  }

  _applyMuffle(force = false) {
    if (!this.muffle) return;
    const t = this.ctx.currentTime, f = this._muffleTarget(), cur = this._muffle.current;
    if (!force && Math.abs(f - cur) < Math.max(40, cur * 0.03)) return;
    this._muffle.current = f;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(f, t, f > this.muffle.frequency.value ? 0.25 : 0.03);
  }

  /** Explosion/Blendgranate ganz nah: Gehör-Dosis (dumpf + Pfeifton, klingt langsam ab), Atmo kurz weg. */
  concuss(strength = 1) {
    if (!this.muffle) return;
    const s = clamp(strength), t = this.ctx.currentTime;
    this.hearing.expose(0.3 + 0.95 * s);
    this._muffle.hearing = this.hearing.muffle;
    this._applyMuffle(true);
    this.ambDuck.gain.cancelScheduledValues(t);
    this.ambDuck.gain.setTargetAtTime(0.35, t, 0.02); this.ambDuck.gain.setTargetAtTime(1, t + 1.5, 1);
  }

  /** Gehör-Dosis direkt erhöhen (z. B. Blendgranate über eigene Ereignisse). 0 … ~1,6 */
  exposeHearing(amount) { this.hearing.expose(amount); this._muffle.hearing = this.hearing.muffle; this._applyMuffle(true); }

  // ================================================================ Spiel-Klanglogik

  _isPlayer(a) { return !!a && (a.isPlayer === true || a === this.G.player); }
  _hostile(a) {
    const P = this.G.player; if (!a || !P || a === P) return false;
    try { if (this.G.combat?.isHostile) return !!this.G.combat.isHostile(P, a); } catch { /* */ }
    return a.team == null || a.team !== P.team;
  }
  _eye(a) {
    if (!a) return null;
    try { if (a.getEyePosition) { const T = this.G.THREE; const o = T ? new T.Vector3() : { x: 0, y: 0, z: 0, set() {} }; const r = a.getEyePosition(o); return xyz(r || o); } } catch { /* */ }
    const p = a.position || a.body?.position; return p ? { x: p.x, y: p.y + 1.55, z: p.z } : null;
  }
  _feet(a) { const p = a?.position || a?.body?.position; return p ? xyz(p) : null; }
  _voicePitch(a) { return a ? 0.88 + ((hashString(String(a.id ?? a.name ?? 'x')) % 1000) / 1000) * 0.26 : 1; }

  weaponDef(id) { return (WEAPONS && id && WEAPONS[id]) || null; }
  profileFor(id, def = this.weaponDef(id)) {
    const p = def?.sound?.profile;
    if (p && GUN_PROFILES[p]) return p;
    if (ID_PROFILE[id]) return ID_PROFILE[id];
    if (def?.cls && CLASS_PROFILE[def.cls]) return CLASS_PROFILE[def.cls];
    const pre = String(id || '').split('_')[0];
    return PREFIX_PROFILE[pre] || 'ar';
  }
  /**
   * Aufnahme-Stimme einer Waffe: `WEAPONS[id].sound.voice` (z. B. 'dmr', 'lever', 'sniper_heavy'), sonst
   * Präzisionsgewehre → 'dmr' (SKS-Aufnahme), sonst das Klangprofil. Fehlt die Stimme, gilt das Profil.
   */
  voiceFor(id, def = this.weaponDef(id), profile = this.profileFor(id, def)) {
    const v = def?.sound?.voice;
    if (v && (GUN_PROFILES[v] || EXTRA_VOICES[v])) return v;
    if (def?.cls === 'marksman') return 'dmr';
    return profile;
  }
  _isKnife(id, def) { return id === 'knife' || def?.cls === 'melee'; }

  /** Nahschuss-Aufnahme für Stimme/Profil (geladen) oder null. */
  _nearRec(voice, profile) { return this._recName(`gun_${voice}`) || (voice !== profile ? this._recName(`gun_${profile}`) : null); }

  /**
   * Schuss (Plan §10 A1). Mit Aufnahmen: Nah-Aufnahme (Variante/Tonhöhe/EQ zufällig) + Mechanik (Aufnahme, nur
   * Spieler) + Ich-Perspektive (Synthese: Druckstoß, Verschluss) + Nachhall (außen Aufnahme-Fahne, innen Faltung)
   * + frühe Reflexionen. Gegner positional mit Nah/Fern-Überblendung (16–60 m, Fern-Aufnahme mit echten Echos),
   * Laufzeit (Abstand / 343 m/s), Luftdämpfung, Verdeckung; > 150 m zusätzlich Tiefpass.
   * Ohne Aufnahme: bisherige Synthese.
   */
  _gunshot(profile, o = {}) {
    const isPlayer = o.player || this._isPlayer(o.actor) || (!o.position && o.distance == null);
    const voice = o.voice && (GUN_PROFILES[o.voice] || EXTRA_VOICES[o.voice]) ? o.voice : profile;
    const nearName = this._nearRec(voice, profile);
    if (!this.G.events?.on && this._recOn() && !nearName) library.request([`gun_${voice}`, `gun_${profile}`], PRIO.urgent); // Website: beim ersten Schuss nachladen
    if (!nearName) return this._gunshotProc(profile, o, isPlayer);
    const low = this._quality() === 'low', sup = !!o.suppressed, vol = o.volume ?? 1, pitch = o.pitch ?? 1;
    const pistol = profile === 'pistol' || profile === 'pistol_heavy';
    const supName = sup && pistol ? this._recName('gunsup_pistol') : null;
    const supRifle = sup && !supName;
    const nearE = entryOf(supName || nearName);
    const nearGain = nearE.gain * this._recGain(supName || nearName);
    const tailName = this._recName(`guntail_${voice}`) || this._recName(`guntail_${profile}`);
    const P = this._preset || MIX_PRESETS.kopfhoerer;

    if (isPlayer) {
      const room = this._roomOf(null, o), ind = room.ind;
      const v = this._spawn(nearE, {
        ...o, position: null, player: true, priority: 3, pitch, eq: !low && this.layers.eq, volume: vol * dbg(PLAYER_NEAR_DB + (PLAYER_TRIM[profile] || 0)) * (supRifle ? 0.18 : 1),
        lowpass: supRifle ? 3400 : 0, highpass: supRifle ? 220 : 0, env: (o.env ?? 1) * 0.4, echo: 0.5,
        er: supRifle || supName ? 0.45 : 1, loud: sup ? -14 : -3, drive: !sup,
      });
      // Mechanik am Ohr (Aufnahme, unter dem Schuss; mit Schalldämpfer hört man sie deutlich)
      const mech = MECH_OF[voice] || MECH_OF[profile];
      if (mech && !low && this.layers.mech) this.play(mech, { player: true, priority: 3, volume: vol * nearGain * dbg(MECH_DB) * (sup ? 1.8 : 1), pitch: pitch * this._rand.range(0.97, 1.03), env: 0, _deferred: true });
      // Ich-Perspektive (Synthese): Druckstoß auf den Brustkorb + Verschluss – je Wiedergabeprofil (Handy kaum Bass)
      const fp = CATALOG[`gunfp_${profile}`];
      if (fp && P.sub > 0.05 && this.layers.fp) this._spawn(fp, { player: true, priority: 3, volume: vol * P.sub * (sup ? 0.55 : 1) * (low ? 0.8 : 1), pitch, _deferred: true }); // Schichten nie verspätet
      // Außen-Nachhall (Aufnahme), Pegel an den Nahschuss gekoppelt; innen übernimmt die Faltung
      if (tailName && ind < 0.95 && this.layers.tail) this._tail(tailName, o.actor || 'player', nearGain * vol * dbg(TAIL_DB) * (1 - ind) * (sup ? 0.3 : 1), 0.004, pitch);
      // Gehör: Schüsse in engen Räumen (Plan §10 A6)
      const small = clamp((10 - room.size) / 7);
      this.hearing.expose((SHOT_DOSE[profile] || 0.03) * (sup ? 0.15 : 1) * (0.06 + 0.94 * ind * small));
      return v;
    }

    const pos = xyz(o.position), dist = o.distance ?? this._dist(pos);
    const x = smooth(16, 60, dist), near = Math.cos(x * Math.PI / 2), far = Math.sin(x * Math.PI / 2);
    const delay = (o.delay || 0) + Math.min(1.5, dist / 343);
    const lpFar = dist > 150 ? Math.max(900, 4200 - (dist - 150) * 9) : 0;
    const base = { ...o, position: pos, delay, pitch, lowpass: supRifle ? 2600 : lpFar };
    let v = null;
    if (near > 0.05) v = this._spawn(nearE, { ...base, volume: vol * near * (supRifle ? 0.35 : 1), eq: dist < 25 && !low && this.layers.eq, highpass: supRifle ? 200 : 0, echo: 0.6 });
    if (far > 0.05) {
      const farName = this._recName(`gunfar_${voice}`) || this._recName(`gunfar_${profile}`);
      const fe = farName ? entryOf(farName) : CATALOG[`gunfar_${profile}`];
      v = this._spawn(fe, { ...base, proc: !farName, volume: vol * far * 1.15 * (farName ? dbg(FAR_DB) : 1) * (sup ? 0.4 : 1), echo: 0.5 }) || v;
    }
    // Nahe Gegner draußen: diffuse Aufnahme-Fahne (2D, verzögert wie der Direktschall)
    if (tailName && near > 0.3 && !sup && dist < 40 && this.layers.tail && !low) { // Handy: Stimmenbudget → nur eigene Fahne
      const room = this._roomOf(pos, o);
      if (room.ind < 0.7) {
        const wd = 7 / (7 + 0.3 * Math.max(0, dist - 7));
        this._tail(tailName, o.actor || pos, nearGain * vol * dbg(TAIL_DB) * (1 - room.ind) * near * wd * 0.8, delay + 0.004, pitch);
      }
      if (dist < 4 && room.ind > 0.4) this.hearing.expose((SHOT_DOSE[profile] || 0.03) * 0.5 * (1 - dist / 4) * room.ind);
    }
    return v;
  }

  /** Nachhall-Fahne je Schütze nachtriggern (alte kurz ausblenden) → höchstens 2 Fahnen je Schütze. Außen ≤ 1,5 s. */
  _tail(name, key, gain, delay, pitch) {
    const old = this._tails.get(key);
    if (old && !old.stopped && this.ctx.currentTime < old.start + 0.12) return; // Feuerstoß: Fahne läuft schon
    if (old && !old.stopped) this._kill(old, 0.12);
    const v = this._spawn(entryOf(name), { volume: gain, delay, pitch, fadeAt: 0.95, fadeLen: 0.55, priority: 2, env: 0, er: 0, _deferred: true });
    if (v) { this._tails.set(key, v); if (this._tails.size > 32) this._tails.delete(this._tails.keys().next().value); }
  }

  /** Bisheriger Synthese-Schuss (ohne Aufnahmen). */
  _gunshotProc(profile, o, isPlayer) {
    const vol = (o.volume ?? 1) * (o.suppressed ? 0.42 : 1), pitch = o.pitch ?? 1, lp = o.suppressed ? 2400 : 0;
    if (isPlayer) {
      const v = this._spawn(CATALOG[`gun_${profile}`], { ...o, proc: true, position: null, priority: 3, env: (o.env ?? 1) * 0.4, volume: vol, pitch, lowpass: lp, loud: o.suppressed ? -14 : -3 });
      const room = this._roomOf(null, o);
      this.hearing.expose((SHOT_DOSE[profile] || 0.03) * (o.suppressed ? 0.15 : 1) * (0.06 + 0.94 * room.ind * clamp((10 - room.size) / 7)));
      return v;
    }
    const pos = xyz(o.position), dist = o.distance ?? this._dist(pos);
    const x = smooth(16, 60, dist), near = Math.cos(x * Math.PI / 2), far = Math.sin(x * Math.PI / 2);
    const delay = (o.delay || 0) + Math.min(1.5, dist / 343);
    const base = { ...o, proc: true, position: pos, delay, pitch, lowpass: lp };
    let v = null;
    if (near > 0.05) v = this._spawn(CATALOG[`gun_${profile}`], { ...base, volume: vol * near });
    if (far > 0.05) v = this._spawn(CATALOG[`gunfar_${profile}`], { ...base, volume: vol * far * 1.15 }) || v;
    return v;
  }

  /** Hülsen fallen (Aufnahme je Untergrund), 0,35–0,7 s nach dem Schuss; nur Spieler und nahe Schützen. */
  _shell(a, profile, pl, at = 0) {
    // Physik-Hülsen (effects.dropCasing → 'shell:land') übernehmen, sobald es sie gibt
    if (this._casingEvents || typeof this.G.effects?.dropCasing === 'function') return;
    const t = this.ctx.currentTime, last = this._shellAt.get(a) ?? -9;
    if (t - last < 0.09) return;
    this._shellAt.set(a, t);
    const surf = this._surf.get(a) || 'concrete', kind = SHELL_SURF[surf];
    if (!kind) return; // Sand, Gras, Wasser, Stoff: praktisch lautlos
    const name = profile === 'shotgun' ? 'shell_shotgun' : kind === 'soft' ? 'shell_concrete' : kind;
    const feet = pl ? null : this._feet(a);
    if (!pl && (!feet || this._dist(feet) > 12)) return;
    const d = at + this._rand.range(0.35, 0.7);
    this.play(name, pl
      ? { player: true, pan: 0.35, delay: d, volume: kind === 'soft' ? 0.25 : 0.55, lowpass: kind === 'soft' ? 1800 : 0, env: 0.5 }
      : { position: { x: feet.x, y: feet.y + 0.05, z: feet.z }, actor: a, delay: d, volume: kind === 'soft' ? 0.3 : 0.7, lowpass: kind === 'soft' ? 1800 : 0 });
  }

  _footstep(o) {
    const raw = String(o.surface || 'concrete'), s = this._surface(raw);
    const name = raw === 'gravel' && this._recName('step_gravel', true) ? 'step_gravel' : `step_${s}`;
    if (o.actor) this._surf.set(o.actor, s);
    const vol = o.volume ?? (o.crouch ? 0.45 : o.sprint ? 1 : 0.75);
    const v = this.play(name, { ...o, volume: vol, lowpass: o.crouch ? 1900 : o.lowpass, footstep: true, pitch: (o.pitch ?? 1) * (o.sprint ? 1.04 : 1) });
    // Ausrüstung klappert nach Tempo (Plan §10 A7): gehen leise, sprinten deutlich, geduckt kaum
    const gear = o.sprint ? 0.6 : o.crouch ? 0.08 : 0.24;
    if (gear > 0.1 && (o.player || o.sprint || this._dist(xyz(o.position)) < 10)) this.play('gear', { ...o, volume: vol * gear, footstep: true, delay: (o.delay || 0) + 0.01 });
    return v;
  }

  _explosion(p) {
    const type = String(p.type || '').toLowerCase();
    if (FLASH_TYPES.has(type)) return this._flash(p);
    if (SMOKE_TYPES.has(type)) return this._smoke(p);
    const pos = xyz(p.position); if (!pos) return null;
    const dist = this._dist(pos), x = smooth(22, 85, dist);
    const near = Math.cos(x * Math.PI / 2), far = Math.sin(x * Math.PI / 2), delay = Math.min(1.5, dist / 343);
    const vol = p.volume ?? 1, P = this._preset || MIX_PRESETS.kopfhoerer;
    let v = null;
    if (near > 0.05) v = this._spawn(CATALOG.explosion, { position: pos, volume: vol * near, delay, priority: 3, occlusion: dist > 8 });
    if (far > 0.05) v = this._spawn(CATALOG.explosion_far, { position: pos, volume: vol * far * 1.2, delay, priority: 2 }) || v;
    // Hybrid: Sub-Druck unter der Aufnahme (Erschütterung), nachrieselnde Trümmer in der Nähe
    if (v?.recorded && this.layers.sub) {
      if (dist < 140 && P.sub > 0.05) this._spawn(CATALOG.boom_sub, { position: pos, volume: vol * P.sub * (0.5 + 0.5 * near), delay, priority: 2, _deferred: true });
      if (dist < 35) this._spawn(CATALOG.debris, { position: pos, volume: vol * (1 - dist / 35), delay: delay + this._rand.range(0.2, 0.35), _deferred: true });
    }
    const r = (p.radius || 6.5) * 1.5, pl = this.G.player;
    if (p.concuss !== false && this.listener.valid && dist < r && (!pl || pl.alive !== false)) this.concuss(1 - dist / r);
    else if (this.listener.valid && dist < r * 2.2) this.hearing.expose(0.18 * (1 - dist / (r * 2.2)));
    return v;
  }

  /** Blendgranate: scharfer Knall; in Sichtlinie und nah → starke Gehör-Dosis (Klingeln, dumpf). */
  _flash(p) {
    const pos = xyz(p.position); if (!pos) return null;
    const dist = this._dist(pos), delay = Math.min(1.5, dist / 343);
    if (!this._anyReady(CATALOG.flashbang)) { this._playSoon('flashbang', { position: pos, priority: 3 }); }
    const v = this._anyReady(CATALOG.flashbang) ? this._spawn(CATALOG.flashbang, { position: pos, volume: p.volume ?? 1, delay, priority: 3, occlusion: dist > 6 }) : null;
    const pl = this.G.player;
    if (this.listener.valid && dist < 22 && (!pl || pl.alive !== false)) {
      const occ = this._occluded(pos, null);
      this.hearing.expose(1.6 * Math.pow(1 - dist / 22, 1.2) * (occ ? 0.35 : 1));
      this._muffle.hearing = this.hearing.muffle; this._applyMuffle(true);
    }
    return v;
  }

  /** Rauchgranate: Zünder + Zischen als Schleife für die Brenndauer. */
  _smoke(p) {
    const pos = xyz(p.position); if (!pos) return null;
    const dur = clamp(+p.duration || 12, 2, 40);
    const start = () => {
      const h = this.loop('smoke_hiss', { position: pos, volume: p.volume ?? 1 });
      if (h) { const t = setTimeout(() => h.stop(2.5), (dur - 2) * 1000); (this._timers || (this._timers = new Set())).add(t); }
    };
    if (this._anyReady(CATALOG.smoke_hiss)) start();
    else this._require(['smoke_hiss'], ok => { if (ok && !this._disposed) start(); });
    return null;
  }

  /**
   * Geschoss passiert den Hörer nah (Plan §10 A5): Überschall → scharfer Knall (N-Welle, Synthese) zuerst, der
   * Mündungsknall kommt später (Abstand / 343 m/s); Unterschall → Pfeifen (Aufnahme/Synthese). Genaue Daten liefert
   * combat über 'bullet:whiz' (echter Strahl mit Streuung); sonst Schätzung aus weapon:fire. Je Schütze und Takt
   * höchstens ein Vorbeiflug (Schrot: der nächste).
   */
  _queuePass(shooter, pass) {
    const k = shooter || pass;
    pass.rec = this.recordings; // A/B im Prüfstand: Zustand zum Schusszeitpunkt
    const cur = this._pass.get(k);
    if (!cur || pass.miss < cur.miss) this._pass.set(k, pass);
    this._flushSoon();
  }
  _flushSoon() {
    if (this._passQueued) return;
    this._passQueued = true;
    queueMicrotask(() => { this._passQueued = false; this._flushPasses(); });
  }
  _flushPasses() {
    const est = this._pass, ev = this._whiz;
    this._pass = new Map(); this._whiz = new Map();
    for (const [k, w] of ev) { this._playPass(w); est.delete(k); }
    // Schätzung nur, wenn combat keine genauen Meldungen liefert – oder für weitere Abstände (> 2,2 m) als combat meldet
    for (const p of est.values()) if (!this._combatWhiz || p.miss > 2.2) this._playPass(p);
  }

  _passFromFire(p, profile, def) {
    const L = this.listener, o = xyz(p.origin), d = xyz(p.dir);
    if (!L.valid || !o || !d) return;
    const dl = Math.hypot(d.x, d.y, d.z) || 1; d.x /= dl; d.y /= dl; d.z /= dl;
    const wx = L.x - o.x, wy = L.y - o.y, wz = L.z - o.z, t = wx * d.x + wy * d.y + wz * d.z;
    const range = def?.range || 250;
    if (t < 3 || t > range) return;
    const cx = o.x + d.x * t, cy = o.y + d.y * t, cz = o.z + d.z * t;
    const miss = Math.hypot(cx - L.x, cy - L.y, cz - L.z), crack = !!SUPERSONIC[profile];
    if (miss > (crack ? 6 : 3.5)) return;
    const w = this.G.world;
    if (w?.raycast) { // Wand dazwischen? Dann kein Vorbeiflug
      try { const hit = w.raycast(this._v3(o), this._v3(d), t - 0.6); if (hit && hit.distance < t - 0.6) return; } catch { /* */ }
    }
    this._queuePass(p.actor, { profile, miss, t, cx, cy, cz, dx: d.x, dz: d.z });
  }

  _passFromWhiz(e) {
    const s = e.shooter, pos = xyz(e.position); if (!pos) return;
    const shot = s ? this._shots.get(s) : null;
    const profile = shot?.profile || this.profileFor(s?.weapon?.currentDef?.id || s?.weapon?.current?.id);
    const o = shot?.origin || this._eye(s) || pos;
    let dx = pos.x - o.x, dz = pos.z - o.z; const t = Math.hypot(dx, pos.y - o.y, dz) || 1; dx /= t; dz /= t;
    const w = { profile, miss: +e.distance || 1, t, cx: pos.x, cy: pos.y, cz: pos.z, dx, dz, rec: this.recordings };
    const cur = this._whiz.get(s || w);
    if (!cur || w.miss < cur.miss) this._whiz.set(s || w, w);
    this._flushSoon();
  }

  _playPass(p) {
    const prev = this.recordings;
    if (p.rec != null) this.recordings = p.rec;
    try { this._playPass1(p); } finally { this.recordings = prev; }
  }

  _playPass1({ profile, miss, t, cx, cy, cz, dx, dz }) {
    const crack = !!SUPERSONIC[profile], v = BULLET_SPEED[profile] || 700;
    const at = t / v; // Ankunft des Geschosses; der Mündungsknall folgt mit t / 343
    if (crack) {
      // N-Welle: Kegel-Normale zeigt nach vorn → scheinbar etwas vor dem Vorbeiflugpunkt
      this.play('bullet_crack', {
        position: { x: cx + dx * 1.5, y: cy, z: cz + dz * 1.5 }, volume: clamp(1.25 - miss / 4, 0.18, 1), lowpass: miss > 2.5 ? 7000 : 0,
        delay: at + miss / 343, priority: 2, occlusion: false, loud: -8,
      });
      if (miss < 2) this.play('bullet_whiz', { position: { x: cx + dx * 0.8, y: cy, z: cz + dz * 0.8 }, volume: 0.32, delay: at + 0.012, priority: 1, occlusion: false });
    } else {
      this.play('bullet_whiz', {
        position: { x: cx + dx * 1.5, y: cy, z: cz + dz * 1.5 }, volume: clamp(1.15 - miss / 3.5, 0.25, 1),
        delay: Math.max(0, at - 0.08), priority: 2, occlusion: false,
      });
    }
  }

  _cancelReload(a) {
    const list = a && this._reloads.get(a); if (!list) return;
    for (const v of list) this._kill(v, 0.03);
    this._reloads.delete(a);
  }

  _reload(p) {
    const a = p.actor, pl = this._isPlayer(a), def = this.weaponDef(p.weaponId), prof = this.profileFor(p.weaponId, def);
    const pos = pl ? null : this._eye(a);
    if (!pl && (!pos || this._dist(pos) > 24)) return;
    const shell = !!def?.perShellReload || (def == null && prof === 'shotgun');
    const base = { player: pl, position: pos, actor: a, volume: pl ? 0.9 : 0.8 };
    const track = v => { if (!v || !a) return; const l = this._reloads.get(a) || []; l.push(v); this._reloads.set(a, l.filter(x => !x.stopped)); };
    if (p.phase === 'start') {
      this._cancelReload(a);
      if (shell) { track(this.play('ads_out', { ...base, volume: 0.7 })); return; }
      const T = (p.empty ? def?.reloadEmptyTime : def?.reloadTime) || RELOAD_TIME[prof] * (p.empty ? 1.25 : 1);
      const seq = prof === 'lmg'
        ? [['reload_bolt', 0.06], ['reload_mag_out', 0.22], ['reload_mag_in', 0.58], ['reload_bolt', 0.82]]
        : [['reload_mag_out', 0.12], ['reload_mag_in', 0.55]];
      // Leer: Verschluss/Schlitten vor – Pistolen mit echter Schlitten-Aufnahme
      const pistol = prof === 'pistol' || prof === 'pistol_heavy';
      if (p.empty && prof !== 'lmg') seq.push([prof === 'sniper' ? 'bolt' : pistol && this._recName('slide_release', true) ? 'slide_release' : 'reload_bolt', 0.78]);
      for (const [n, f] of seq) track(this.play(n, { ...base, delay: T * f }));
    } else if (p.phase === 'insert') {
      if (shell) track(this.play('reload_shell', base));
    } else if (p.phase === 'end') {
      this._reloads.delete(a);
      if (shell && p.empty) this.play(def?.fireMode === 'bolt' ? 'bolt' : 'pump', base);
    }
  }

  _playerHurt({ amount = 10, attacker = null }) {
    const now = this.ctx.currentTime;
    if (now - this._t.hurt < 0.03) return;
    this._t.hurt = now;
    let pos = null; const L = this.listener, ap = this._feet(attacker);
    if (ap && L.valid) {
      const dx = ap.x - L.x, dz = ap.z - L.z, dl = Math.hypot(dx, dz) || 1;
      pos = { x: L.x + dx / dl * 1.2, y: L.y - 0.3, z: L.z + dz / dl * 1.2 };
    }
    this.play('hit_flesh', { position: pos, volume: clamp(0.55 + amount / 60, 0.55, 1), priority: 3, occlusion: false, env: 0 });
    if (now - this._t.pain > 0.75 && amount >= 8) { this._t.pain = now; this.play('pain', { volume: 0.5, priority: 3, pitch: 0.95 }); }
  }

  /** Abonniert alle relevanten Ereignisse aus §3 (Vertrag). */
  attach(G = this.G) {
    this.detach();
    this.G = G || this.G;
    if (this.G.settings && this.G.settings !== this.settings) { this.settings = this.G.settings; this._readSettings(); this._applyVolumes(); this._applyMix(); }
    if (!WEAPONS) loadWeapons();
    const ev = this.G.events; if (!ev?.on) return;
    this._bindLifecycle(ev);
    this._attached = true;
    const on = (name, fn) => {
      const h = p => { try { fn(p || {}); } catch (err) { this._error(err); } };
      const u = ev.on(name, h);
      this._unsubs.push(typeof u === 'function' ? u : () => ev.off?.(name, h));
    };
    const now = () => (this.ctx ? this.ctx.currentTime : 0);
    const posOf = (a, explicit) => (this._isPlayer(a) ? null : xyz(explicit) || this._eye(a));

    on('weapon:fire', p => {
      const a = p.actor, def = this.weaponDef(p.weaponId), pl = this._isPlayer(a);
      if (this._isKnife(p.weaponId, def)) { this.play('melee_swing', { player: pl, position: posOf(a), actor: a }); return; }
      if (a) { const t = now(), last = this._lastFire.get(a); if (last != null && t - last < 0.015 && t >= last) return; this._lastFire.set(a, t); }
      this._cancelReload(a);
      const prof = this.profileFor(p.weaponId, def), pos = pl ? null : xyz(p.origin) || this._eye(a);
      if (a) this._shots.set(a, { profile: prof, origin: xyz(p.origin) || this._eye(a) });
      this.play(prof, { player: pl, position: pos, actor: a, suppressed: !!p.suppressed, pitch: def?.sound?.pitch || 1, voice: this.voiceFor(p.weaponId, def, prof) });
      const fm = def?.fireMode || (prof === 'shotgun' ? 'pump' : prof === 'sniper' ? 'bolt' : null);
      let cycle = 0;
      if (fm === 'pump' || fm === 'bolt') {
        const mag = a?.weapon?.current?.mag;
        if (mag !== 0) {
          cycle = clamp((60 / (def?.rpm || (fm === 'pump' ? 70 : 45))) * 0.42, 0.22, 0.65);
          const v = this.play(fm, { player: pl, position: pos, actor: a, delay: cycle, volume: pl ? 0.85 : 0.65 });
          if (v && a) { const l = this._reloads.get(a) || []; l.push(v); this._reloads.set(a, l); }
        }
      }
      // Hülse fällt (Repetierer/Pumpe: beim Durchladen)
      if (a && this._recOn()) this._shell(a, prof, pl, cycle ? cycle + 0.12 : 0);
      if (pl) {
        const mag = a?.weapon?.current?.mag, cap = def?.mag;
        if (typeof mag === 'number' && cap > 5 && mag <= Math.ceil(cap * 0.25)) this.play('low_ammo', { volume: 0.5 + 0.5 * (1 - mag / (cap * 0.25)), player: true });
      } else this._passFromFire(p, prof, def);
    });
    // Genauer Vorbeiflug aus combat (echter Strahl inkl. Streuung)
    on('bullet:whiz', p => { this._combatWhiz = true; this._passFromWhiz(p); });
    on('weapon:melee', p => this.play('melee_swing', { player: this._isPlayer(p.actor), position: posOf(p.actor), actor: p.actor }));
    on('weapon:dryfire', p => this.play('dryfire', { player: this._isPlayer(p.actor), position: posOf(p.actor), actor: p.actor }));
    on('weapon:reload', p => this._reload(p));
    on('weapon:switch', p => {
      this._cancelReload(p.actor);
      const pl = this._isPlayer(p.actor), def = this.weaponDef(p.weaponId);
      this.play('equip', { player: pl, position: posOf(p.actor), actor: p.actor, volume: pl ? 0.9 : 0.5, pitch: def?.slot === 'secondary' ? 1.15 : 1 });
    });
    on('weapon:ads', p => { if (this._isPlayer(p.actor)) this.play(p.on ? 'ads_in' : 'ads_out', { player: true }); });
    on('impact', p => {
      if (!p.point) return;
      const pl = this._isPlayer(p.shooter), s = p.surface === 'flesh' ? 'flesh' : this._surface(p.surface);
      const name = s === 'flesh' ? 'hit_flesh' : `impact_${s}`, vol = pl ? 1 : 0.8, pos = xyz(p.point);
      const v = this.play(name, { position: pos, volume: vol, priority: pl ? 2 : undefined });
      // Hybrid: leise Synthese-Schicht unter der Aufnahme (Staub/Splitter → mehr Variation), nicht auf dem Handy
      if (v?.recorded && this._quality() !== 'low' && PROC_LAYER.has(name) && this._dist(pos) < 25) this.play(name, { position: pos, volume: vol * 0.32, proc: true, priority: 0, delay: 0.002, _deferred: true });
      // Querschläger an Metall und Stein
      if ((s === 'metal' && this._rand() < 0.14) || (s === 'concrete' && this._rand() < 0.05)) this.play('ricochet', { position: pos, volume: 0.7, delay: 0.008 });
    });
    on('actor:hit', p => {
      const { target, attacker, zone, killed } = p, def = this.weaponDef(p.weaponId), melee = this._isKnife(p.weaponId, def);
      if (this._isPlayer(target)) {
        this._playerHurt(p);
        if (zone === 'head' && !p.explosive) this.play('hit_helmet', { volume: 0.45, priority: 3 });
        if (melee) this.play('melee_hit', { volume: 0.9, priority: 3 });
        return;
      }
      const point = xyz(p.point) || this._eye(target), t = now(), byPlayer = this._isPlayer(attacker);
      if (melee) this.play('melee_hit', { position: byPlayer ? null : point, player: byPlayer, actor: target });
      if (byPlayer) {
        if (killed) { if (t - this._t.kill > 0.08) { this._t.kill = t; this.play('hitmarker_kill'); } }
        else if (t - this._t.hm > 0.035) { this._t.hm = t; this.play('hitmarker', { pitch: zone === 'head' ? 1.1 : 1 }); }
        if (zone === 'head' && t - this._t.hs > 0.06) {
          this._t.hs = t; this.play('headshot', { volume: killed ? 1 : 0.75 });
          this.play('hit_helmet', { position: point, volume: 0.55, occlusion: false });
        }
        if (!melee) this.play('hit_flesh', { position: point, volume: 0.5, occlusion: false });
      } else if (!melee) this.play('hit_flesh', { position: point, volume: 0.65, actor: target });
      // Bots stöhnen bei Treffern (gedrosselt pro Akteur)
      if (!killed && target && !p.explosive) {
        const last = this._actorPain.get(target) ?? -9;
        if (t - last > 1.1 && this._rand() < 0.55) { this._actorPain.set(target, t); this.play('pain', { position: this._eye(target), actor: target, pitch: this._voicePitch(target), volume: 0.75, delay: 0.04 }); }
      }
    });
    on('kill', p => {
      const { victim, killer } = p;
      if (this._isPlayer(victim)) { this.play('death', { priority: 3, volume: 0.85, pitch: 0.95 }); this._muffle.dead = true; this._applyMuffle(true); }
      else if (victim) {
        this.play('death', { position: this._eye(victim), actor: victim, pitch: this._voicePitch(victim), volume: 0.85 });
        // Körper schlägt auf (Aufnahme), wenn die Ragdoll den Boden erreicht
        const f = this._feet(victim);
        if (f && this._recName('bodyfall', true)) this.play('bodyfall', { position: f, actor: victim, delay: this._rand.range(0.42, 0.62), volume: 0.9 });
      }
      if (this._isPlayer(killer) && now() - this._t.kill > 0.08) { this._t.kill = now(); this.play('hitmarker_kill'); }
    });
    on('explosion', p => this._explosion(p));
    // Splint beim Ziehen (Kochen hörbar, Warnung bei Bots), Wurf nur als Luftzug, Bügel springt beim Loslassen
    const pin = (a, explicit) => {
      const pl = this._isPlayer(a);
      if (a) this._pinAt.set(a, now());
      this.play('grenade_pin', pl ? { player: true, volume: 0.8 } : { position: xyz(explicit) || this._eye(a), actor: a, volume: 1 });
    };
    on('grenade:pin', p => pin(p.actor));
    on('grenade:throw', p => {
      const a = p.actor, pl = this._isPlayer(a), pinned = a && now() - (this._pinAt.get(a) ?? -99) < 30; // Haftgranate darf lange gehalten werden
      if (a) this._pinAt.delete(a);
      if (!pinned) pin(a, p.position); // Werfer ohne grenade:pin (ältere Emitter)
      if (p.dropped) return;           // fallen gelassen (Tod beim Kochen): kein Wurfgeräusch
      if (pl) this.play('grenade_throw', { player: true, delay: pinned ? 0 : 0.05 });
      else this.play('grenade_throw', { position: xyz(p.position) || this._eye(a), actor: a, volume: 0.7 });
      if (this._recName('grenade_spoon', true) && (pl || this._dist(this._feet(a)) < 15)) {
        this.play('grenade_spoon', pl ? { player: true, pan: 0.3, delay: 0.06, volume: 0.7 } : { position: this._feet(a), actor: a, delay: 0.06, volume: 0.8 });
      }
    });
    on('grenade:stick', p => {
      const victim = this._isPlayer(p.target);
      // Am eigenen Körper: laut und nah (Warnung); sonst positional am Haftpunkt
      if (victim) this.play('grenade_stick', { volume: 1, priority: 3, env: 0.2 });
      else this.play('grenade_stick', { position: xyz(p.position), volume: p.target ? 0.9 : 1 });
    });
    on('player:slide', p => {
      if (p.phase === 'start') {
        if (this._slideVoice && !this._slideVoice.stopped) this._kill(this._slideVoice, 0.05);
        const v = clamp(+p.velocity || 9, 6, 13);
        this._slideVoice = this.play('slide', { player: true, volume: clamp(0.55 + (v - 8) * 0.06, 0.5, 0.85), pitch: clamp(0.94 + (v - 8) * 0.015, 0.92, 1.06) });
      } else if (p.phase === 'end') {
        // Abbruch (Sprung, Wand): Reiben schnell ausblenden
        const sv = this._slideVoice; this._slideVoice = null;
        if (sv && !sv.stopped && this.ctx.currentTime < sv.end - 0.12) this._kill(sv, 0.12);
      }
    });
    on('grenade:bounce', p => {
      if (p.stick) return;             // Haftgranate: eigener Klang über grenade:stick
      const s = +p.speed || 3; if (s < 0.6) return;
      this.play('grenade_bounce', { position: p.position, volume: clamp(s / 8, 0.15, 1), pitch: clamp(0.9 + s / 40, 0.9, 1.15) });
    });
    // Hülsen/Magazine mit eigener Physik (weapons-feel P4, effects.debris): Aufschlag → Klang je Untergrund.
    // Die Hülsen-Aufnahmen enthalten schon das Nachspringen → nur der erste Aufschlag; Magazine bis zu 2×.
    const casing = p => {
      this._casingEvents = true;
      if (!p.position || !this.ctx) return;
      const s = this._surface(p.surface), mag = p.kind === 'mag', pos = xyz(p.position);
      if (s === 'water' || this._dist(pos) > 16) return;
      if (!mag && p.first === false) return;
      const t = this.ctx.currentTime;
      this._shellWin = (this._shellWin || []).filter(x => t - x < 0.3);
      if (this._shellWin.length > (mag ? 8 : 5)) return; // Dauerfeuer: Klimpern nicht stapeln
      this._shellWin.push(t);
      const kind = SHELL_SURF[s], soft = !kind || kind === 'soft', speed = clamp((+p.speed || 2) / 3.5, 0.2, 1);
      if (mag) {
        this.play('grenade_bounce', { position: pos, actor: p.actor, volume: 0.42 * speed * (p.first === false ? 0.6 : 1), pitch: this._rand.range(0.68, 0.8), lowpass: soft ? 900 : 3400, occlusion: false, quiet: true });
        return;
      }
      if (soft && s !== 'dirt') return; // Gras, Sand, Stoff: praktisch lautlos
      const name = p.type === 'shotgun' ? 'shell_shotgun' : soft ? 'shell_concrete' : kind;
      const pitch = p.type === 'pistol' ? 1.12 : p.type === 'big' ? 0.82 : 1;
      const o = { position: pos, actor: p.actor, volume: (soft ? 0.3 : 0.75) * speed, lowpass: soft ? 1600 : 0, pitch, occlusion: false };
      if (!this.play(name, o)) this.play('shell_tink', o); // ohne Aufnahme: Synthese
    };
    on('shell:land', casing);
    on('casing:land', p => casing({ ...p, kind: p.kind === 'mag' ? 'mag' : 'shell', type: p.type || p.kind }));
    on('footstep', p => {
      const pl = this._isPlayer(p.actor);
      const vol = pl ? (p.crouch ? 0.16 : p.sprint ? 0.42 : 0.3) : (p.crouch ? 0.4 : p.sprint ? 1 : 0.72);
      this.play('footstep', { surface: p.surface, sprint: !!p.sprint, crouch: !!p.crouch, player: pl, position: pl ? null : xyz(p.position) || this._feet(p.actor), actor: p.actor, volume: vol, priority: pl ? 2 : undefined });
    });
    on('player:jump', () => this.play('jump', { volume: 0.7 }));
    on('player:land', p => {
      const v = p.velocity, s = Math.abs(typeof v === 'number' ? v : v?.y ?? 5);
      if (s >= 2.2) this.play('land', { volume: clamp((s - 2) / 9, 0.25, 1), priority: 3 });
    });
    on('player:damaged', p => this._playerHurt(p));
    on('actor:spawn', p => {
      if (!this._isPlayer(p.actor)) return;
      this._muffle.dead = false; this.hearing.reset(); this._muffle.hearing = NO_MUFFLE; this._applyMuffle(true);
      this._hb = 0.1; this._br = 0.4;
      if (this.G.match?.state === 'playing') this.play('spawn', { volume: 0.8 });
    });
    on('streak:ready', p => { if (this._isPlayer(p.actor)) this.play('streak_ready'); });
    on('streak:activate', p => {
      const name = STREAK_SOUND[p.streakId] || 'uav', hostile = this._hostile(p.actor);
      this._t.streak = now();
      this.play(name, { volume: hostile ? 0.7 : 1, pitch: hostile ? 0.88 : 1 });
    });
    on('uav:state', p => {
      const P = this.G.player, M = this.G.mode;
      const myKey = P ? (M ? (M.teams ? P.team : P.id) : (P.team ?? P.id)) : undefined;
      const mine = (p.team != null && p.team === myKey) || (!!P && p.owner === P);
      if (p.active) { if (now() - this._t.streak > 1.2) this.play('uav', { volume: mine ? 0.9 : 0.65, pitch: mine ? 1 : 0.88 }); }
      else if (mine) this.play('uav_end');
    });
    on('objective:update', p => {
      const list = Array.isArray(p.objectives) ? p.objectives : Object.values(p.objectives || {});
      const team = this.G.player?.team;
      for (const o of list) {
        if (!o) continue;
        const id = o.id ?? list.indexOf(o), owner = o.owner ?? o.team ?? o.holder ?? null, prev = this._objOwners.get(id);
        this._objOwners.set(id, owner);
        if (prev === undefined || prev === owner || team == null) continue;
        if (owner === team) this.play('capture');
        else if (prev === team || owner != null) this.play('capture_lost', { volume: prev === team ? 1 : 0.6 });
      }
    });
    on('medal', p => {
      if (!this._isPlayer(p.actor)) return;
      const t = now(); this._t.medal = Math.max(t, this._t.medal) + 0.24;
      const delay = this._t.medal - t - 0.24, tier = MEDALS?.[p.id]?.tier;
      if (delay < 1.2) this.play('medal', { delay, pitch: MEDAL_PITCH[tier] || 1, volume: tier === 'gold' ? 1 : 0.85 });
    });
    on('match:countdown', p => this.play(+p.value > 0 ? 'countdown' : 'go', { pitch: +p.value === 1 ? 1.06 : 1 }));
    on('match:start', p => {
      this._objOwners.clear(); this._muffle.dead = false; this._muffle.pause = false; this.hearing.reset(); this._muffle.hearing = NO_MUFFLE; this._applyMuffle(true);
      this.acoustics.clear(); this._tails.clear();
      this.startAmbience(this.G.world?.ambience || MAP_AMBIENCE[p.mapId] || p.mapId || 'range');
      this._planActorSamples();
    });
    on('match:end', p => {
      const r = p.result || {};
      const name = r.draw ? 'draw' : r.playerWon ? 'win' : 'lose'; // draw gilt je Spieler (FFA: nur punktgleiche Führende)
      this._playSoon(name, { priority: 3 });
      this.fadeAmbience(0.35, 2);
      if (this.autoMusic) { clearTimeout(this._musicT); this._musicT = setTimeout(() => { if (this.G.match?.state !== 'playing') this.startMusic(); }, 4200); }
    });
    on('ui:sound', p => this.ui(p.name));
    on('settings:change', p => {
      this._settingsChanged();
      if (p.key === 'quality') this.setSpace(this._space);
    });
  }

  /**
   * Dauerhafte Abos (unabhängig von attach/detach): Matchzustand steuert Lobbymusik und Pausendämpfung,
   * denn main.js trennt die Engine in der Lobby.
   */
  _bindLifecycle(ev) {
    if (!ev?.on || ev === this._lifeBus) return;
    this._lifeUnsub?.();
    this._lifeBus = ev;
    const u = ev.on('match:state', p => { try { this._onState(p || {}); } catch (err) { this._error(err); } });
    this._lifeUnsub = typeof u === 'function' ? u : () => ev.off?.('match:state', u);
  }

  _onState({ state: s }) {
    this._muffle.pause = s === 'paused';
    if (s === 'lobby' || s === 'boot') this._muffle.dead = false;
    // Ohrenklingeln nicht in Pausenmenü/Endbildschirm stehen lassen (dort läuft kein update())
    if (s === 'lobby' || s === 'boot' || s === 'paused' || s === 'ended') { this.hearing.reset(); this._muffle.hearing = NO_MUFFLE; }
    if (this.muffle) this._applyMuffle(true);
    library.inPlay = s === 'loading' || IN_PLAY.has(s); // Kartenaufbau/Spiel: nur ein Ladeauftrag gleichzeitig
    // Klangbank ab der Lobby füllen (Worker, ohne AudioContext); Ausrüstung aus der letzten Wahl zuerst;
    // Aufnahmen für Ausrüstung und Karte nachladen (Lobby: letzte Wahl, Laden: echte Wahl)
    if (s === 'lobby' || s === 'loading') { this._warmBank(); this._prioritizeLoadout(); this._planSamples(); }
    // Menü-Klänge (Musik, Endbildschirm-Stinger) während des Matchs nicht im Speicher halten
    if (s === 'loading' || s === 'countdown' || s === 'playing') this._releaseSounds(transientName);
    if (s === 'lobby') { this.stopAmbience(1.2); if (this.autoMusic) this.startMusic(); }
    else if (s === 'countdown' || s === 'playing') {
      clearTimeout(this._musicT);
      if (this.autoMusic) this.stopMusic(2.5);
      if (!this._amb && this._attached && this.G.world?.ambience) this.startAmbience(this.G.world.ambience);
      else if (this._amb) this.fadeAmbience(1, 1);
    } else if (s === 'paused') this.fadeAmbience(0.6, 0.5);
    else if (s === 'ended' && CATALOG.levelup) this._request(CATALOG.levelup, PRIO.urgent); // Endbildschirm spielt ihn evtl. gleich
  }

  detach() {
    for (const u of this._unsubs) { try { u(); } catch { /* */ } }
    this._unsubs = [];
    this._attached = false;
    clearTimeout(this._musicT);
    for (const t of this._timers || []) clearTimeout(t);
    this._timers?.clear();
    for (const a of this._reloads.keys()) this._cancelReload(a);
    this._occl.clear(); this.acoustics.clear(); this._tails.clear(); this._pass.clear(); this._whiz.clear(); this._dif.clear();
    if (this.ctx && this.unlocked) {
      for (const v of this.voices.slice()) if (v.group === 'vital' || v.group === 'loop' && v.name === 'smoke_hiss') this._kill(v, 0.2);
      this._muffle.dead = false; this._muffle.pause = false; this._muffle.health = NO_MUFFLE;
      this.hearing.reset(); this._muffle.hearing = NO_MUFFLE; this._applyMuffle(true);
    }
  }

  // ================================================================ Atmosphäre

  /** Atmo starten: 'harbor'|'desert'|'industrial'|'range' oder Karten-ID (hafen, altstadt, werk, range). */
  startAmbience(id) {
    id = MAP_AMBIENCE[id] || id;
    if (!AMBIENCES[id]) id = 'range';
    if (!this.ctx || !this.unlocked) { this._wantAmb = id; return; }
    if (this._amb?.id === id && this._amb.playing) { this.fadeAmbience(1, 1); return; }
    this.stopAmbience(1);
    this.setSpace(AMBIENCES[id].space);
    const cfg = AMBIENCES[id], now = this.ctx.currentTime, bedName = `amb_bed_${id}`;
    // Schleife und Ereignisse anderer Karten freigeben
    const keep = new Set([bedName, ...cfg.events.map(e => e.name)]);
    this._releaseSounds((name, e) => e.bus === 'amb' && !keep.has(name));
    library.release(n => n.startsWith('amb_bed_') && n !== bedName);
    const amb = this._amb = { id, playing: true, gain: this.ctx.createGain(), src: null, next: [] };
    amb.gain.gain.value = 0; amb.gain.connect(this.bus.amb);
    amb.next = cfg.events.map(ev => now + this._rand.range(...(ev.first || ev.every)));
    // Unter Ausrüstung/Feedback einsortiert: die Schleife blendet ohnehin erst ein, wenn sie fertig ist
    this._require(cfg.events.map(e => e.name), () => {}, PRIO.amb);
    const fadeIn = (buffer, gain = 1) => {
      if (this._amb !== amb || !amb.playing || !this.ctx || !buffer) return;
      const s = this.ctx.createBufferSource(); s.buffer = buffer; s.loop = true;
      const g = this.ctx.createGain(); g.gain.value = gain;
      s.connect(g).connect(amb.gain); s.start();
      amb.src = s; amb.bedGain = g;
      const t = this.ctx.currentTime; amb.gain.gain.setValueAtTime(0, t); amb.gain.gain.linearRampToValueAtTime(1, t + 2.5);
    };
    const proc = () => this._require([bedName], ok => {
      if (ok) fadeIn(bank.get(this._key(CATALOG[bedName], 0)));
    }, PRIO.amb + 5);
    // Aufnahme-Bett (Schleife, nahtlos) bevorzugt; fehlt sie (404, aus), das prozedurale Bett
    if (this._recOn()) {
      library.request([bedName], PRIO.urgent);
      library.whenReady([bedName], ok => {
        if (this._amb !== amb || !amb.playing) return;
        const s = ok ? library.get(bedName, 0) : null;
        if (s) { amb.recorded = true; fadeIn(s.buffer, this._recGain(bedName)); } else proc();
      }, 9000);
    } else proc();
    amb.timer = setInterval(() => this._ambTick(amb, cfg), 250);
  }

  _ambTick(amb, cfg) {
    if (!amb.playing || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime, L = this.listener;
    cfg.events.forEach((ev, i) => {
      if (now < amb.next[i]) return;
      amb.next[i] = now + this._rand.range(...ev.every);
      if (!this._anyReady(CATALOG[ev.name])) return;
      const vol = this._rand.range(...ev.vol), dist = this._rand.range(...ev.dist), a = this._rand() * Math.PI * 2;
      const shots = ev.burst ? Math.floor(this._rand.range(ev.burst[0], ev.burst[1] + 1)) : 1;
      const rate = this._rand.range(0.1, 0.16);
      for (let k = 0; k < shots; k++) {
        const o = { volume: vol * (k ? this._rand.range(0.8, 1) : 1), bus: 'amb', delay: k * rate, priority: 0, ref: dist, env: 0, occlusion: false, er: 0, loud: null };
        if (L.valid) o.position = { x: L.x + Math.cos(a) * dist, y: L.y + this._rand.range(...ev.height), z: L.z + Math.sin(a) * dist };
        else o.pan = Math.cos(a) * 0.8;
        this.play(ev.name, o);
      }
    });
  }

  fadeAmbience(level = 1, time = 1) {
    const a = this._amb; if (!a || !this.ctx) return;
    const t = this.ctx.currentTime; a.gain.gain.cancelScheduledValues(t); a.gain.gain.setTargetAtTime(level, t, time / 3);
  }

  stopAmbience(fade = 1.5) {
    this._wantAmb = null;
    const a = this._amb; if (!a) return;
    this._amb = null; a.playing = false; clearInterval(a.timer);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    a.gain.gain.cancelScheduledValues(t); a.gain.gain.setValueAtTime(a.gain.gain.value, t); a.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
    try { a.src?.stop(t + fade + 0.05); } catch { /* */ }
    setTimeout(() => { try { a.src?.disconnect(); a.bedGain?.disconnect(); a.gain.disconnect(); } catch { /* */ } }, (fade + 0.3) * 1000);
    for (const v of this.voices.slice()) if (v.group === 'amb') this._kill(v, fade);
  }

  get ambienceId() { return this._amb?.id || null; }

  // ================================================================ Musik

  /** Lobby-/Menümusik (synthetisch, 100 BPM). Vor unlock() vorgemerkt. */
  startMusic() {
    this._wantMusic = true;
    if (!this.ctx || !this.unlocked || this._disposed) return;
    if (this._music?.playing || this._musicPending) return;
    if (!(this.vol.music > 0 && this.vol.master > 0)) return; // stumm: nichts rendern (setVolumes startet nach)
    this._musicPending = true;
    this._require(STEM_IDS.map(i => `mus_${i}`), ok => {
      this._musicPending = false;
      if (!ok || !this._wantMusic || this._disposed || !this.ctx) return;
      const buffers = {};
      for (const id of STEM_IDS) buffers[id] = bank.get(this._key(CATALOG[`mus_${id}`], 0));
      this._music = this._music || new MusicPlayer(this.ctx, this.bus.music);
      this._music.start(buffers);
    }, PRIO.music);
  }

  stopMusic(fade = 1.2) {
    this._wantMusic = false;
    this._music?.stop(fade);
    if (this._musicPending) bank.cancel(name => name.startsWith('mus_')); // noch nicht fertig → Worker frei für Spielklänge
  }

  get musicPlaying() { return !!this._music?.playing; }

  // ================================================================ Diagnose

  /** Analyser am Ausgang (für Pegelanzeigen). */
  getAnalyser() {
    if (!this.ctx) return null;
    if (!this._analyser) { this._analyser = this.ctx.createAnalyser(); this._analyser.fftSize = 2048; this.output.connect(this._analyser); }
    return this._analyser;
  }

  info() {
    const S = this.acoustics.state, li = library.info();
    return {
      state: this.ctx?.state || 'none', sampleRate: this.ctx?.sampleRate || 0, unlocked: this.unlocked, voices: this.voices.length,
      buffers: bank.buffers.size, queue: bank.queued, bankMB: +(bank.bytes / 1048576).toFixed(2), workers: bank.stats.workers, synth: bank.stats.mode, space: this._space, indoor: +this._indoor.toFixed(2), ambience: this.ambienceId,
      music: this.musicPlaying, hrtf: this._hrtf(), synthErrors: bank.stats.errors, muffle: Math.round(this.muffle?.frequency.value || 0), ...this.stats,
      recordings: this._recOn(), samplesMB: li.MB, samplesCapMB: li.capMB, samplesTier: li.tier, samples: li.sounds, samplesQueued: li.queued, samplesErrors: li.errors,
      samplesUnavailable: li.unavailable, totalMB: +((bank.bytes + library.stats.bytes) / 1048576).toFixed(2),
      mix: this.mixId, protection: this.protection, hdrDb: +this._hdrDb.toFixed(1),
      room: { indoor: +S.indoor.toFixed(2), enclosure: +S.enclosure.toFixed(2), meanFree: +S.meanFree.toFixed(1), ceiling: Number.isFinite(S.ceiling) ? +S.ceiling.toFixed(1) : null, provider: this.acoustics.provider, rays: this.acoustics.rays },
      hearing: { dose: +this.hearing.dose.toFixed(3), ring: +this.hearing.ring.toFixed(3), peak: +this.hearing.stats.peakDose.toFixed(3) },
    };
  }

  _error(err) {
    this.stats.errors++; this.stats.lastError = String(err?.stack || err);
    if (this.G.debug) console.error('[audio]', err);
  }

  dispose() {
    this.detach(); this.stopAmbience(0); this.stopMusic(0); this.stopAll(0.01);
    this._lifeUnsub?.(); this._lifeUnsub = null; this._lifeBus = null;
    this._libUnsub?.(); this._libUnsub = null;
    this.hearing.dispose(); this.er?.dispose();
    this._disposed = true;
    if (typeof window !== 'undefined') {
      if (this._onGesture) for (const t of GESTURES) window.removeEventListener(t, this._onGesture, true);
      if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); window.removeEventListener('pagehide', this._onVis); window.removeEventListener('pageshow', this._onVis); }
    }
    if (typeof this._settingsUnsub === 'function') this._settingsUnsub();
    if (this.ctx && !this.offline && !this.opts.context) this.ctx.close().catch(() => {});
  }
}

/** Liste aller abspielbaren Katalognamen (Synthese). */
export const SOUND_NAMES = Object.keys(CATALOG);
/** Klänge, die es nur als Aufnahme gibt (assets/lib/audio). */
export const RECORDED_NAMES = Object.keys(REC_ONLY);

/**
 * Offline-Messung: rendert, was setup(engine) abspielt, durch die komplette Kette (inkl. Limiter)
 * und liefert Spitzenpegel/RMS. Für Tests und das Dev-Board. recordings: Aufnahmen verwenden (vorher
 * mit samples: [Namen] laden lassen; sonst nur bereits geladene).
 */
export async function renderOffline(setup, { seconds = 2, sampleRate = 48000, settings = null, camera = null, THREE = null, preroll = 1, recordings = false, samples = null, quality = null, world = null } = {}) {
  if (recordings && samples?.length) {
    library.configure({ quality: quality || 'high', enabled: true });
    library.request(samples, PRIO.urgent);
    await new Promise(res => library.whenReady(samples, res, 20000));
  }
  // Vorlauf: Chromes Kompressor startet voll zugedrückt und gibt erst über die Release-Zeit frei
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + preroll) * sampleRate), sampleRate);
  const params = quality ? new URLSearchParams(`quality=${quality}`) : null;
  const eng = new AudioEngine({ settings, events: null, camera, THREE, params, world }, { context: ctx, autoUnlock: false, autoMusic: false, recordings: !!recordings });
  await eng.unlock();
  eng.update(0);
  let setupError = null;
  ctx.suspend(preroll).then(async () => {
    try { await setup(eng); } catch (err) { setupError = err; }
    ctx.resume();
  });
  const buf = await ctx.startRendering();
  if (setupError) throw setupError;
  const i0 = Math.floor(preroll * sampleRate), chs = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c).subarray(i0));
  let peak = 0, sum = 0, n = 0;
  for (const d of chs) { for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; } n += d.length; }
  // RMS über den aktiven Teil (erstes bis letztes Sample über −60 dB unter Spitze)
  const thr = peak * 0.001; let first = chs[0].length, last = 0;
  for (const d of chs) {
    let f = 0; while (f < d.length && Math.abs(d[f]) < thr) f++;
    let l = d.length - 1; while (l > f && Math.abs(d[l]) < thr) l--;
    first = Math.min(first, f); last = Math.max(last, l);
  }
  let s2 = 0; for (const d of chs) for (let i = first; i <= last; i++) s2 += d[i] * d[i];
  const act = Math.max(1, (last - first + 1) * chs.length);
  const rms = Math.sqrt(s2 / act), db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  eng.dispose();
  return { peak, rms, peakDb: db(peak), rmsDb: db(rms), fullRmsDb: db(Math.sqrt(sum / Math.max(1, n))), activeSec: Math.max(0, last - first) / sampleRate, buffer: buf, stats: eng.stats };
}
