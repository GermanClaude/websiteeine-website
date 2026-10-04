// NULLPUNKT — Medaillen nach MEDAL_RULES (modes.data.js). Wird vom Modus gefüttert (onKill/onHit/onImpact)
// und sendet 'medal' { actor, id, label, tier }. Zählt Medaillen pro Akteur (Endbildschirm, playerSummary).

const FALLBACK_RULES = {
  multiKillWindow: 4, headhunterCount: 3, streaks: { 5: 'serie5', 10: 'serie10', 15: 'serie15' }, comebackDeaths: 3,
  closeCallHealth: 15, saviorWindow: 3, buzzkillStreak: 5, flawlessMinKills: 5, defendRadius: 9,
  longshotByClass: { ar: 40, smg: 25, lmg: 45, marksman: 50, sniper: 60, shotgun: 15, pistol: 25, melee: Infinity },
};

export class MedalTracker {
  constructor(mode) {
    this.mode = mode;
    this.G = mode.G;
    const D = this.G.data || {};
    this.defs = D.MEDALS || {};
    this.rules = D.MEDAL_RULES || FALLBACK_RULES;
    this.multi = typeof D.multiKillMedal === 'function' ? D.multiKillMedal : (n) => (n >= 5 ? 'kahlschlag' : ({ 2: 'doppelkill', 3: 'dreifachkill', 4: 'vierfachkill' })[n] || null);
    this.counts = new Map(); // actor → { id: n }
    this.chain = new Map(); // actor → { last, n }
    this.lastHit = new Map(); // attacker → { time, target }
    this.penetrations = new Map(); // shooter → time
    this.killSerial = new Map(); // actor → { serial, weaponId }
    this.headLife = new Map(); // actor → Kopfschuss-Abschüsse in diesem Leben
  }

  reset() {
    for (const m of [this.counts, this.chain, this.lastHit, this.penetrations, this.killSerial, this.headLife]) m.clear();
  }

  /** Vergibt eine Medaille (unbekannte Ids werden ignoriert). */
  award(actor, id) {
    if (!actor || !id) return;
    const def = this.defs[id];
    if (!def) return;
    const c = this.counts.get(actor) || {};
    c[id] = (c[id] || 0) + 1;
    this.counts.set(actor, c);
    this.G.events.emit('medal', { actor, id, label: def.label, tier: def.tier });
  }

  medalsOf(actor) {
    return { ...(this.counts.get(actor) || {}) };
  }

  onHit({ attacker, target }) {
    if (!attacker || !target || attacker === target) return;
    this.lastHit.set(attacker, { time: this.G.time.elapsed, target });
  }

  onImpact({ shooter, penetrated }) {
    if (shooter && penetrated) this.penetrations.set(shooter, this.G.time.elapsed);
  }

  onDeath(victim) {
    this.headLife.delete(victim);
    this.chain.delete(victim);
  }

  /**
   * ctx: { credit, victim, e (kill-Ereignis), streakKill, victimStreak (Abschüsse des Opfers in diesem Leben),
   *        deathsInRow (Tode des Schützen vor diesem Abschuss), teams }
   */
  onKill(ctx) {
    const { credit, victim, e, streakKill, victimStreak, deathsInRow, teams } = ctx;
    const G = this.G;
    const R = this.rules;
    const now = G.time.elapsed;
    const W = (G.data && G.data.WEAPONS) || {};
    const def = W[e.weaponId] || null;
    const gun = !!def && def.cls !== 'melee' && !e.explosive;

    // Mehrfachabschüsse
    const ch = this.chain.get(credit);
    const n = ch && now - ch.last <= R.multiKillWindow ? ch.n + 1 : 1;
    this.chain.set(credit, { last: now, n });
    if (n >= 2) this.award(credit, this.multi(n));

    if (e.firstBlood) this.award(credit, 'erstesblut');
    if (e.headshot) {
      this.award(credit, 'kopftreffer');
      const h = (this.headLife.get(credit) || 0) + 1;
      this.headLife.set(credit, h);
      if (h === R.headhunterCount) this.award(credit, 'kopfjaeger');
    }
    if (e.revenge) this.award(credit, 'rache');
    if (e.weaponId === 'knife' || (def && def.cls === 'melee')) this.award(credit, 'nahkampf');
    if (e.explosive && (e.weaponId === 'frag' || e.weaponId === 'semtex')) this.award(credit, 'granate');
    if (streakKill) this.award(credit, 'praemie');
    if (def && gun && Number.isFinite(e.distance)) {
      const min = R.longshotByClass ? R.longshotByClass[def.cls] : undefined;
      if (min !== undefined && e.distance >= min) this.award(credit, 'weitschuss');
    }
    const streakId = R.streaks && R.streaks[credit.stats ? credit.stats.streak : 0];
    if (streakId) this.award(credit, streakId);
    if (victimStreak >= R.buzzkillStreak) this.award(credit, 'serienbrecher');
    if (deathsInRow >= R.comebackDeaths) this.award(credit, 'rueckkehrer');
    if (credit.alive && !credit.isStreakEntity && credit.health > 0 && credit.health < R.closeCallHealth) this.award(credit, 'haaresbreite');
    if (gun && credit.weapon && (credit.weapon.adsProgress || 0) < 0.25 && credit.isPlayer) this.award(credit, 'huefte');
    if (gun && this.penetrations.get(credit) === now) this.award(credit, 'durchschlag');

    // Retter: Opfer hat kurz vorher einen Verbündeten des Schützen getroffen
    if (teams) {
      const lh = this.lastHit.get(victim);
      if (lh && lh.target !== credit && lh.target.team === credit.team && now - lh.time <= R.saviorWindow) this.award(credit, 'retter');
    }
    // Kollateral: zwei Abschüsse mit derselben Kugel
    if (gun && credit._shotSerial != null) {
      const prev = this.killSerial.get(credit);
      if (prev && prev.serial === credit._shotSerial && prev.weaponId === e.weaponId && def.pellets <= 1) this.award(credit, 'kollateral');
      this.killSerial.set(credit, { serial: credit._shotSerial, weaponId: e.weaponId });
    }
    this.onDeath(victim);
  }
}
