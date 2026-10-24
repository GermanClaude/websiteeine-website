// NULLPUNKT – Ego-Waffen ohne Hänger (24.10., Vorarbeit V5 vor dem Umbau aller Waffen auf M-17/P-9-Detailgrad).
//
// Eine Foto-Waffe kostet im Container bis ≈ 5 s Bau (Distanzfeld-Netze, Atlas) + 0,8 s Kontaktgitter – synchron im Hauptthread.
// Bisher geschah das, wann immer eine Ego-Fassung fehlte: beim Aufheben einer Waffe mitten im Gefecht, beim ersten Wechsel auf eine
// Zweitwaffe mit Aufsätzen. Darum:
//  - prefetch(defs) / prefetchJobs(defs): Vorrat – Ego-Fassungen der im Match getragenen Waffen (Bots, Mitspieler, Beute am Boden,
//    vorgemerkte eigene Ausrüstung) in der aktuellen Detailstufe, im Ladebildschirm (main.js runJobs) bzw. im Leerlauf (tot, Pause,
//    Countdown). Budget je Stufe (PREFETCH_TRIS), häufigste Waffen zuerst; was nicht mehr passt, fällt auf den nächsten Punkt zurück.
//  - _entryForSwap() (aus _swapNow, nur mit deferBuilds = Spiel; Labor/Werkzeuge bauen wie bisher sofort): fehlt die Ego-Fassung
//    und ist sie teuer, kommt sofort die Bot-Fassung derselben Waffe in die Hand (gleiche Anker → Anschlag, Griffe, Mündung, Auswurf
//    stimmen; ≤ 30 ms). Die Ego-Fassung entsteht in Einzelschritten (Vorlage → Kontaktgitter → Griffe/Schacht → Shader/Texturen)
//    und ersetzt sie in einem ruhigen Moment.
// backgroundStep({ idle, quiet }) läuft je Bild (main.js) und macht höchstens einen Schritt: dringende Aufträge (Bot-Fassung in der
// Hand) im Leerlauf oder in Ruhe (QUIET_S kein Schuss, kein Anschlag, keine Aktion, kein Treffer), Vorrat nur im Leerlauf.
import * as THREE from 'three';
import { createWeaponModel, weaponDetailTier, hasWeaponTemplate, weaponBuildCost, releaseWeaponTemplate } from './models.js';
import { applyCamo } from './gunsmith/camos.js';
import { ID_TO_MODEL } from './gunsmith/handling.js';
import { magWellOf } from './anim/magwell.js';
import { uploadTextures } from '../engine/warm.js';

// Sofort bauen, was so billig ist wie die Waffen alter Bauweise (1 000–7 000 Dreiecke, 2–90 ms im Container)
const CHEAP_MS = 40;
const CHEAP_TRIS = 60000;
// Vorrat je Match und Detailstufe: höchstens so viele Dreiecke zusätzlicher Ego-Vorlagen (≈ 96–120 B je Dreieck → max ≤ 60 MB,
// std ≤ 36 MB, lite ≤ 15 MB; nach den Budgets der Bauanleitung ≈ 2 Foto-Waffen in max, 3 in std/lite – jede Aufsatz-Kombination
// mit Mündung/Optik/Unterlauf ist bis zum Bauteil-Cache eine eigene Vorlage) und teure Einträge (billige zählen nicht); ungenutzte
// Vorlagen gibt dispose() am Matchende wieder frei (prefetchRelease)
const PREFETCH_TRIS = { max: 500000, std: 300000, lite: 150000 };
const PREFETCH_MAX = 6;
const QUIET_S = 2;
const STEPS = 5; // 0 Vorlage + Eintrag, 1 Kontaktgitter, 2 Griffe/Schacht, 3 Shader/Texturen, 4 eintragen/tauschen

const attKeyOf = (att) => (att ? Object.values(att).join('+') : '');

export const BUILD_ACTIONS = {
  /** Eintragsschlüssel wie _getModel: Waffen-Id, mit Aufsätzen '#' + Kombination. */
  _mk(id, att) { const ak = attKeyOf(att); return ak ? id + '#' + ak : id; },

  /**
   * Waffe für _swapNow: vorhandener Eintrag; sonst billig sofort (wie bisher); teuer nur im Spiel (deferBuilds): Vorlage schon da →
   * echtes Modell sofort, Kontaktgitter nachgereicht; Vorlage fehlt → Bot-Fassung + dringender Auftrag.
   */
  _entryForSwap(id, key, att) {
    const ak = attKeyOf(att);
    const mk = ak ? id + '#' + ak : id;
    const have = this._models.get(mk);
    if (have) return have;
    if (!this.deferBuilds) return this._getModel(id, key, att);
    const a = ak ? att : null;
    const q = this._bgJobs || (this._bgJobs = []);
    const job = q.find((j) => j.mk === mk);
    if (job && job.entry) {
      // Ego-Vorlage im Hintergrund schon fertig: gleich zeigen, Kontaktgitter/Griffe/Shader laufen weiter
      job.prio = 2;
      job.prefetch = false;
      this._bgCamo(job.entry);
      this._models.set(mk, job.entry);
      return job.entry;
    }
    if (hasWeaponTemplate(key, 'first', a)) {
      const entry = this._entryFrom(createWeaponModel(key, { lod: 'first', att: a }), id, key, ak, a);
      if (entry.ud.info.triangles <= CHEAP_TRIS) {
        if (job) q.splice(q.indexOf(job), 1);
        this._entryCollider(entry);
        this._models.set(mk, entry);
        this._prepareGrips(entry);
        magWellOf(entry);
        return entry;
      }
      // Kontaktgitter (bis 0,8 s) später: bis dahin greifen die Hände ohne Oberflächenkontakt (wie bei einem Fehler im Gitter)
      entry.collider = null;
      entry.contactMemo = new Map();
      this._models.set(mk, entry);
      this._prepareGrips(entry);
      magWellOf(entry);
      if (job) Object.assign(job, { entry, step: 1, prio: 2, prefetch: false });
      else this._enqueue({ mk, id, key, att: a, ak, prio: 2, step: 1, entry });
      return entry;
    }
    const c = weaponBuildCost(key);
    if (c && c.ms <= CHEAP_MS && c.triangles <= CHEAP_TRIS) {
      if (job) q.splice(q.indexOf(job), 1);
      return this._getModel(id, key, att);
    }
    const stub = this._entryFrom(createWeaponModel(key, { lod: 'third', att: a }), id, key, ak, a);
    stub.stub = true;
    stub.tier = 'third';
    this._entryCollider(stub);
    stub.mw = null; // Schachtachse nicht aus der Bot-Fassung (magWellOf speichert je Modell – das gehört der Ego-Fassung)
    this._models.set(mk, stub);
    this._prepareGrips(stub);
    if (job) Object.assign(job, { prio: 2, prefetch: false });
    else this._enqueue({ mk, id, key, att: a, ak, prio: 2, step: 0 });
    return stub;
  },

  _enqueue(job) {
    const q = this._bgJobs || (this._bgJobs = []);
    const old = q.find((j) => j.mk === job.mk);
    if (old) { old.prio = Math.max(old.prio, job.prio); if (!job.prefetch) old.prefetch = false; return old; }
    q.push(job);
    return job;
  },

  /**
   * Vorrat (V5): Ego-Fassungen für Waffen, die man im Match aufheben oder ausrüsten kann (defs: Waffen-Definitionen samt Aufsätzen,
   * häufigste zuerst). → Anzahl neuer Aufträge
   */
  prefetch(defs) {
    let n = 0;
    for (const d of defs || []) {
      if (!d || !d.id || d.cls === 'melee') continue;
      const att = d.att && Object.keys(d.att).length ? d.att : null;
      const mk = this._mk(d.id, att);
      if (this._models.has(mk) || (this._bgJobs || []).some((j) => j.mk === mk)) continue;
      this._enqueue({ mk, id: d.id, key: d.model || ID_TO_MODEL[d.id] || d.id, att, ak: attKeyOf(att), prio: 0, step: 0, prefetch: true });
      n++;
    }
    return n;
  },

  /** Ladebildschirm: Vorrat als Einzelschritte für main.js runJobs (je Auftrag STEPS Schritte; Budget beim Ausführen). */
  prefetchJobs(defs) {
    this.prefetch(defs);
    const jobs = [];
    for (const j of [...(this._bgJobs || [])]) {
      if (!j.prefetch) continue;
      for (let s = 0; s < STEPS; s++) jobs.push(() => this._bgPump(j, true));
    }
    return jobs;
  },

  /** Einen Schritt von job ausführen, falls er noch ansteht. */
  _bgPump(job, idle) {
    const q = this._bgJobs;
    if (!q || !q.includes(job)) return;
    let done = false;
    try { done = this._bgRun(job, idle); } catch (err) { console.warn('[viewmodel] Hintergrund-Bau', job.mk, err); done = true; }
    if (done) q.splice(q.indexOf(job), 1);
  },

  /** Ein Schritt (STEPS). → true, wenn der Auftrag erledigt ist (oder entfällt). */
  _bgRun(job, idle) {
    switch (job.step) {
      case 0: {
        let had = true;
        if (job.prefetch) {
          // Budget erschöpft: diese Waffe fällt beim Aufheben auf Bot-Fassung + Hintergrund-Bau zurück
          if ((this._prefetchTris || 0) >= (PREFETCH_TRIS[this._tier] ?? PREFETCH_TRIS.std) || (this._prefetchN || 0) >= PREFETCH_MAX) return true;
          had = hasWeaponTemplate(job.key, 'first', job.att);
        }
        // Der teure Teil: Distanzfeld-Netze, Atlas (Container bis ≈ 5 s, Ziel ≤ 2,5 s) – nur hier, nie mitten im Gefecht
        const t0 = performance.now();
        job.entry = this._entryFrom(createWeaponModel(job.key, { lod: 'first', att: job.att }), job.id, job.key, job.ak, job.att);
        if (job.prefetch) {
          // Waffen alter Bauweise (wenige ms) zählen nicht gegen die Anzahl – sie kämen sonst beim Aufheben als Bot-Fassung
          if (performance.now() - t0 > CHEAP_MS || job.entry.ud.info.triangles > CHEAP_TRIS) this._prefetchN = (this._prefetchN || 0) + 1;
          job.entry.prefetched = true;
          if (!had) { this._prefetchTris = (this._prefetchTris || 0) + (job.entry.ud.info.triangles || 0); job.entry.ownTemplate = true; }
        }
        job.step = 1;
        return false;
      }
      case 1: this._entryCollider(job.entry); job.step = 2; return false;
      case 2: this._prepareGrips(job.entry); magWellOf(job.entry); job.step = 3; return false;
      case 3: this._gpuWarm(job.entry, !job.prefetch); job.step = 4; return false;
      default: return this._bgFinish(job, idle);
    }
  },

  /** Fertigen Eintrag übernehmen; liegt die Vorfassung (Bot-Fassung/alte Stufe) in der Hand, erst in einer ruhigen Pause tauschen. */
  _bgFinish(job, idle) {
    const entry = job.entry;
    const have = this._models.get(job.mk);
    if (have === entry) return true; // Kontaktgitter nachgereicht
    if (have && !have.stub && have.tier === entry.tier) return true; // inzwischen anders gebaut
    this._bgCamo(entry);
    if (have && this.cur === have) {
      if (!this._swapReady(idle)) return false;
      this._models.set(job.mk, entry);
      this._replaceCurrent(entry);
    } else this._models.set(job.mk, entry);
    return true;
  },

  /**
   * Tarnmuster wie die übrigen Einträge dieser Waffe: setCamo() erreicht nur Einträge in _models – ein Auftrag, der beim Aufheben
   * (Tarnung des Vorbesitzers) noch lief, trug sonst das Muster vom Zeitpunkt seines Baus.
   */
  _bgCamo(entry) {
    if (!this._camos.has(entry.id)) return;
    const c = this._camos.get(entry.id) || null;
    if ((entry.model.userData.camo || null) !== (c === 'werk' ? null : c)) applyCamo(entry.model, c);
  },

  /** Tausch der Waffe in der Hand nur ohne laufende Aktion, Wechsel oder Anschlag (Leerlauf: Ansicht ohnehin verdeckt). */
  _swapReady(idle) {
    if (this.action || this._pending || this._lowering || this._equipT < 1) return false;
    return idle || this._ads < 0.05;
  },

  /** Ruhe für dringende Bauschritte: QUIET_S kein Schuss, nicht im Anschlag, keine Aktion/kein Wechsel. */
  _quietNow() {
    return !this.action && !this._pending && !this._lowering && this._equipT >= 1 && this._ads < 0.05 &&
      this._time - (this._lastShotT ?? -1e9) >= QUIET_S;
  },

  /**
   * Matchende (dispose): Vorlagen, die nur der Vorrat gebaut hat und die nie in die Hand kamen, freigeben – sonst wüchse der Speicher
   * von Match zu Match um die Waffen der Bots. Auch Aufträge, die beim Matchende noch liefen.
   */
  prefetchRelease() {
    let n = 0;
    for (const e of [...this._models.values(), ...(this._bgJobs || []).map((j) => j.entry).filter(Boolean)]) {
      if (!e.prefetched || !e.ownTemplate || e.used || e.tier !== weaponDetailTier()) continue;
      if (releaseWeaponTemplate(e.key, 'first', e.attObj)) n++;
    }
    return n;
  },

  /** Neuen Eintrag statt der Bot-Fassung/alten Stufe in die Hand (Teile in Ruhelage, Mündungsfeuer umhängen). */
  _replaceCurrent(entry) {
    entry.used = true;
    if (this.cur) this.gun.remove(this.cur.model);
    this.cur = entry;
    this.gun.add(entry.model);
    this._resetParts();
    entry.ud.muzzle.add(this.flash.group);
    this.flash.hide();
    this._sightType = entry.ud.info.sight;
  },

  /** Shader der neuen Materialien übersetzen, Texturen hochladen (Vorrat: nur Shader – Texturen erst beim Gebrauch). */
  _gpuWarm(entry, upload) {
    const r = this.G?.renderer?.renderer;
    if (!r || typeof r.compile !== 'function') return;
    const holder = new THREE.Group();
    holder.add(entry.model);
    this.root.add(holder);
    try { r.compile(this.scene, this.camera); } catch { /* beim ersten Zeichnen */ }
    if (upload) { try { uploadTextures(r, holder); } catch { /* beim ersten Zeichnen */ } }
    holder.remove(entry.model);
    this.root.remove(holder);
  },

  /**
   * Je Bild höchstens ein Schritt (main.js). idle: Spieler tot, Pausenmenü, Countdown; quiet: Spieler lebt und nahm zuletzt keinen
   * Schaden. → true, wenn gearbeitet wurde
   */
  backgroundStep({ idle = false, quiet = true } = {}) {
    if (this._disposed) return false;
    const calm = idle || (quiet && this._quietNow());
    // Pausenmenü/Todesbildschirm: vorgemerkte Waffe (Ausrüstung geändert) schon jetzt bauen – sonst Bot-Fassung beim Weiterspielen
    const p = this._pending;
    if (idle && p && this.deferBuilds) {
      const att = p.def && p.def.att ? p.def.att : null;
      const mk = this._mk(p.id, att);
      if (!this._models.has(mk)) this._enqueue({ mk, id: p.id, key: (p.def && p.def.model) || ID_TO_MODEL[p.id] || p.id, att, ak: attKeyOf(att), prio: 2, step: 0 });
    }
    const q = this._bgJobs;
    if (!q || !q.length) return false;
    let job = null;
    for (const j of q) {
      if (j.prio >= 1 ? !calm : !idle) continue;
      if (j.step >= 4 && this.cur && this._models.get(j.mk) === this.cur && !this._swapReady(idle)) continue;
      if (!job || j.prio > job.prio) job = j;
    }
    if (!job) return false;
    this._bgPump(job, idle);
    return true;
  },

  /** Stand für Prüfwerkzeuge: { tier, jobs: [{ mk, prio, step }], stub (Waffe in der Hand ist die Bot-Fassung), prefetchTris } */
  buildState() {
    return {
      tier: this._tier, stub: !!(this.cur && this.cur.stub), curTier: this.cur ? this.cur.tier : null, prefetchTris: this._prefetchTris || 0,
      jobs: (this._bgJobs || []).map((j) => ({ mk: j.mk, prio: j.prio, step: j.step, prefetch: !!j.prefetch })),
      entries: [...this._models].map(([mk, e]) => ({ mk, tier: e.tier, stub: !!e.stub, collider: !!e.collider })),
    };
  },
};
