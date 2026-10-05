// NULLPUNKT — Klassen, Panzerung (Westen-Platten, Helme), Klassen-Ausrüstung und Spielstile.
// Reine Daten + kleine Hilfsfunktionen ohne three.js (Spiel, Bots, Website und Node-Prüfungen nutzen sie).
//
// Rüstungsmodell (wie Warzone/COD Mobile, mit Realismus-Einschlag):
//  - Eine Weste hat `slots` Platten zu je `plateHp`. Die Platten bilden einen gemeinsamen Balken (hp = Summe);
//    Schaden trägt ihn von oben ab, eine eingesetzte Platte füllt das angebrochene Segment und ein weiteres auf.
//  - Platten nehmen den Anteil `absorb` eines Rumpftreffers auf, der Rest (stumpfes Trauma) geht auf das Leben.
//    Glieder schützt die Weste nur zu `limbCover` (Schulter-/Seitenschutz), Splitter zu `explosiveAbsorb`.
//  - Der Helm mindert Kopfschaden um `reduction`, solange er hält (hp). Scharfschützen- und Großkaliber-Treffer
//    (≥ 90 Schaden) unterhalb von `sniperRange` Metern gehen ungebremst durch.
//  - Gewicht kostet Tempo (`speedMult`, `sprintMult`).

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/* =============================================================== Panzerung */

/** Dauer einer Platten-Einsetzung (s), wenn die Stufe nichts anderes sagt. */
export const PLATE_INSERT_TIME = 1.2;

export const ARMOR_TIERS = deepFreeze({
  keine: {
    id: 'keine', label: 'Keine', short: '—', slots: 0, plateHp: 0, absorb: 0, limbCover: 0, explosiveAbsorb: 0,
    carry: 0, speedMult: 1, sprintMult: 1, plateTime: PLATE_INSERT_TIME, weight: 0,
    desc: 'Kein Plattenträger: volle Beweglichkeit, jeder Treffer geht aufs Leben.',
  },
  leicht: {
    id: 'leicht', label: 'Leicht', short: 'L', slots: 2, plateHp: 30, absorb: 0.7, limbCover: 0.2, explosiveAbsorb: 0.45,
    carry: 3, speedMult: 1, sprintMult: 0.99, plateTime: 1.0, weight: 4.5,
    desc: 'Zwei Weichkern-Platten. Kaum spürbar, fängt eine kurze Salve ab.',
  },
  mittel: {
    id: 'mittel', label: 'Mittel', short: 'M', slots: 3, plateHp: 30, absorb: 0.8, limbCover: 0.3, explosiveAbsorb: 0.55,
    carry: 3, speedMult: 0.96, sprintMult: 0.95, plateTime: 1.2, weight: 8,
    desc: 'Drei Keramikplatten. Der Standard für den Sturm: hält, ohne zu bremsen.',
  },
  schwer: {
    id: 'schwer', label: 'Schwer', short: 'S', slots: 4, plateHp: 30, absorb: 0.85, limbCover: 0.4, explosiveAbsorb: 0.65,
    carry: 2, speedMult: 0.9, sprintMult: 0.88, plateTime: 1.5, weight: 13,
    desc: 'Vier Stahlkeramik-Platten mit Seitenschutz. Langsamer – aber wer dich umlegen will, braucht ein Magazin.',
  },
});
export const ARMOR_ORDER = Object.freeze(['keine', 'leicht', 'mittel', 'schwer']);

export const HELMETS = deepFreeze({
  keine: { id: 'keine', label: 'Kein Helm', reduction: 0, hp: 0, sniperRange: 0, speedMult: 1, desc: 'Mütze oder Kappe – nur Tarnung.' },
  standard: {
    id: 'standard', label: 'Gefechtshelm', reduction: 0.35, hp: 60, sniperRange: 60, speedMult: 1,
    desc: 'Mindert Kopftreffer um 35 %, bis er nachgibt. Gegen Scharfschützen auf unter 60 m wirkungslos.',
  },
  schwer: {
    id: 'schwer', label: 'Schwerer Helm', reduction: 0.5, hp: 110, sniperRange: 25, speedMult: 0.99,
    desc: 'Mit Kinnschutz: halbiert Kopftreffer und hält deutlich länger. Scharfschützen unter 25 m schlagen trotzdem durch.',
  },
});
export const HELMET_ORDER = Object.freeze(['keine', 'standard', 'schwer']);

/** Schaden pro Treffer, ab dem ein Treffer unterhalb von sniperRange den Helm ignoriert (Großkaliber). */
export const HELMET_PIERCE_DAMAGE = 90;

export const armorDef = (id) => ARMOR_TIERS[id] || ARMOR_TIERS.keine;
export const helmetDef = (id) => HELMETS[id] || HELMETS.keine;

/** Neuer Rüstungszustand (am Spawn voll, Reserveplatten voll). */
export function createArmorState(tierId = 'keine', helmetId = 'keine') {
  const t = armorDef(tierId);
  const h = helmetDef(helmetId);
  return {
    tier: t.id, helmetId: h.id,
    slots: t.slots, plateHp: t.plateHp, maxHp: t.slots * t.plateHp, hp: t.slots * t.plateHp,
    carry: t.carry, carryMax: t.carry,
    helmetHp: h.hp, helmetMax: h.hp,
    speedMult: t.speedMult * h.speedMult, sprintMult: t.sprintMult * h.speedMult,
    plateTime: t.plateTime || PLATE_INSERT_TIME,
    /** { start, dur, chain } während des Einsetzens (Zeit = G.time.elapsed), sonst null. */
    inserting: null,
  };
}

/** Intakte (auch angebrochene) Platten. */
export function plateCount(s) {
  return s && s.plateHp > 0 ? Math.ceil(Math.max(0, s.hp) / s.plateHp - 1e-6) : 0;
}

/** Kann eine Platte eingesetzt werden (nicht voll, Reserve vorhanden)? */
export function canInsertPlate(s) {
  return !!s && s.slots > 0 && s.carry > 0 && s.hp < s.maxHp - 0.5;
}

/** Eine Platte einsetzen (fertig): füllt das angebrochene Segment und ein weiteres auf. → neue hp. */
export function insertPlate(s) {
  if (!canInsertPlate(s)) return s ? s.hp : 0;
  const full = Math.floor(s.hp / s.plateHp + 1e-6);
  s.hp = Math.min(s.maxHp, (full + 1) * s.plateHp);
  s.carry -= 1;
  return s.hp;
}

/**
 * Schaden durch Weste/Helm verteilen (verändert `s`).
 * ctx: { zone: 'head'|'body'|'limb', explosive, weaponCls, distance, perShot (Schaden je Treffer vor Rüstung) }
 * → { health, plates, helmet, platesBroken (Anzahl zerbrochener Segmente), broken (Weste leer), helmetBroken, pierced }
 */
export function absorbDamage(s, amount, ctx = {}) {
  const out = { health: amount, plates: 0, helmet: 0, platesBroken: 0, broken: false, helmetBroken: false, pierced: false };
  if (!s || !(amount > 0)) return out;
  const zone = ctx.zone || 'body';
  if (zone === 'head' && !ctx.explosive) {
    if (s.helmetHp > 0) {
      const h = helmetDef(s.helmetId);
      const big = ctx.weaponCls === 'sniper' || (Number(ctx.perShot) || amount) >= HELMET_PIERCE_DAMAGE;
      if (big && (Number(ctx.distance) || 0) < h.sniperRange) { out.pierced = true; return out; }
      const blocked = Math.min(amount * h.reduction, s.helmetHp);
      s.helmetHp -= blocked;
      out.helmet = blocked;
      out.health = amount - blocked;
      if (s.helmetHp <= 0.01) { s.helmetHp = 0; out.helmetBroken = true; }
    }
    return out;
  }
  if (s.hp <= 0) return out;
  const t = armorDef(s.tier);
  const share = ctx.explosive ? t.explosiveAbsorb : zone === 'limb' ? t.absorb * t.limbCover : t.absorb;
  if (share <= 0) return out;
  const before = plateCount(s);
  const want = amount * share;
  const taken = Math.min(want, s.hp);
  s.hp -= taken;
  if (s.hp < 0.01) s.hp = 0;
  out.plates = taken;
  out.health = amount - taken; // Rest: stumpfes Trauma + Überschuss einer zerbrechenden Platte
  out.platesBroken = before - plateCount(s);
  out.broken = s.hp <= 0;
  return out;
}

/* ===================================================== Klassen-Ausrüstung */

export const GADGETS = deepFreeze({
  adrenalin: {
    id: 'adrenalin', name: 'Adrenalinspritze', cls: 'sturm', charges: 1, useTime: 0.55, heal: 35, speedMult: 1.12, duration: 6,
    desc: 'Sofort 35 Leben und 6 s lang 12 % schneller. Eine Spritze pro Leben.',
  },
  medkit: {
    id: 'medkit', name: 'Verbandskasten', cls: 'sanitaeter', charges: 3, useTime: 0.8, heal: 60, healTime: 1.6, healOthers: 45, radius: 4,
    desc: 'Heilt dich um 60 und Kameraden im Umkreis von 4 m um 45. Drei Anwendungen pro Leben.',
  },
  repair: {
    id: 'repair', name: 'Reparaturwerkzeug', cls: 'pionier', charges: 0, hold: true, rate: 55, range: 3.2,
    desc: 'Gedrückt halten an einem beschädigten eigenen Fahrzeug: 55 Strukturpunkte pro Sekunde.',
  },
  spot: {
    id: 'spot', name: 'Markieren', cls: 'aufklaerer', charges: 0, cooldown: 1.2, range: 350, cone: 0.06, duration: 8,
    desc: 'Markiert den Gegner im Visier 8 s lang für dein Team (Minikarte und Marker).',
  },
});

/* ================================================================ Klassen */

// Alle Schusswaffen stehen allen Klassen offen (wie Battlefield 6); Werfer nur dem Pionier.
const ALL_WEAPONS = Object.freeze(['ar', 'carbine', 'smg', 'lmg', 'marksman', 'sniper', 'shotgun', 'pistol', 'melee']);

/**
 * prefer.* = Wunschreihenfolge je Platz; resolveClassLoadout() nimmt die erste existierende, freigeschaltete Waffe.
 * launcher = Wunschliste für einen Werfer (Klasse 'launcher', sobald es einen gibt; sonst entfällt er).
 * look = Aussehen für Bots (Weste, Helm, Gepäck, Tarnung) und Viewmodel-Ärmel/Handschuhe.
 */
export const CLASSES = deepFreeze({
  sturm: {
    id: 'sturm', name: 'Sturm', short: 'STU', icon: 'sturm',
    role: 'Speerspitze im Angriff: mittlere Weste, Sturmgewehr und eine Adrenalinspritze für den letzten Meter.',
    armor: 'mittel', helmet: 'standard', gadget: 'adrenalin',
    weaponClasses: ALL_WEAPONS,
    signature: ['ar', 'carbine'],
    prefer: { primary: ['ar_m17', 'ar_kv47'], secondary: ['pi_p9', 'pi_adler'], lethal: ['frag', 'semtex'] },
    perks: { sprintAfterKill: 1.1, sprintAfterKillTime: 5 },
    look: { id: 'sturm', variant: 'sturm', camo: 'flecktarn', sleeve: '#59603f', glove: '#2a2b26', vest: 'plattentraeger', helmet: 'gefechtshelm', pack: 'sturmgepaeck', patch: 'pfeil', accent: '#c8a64a' },
    bot: { weight: 0.4, aggression: 0.75 },
  },
  sanitaeter: {
    id: 'sanitaeter', name: 'Sanitäter', short: 'SAN', icon: 'sanitaeter',
    role: 'Hält den Trupp am Leben: heilt schneller, belebt in 1,5 s wieder und trägt einen Verbandskasten für alle.',
    armor: 'leicht', helmet: 'standard', gadget: 'medkit',
    weaponClasses: ALL_WEAPONS,
    signature: ['smg'],
    prefer: { primary: ['smg_vp9', 'smg_qx90', 'ar_m17'], secondary: ['pi_p9', 'pi_adler'], lethal: ['frag', 'semtex'] },
    perks: { regenDelayMult: 0.7, regenRateMult: 1.35, reviveTime: 1.5, reviveHealth: 60 },
    look: { id: 'sanitaeter', variant: 'funker', camo: 'flecktarn', sleeve: '#5d6450', glove: '#3a3a36', vest: 'sanitaetsweste', helmet: 'gefechtshelm', pack: 'sanitaetstasche', patch: 'kreuz', accent: '#d8d8d0' },
    bot: { weight: 0.25, aggression: 0.5 },
  },
  pionier: {
    id: 'pionier', name: 'Pionier', short: 'PIO', icon: 'pionier',
    role: 'Gegen Panzer und für Fahrzeuge: schwere Weste mit vier Platten, Werfer, Reparaturwerkzeug und 20 % weniger Explosionsschaden.',
    armor: 'schwer', helmet: 'schwer', gadget: 'repair',
    weaponClasses: [...ALL_WEAPONS, 'launcher'],
    signature: ['lmg', 'shotgun'],
    prefer: { primary: ['lmg_hm60', 'sg_bulldog', 'ar_kv47', 'ar_m17'], secondary: ['pi_adler', 'pi_p9'], lethal: ['semtex', 'frag'] },
    launcher: ['pf3', 'pf3_faust', 'faust', 'lr2', 'lr2_degen', 'degen'],
    perks: { explosiveResist: 0.2, repairMult: 1.25 },
    look: { id: 'pionier', variant: 'pionier', camo: 'oliv', sleeve: '#4f5038', glove: '#262420', vest: 'schwerer_traeger', helmet: 'schwerer_helm', pack: 'werfer', patch: 'zahnrad', accent: '#b5651d' },
    bot: { weight: 0.2, aggression: 0.6 },
  },
  aufklaerer: {
    id: 'aufklaerer', name: 'Aufklärer', short: 'AUF', icon: 'aufklaerer',
    role: 'Augen des Teams: Präzisionswaffen, leichte Weste, markiert Gegner 8 s lang und hält länger den Atem an.',
    armor: 'leicht', helmet: 'keine', gadget: 'spot',
    weaponClasses: ALL_WEAPONS,
    signature: ['sniper', 'marksman'],
    prefer: { primary: ['sr_brecher', 'mr_sk14', 'ar_kv47', 'ar_m17'], secondary: ['pi_p9', 'pi_adler'], lethal: ['frag', 'semtex'] },
    perks: { spotDuration: 8, holdBreathMult: 1.5, footstepVolume: 0.8 },
    look: { id: 'aufklaerer', variant: 'kundschafter', camo: 'ghillie', sleeve: '#4c5a3a', glove: '#33352a', vest: 'brustgurt', helmet: 'boonie', pack: 'funk', patch: 'auge', accent: '#7e9b5a' },
    bot: { weight: 0.15, aggression: 0.35 },
  },
});
// Eigener Name: G.data.CLASS_ORDER ist die Waffenklassen-Reihenfolge (weapons.data.js).
export const SOLDIER_CLASS_ORDER = Object.freeze(['sturm', 'sanitaeter', 'pionier', 'aufklaerer']);
export const DEFAULT_CLASS = 'sturm';

export const classDef = (id) => CLASSES[id] || CLASSES[DEFAULT_CLASS];
export const gadgetDef = (id) => GADGETS[id] || null;

/** Darf die Klasse Waffen dieser Waffenklasse tragen? (Unbekannte Klassen: ja.) */
export function classAllows(clsId, weaponCls) {
  const c = CLASSES[clsId];
  return !c || !weaponCls || c.weaponClasses.includes(weaponCls);
}

/** Signaturwaffe der Klasse (−10 % Anschlagzeit/Rückstoß-Erholung, für weapons/ui)? */
export const isSignature = (clsId, weaponCls) => !!(CLASSES[clsId] && CLASSES[clsId].signature.includes(weaponCls));

/**
 * Standardausrüstung einer Klasse aus den vorhandenen Waffen.
 * opts: { weapons (WEAPONS), equipment (EQUIPMENT), isUnlocked(id) → bool, base (vorhandene Ausrüstung, Vorrang wenn erlaubt) }
 * → { cls, primary, secondary, lethal, armor, helmet, gadget, launcher|null }
 */
export function resolveClassLoadout(clsId, { weapons = {}, equipment = {}, isUnlocked = () => true, base = null } = {}) {
  const c = classDef(clsId);
  const okW = (id, slot) => !!(id && weapons[id] && weapons[id].slot === slot && isUnlocked(id) && classAllows(c.id, weapons[id].cls));
  const okE = (id) => !!(id && equipment[id] && isUnlocked(id));
  const b = base || {};
  const pick = (list, ok) => list.find(ok) || null;
  const anyOf = (slot) => Object.keys(weapons).find((id) => okW(id, slot)) || null;
  const launcher = pick(c.launcher || [], (id) => !!(weapons[id] && isUnlocked(id)));
  let secondary = okW(b.secondary, 'secondary') ? b.secondary : pick(c.prefer.secondary, (id) => okW(id, 'secondary')) || anyOf('secondary');
  // Ein Werfer im Zweitwaffen-Platz ersetzt die Pistole (Pionier), sofern es ihn gibt
  if (launcher && weapons[launcher].slot === 'secondary' && !b.secondary) secondary = launcher;
  return {
    cls: c.id,
    primary: okW(b.primary, 'primary') ? b.primary : pick(c.prefer.primary, (id) => okW(id, 'primary')) || anyOf('primary'),
    secondary,
    lethal: okE(b.lethal) ? b.lethal : pick(c.prefer.lethal, okE) || Object.keys(equipment).find(okE) || null,
    armor: ARMOR_TIERS[b.armor] ? b.armor : c.armor,
    helmet: HELMETS[b.helmet] ? b.helmet : c.helmet,
    gadget: c.gadget,
    launcher,
  };
}

/**
 * Anzeigeprofil einer Klasse für Karten/Lobby (Balken 0…1): Tempo, Schutz, Heilung, Unterstützung, Reichweite.
 * Optional eine abweichende Weste/Helm (Ausrüstungswahl).
 */
export function classProfile(clsId, { armor, helmet } = {}) {
  const c = classDef(clsId);
  const t = armorDef(armor || c.armor);
  const h = helmetDef(helmet || c.helmet);
  const p = c.perks || {};
  const regen = (p.regenRateMult || 1) / (p.regenDelayMult || 1);
  const reach = { sniper: 1, marksman: 0.85, ar: 0.65, carbine: 0.6, lmg: 0.7, smg: 0.4, shotgun: 0.2 };
  const best = Math.max(...c.signature.map((k) => reach[k] || 0.5));
  return {
    tempo: Math.round(((t.speedMult * h.speedMult - 0.8) / 0.2) * 100) / 100,
    schutz: Math.round(Math.min(1, (t.slots * t.plateHp * t.absorb) / 120 * 0.8 + h.reduction * 0.4) * 100) / 100,
    heilung: Math.round(Math.min(1, (regen - 0.6) / 1.4) * 100) / 100,
    unterstuetzung: c.id === 'sanitaeter' ? 1 : c.id === 'pionier' ? 0.8 : c.id === 'aufklaerer' ? 0.6 : 0.3,
    reichweite: best,
    armorLabel: t.label, helmetLabel: h.label, plates: t.slots, carry: t.carry,
  };
}

/** Klasse für einen Bot ziehen (rng() ∈ [0,1)); gewichtet nach CLASSES[*].bot.weight. */
export function pickBotClass(rng = Math.random) {
  let sum = 0;
  for (const id of SOLDIER_CLASS_ORDER) sum += CLASSES[id].bot.weight;
  let r = rng() * sum;
  for (const id of SOLDIER_CLASS_ORDER) { r -= CLASSES[id].bot.weight; if (r < 0) return id; }
  return DEFAULT_CLASS;
}

/* ============================================================= Spielstile */

/**
 * Spielstil eines Matches (G.match.style). Flags für ui/bots/combat:
 *  bulletMult/explosiveMult – Schadensfaktor (combat), regenDelay/regenRate – Regeneration (player/bots),
 *  bleedout – Ausbluten am Boden (s, für Am-Boden-System), nameplates 'alle'|'team'|'aus' – Namensschilder,
 *  minimapEnemies/uavEnemies – Gegnerpunkte, hitmarkers 'immer'|'sicht' – Treffermarker (sicht = nur bei freier Sicht),
 *  hitmarkerThroughWalls, killfeed 'alle'|'eigene', enemyMarkers – 3D-Markierungen, crosshair 'an'|'einstellung',
 *  hudMin – empfohlene HUD-Mindeststufe, spotting – Markieren erlaubt, damageDirection – Trefferrichtungsanzeige.
 */
export const GAME_STYLES = deepFreeze({
  arcade: {
    id: 'arcade', label: 'Arcade', short: 'Arcade',
    desc: 'Das bisherige Spiel: volles HUD, Namensschilder, Gegner auf der Minikarte, schnelle Regeneration.',
    bulletMult: 1, explosiveMult: 1, regenDelay: 3.5, regenRate: 55, bleedout: 15,
    nameplates: 'alle', minimapEnemies: true, uavEnemies: true, hitmarkers: 'immer', hitmarkerThroughWalls: true,
    killfeed: 'alle', enemyMarkers: true, crosshair: 'an', hudMin: 'voll', spotting: true, damageDirection: true,
  },
  realistisch: {
    id: 'realistisch', label: 'Realistisch', short: 'Real',
    desc: 'Wie Bodycam: Gegner werden nirgends angezeigt, minimales HUD, deutlich mehr Schaden, langsame Heilung.',
    bulletMult: 1.5, explosiveMult: 1.25, regenDelay: 7, regenRate: 14, bleedout: 8,
    nameplates: 'team', minimapEnemies: false, uavEnemies: false, hitmarkers: 'sicht', hitmarkerThroughWalls: false,
    killfeed: 'eigene', enemyMarkers: false, crosshair: 'einstellung', hudMin: 'reduziert', spotting: true, damageDirection: false,
  },
});
export const STYLE_ORDER = Object.freeze(['arcade', 'realistisch']);
export const DEFAULT_STYLE = 'arcade';

/**
 * Wirksame Flags eines Stils (Kopie, = G.match.styleFlags). `crosshair` wird zu true/false aufgelöst: Arcade immer an,
 * Realistisch nach Einstellung `realisticCrosshair`. `rules` = modes.data.js styleRules() (modes-ui, Lobby-Regeln):
 * ihre Schlüssel stehen unverändert mit im Ergebnis und haben Vorrang (damageMult → bulletMult, regenDelayMult →
 * regenDelay, crosshair, enemyNameplates/enemyMinimap/enemyMarkers/hitmarkers/hudStyle → die Flags oben).
 */
export function styleFlags(styleId, { realisticCrosshair = false, rules = null } = {}) {
  const s = GAME_STYLES[styleId] || GAME_STYLES[DEFAULT_STYLE];
  const out = { ...s, crosshair: s.crosshair === 'an' ? true : !!realisticCrosshair };
  if (!rules) return out;
  Object.assign(out, rules, { id: s.id });
  if (Number.isFinite(rules.damageMult)) out.bulletMult = rules.damageMult;
  if (Number.isFinite(rules.regenDelayMult)) out.regenDelay = GAME_STYLES.arcade.regenDelay * rules.regenDelayMult;
  if (typeof rules.crosshair === 'boolean') out.crosshair = rules.crosshair || (s.crosshair !== 'an' && !!realisticCrosshair);
  if (rules.enemyNameplates === false) out.nameplates = 'team';
  if (rules.enemyMinimap === false) { out.minimapEnemies = false; out.uavEnemies = false; }
  if (rules.enemyMarkers === false) out.enemyMarkers = false;
  if (rules.hitmarkers === false) { out.hitmarkers = 'aus'; out.hitmarkerThroughWalls = false; }
  if (rules.hudStyle) out.hudMin = rules.hudStyle;
  return out;
}
