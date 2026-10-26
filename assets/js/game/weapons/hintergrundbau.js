// NULLPUNKT – Ego-Waffen ohne Hänger (24.10., Vorarbeiten V1/V5 vor dem Umbau aller Waffen auf M-17/P-9-Detailgrad).
//
// Eine Foto-Waffe kostet im Container bis ≈ 5 s Bau (Distanzfeld-Netze, Atlas) + 0,8 s Kontaktgitter – synchron im Hauptthread.
// Bisher geschah das, wann immer eine Ego-Fassung fehlte: beim Aufheben einer Waffe mitten im Gefecht, beim ersten Wechsel auf eine
// Zweitwaffe mit Aufsätzen, nach einem Wechsel der Grafikstufe gar nicht (VR blieb auf der vollen Fassung). Darum:
//  - prefetch(defs) / prefetchJobs(defs): Vorrat – Ego-Fassungen der im Match getragenen Waffen (Bots, Mitspieler, Beute am Boden,
//    vorgemerkte eigene Ausrüstung) in der aktuellen Detailstufe, im Ladebildschirm (main.js runJobs) bzw. im Leerlauf (tot, Pause,
//    Countdown). Budget je Stufe (PREFETCH_TRIS), häufigste Waffen zuerst; was nicht mehr passt, fällt auf den nächsten Punkt zurück.
//  - _entryForSwap() (aus _swapNow, nur mit deferBuilds = Spiel; Labor/Werkzeuge bauen wie bisher sofort): fehlt die Ego-Fassung
//    und ist sie teuer (Foto-Waffe), kommt sofort ein Platzhalter in die Hand – die Ego-Grundfassung derselben Waffe, wenn deren
//    Vorlage steht (nur die Aufsätze fehlen), sonst die Bot-Fassung (gleiche Anker → Anschlag, Griffe, Mündung, Auswurf stimmen;
//    ≤ 30 ms). Waffen alter Bauweise (auch ohne Messung) und Klone vorhandener Vorlagen baut das Aufheben wie bisher sofort.
//  - _retier() (Grafikstufe im Match gewechselt: Einstellungen, VR-Vorgabe „Niedrig“): Waffen in der Hand/im Gepäck in der neuen
//    Stufe ebenso neu, die alte Fassung bleibt bis zum Tausch; danach werden die Vorlagen der alten Stufe freigegeben.
// backgroundStep({ idle, quiet }) läuft je Bild (main.js) und macht höchstens einen Schritt (Vorlage → Shader/Texturen → Griffe/Schacht
// → Kontaktgitter → Tausch; bis 25.10. kam das Gitter vor Shader/Griffen). Ein Bauplan läuft am Stück (bis Sekunden, kein Bau in Zeitscheiben) – darum die schweren Schritte
// (Vorlage, Kontaktgitter ohne Teilen) im Spiel NUR im Leerlauf (tot, Pause, Countdown), nie mitten im Gefecht; leichte Schritte
// dringender Aufträge (Platzhalter/alte Stufe in der Hand) auch in Ruhe (QUIET_S seit Ziehen/Schuss, kein Anschlag, keine Aktion,
// kein Treffer). Vorrat nur im Leerlauf.
//
// 26.10. (Vorab Etappe 2): Plan-Aufträge des Modus (planWeapons). Waffenspiel und Schießstand bauten bisher im Ladebildschirm jede
// Waffe vor – mit jeder Foto-Waffe länger und größer (Waffenspiel PC hoch nach Etappe 1: Laden +16 s, JS-Speicher +102 MB, die ganze
// Leiter in max). Jetzt baut der Ladebildschirm im Waffenspiel nur die aktuelle und die nächsten LADDER_AHEAD Stufen, im Schießstand
// nur die Ausrüstung; den Rest bauen Plan-Aufträge im Leerlauf nach (Waffenspiel: die nächsten Stufen zuerst und dringlich, damit
// beim Aufstieg die echte Fassung schon steht – fehlt sie doch, gilt die Platzhalter-Regel wie beim Aufheben). Schwere Schritte
// nicht dringender Aufträge laufen nur, solange der Leerlauf noch reicht (idleLeft, main.js rechnet die Bauzeit auf Countdown und
// Wiedereinstieg an – der Leerlauf wird nicht länger, nur genutzt).
import * as THREE from 'three';
import { createWeaponModel, weaponDetailTier, hasWeaponModel, weaponBuildCost, isPhotoWeapon, releaseEgoTemplates, releaseWeaponTemplate } from './models.js';
import { applyCamo } from './gunsmith/camos.js';
import { ID_TO_MODEL } from './gunsmith/handling.js';
import { magWellOf } from './anim/magwell.js';
import { uploadTextures } from '../engine/warm.js';

// Sofort bauen, was so billig ist wie die Waffen alter Bauweise (1 000–7 000 Dreiecke; 2–90 ms im Container, unter Last und mit
// Aufsätzen in max mehr) – Foto-Waffen liegen bei ≥ 70 000 Dreiecken und ≥ 300 ms
const CHEAP_MS = 150;
const CHEAP_TRIS = 60000;
// Vorrat je Match und Detailstufe: höchstens so viele Dreiecke zusätzlicher Ego-Vorlagen (≈ 96–120 B je Dreieck → max ≤ 60 MB,
// std ≤ 36 MB, lite ≤ 15 MB; nach den Budgets der Bauanleitung ≈ 2 Foto-Waffen in max, 3 in std/lite – jede Aufsatz-Kombination
// mit Mündung/Optik/Unterlauf ist bis zum Bauteil-Cache eine eigene Vorlage) und teure Einträge (billige zählen nicht). Geprüft
// VOR dem Bau mit einer Schätzung (gemessene Grundfassung, sonst EST_*), also hart bis auf die Dreiecke der Aufsätze; die M-17 in
// max (534 000) passt deshalb nie. Ungenutzte Vorlagen gibt dispose() am Matchende wieder frei (prefetchRelease)
const PREFETCH_TRIS = { max: 500000, std: 300000, lite: 150000 };
const EST_PHOTO_TRIS = { max: 540000, std: 125000, lite: 75000 }; // noch nie gebaute Foto-Waffe: wie die M-17 (größte bisher)
const EST_OLD_TRIS = 8000; // noch nie gebaute Waffe alter Bauweise
const PREFETCH_MAX = 6;
const QUIET_S = 2;
const STEPS = 5; // 0 Vorlage + Eintrag, 1 Shader/Texturen, 2 Griffe/Schacht, 3 Kontaktgitter, 4 eintragen/tauschen
// 26.10.: die leichten Schritte (Shader/Texturen, Griffe) vor dem schweren Kontaktgitter – kommt eine Waffe mitten aus ihrem Auftrag in
// die Hand (Aufstieg im Waffenspiel nach einem kurzen Leerlauf), fehlt höchstens das Gitter; vorher lud dann das erste Bild ihre Atlanten
// hoch und übersetzte die Shader
const ST_GPU = 1, ST_GRIPS = 2, ST_COLL = 3;
// 26.10.: schwerer Schritt eines nicht dringenden Auftrags (Vorrat, Plan) nur, wenn vom Leerlauf noch so viel übrig ist (s) – eine
// Foto-Waffe kostet am PC grob 0,2–1,5 s, im Container bis 4,5 s; ein Bau überzieht den Leerlauf so höchstens einmal
const IDLE_MIN_S = 0.75;

const attKeyOf = (att) => (att ? Object.values(att).join('+') : '');

/** Waffenspiel (26.10.): der Ladebildschirm baut die aktuelle und die nächsten LADDER_AHEAD Stufen, den Rest der Hintergrund. */
export const LADDER_AHEAD = 2;

/** Waffen-Ids der Leiterstufen level … level + ahead (je Id einmal). */
export function ladderWindow(steps, level = 0, ahead = LADDER_AHEAD) {
  return [...new Set((steps || []).slice(Math.max(0, level), Math.max(0, level) + ahead + 1))];
}

/**
 * Ladebildschirm im Waffenspiel (Prüfung 26.10.): das Fenster (ladderWindow) und dazu alle Waffen alter Bauweise der Leiter – je wenige
 * Millisekunden und ≈ 1 MB; ohne sie baute der Aufstieg in einer Serie jede davon im Bild (Container 40–100 ms, Probe aufstieg.mjs).
 * Teuer und dem Leerlauf überlassen sind nur die Foto-Waffen. modelOf(id) → Modellschlüssel.
 */
export function ladderPrebuild(steps, level = 0, modelOf = (id) => id) {
  return [...new Set([...ladderWindow(steps, level), ...(steps || []).filter((id) => !isPhotoWeapon(modelOf(id)))])];
}

/** Waffen-Ids der Leiter in Bau-Reihenfolge ab Stufe level: die Stufen davor zuletzt (Abstufung durch Messer/Selbsttötung). */
export function ladderOrder(steps, level = 0) {
  const s = steps || [], l = Math.max(0, Math.min(level, s.length));
  return [...new Set([...s.slice(l), ...s.slice(0, l).reverse()])];
}

export const BUILD_ACTIONS = {
  /** Eintragsschlüssel wie _getModel: Waffen-Id, mit Aufsätzen '#' + Kombination. */
  _mk(id, att) { const ak = attKeyOf(att); return ak ? id + '#' + ak : id; },

  /**
   * Waffe für _swapNow: vorhandener Eintrag; ohne deferBuilds (Labor, Werkzeuge) sofort bauen wie bisher. Im Spiel: Klon einer
   * vorhandenen Vorlage sofort (Kontaktgitter geteilt bzw. im Leerlauf nachgereicht); Waffe alter Bauweise sofort (wie bisher, auch
   * ohne Messung); Foto-Waffe ohne Vorlage → Platzhalter + dringender Auftrag (Bau im Leerlauf).
   */
  _entryForSwap(id, key, att) {
    this._restT = this._time; // Ruhe für Hintergrund-Schritte zählt ab dem Ziehen
    const ak = attKeyOf(att);
    const mk = ak ? id + '#' + ak : id;
    const have = this._models.get(mk);
    if (have) return have;
    if (!this.deferBuilds) return this._getModel(id, key, att);
    const a = ak ? att : null;
    const q = this._bgJobs || (this._bgJobs = []);
    const job = q.find((j) => j.mk === mk);
    if (job && job.entry) {
      // Ego-Vorlage im Hintergrund schon fertig: gleich zeigen, Kontaktgitter/Griffe/Shader laufen weiter (ohne sie umzuhängen)
      job.prio = 2;
      job.prefetch = false;
      this._bgCamo(job.entry);
      this._models.set(mk, job.entry);
      return job.entry;
    }
    if (hasWeaponModel(key, { att: a })) {
      const entry = this._entryFrom(createWeaponModel(key, { lod: 'first', att: a }), id, key, ak, a);
      // klein oder Kontaktgitter teilbar (Munition, Schaft, Schnellmagazin teilen die Vorlage der Grundfassung): gleich vollständig
      if (entry.ud.info.triangles <= CHEAP_TRIS || this._colliderShared(entry)) {
        if (job) q.splice(q.indexOf(job), 1);
        this._entryCollider(entry);
        this._models.set(mk, entry);
        this._prepareGrips(entry);
        magWellOf(entry);
        return entry;
      }
      // Kontaktgitter (bis 0,8 s) im nächsten Leerlauf: bis dahin greifen die Hände ohne Oberflächenkontakt (wie bei einem Fehler im Gitter)
      entry.collider = null;
      entry.contactMemo = new Map();
      this._models.set(mk, entry);
      this._prepareGrips(entry);
      magWellOf(entry);
      if (job) Object.assign(job, { entry, step: ST_COLL, prio: 2, prefetch: false });
      else this._enqueue({ mk, id, key, att: a, ak, prio: 2, step: ST_COLL, entry });
      return entry;
    }
    // Kosten der Grundfassung in dieser Stufe gemessen → danach; unbekannt → alte Bauweise sofort, Foto-Waffe nie im Bild
    const c = weaponBuildCost(key);
    if (c ? c.ms <= CHEAP_MS && c.triangles <= CHEAP_TRIS : !isPhotoWeapon(key)) {
      if (job) q.splice(q.indexOf(job), 1);
      return this._getModel(id, key, att);
    }
    const stub = this._placeholder(id, key, ak, a);
    this._models.set(mk, stub);
    if (job) Object.assign(job, { prio: 2, prefetch: false });
    else this._enqueue({ mk, id, key, att: a, ak, prio: 2, step: 0 });
    return stub;
  },

  /**
   * Platzhalter, bis die Ego-Fassung im Leerlauf entsteht: Ego-Grundfassung derselben Waffe, wenn deren Vorlage in dieser Stufe steht
   * (nur die Aufsätze fehlen sichtbar; Kontaktgitter meist geteilt), sonst die Bot-Fassung mit Aufsätzen (≤ 600 Dreiecke).
   */
  _placeholder(id, key, ak, a) {
    let e;
    if (a && hasWeaponModel(key)) {
      e = this._entryFrom(createWeaponModel(key, { lod: 'first' }), id, key, ak, a);
      if (e.ud.info.triangles <= CHEAP_TRIS || this._colliderShared(e)) this._entryCollider(e);
      else { e.collider = null; e.contactMemo = new Map(); }
      this._prepareGrips(e);
      magWellOf(e); // Grundfassung derselben Waffe (Schachtachse je Modellschlüssel)
    } else {
      e = this._entryFrom(createWeaponModel(key, { lod: 'third', att: a }), id, key, ak, a);
      e.tier = 'third';
      this._entryCollider(e);
      e.mw = null; // Schachtachse nicht aus der Bot-Fassung (magWellOf speichert je Modell – das gehört der Ego-Fassung)
      this._prepareGrips(e);
    }
    e.stub = true;
    return e;
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

  /**
   * 26.10.: Plan-Aufträge des Modus – defs = Waffen-Definitionen samt Aufsätzen (wie setLoadout sie anlegt) in Bau-Reihenfolge; die
   * ersten near sind dringlich (prio 1, Waffenspiel: die nächsten Stufen – leichte Schritte auch in Ruhe), der Rest prio 0 (nur im
   * Leerlauf). tier = feste Stufe (Schießstand: die leichte); weicht sie von der aktuellen ab (PC hoch), nur Vorlage + Shader/Texturen
   * ohne Eintrag – die volle Fassung entsteht beim Ausrüsten (gleiche Materialien und Atlanten). warmOnly (Prüfung 26.10., Schießstand):
   * auch in der aktuellen Stufe nur Vorlage + Shader/Texturen – fertige Einträge samt Kontaktgitter aller Waffen hielten nach einem
   * längeren Pausenmenü mehr Speicher als der frühere Vorbau (Schießstand mittel 235 statt 217 MB); Eintrag, Griffe und Gitter der in der
   * Waffenkammer gewählten Waffe entstehen noch im Pausenmenü (vorgemerkte Waffe). Plan-Aufträge, die nicht mehr im
   * Plan stehen und noch nicht begonnen haben, entfallen; die übrigen folgen der neuen Reihenfolge. → Anzahl neuer Aufträge
   */
  planWeapons(defs, { near = 0, tier = null, warmOnly = false } = {}) {
    const q = this._bgJobs || (this._bgJobs = []);
    const warm = tier && (warmOnly || tier !== this._tier) ? tier : null;
    const order = new Map();
    let n = 0;
    for (const d of defs || []) {
      if (!d || !d.id || d.cls === 'melee') continue;
      const att = d.att && Object.keys(d.att).length ? d.att : null;
      const key = d.model || ID_TO_MODEL[d.id] || d.id;
      const mk = this._mk(d.id, att) + (warm ? '@' + warm : '');
      if (order.has(mk)) continue;
      const prio = order.size < near ? 1 : 0;
      order.set(mk, order.size);
      const job = q.find((j) => j.mk === mk);
      if (job) { job.plan = true; if (job.prio < 2) job.prio = prio; continue; }
      const e = warm ? null : this._models.get(mk);
      if (warm ? hasWeaponModel(key, { att, tier: warm }) : e && !e.stub && e.tier === this._tier) continue; // steht schon
      q.push({ mk, id: d.id, key, att, ak: attKeyOf(att), prio, step: 0, plan: true, warm });
      n++;
    }
    const kept = q.filter((j) => !j.plan || j.prio >= 2 || j.step > 0 || order.has(j.mk));
    const planned = kept.filter((j) => j.plan && order.has(j.mk)).sort((a, b) => order.get(a.mk) - order.get(b.mk));
    let k = 0;
    this._bgJobs = kept.map((j) => (j.plan && order.has(j.mk) ? planned[k++] : j));
    return n;
  },

  /** 26.10.: Plan-Auftrag in einer anderen festen Stufe (Schießstand am PC hoch: die leichte) – Vorlage, dann Shader/Texturen. */
  _bgWarm(job) {
    if (job.step === 0) {
      job.model = createWeaponModel(job.key, { lod: 'first', att: job.att, tier: job.warm });
      job.step = 1;
      return false;
    }
    this._gpuWarm({ model: job.model }, true);
    job.model = null;
    return true;
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
    if (done) {
      q.splice(q.indexOf(job), 1);
      // fertig, aber nicht übernommen (inzwischen anders gebaut, Fehler): Ego-Fassung nicht weiter halten (Freigabe je Waffe, models.js)
      if (job.entry && this._models.get(job.mk) !== job.entry) this._dropEntry(job.entry);
    }
  },

  /** Ein Schritt (STEPS). → true, wenn der Auftrag erledigt ist (oder entfällt). */
  _bgRun(job, idle) {
    if (job.warm) return this._bgWarm(job);
    switch (job.step) {
      case 0: {
        let had = true;
        if (job.prefetch) {
          // Budget VOR dem Bau (Schätzung): passt die Vorlage nicht mehr, fällt die Waffe beim Aufheben auf Platzhalter + Bau im Leerlauf zurück
          had = hasWeaponModel(job.key, { att: job.att });
          const est = had ? 0 : this._estTris(job.key);
          if ((this._prefetchTris || 0) + est > (PREFETCH_TRIS[this._tier] ?? PREFETCH_TRIS.std)) return true;
          if ((this._prefetchN || 0) >= PREFETCH_MAX && est > CHEAP_TRIS) return true;
        }
        // Der teure Teil: Distanzfeld-Netze, Atlas (Container bis ≈ 7 s) – im Spiel nur im Leerlauf (backgroundStep), nie im Gefecht
        const t0 = performance.now();
        job.entry = this._entryFrom(createWeaponModel(job.key, { lod: 'first', att: job.att }), job.id, job.key, job.ak, job.att);
        if (job.prefetch) {
          // Waffen alter Bauweise (wenige ms) zählen nicht gegen die Anzahl – sie kämen sonst beim Aufheben als Bot-Fassung
          if (performance.now() - t0 > CHEAP_MS || job.entry.ud.info.triangles > CHEAP_TRIS) this._prefetchN = (this._prefetchN || 0) + 1;
          job.entry.prefetched = true;
          if (!had) { this._prefetchTris = (this._prefetchTris || 0) + (job.entry.ud.info.triangles || 0); job.entry.ownTemplate = true; }
        }
        job.step = ST_GPU;
        return false;
      }
      case ST_GPU: this._gpuWarm(job.entry, !job.prefetch); job.step = ST_GRIPS; return false;
      case ST_GRIPS: this._prepareGrips(job.entry); magWellOf(job.entry); job.step = ST_COLL; return false;
      case ST_COLL: this._entryCollider(job.entry); job.step = 4; return false;
      default: return this._bgFinish(job, idle);
    }
  },

  /** Fertigen Eintrag übernehmen; liegt die Vorfassung (Platzhalter/alte Stufe) in der Hand, erst in einer ruhigen Pause tauschen. */
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
    this._dropEntry(have); // Platzhalter/alte Stufe abgemeldet
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

  /** Ruhe für leichte Schritte dringender Aufträge: QUIET_S seit Ziehen und letztem Schuss, nicht im Anschlag, keine Aktion/kein Wechsel. */
  _quietNow() {
    return !this.action && !this._pending && !this._lowering && this._equipT >= 1 && this._ads < 0.05 &&
      this._time - (this._restT ?? 0) >= QUIET_S;
  },

  /** Schritt kostet bis zu Sekunden am Stück (Vorlage bauen; Kontaktgitter, wenn es nicht geteilt werden kann). */
  _heavyStep(job) {
    if (job.step === 0) return !hasWeaponModel(job.key, { att: job.att, tier: job.warm || null });
    return !job.warm && job.step === ST_COLL && !(job.entry && this._colliderShared(job.entry));
  },

  /** Geschätzte Dreiecke einer noch nicht gebauten Ego-Vorlage (Vorrat-Budget). */
  _estTris(key) {
    const c = weaponBuildCost(key);
    if (c) return c.triangles;
    return isPhotoWeapon(key) ? (EST_PHOTO_TRIS[this._tier] ?? EST_PHOTO_TRIS.std) : EST_OLD_TRIS;
  },

  /** Eintragsschlüssel der Waffen, die der Spieler trägt (Hand, laufender Wechsel, Ausrüstung). */
  _carriedMks() {
    const s = new Set();
    if (this.cur) s.add(this.cur.mk);
    const p = this._pending;
    if (p) s.add(this._mk(p.id, (p.def && p.def.att) || null));
    for (const sl of this.G?.player?.weapon?.slots || []) if (sl && sl.def) s.add(this._mk(sl.id, sl.def.att || null));
    return s;
  },

  /**
   * Matchende (dispose): Vorlagen, die nur der Vorrat gebaut hat und die nie in die Hand kamen, freigeben – sonst wüchse der Speicher
   * von Match zu Match um die Waffen der Bots. Auch Aufträge, die beim Matchende noch liefen.
   */
  prefetchRelease() {
    let n = 0;
    const all = [...this._models.values(), ...(this._bgJobs || []).map((j) => j.entry).filter(Boolean)];
    // Vorlage, die ein benutzter Eintrag teilt (Nur-Werte-Aufsätze, STAT_ONLY: Hohlspitz = Grundfassung), bleibt
    const usedTpl = new Set(all.filter((e) => e.used && e.ud.tpl).map((e) => e.ud.tpl));
    for (const e of all) {
      if (!e.prefetched || !e.ownTemplate || e.used || e.tier !== weaponDetailTier() || usedTpl.has(e.ud.tpl)) continue;
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
    // Liegt das Modell schon in der Hand (vm.gun: Aufheben während des Auftrags, Klon einer vorhandenen Vorlage), NICHT umhängen –
    // holder.add nähme es aus der Hand, die Waffe wäre bis zum nächsten Wechsel unsichtbar; es ist dann ohnehin in der Szene
    const holder = entry.model.parent ? null : new THREE.Group();
    if (holder) { holder.add(entry.model); this.root.add(holder); }
    try { r.compile(this.scene, this.camera); } catch { /* beim ersten Zeichnen */ }
    if (upload) { try { uploadTextures(r, entry.model); } catch { /* beim ersten Zeichnen */ } }
    if (holder) { holder.remove(entry.model); this.root.remove(holder); }
  },

  /**
   * Grafikstufe im Match gewechselt (V1): Waffe in der Hand und ausgerüstete Waffen in der neuen Stufe neu (Hand zuerst), übrige
   * Einträge (Vorrat, alte Aufsätze) fallen weg; Requisiten folgen in einem Schritt, danach Vorlagen der alten Stufe frei.
   */
  _retier() {
    this._tier = weaponDetailTier();
    this._setSelfShadow(this._tier === 'max');
    const keep = new Set();
    if (this.cur) keep.add(this.cur.mk);
    for (const s of this.G?.player?.weapon?.slots || []) if (s && s.def) keep.add(this._mk(s.id, s.def.att || null));
    // Vorrat und Plan-Aufträge verwerfen (main.js plant sie in der neuen Stufe neu, 26.10.); laufende Aufträge in der neuen Stufe von
    // vorn (verworfene Einträge abmelden, sonst hielten sie die alte Stufe)
    const loose = (j) => { if (j.entry && this._models.get(j.mk) !== j.entry) this._dropEntry(j.entry); };
    const gone = (j) => j.prefetch || (j.plan && j.prio < 2);
    for (const j of this._bgJobs || []) if (gone(j)) loose(j);
    this._bgJobs = (this._bgJobs || []).filter((j) => !gone(j));
    for (const j of this._bgJobs) if (j.entry && j.entry.tier !== this._tier) { loose(j); j.step = 0; j.entry = null; }
    for (const [mk, e] of [...this._models]) {
      if (!keep.has(mk)) { this._models.delete(mk); this._dropEntry(e); continue; }
      if (!e.stub && e.tier === this._tier) { // schon in dieser Stufe
        for (const j of this._bgJobs) if (j.mk === mk) loose(j);
        this._bgJobs = this._bgJobs.filter((j) => j.mk !== mk);
        continue;
      }
      this._enqueue({ mk, id: e.id, key: e.key, att: e.attObj || null, ak: e.att || '', prio: e === this.cur ? 1 : 0, step: 0 });
    }
    // geteilte Kontaktgitter nur noch aus Einträgen dieser Stufe (die übrigen hielten sonst ihre Netze im Speicher)
    this._colliderSrc = new Map();
    for (const e of this._models.values()) if (!e.stub && e.tier === this._tier && e.collider && e.ud.tpl && !this._colliderSrc.has(e.ud.tpl)) this._colliderSrc.set(e.ud.tpl, e.collider);
    this._prefetchTris = this._prefetchN = 0;
    this._releaseOld = true;
  },

  /** Requisiten (Messer, Granaten, Platte – je ≤ 2 000 Dreiecke) in der aktuellen Stufe neu. */
  _rebuildProps() {
    for (const k of Object.keys(this.props)) {
      const old = this.props[k];
      const m = this._prop(createWeaponModel(k === 'knife' ? this._meleeKey : k, { lod: 'first' }));
      if (k === 'knife' && this._camos.get(this._meleeId)) applyCamo(m, this._camos.get(this._meleeId));
      old.removeFromParent();
      this.props[k] = m;
    }
    this._propsTier = this._tier;
  },

  /**
   * Je Bild höchstens ein Schritt (main.js). idle: Spieler tot, Pausenmenü, Countdown; quiet: Spieler lebt und nahm zuletzt keinen
   * Schaden; idleLeft (26.10.): Rest des Leerlaufs in s (Countdown, Wiedereinstieg; Pause: unbegrenzt) – schwere Schritte nicht
   * dringender Aufträge (Vorrat, Plan) nur bei mindestens IDLE_MIN_S. busy (Prüfung 26.10.): Menü wird gerade bedient (Pause,
   * Ausrüstung im Tod) – dann gar keine schweren Schritte, auch nicht für die gewählte Waffe. → true, wenn gearbeitet wurde
   */
  backgroundStep({ idle = false, quiet = true, idleLeft = Infinity, busy = false } = {}) {
    if (this._disposed) return false;
    const calm = idle || (quiet && this._quietNow());
    // Requisiten nach Stufenwechsel (ohne laufende Aktion – Granate/Messer könnten gerade in der Hand sein)
    if (this._propsTier !== this._tier && calm && !this.action) { this._rebuildProps(); return true; }
    // Pausenmenü/Todesbildschirm: vorgemerkte Waffe (Ausrüstung geändert) schon jetzt bauen – sonst Bot-Fassung beim Weiterspielen;
    // 26.10. auch ohne deferBuilds (Schießstand-Waffenkammer im Pausenmenü: sonst baute das Ziehen nach dem Weiterspielen am Stück);
    // pend: Auftrag gehört der Vormerkung – wird sie geändert (andere Waffe angeklickt), entfällt er auch begonnen (unten)
    const p = this._pending;
    if (idle && p) {
      const att = p.def && p.def.att ? p.def.att : null;
      const mk = this._mk(p.id, att);
      if (!this._models.has(mk)) {
        const j = this._enqueue({ mk, id: p.id, key: (p.def && p.def.model) || ID_TO_MODEL[p.id] || p.id, att, ak: attKeyOf(att), prio: 2, step: 0 });
        if (!j.prefetch && !j.plan) j.pend = true;
      }
    }
    const q = this._bgJobs;
    if (!q || !q.length) {
      if (this._releaseOld && this._propsTier === this._tier) { this._releaseOld = false; releaseEgoTemplates(this._tier); }
      return false;
    }
    // Waffe inzwischen wieder abgelegt (anderes aufgehoben, Tod): noch nicht begonnene Aufträge verwerfen und den Platzhalter
    // vergessen – sonst baute der Leerlauf eine Waffe, die niemand trägt; ein späteres Aufheben fängt neu an
    // (Plan-Aufträge gehören dem Modus, 26.10.). Prüfung 26.10.: Aufträge der Vormerkung auch begonnen – wer in der Waffenkammer
    // mehrere Waffen anklickt, baut nur die zuletzt gewählte (die Vorlage einer abgewählten bleibt im Zwischenspeicher)
    if (q.some((j) => !j.prefetch && !j.plan && (j.step === 0 || j.pend))) {
      const carried = this._carriedMks();
      for (const j of [...q]) {
        if (j.prefetch || j.plan || (j.step !== 0 && !j.pend) || carried.has(j.mk)) continue;
        q.splice(q.indexOf(j), 1);
        if (j.entry && this._models.get(j.mk) !== j.entry) this._dropEntry(j.entry);
        const e = this._models.get(j.mk);
        if (e && (e.stub || e.tier !== this._tier)) { this._models.delete(j.mk); this._dropEntry(e); }
      }
    }
    let job = null;
    for (const j of q) {
      // Vorrat/Gepäck (prio 0) nur im Leerlauf; dringende Aufträge: leichte Schritte auch in Ruhe, schwere nur im Leerlauf. Prüfung
      // 26.10.: begonnene Plan-Aufträge (Vorlage steht) ebenso – baute der Todesbildschirm die Vorlage gerade noch, lud sonst der
      // Aufstieg auf diese Waffe ihre Atlanten und Programme erst im Wechselbild (Probe aufstieg.mjs: Adler 3 Texturen, 3 Programme)
      const urgent = j.prio >= 1 || (j.plan && j.step > 0);
      if (!idle && (!urgent || !calm || this._heavyStep(j))) continue;
      if (busy && this._heavyStep(j)) continue; // Menü wird bedient: auch die gewählte Waffe erst in Ruhe (Prüfung 26.10.)
      if (idle && j.prio < 2 && idleLeft < IDLE_MIN_S && this._heavyStep(j)) continue; // Leerlauf reicht nicht mehr (26.10.)
      if (j.step >= 4 && this.cur && this._models.get(j.mk) === this.cur && !this._swapReady(idle)) continue;
      if (!job || j.prio > job.prio) job = j;
    }
    if (!job) return false;
    const s0 = job.step;
    this._bgPump(job, idle);
    // Prüfung 26.10.: im Leerlauf nach der Vorlage gleich Shader/Texturen – die Bauzeit wird angerechnet, und endete der Leerlauf mit
    // dem Bau (Wiedereinstieg), lud sonst der Aufstieg auf diese Waffe Atlanten und Programme im Wechselbild (Probe aufstieg.mjs)
    if (idle && s0 === 0 && job.step === ST_GPU && (this._bgJobs || []).includes(job)) this._bgPump(job, idle);
    return true;
  },

  /**
   * Stand für Prüfwerkzeuge: { tier, jobs: [{ mk, prio, step }], stub (Waffe in der Hand ist ein Platzhalter), curLod ('first' = Ego-
   * Grundfassung, 'third' = Bot-Fassung), inGun (Modell hängt in der Hand), prefetchTris }
   */
  buildState() {
    return {
      tier: this._tier, stub: !!(this.cur && this.cur.stub), curTier: this.cur ? this.cur.tier : null, prefetchTris: this._prefetchTris || 0,
      curLod: this.cur ? this.cur.ud.lod : null, inGun: !!(this.cur && this.cur.model.parent === this.gun),
      jobs: (this._bgJobs || []).map((j) => ({ mk: j.mk, prio: j.prio, step: j.step, prefetch: !!j.prefetch, plan: !!j.plan, warm: j.warm || null })),
      entries: [...this._models].map(([mk, e]) => ({ mk, tier: e.tier, stub: !!e.stub, collider: !!e.collider })),
    };
  },
};
