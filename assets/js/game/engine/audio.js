// NULLPUNKT – prozedurale Audio-Engine (WebAudio, keine Audiodateien).
// Alle Klänge entstehen in Synthese-Workern (audio/bank.js, ab Lobby priorisiert: Menü → Ausrüstung →
// häufiges Feedback → Rest); der Hauptthread rendert im Spiel nie synchron (Ersatzklang oder auslassen).
// Puffer werden zwischen Kontexten geteilt. Signalfluss:
//   Stimme → [Tiefpass Distanz/Verdeckung] → Gain → Panner(HRTF|equalpower) → Bus
//                                         ↘ Sends → Innenhall (Faltung) / Außen-Slapback + Weite
//   sfx/amb → world → muffle(Tiefpass: Pause, Tod, Explosion, wenig Leben) ┐
//   fb/ui/music ─────────────────────────────────────────────────────────── master → Glue → Limiter → Softclip → Ausgang
import { CATALOG, SOUND_GROUPS, GUN_PROFILES, SURFACES, AMBIENCES, STEM_IDS } from './audio/catalog.js';
import { bank, PRIO, makeBuffer } from './audio/bank.js';
import { makeRng, hashString, clamp, lerp } from './audio/dsp.js';
import { MusicPlayer } from './audio/music.js';
import { MAP_AMBIENCE } from './audio/ambience.js';
import { spaceFor, roomIR, outdoorIR } from './audio/space.js';
export { createUiSounds } from './audio/ui-sounds.js';
export { SOUND_GROUPS, GUN_PROFILES, SURFACES };

// Waffendaten defensiv laden (Datei gehört einem anderen Modul und kann noch fehlen)
let WEAPONS = null;
const loadWeapons = () => import('../../shared/weapons.data.js').then(m => { WEAPONS = m.WEAPONS || m.default?.WEAPONS || null; }).catch(() => {});
loadWeapons();
let MEDALS = null; // Medaillenstufe → Tonhöhe der Fanfare (bronze/silber/gold)
import('../../shared/modes.data.js').then(m => { MEDALS = m.MEDALS || null; }).catch(() => {});
const MEDAL_PITCH = { bronze: 0.94, silber: 1, silver: 1, gold: 1.1 };

const CLASS_PROFILE = { ar: 'ar', smg: 'smg', lmg: 'lmg', sniper: 'sniper', marksman: 'ar_heavy', shotgun: 'shotgun', pistol: 'pistol' };
const ID_PROFILE = { ar_kv47: 'ar_heavy', ar_m17: 'ar', smg_vp9: 'smg', smg_qx90: 'smg', lmg_hm60: 'lmg', mr_sk14: 'ar_heavy', sr_brecher: 'sniper', sg_bulldog: 'shotgun', pi_p9: 'pistol', pi_adler: 'pistol_heavy', sentry: 'lmg' };
const PREFIX_PROFILE = { ar: 'ar', smg: 'smg', lmg: 'lmg', mr: 'ar_heavy', sr: 'sniper', sg: 'shotgun', pi: 'pistol' };
const RELOAD_TIME = { ar: 2.1, ar_heavy: 2.3, smg: 1.9, lmg: 4.2, sniper: 2.8, shotgun: 0.5, pistol: 1.5, pistol_heavy: 1.8 };
const SUPERSONIC = { ar: 1, ar_heavy: 1, lmg: 1, sniper: 1, pistol_heavy: 1 };
const STREAK_SOUND = { uav: 'uav', strike: 'airstrike', airstrike: 'airstrike', sentry: 'sentry' };
const SURFACE_ALIAS = { asphalt: 'concrete', stone: 'concrete', plaster: 'concrete', brick: 'concrete', rubber: 'fabric', sandbag: 'sand', mud: 'dirt', gravel: 'dirt', ceramic: 'tile', carpet: 'fabric', snow: 'grass' };
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
const NO_MUFFLE = 22000;
const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const xyz = p => (p ? { x: +p.x || 0, y: +p.y || 0, z: +p.z || 0 } : null);
const IN_PLAY = new Set(['countdown', 'playing']);
const IN_MATCH = new Set(['loading', 'countdown', 'playing', 'paused']);
// Was im Match zuerst gebraucht wird (neben der eigenen Ausrüstung): Countdown, Treffer, Tod, Explosion …
const CORE_SET = new Set([
  'countdown', 'go', 'spawn', 'hitmarker', 'hitmarker_kill', 'headshot', 'hit_flesh', 'death', 'medal', 'explosion', 'explosion_far',
  'impact_concrete', 'step_concrete', 'bullet_crack', 'bullet_whiz', 'grenade_pin', 'grenade_throw', 'equip', 'ads_in', 'ads_out',
  'reload_mag_out', 'reload_mag_in', 'dryfire',
]);
// Website (Engine ohne Ereignisbus): nur, was sie abspielt
const SITE_SET = new Set(['reload_mag_out', 'reload_mag_in', 'reload_bolt', 'bolt', 'pump', 'equip', 'dryfire']);
const DEFER_MS = 1500;      // außerhalb des Spiels: fehlender Klang startet, sobald gerendert (höchstens so spät)
const transientName = n => !!CATALOG[n]?.transient;

export class AudioEngine {
  /**
   * @param G     Spielkontext oder minimal { settings, events }
   * @param opts  { context?: AudioContext|OfflineAudioContext, autoUnlock = true, autoMusic = true, maxVoices }
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
    // rendered/queued/renderMs/maxSliceMs kommen aus der gemeinsamen Bank (renderMs = Hauptthread-Anteil)
    const B = bank.stats;
    this.stats = {
      played: 0, dropped: 0, stolen: 0, substituted: 0, missed: 0, deferred: 0, errors: 0, lastError: null,
      get rendered() { return B.rendered; }, get queued() { return bank.queued; }, get renderMs() { return B.mainMs; },
      get maxSliceMs() { return B.maxMainMs; }, get workerMs() { return B.workerMs; },
    };
    this.envMode = 'auto';            // 'auto' | 'indoor' | 'outdoor'
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, valid: false };
    this._unsubs = [];
    this._warm = false; this._bankLow = null; this._pinAt = new WeakMap(); this._slideVoice = null;
    this._occl = new Map(); this._indoorSrc = new Map(); this._lastFire = new WeakMap(); this._reloads = new Map();
    this._lastVar = new Map(); this._objOwners = new Map(); this._actorPain = new WeakMap();
    this._indoor = 0; this._indoorT = 0; this._indoorTimer = 0;
    this._hb = 0; this._br = 0; this._brIn = true;
    this._t = { hm: -1, kill: -1, hs: -1, hurt: -1, pain: -1, medal: 0, streak: -9, duck: 0 };
    this._muffle = { pause: false, dead: false, health: NO_MUFFLE, concussUntil: 0, current: NO_MUFFLE };
    this._losBudget = 8; this._losWindow = 0;
    this._rand = makeRng((Date.now() & 0xffff) + 1);
    this._space = 'default'; this._spaceKey = '';
    this._wantMusic = false; this._wantAmb = null; this._amb = null; this._music = null;
    this._readSettings();
    if (this.settings?.onChange) {
      try { const u = this.settings.onChange(() => { this._readSettings(); this._applyVolumes(); }); if (typeof u === 'function') this._settingsUnsub = u; } catch { /* Store ohne onChange */ }
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
    const glue = this.glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.004; glue.release.value = 0.2;
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
    this.master.connect(glue).connect(lim).connect(this.clipPre).connect(this.clipper).connect(this.output).connect(ctx.destination);

    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = NO_MUFFLE; this.muffle.Q.value = 0.5;
    this.world = gain(1); this.world.connect(this.muffle).connect(this.master);
    this.bus = {
      sfx: gain(this.vol.sfx), amb: gain(1), fb: gain(1), ui: gain(1), music: gain(1),
    };
    this.ambDuck = gain(1);
    this.bus.sfx.connect(this.world);
    this.bus.amb.connect(this.ambDuck).connect(this.world);
    this.bus.fb.connect(this.master); this.bus.ui.connect(this.master); this.bus.music.connect(this.master);
    // Raum: Sends kommen pro Stimme, Rückwege laufen über den sfx-Bus (folgen sfxVolume)
    this.revIn = gain(1); this.revOut = gain(0.9); this.revOut.connect(this.bus.sfx);
    this.echoIn = gain(1); this.echoOut = gain(1); this.echoOut.connect(this.bus.sfx);
    this._applyVolumes(true);
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
    // Innenhall
    const conv = ctx.createConvolver(); conv.normalize = false;
    conv.buffer = makeBuffer(roomIR(ctx.sampleRate, S, { maxLen: hq ? 3 : 1.4, seed: hashString(id) }), ctx.sampleRate, ctx);
    this.revIn.connect(conv); conv.connect(this.revOut);
    const oldConv = this._conv; this._conv = conv;
    if (oldConv) { try { this.revIn.disconnect(oldConv); } catch { /* */ } setTimeout(() => { try { oldConv.disconnect(); } catch { /* */ } }, 3500); }
    // Außen: Slapback-Taps + (hohe Qualität) weite Fahne
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
      c2.buffer = makeBuffer(outdoorIR(ctx.sampleRate, S, { seed: hashString(id) + 3 }), ctx.sampleRate, ctx);
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

  /** Entsperrt und keine Klänge mehr in Arbeit. */
  get ready() { return this.unlocked && bank.idle; }

  /** Gemeinsame Klangbank (Diagnose/Tests): info(), buffers, queued … */
  get bank() { return bank; }

  // ================================================================ Einstellungen

  _readSettings() {
    const s = this.settings, get = (k, d) => { try { const v = s?.get?.(k); return typeof v === 'number' && isFinite(v) ? v : d; } catch { return d; } };
    this.vol.master = clamp(get('masterVolume', this.vol.master));
    this.vol.sfx = clamp(get('sfxVolume', this.vol.sfx));
    this.vol.music = clamp(get('musicVolume', this.vol.music));
    this.vol.ui = clamp(get('uiVolume', this.vol.ui));
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

  _quality() {
    const q = this.G.params?.get?.('quality') || this.G.renderer?.quality || this.settings?.get?.('quality') || 'auto';
    if (q !== 'auto') return q;
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    return coarse ? 'low' : 'high';
  }
  _hrtf() { const q = this._quality(); return q === 'high' || q === 'ultra'; }
  get maxVoices() { return this.opts.maxVoices || (this._quality() === 'low' ? 28 : 48); }

  // ================================================================ Vorrendern (Klangbank)

  /** Niedrige Qualität → kleinere Abtastraten/weniger Varianten. Einmal je Engine festgelegt (gleiche Schlüssel). */
  _lowBank() { if (this._bankLow == null) this._bankLow = this._quality() === 'low'; return this._bankLow; }
  _rate(e) { return this._lowBank() ? Math.min(e.rate, e.rateLow) : e.rate; }
  _variants(e) { return this._lowBank() && e.variantsLow ? Math.min(e.variants, e.variantsLow) : e.variants; }
  _key(e, v) { return bank.key(e.name, v, this._rate(e)); }
  _request(e, prio) { const n = this._variants(e), keys = []; for (let v = 0; v < n; v++) keys.push(bank.request(e.name, v, this._rate(e), prio)); return keys; }
  _anyReady(e) { for (let v = 0, n = this._variants(e); v < n; v++) if (bank.has(this._key(e, v))) return true; return false; }
  _inPlay() { return IN_PLAY.has(this.G.match?.state); }

  _prioOf(e) {
    if (e.bus === 'ui' && e.tier === 0) return PRIO.ui;
    if (CORE_SET.has(e.name)) return PRIO.core;
    return e.tier <= 1 ? PRIO.t1 : PRIO.t2;
  }

  /**
   * Match-Bank im Worker vorrendern – im Spiel schon ab der Lobby (kein AudioContext nötig).
   * Ohne Ereignisbus (Website) nur Menü-, Waffen- und Nachladeklänge.
   */
  _warmBank() {
    if (this._warm || this._disposed || this.offline) return;
    this._warm = true;
    const game = !!this.G.events?.on;
    for (const e of Object.values(CATALOG)) {
      if (e.tier > 2) continue;
      if (!game && !(e.tier === 0 && e.bus === 'ui') && !e.name.startsWith('gun_') && !SITE_SET.has(e.name)) continue;
      this._request(e, this._prioOf(e));
    }
    if (game) this._prioritizeLoadout();
  }

  /** Eigene Ausrüstung zuerst: Schuss nah/fern, Repetier- und Nachladegeräusche. */
  _prioritizeLoadout(lo = this.G.match?.loadout) {
    if (!lo) { try { lo = this.settings?.get?.('lastLoadout'); } catch { lo = null; } }
    if (!lo || typeof lo !== 'object') return;
    for (const id of [lo.primary, lo.secondary]) {
      if (!id) continue;
      const def = this.weaponDef(id), prof = this.profileFor(id, def), names = [`gun_${prof}`, `gunfar_${prof}`];
      const fm = def?.fireMode || (prof === 'shotgun' ? 'pump' : prof === 'sniper' ? 'bolt' : null);
      if (fm === 'pump' || fm === 'bolt') names.push(fm);
      if (def?.perShellReload || prof === 'shotgun') names.push('reload_shell');
      if (prof === 'lmg') names.push('reload_bolt');
      for (const n of names) if (CATALOG[n]) this._request(CATALOG[n], PRIO.loadout);
    }
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

  /** Nicht mehr benötigte Klänge freigeben (Speicher). pred(name) */
  _releaseSounds(pred) { bank.release(name => !!CATALOG[name] && pred(name, CATALOG[name])); }

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
      this._spawn(e, { ...p.o, variant: bank.has(this._key(e, p.v)) ? p.v : v, delay: Math.max(0, (p.o.delay || 0) - late) });
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

  // ================================================================ Abspielen

  /**
   * Spielt einen Klang. name: Katalogname, Waffenprofil (ar, sniper …), 'footstep', 'impact', 'explosion'.
   * opts: { position, volume, pitch, actor, player, surface, sprint, crouch, suppressed, delay, priority, bus, pan,
   *         lowpass, env, indoor, distance, variant, loop, ref }
   */
  play(name, opts = {}) {
    if (!this.ctx || !this.unlocked || this._disposed) return null;
    try {
      if (GUN_PROFILES[name]) return this._gunshot(name, opts);
      switch (name) {
        case 'footstep': return this._footstep(opts);
        case 'impact': return opts.surface === 'flesh' ? this.play('hit_flesh', opts) : this.play(`impact_${this._surface(opts.surface)}`, opts);
        case 'impact_flesh': return this.play('hit_flesh', opts);
        case 'explosion': return opts.position ? this._explosion({ position: opts.position, radius: opts.radius, volume: opts.volume, concuss: opts.concuss }) : this._spawn(CATALOG.explosion, { priority: 3, ...opts });
        case 'hitmarker_headshot': return this.play('headshot', opts);
        case 'airstrike_call': case 'strike': return this.play('airstrike', opts);
      }
      if (name.startsWith('step_') && !CATALOG[name]) return this.play(`step_${this._surface(name.slice(5))}`, opts);
      if (name.startsWith('impact_') && !CATALOG[name]) return this.play(`impact_${this._surface(name.slice(7))}`, opts);
      const e = CATALOG[name];
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
    const n = this._variants(e);
    let v = o.variant != null ? Math.abs(Math.floor(o.variant)) % n : Math.floor(this._rand() * n);
    if (o.variant == null && n > 1 && v === this._lastVar.get(e.name)) v = (v + 1 + Math.floor(this._rand() * (n - 1))) % n;
    // Nie synchron nachrendern: im Spiel Ersatzklang oder auslassen, sonst nachholen, sobald fertig
    let buffer = this._buffer(e, v);
    if (!buffer && this._inPlay()) buffer = this._altBuffer(e);
    if (!buffer) {
      this.stats.missed++;
      if (!this._inPlay() && !o._deferred && !o.loop) this._defer(e, v, o); else this.stats.dropped++;
      return null;
    }
    this._lastVar.set(e.name, v);
    const prio = o.priority ?? (o.player || !pos ? Math.max(e.prio, 2) : dist < 15 ? e.prio + 1 : e.prio);
    if (!this._admit(e, prio)) { this.stats.dropped++; return null; }

    const src = ctx.createBufferSource(); src.buffer = buffer;
    if (o.loop) src.loop = true;
    const rate = (o.pitch ?? 1) * (1 + this._rand.bi() * e.pitchJit);
    src.playbackRate.value = clamp(rate, 0.25, 4);
    const nodes = [src];
    let head = src;
    // Distanz-/Verdeckungsfilter
    const occluded = pos && !o.player && o.occlusion !== false && e.bus !== 'amb' ? this._occluded(pos, o.actor, o.footstep) : false;
    let lp = o.lowpass || 0;
    if (pos && e.bus !== 'amb') lp = Math.min(lp || NO_MUFFLE, Math.max(2200, 20000 * Math.exp(-dist / 85)));
    if (occluded) lp = clamp(Math.min(lp || NO_MUFFLE, 6000) * 0.12, 420, 1300);
    let filter = null;
    if ((lp && lp < 19000) || o.loop) {
      filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = lp || NO_MUFFLE; filter.Q.value = 0.5;
      head.connect(filter); head = filter; nodes.push(filter);
    }
    const g = ctx.createGain();
    const entryGain = e.gain * (1 + this._rand.bi() * e.gainJit);
    const baseGain = entryGain * (o.volume ?? 1);
    g.gain.value = baseGain * (occluded ? 0.55 : 1);
    head.connect(g); nodes.push(g);
    let out = g, panner = null;
    if (pos) {
      panner = ctx.createPanner();
      panner.panningModel = this._hrtf() ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = o.ref || e.ref; panner.rolloffFactor = e.roll; panner.maxDistance = 10000;
      this._setPannerPos(panner, pos);
      g.connect(panner); out = panner; nodes.push(panner);
    } else if (o.pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner(); sp.pan.value = clamp(o.pan, -1, 1); g.connect(sp); out = sp; nodes.push(sp);
    }
    out.connect(this.bus[o.bus || e.bus] || this.bus.sfx);
    // Hall-/Echo-Sends (vor dem Panner: Raumanteil ist diffus)
    const envAmt = e.env * (o.env ?? 1);
    if (envAmt > 0.001 && (o.bus || e.bus) === 'sfx') {
      const wetDist = pos ? (0.35 + 0.65 * Math.min(1, dist / 35)) * (e.ref / (e.ref + 0.3 * Math.max(0, dist - e.ref))) : 0.45;
      const ind = this._indoorMix(pos, o);
      const wet = envAmt * wetDist * (o.volume ?? 1) * entryGain;
      if (ind > 0.02) { const s = ctx.createGain(); s.gain.value = wet * ind * 1.9; head.connect(s).connect(this.revIn); nodes.push(s); }
      if (ind < 0.98) { const s = ctx.createGain(); s.gain.value = wet * (1 - ind) * 0.62; head.connect(s).connect(this.echoIn); nodes.push(s); }
    }
    const when = now + Math.max(0, o.delay || 0);
    src.start(when, 0);
    const voice = {
      name: e.name, group: e.group, prio, src, gain: g, filter, panner, nodes, start: when, loop: !!o.loop,
      end: o.loop ? Infinity : when + buffer.duration / rate, actor: o.actor || null, tag: o.tag || null,
      position: pos, occluded, baseGain, entryGain, stopped: false, footstep: !!o.footstep,
    };
    src.onended = () => this._release(voice);
    this.voices.push(voice);
    this.stats.played++;
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

  /** 0 = draußen, 1 = drinnen: Decke über Punkt? (world.raycast nach oben, gecacht) */
  _ceilingAt(p) {
    const w = this.G.world; if (!w?.raycast) return 0;
    try {
      const T = this.G.THREE, up = T ? new T.Vector3(0, 1, 0) : { x: 0, y: 1, z: 0 };
      const hit = w.raycast(this._v3({ x: p.x, y: p.y + 0.2, z: p.z }), up, 16);
      return hit ? 1 : 0;
    } catch { return 0; }
  }

  _indoorMix(pos, o) {
    if (o.indoor != null) return o.indoor ? 1 : 0;
    if (this.envMode === 'indoor') return 1;
    if (this.envMode === 'outdoor') return 0;
    if (!pos) return this._indoor;
    const key = o.actor?.id ?? `${Math.round(pos.x / 3)}|${Math.round(pos.z / 3)}`;
    const now = this.ctx.currentTime, c = this._indoorSrc.get(key);
    let s;
    if (c && now - c.t < 0.6) s = c.v;
    else if (this._losAllowed()) { s = this._ceilingAt(pos); this._indoorSrc.set(key, { t: now, v: s }); if (this._indoorSrc.size > 256) this._indoorSrc.delete(this._indoorSrc.keys().next().value); }
    else s = c ? c.v : this._indoor;
    return 0.55 * s + 0.45 * this._indoor;
  }

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
    L.fx = fx; L.fy = fy; L.fz = fz; L.valid = true;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else { l.setPosition(L.x, L.y, L.z); l.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  // ================================================================ Update

  /** Pro Frame: Hörer folgt der Kamera, Innen/Außen, Schleifen-Verdeckung, Herzschlag, Dämpfung. */
  update(dt = 1 / 60) {
    if (!this.ctx || !this.unlocked) return;
    dt = clamp(dt, 0, 0.1);
    this._updateListener();
    // Innen/Außen am Hörer (gedrosselt)
    if (this.envMode === 'auto' && this.listener.valid) {
      this._indoorTimer -= dt;
      if (this._indoorTimer <= 0) { this._indoorTimer = 0.3; this._indoorT = this._ceilingAt(this.listener); }
      this._indoor += (this._indoorT - this._indoor) * Math.min(1, dt * 4);
    }
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
    this._updateVitals(dt);
    this._applyMuffle();
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
    } else {
      this._hb = 0.1; this._br = 0.4; this._brIn = true;
      this._muffle.health = NO_MUFFLE;
    }
  }

  _muffleTarget() {
    const m = this._muffle;
    let f = Math.min(m.health, m.pause ? 900 : NO_MUFFLE, m.dead ? 1100 : NO_MUFFLE);
    return f;
  }

  _applyMuffle(force = false) {
    if (!this.muffle) return;
    const t = this.ctx.currentTime;
    if (t < this._muffle.concussUntil && !force) return;
    const f = this._muffleTarget();
    if (Math.abs(f - this._muffle.current) < 50 && !force) return;
    this._muffle.current = f;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(f, t, f > this.muffle.frequency.value ? 0.25 : 0.08);
  }

  /** Explosion ganz nah: Dumpfheit + Tinnitus. */
  concuss(strength = 1) {
    if (!this.muffle) return;
    const t = this.ctx.currentTime, f = this.muffle.frequency, s = clamp(strength);
    const until = t + 1.2 + 2.2 * s;
    this._muffle.concussUntil = until;
    f.cancelScheduledValues(t); f.setValueAtTime(Math.max(100, f.value), t);
    f.exponentialRampToValueAtTime(lerp(1600, 330, s), t + 0.03);
    f.exponentialRampToValueAtTime(Math.max(400, this._muffleTarget()), until);
    this._muffle.current = -1;
    this.play('tinnitus', { volume: 0.3 + 0.7 * s, priority: 3 });
    this.ambDuck.gain.setTargetAtTime(0.35, t, 0.02); this.ambDuck.gain.setTargetAtTime(1, t + 1.5, 1);
  }

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
  _isKnife(id, def) { return id === 'knife' || def?.cls === 'melee'; }

  /** Schuss: Spieler trocken/2D/stereo; andere positional mit Nah/Fern-Überblendung und Laufzeit. */
  _gunshot(profile, o = {}) {
    const P = GUN_PROFILES[profile], isPlayer = o.player || this._isPlayer(o.actor) || (!o.position && o.distance == null);
    const vol = (o.volume ?? 1) * (o.suppressed ? 0.42 : 1), pitch = o.pitch ?? 1, lp = o.suppressed ? 2400 : 0;
    if (isPlayer) {
      const v = this._spawn(CATALOG[`gun_${profile}`], { ...o, position: null, priority: 3, env: (o.env ?? 1) * 0.4, volume: vol, pitch, lowpass: lp });
      if (this.ambDuck) { const t = this.ctx.currentTime; this.ambDuck.gain.setTargetAtTime(0.72, t, 0.01); this.ambDuck.gain.setTargetAtTime(1, t + 0.12, 0.35); }
      return v;
    }
    const pos = xyz(o.position), dist = o.distance ?? this._dist(pos);
    const x = smooth(16, 60, dist), near = Math.cos(x * Math.PI / 2), far = Math.sin(x * Math.PI / 2);
    const delay = (o.delay || 0) + Math.min(0.3, dist / 343);
    const base = { ...o, position: pos, delay, pitch, lowpass: lp };
    let v = null;
    if (near > 0.05) v = this._spawn(CATALOG[`gun_${profile}`], { ...base, volume: vol * near });
    if (far > 0.05) v = this._spawn(CATALOG[`gunfar_${profile}`], { ...base, volume: vol * far * 1.15 }) || v;
    return v;
  }

  _footstep(o) {
    const s = this._surface(o.surface), name = `step_${s}`;
    const vol = o.volume ?? (o.crouch ? 0.45 : o.sprint ? 1 : 0.75);
    const v = this.play(name, { ...o, volume: vol, lowpass: o.crouch ? 1900 : o.lowpass, footstep: true, pitch: (o.pitch ?? 1) * (o.sprint ? 1.04 : 1) });
    if (o.sprint) this.play('gear', { ...o, volume: vol * 0.6, footstep: true, delay: (o.delay || 0) + 0.01 });
    return v;
  }

  _explosion(p) {
    const pos = xyz(p.position); if (!pos) return null;
    const dist = this._dist(pos), x = smooth(22, 85, dist);
    const near = Math.cos(x * Math.PI / 2), far = Math.sin(x * Math.PI / 2), delay = Math.min(0.35, dist / 343);
    const vol = p.volume ?? 1;
    let v = null;
    if (near > 0.05) v = this._spawn(CATALOG.explosion, { position: pos, volume: vol * near, delay, priority: 3, occlusion: dist > 8 });
    if (far > 0.05) v = this._spawn(CATALOG.explosion_far, { position: pos, volume: vol * far * 1.2, delay, priority: 2 }) || v;
    const r = (p.radius || 6.5) * 1.5, pl = this.G.player;
    if (p.concuss !== false && this.listener.valid && dist < r && (!pl || pl.alive !== false)) this.concuss(1 - dist / r);
    return v;
  }

  /** Geschoss passiert den Hörer nah (aus weapon:fire Ursprung/Richtung) → Pfeifen/Knall. */
  _bulletPass(p, profile, def) {
    const L = this.listener, o = xyz(p.origin), d = xyz(p.dir);
    if (!L.valid || !o || !d) return;
    const dl = Math.hypot(d.x, d.y, d.z) || 1; d.x /= dl; d.y /= dl; d.z /= dl;
    const wx = L.x - o.x, wy = L.y - o.y, wz = L.z - o.z, t = wx * d.x + wy * d.y + wz * d.z;
    const range = def?.range || 250;
    if (t < 3 || t > range) return;
    const cx = o.x + d.x * t, cy = o.y + d.y * t, cz = o.z + d.z * t;
    const miss = Math.hypot(cx - L.x, cy - L.y, cz - L.z);
    if (miss > 3.5) return;
    const w = this.G.world;
    if (w?.raycast) { // Wand dazwischen? Dann kein Vorbeiflug
      try { const hit = w.raycast(this._v3(o), this._v3(d), t - 0.6); if (hit && hit.distance < t - 0.6) return; } catch { /* */ }
    }
    const crack = !!SUPERSONIC[profile];
    this.play(crack ? 'bullet_crack' : 'bullet_whiz', {
      position: { x: cx + d.x * 1.5, y: cy, z: cz + d.z * 1.5 }, volume: clamp(1.15 - miss / 3.5, 0.25, 1),
      delay: t / (crack ? 850 : 360), priority: 2, occlusion: false,
    });
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
      if (p.empty && prof !== 'lmg') seq.push([prof === 'sniper' ? 'bolt' : 'reload_bolt', 0.78]);
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
    if (this.G.settings && this.G.settings !== this.settings) { this.settings = this.G.settings; this._readSettings(); this._applyVolumes(); }
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
      this.play(prof, { player: pl, position: pos, actor: a, suppressed: !!p.suppressed, pitch: def?.sound?.pitch || 1 });
      const fm = def?.fireMode || (prof === 'shotgun' ? 'pump' : prof === 'sniper' ? 'bolt' : null);
      if (fm === 'pump' || fm === 'bolt') {
        const mag = a?.weapon?.current?.mag;
        if (mag !== 0) {
          const delay = clamp((60 / (def?.rpm || (fm === 'pump' ? 70 : 45))) * 0.42, 0.22, 0.65);
          const v = this.play(fm, { player: pl, position: pos, actor: a, delay, volume: pl ? 0.85 : 0.65 });
          if (v && a) { const l = this._reloads.get(a) || []; l.push(v); this._reloads.set(a, l); }
        }
      }
      if (pl) {
        const mag = a?.weapon?.current?.mag, cap = def?.mag;
        if (typeof mag === 'number' && cap > 5 && mag <= Math.ceil(cap * 0.25)) this.play('low_ammo', { volume: 0.5 + 0.5 * (1 - mag / (cap * 0.25)), player: true });
      } else this._bulletPass(p, prof, def);
    });
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
      const pl = this._isPlayer(p.shooter);
      this.play('impact', { surface: p.surface, position: p.point, volume: pl ? 1 : 0.8, priority: pl ? 2 : undefined });
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
      else if (victim) this.play('death', { position: this._eye(victim), actor: victim, pitch: this._voicePitch(victim), volume: 0.85 });
      if (this._isPlayer(killer) && now() - this._t.kill > 0.08) { this._t.kill = now(); this.play('hitmarker_kill'); }
    });
    on('explosion', p => this._explosion(p));
    // Splint beim Ziehen (Kochen hörbar, Warnung bei Bots), Wurf nur als Luftzug
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
      this._muffle.dead = false; this._applyMuffle(true);
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
      this._objOwners.clear(); this._muffle.dead = false; this._muffle.pause = false; this._applyMuffle(true);
      this.startAmbience(this.G.world?.ambience || MAP_AMBIENCE[p.mapId] || p.mapId || 'range');
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
      this._readSettings(); this._applyVolumes();
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
    if (this.muffle) this._applyMuffle(true);
    // Klangbank ab der Lobby füllen (Worker, ohne AudioContext); Ausrüstung aus der letzten Wahl zuerst
    if (s === 'lobby' || s === 'loading') { this._warmBank(); this._prioritizeLoadout(); }
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
    for (const a of this._reloads.keys()) this._cancelReload(a);
    this._occl.clear(); this._indoorSrc.clear();
    if (this.ctx && this.unlocked) {
      for (const v of this.voices.slice()) if (v.group === 'vital') this._kill(v, 0.2);
      this._muffle.dead = false; this._muffle.pause = false; this._muffle.health = NO_MUFFLE; this._applyMuffle(true);
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
    const cfg = AMBIENCES[id], now = this.ctx.currentTime;
    // Schleife und Ereignisse anderer Karten freigeben
    const keep = new Set([`amb_bed_${id}`, ...cfg.events.map(e => e.name)]);
    this._releaseSounds((name, e) => e.bus === 'amb' && !keep.has(name));
    const amb = this._amb = { id, playing: true, gain: this.ctx.createGain(), src: null, next: [] };
    amb.gain.gain.value = 0; amb.gain.connect(this.bus.amb);
    amb.next = cfg.events.map(ev => now + this._rand.range(...(ev.first || ev.every)));
    // Unter Ausrüstung/Feedback einsortiert: die Schleife blendet ohnehin erst ein, wenn sie fertig ist
    this._require(cfg.events.map(e => e.name), () => {}, PRIO.amb);
    this._require([`amb_bed_${id}`], ok => {
      if (!ok || this._amb !== amb || !amb.playing || !this.ctx) return;
      const b = bank.get(this._key(CATALOG[`amb_bed_${id}`], 0)); if (!b) return;
      const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(amb.gain); s.start();
      amb.src = s;
      const t = this.ctx.currentTime; amb.gain.gain.setValueAtTime(0, t); amb.gain.gain.linearRampToValueAtTime(1, t + 2.5);
    }, PRIO.amb + 5);
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
        const o = { volume: vol * (k ? this._rand.range(0.8, 1) : 1), bus: 'amb', delay: k * rate, priority: 0, ref: dist, env: 0, occlusion: false };
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
    setTimeout(() => { try { a.src?.disconnect(); a.gain.disconnect(); } catch { /* */ } }, (fade + 0.3) * 1000);
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
    return {
      state: this.ctx?.state || 'none', sampleRate: this.ctx?.sampleRate || 0, unlocked: this.unlocked, voices: this.voices.length,
      buffers: bank.buffers.size, queue: bank.queued, bankMB: +(bank.bytes / 1048576).toFixed(2), workers: bank.stats.workers, synth: bank.stats.mode, space: this._space, indoor: +this._indoor.toFixed(2), ambience: this.ambienceId,
      music: this.musicPlaying, hrtf: this._hrtf(), synthErrors: bank.stats.errors, muffle: Math.round(this.muffle?.frequency.value || 0), ...this.stats,
    };
  }

  _error(err) {
    this.stats.errors++; this.stats.lastError = String(err?.stack || err);
    if (this.G.debug) console.error('[audio]', err);
  }

  dispose() {
    this.detach(); this.stopAmbience(0); this.stopMusic(0); this.stopAll(0.01);
    this._lifeUnsub?.(); this._lifeUnsub = null; this._lifeBus = null;
    this._disposed = true;
    if (typeof window !== 'undefined') {
      if (this._onGesture) for (const t of GESTURES) window.removeEventListener(t, this._onGesture, true);
      if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); window.removeEventListener('pagehide', this._onVis); window.removeEventListener('pageshow', this._onVis); }
    }
    if (typeof this._settingsUnsub === 'function') this._settingsUnsub();
    if (this.ctx && !this.offline && !this.opts.context) this.ctx.close().catch(() => {});
  }
}

/** Liste aller abspielbaren Katalognamen. */
export const SOUND_NAMES = Object.keys(CATALOG);

/**
 * Offline-Messung: rendert, was setup(engine) abspielt, durch die komplette Kette (inkl. Limiter)
 * und liefert Spitzenpegel/RMS. Für Tests und das Dev-Board.
 */
export async function renderOffline(setup, { seconds = 2, sampleRate = 48000, settings = null, camera = null, THREE = null, preroll = 1 } = {}) {
  // Vorlauf: Chromes Kompressor startet voll zugedrückt und gibt erst über die Release-Zeit frei
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + preroll) * sampleRate), sampleRate);
  const eng = new AudioEngine({ settings, events: null, camera, THREE }, { context: ctx, autoUnlock: false, autoMusic: false });
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
