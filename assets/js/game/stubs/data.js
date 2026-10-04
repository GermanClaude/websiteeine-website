// NULLPUNKT — Ersatzdaten (Stub, §10a): werden nur genutzt, wenn shared/*.data.js fehlen oder
// nicht laden. Gleiche Exporte und Felder wie die echten Datenmodule (Teilmenge, plausible Werte).

export const WEAPON_CLASSES = {
  ar: 'Sturmgewehr', smg: 'MP', lmg: 'LMG', sniper: 'Scharfschützengewehr', marksman: 'Präzisionsgewehr',
  shotgun: 'Schrotflinte', pistol: 'Pistole', melee: 'Nahkampf',
};

const W = (id, name, cls, slot, o) => ({
  id, name, cls, slot, description: '', unlockLevel: 1, pellets: 1, burstCount: 1, perShellReload: false,
  headMult: 1.4, limbMult: 0.9, scope: null, sprintToFire: 0.2, moveSpeedMult: 1, adsMoveMult: 0.6,
  moveSpreadMult: 1.4, jumpSpreadMult: 2.5, penetration: 0.5, suppressed: false, adsZoom: 1.25,
  sound: { profile: cls === 'smg' ? 'smg' : cls === 'pistol' ? 'pistol' : 'ar', pitch: 1 }, ...o,
});

export const WEAPONS = {
  ar_kv47: W('ar_kv47', 'KV-47', 'ar', 'primary', { unlockLevel: 2, model: 'kv47', damage: { max: 33, min: 25, rangeStart: 24, rangeEnd: 48 }, rpm: 560, fireMode: 'auto', mag: 30, reserve: 120, reloadTime: 2.35, reloadEmptyTime: 3.05, equipTime: 0.6, adsTime: 0.26, hipSpread: 0.052, adsSpread: 0.0034, recoil: { vertical: 0.0105, horizontal: 0.0048, recovery: 8, firstShotMult: 1.25 }, range: 115, sound: { profile: 'ar_heavy', pitch: 0.96 } }),
  ar_m17: W('ar_m17', 'M-17 Falke', 'ar', 'primary', { model: 'm17', damage: { max: 25, min: 19, rangeStart: 20, rangeEnd: 42 }, rpm: 700, fireMode: 'auto', mag: 30, reserve: 120, reloadTime: 2.1, reloadEmptyTime: 2.7, equipTime: 0.55, adsTime: 0.22, adsZoom: 1.35, scope: { zoom: 1.35, overlay: 'holo' }, hipSpread: 0.045, adsSpread: 0.0022, recoil: { vertical: 0.0078, horizontal: 0.0028, recovery: 10, firstShotMult: 1.1 }, range: 110 }),
  smg_vp9: W('smg_vp9', 'VP-9 Viper', 'smg', 'primary', { model: 'vp9', damage: { max: 26, min: 17, rangeStart: 14, rangeEnd: 28 }, rpm: 820, fireMode: 'auto', mag: 30, reserve: 150, reloadTime: 1.95, reloadEmptyTime: 2.5, equipTime: 0.45, adsTime: 0.17, adsZoom: 1.2, hipSpread: 0.03, adsSpread: 0.0034, recoil: { vertical: 0.0058, horizontal: 0.0032, recovery: 12, firstShotMult: 1 }, range: 90, adsMoveMult: 0.75 }),
  smg_qx90: W('smg_qx90', 'QX-90', 'smg', 'primary', { unlockLevel: 4, model: 'qx90', damage: { max: 25, min: 14, rangeStart: 10, rangeEnd: 22 }, rpm: 920, fireMode: 'auto', mag: 50, reserve: 150, reloadTime: 2.75, reloadEmptyTime: 3.35, equipTime: 0.5, adsTime: 0.18, scope: { zoom: 1.25, overlay: 'reddot' }, hipSpread: 0.034, adsSpread: 0.0045, recoil: { vertical: 0.0052, horizontal: 0.0045, recovery: 12, firstShotMult: 1 }, range: 90 }),
  lmg_hm60: W('lmg_hm60', 'HM-60 Hammer', 'lmg', 'primary', { unlockLevel: 12, model: 'hm60', damage: { max: 28, min: 25, rangeStart: 32, rangeEnd: 65 }, rpm: 600, fireMode: 'auto', mag: 100, reserve: 200, reloadTime: 6.2, reloadEmptyTime: 7.4, equipTime: 0.95, adsTime: 0.45, hipSpread: 0.075, adsSpread: 0.003, moveSpeedMult: 0.85, recoil: { vertical: 0.0088, horizontal: 0.0052, recovery: 7, firstShotMult: 1.5 }, range: 120, sound: { profile: 'lmg', pitch: 1 } }),
  mr_sk14: W('mr_sk14', 'SK-14', 'marksman', 'primary', { unlockLevel: 5, model: 'sk14', damage: { max: 52, min: 38, rangeStart: 35, rangeEnd: 75 }, headMult: 1.6, rpm: 250, fireMode: 'semi', mag: 12, reserve: 48, reloadTime: 2.3, reloadEmptyTime: 3.0, equipTime: 0.65, adsTime: 0.32, adsZoom: 2.4, scope: { zoom: 2.4, overlay: 'acog' }, hipSpread: 0.07, adsSpread: 0.0008, recoil: { vertical: 0.024, horizontal: 0.006, recovery: 9, firstShotMult: 1 }, range: 130, sound: { profile: 'ar_heavy', pitch: 1.1 } }),
  sr_brecher: W('sr_brecher', 'Brecher .338', 'sniper', 'primary', { unlockLevel: 20, model: 'brecher', damage: { max: 130, min: 105, rangeStart: 45, rangeEnd: 110 }, headMult: 1.5, limbMult: 0.7, rpm: 46, fireMode: 'bolt', mag: 5, reserve: 25, reloadTime: 3.0, reloadEmptyTime: 3.9, equipTime: 0.85, adsTime: 0.48, adsZoom: 5.5, scope: { zoom: 5.5, overlay: 'sniper' }, hipSpread: 0.12, adsSpread: 0.0005, recoil: { vertical: 0.05, horizontal: 0.01, recovery: 5, firstShotMult: 1 }, range: 160, sound: { profile: 'sniper', pitch: 1 } }),
  sg_bulldog: W('sg_bulldog', 'Bulldog 12', 'shotgun', 'primary', { unlockLevel: 3, model: 'bulldog', damage: { max: 16, min: 3.5, rangeStart: 3.5, rangeEnd: 18 }, headMult: 1.15, pellets: 8, rpm: 75, fireMode: 'pump', mag: 6, reserve: 30, reloadTime: 1.2, reloadEmptyTime: 3.6, perShellReload: true, shellTiming: { start: 0.3, insert: 0.48, end: 0.42 }, equipTime: 0.6, adsTime: 0.24, adsZoom: 1.15, hipSpread: 0.06, adsSpread: 0.045, recoil: { vertical: 0.04, horizontal: 0.012, recovery: 6, firstShotMult: 1 }, range: 35, sound: { profile: 'shotgun', pitch: 1 } }),
  pi_p9: W('pi_p9', 'P-9 Kompakt', 'pistol', 'secondary', { model: 'p9', damage: { max: 26, min: 18, rangeStart: 12, rangeEnd: 28 }, rpm: 420, fireMode: 'semi', mag: 15, reserve: 60, reloadTime: 1.45, reloadEmptyTime: 1.85, equipTime: 0.32, adsTime: 0.14, adsZoom: 1.15, hipSpread: 0.026, adsSpread: 0.003, moveSpeedMult: 1.05, recoil: { vertical: 0.011, horizontal: 0.004, recovery: 13, firstShotMult: 1 }, range: 70 }),
  pi_adler: W('pi_adler', 'Adler .50', 'pistol', 'secondary', { unlockLevel: 7, model: 'adler', damage: { max: 42, min: 28, rangeStart: 10, rangeEnd: 30 }, headMult: 1.5, rpm: 240, fireMode: 'semi', mag: 7, reserve: 35, reloadTime: 1.9, reloadEmptyTime: 2.35, equipTime: 0.42, adsTime: 0.17, adsZoom: 1.15, hipSpread: 0.034, adsSpread: 0.0035, moveSpeedMult: 1.05, recoil: { vertical: 0.03, horizontal: 0.009, recovery: 8, firstShotMult: 1 }, range: 80, sound: { profile: 'pistol_heavy', pitch: 0.95 } }),
  knife: W('knife', 'Kampfmesser', 'melee', 'melee', { model: 'knife', damage: { max: 135, min: 135, rangeStart: 0, rangeEnd: 2.4 }, rpm: 80, fireMode: 'semi', mag: 0, reserve: 0, reloadTime: 0, reloadEmptyTime: 0, equipTime: 0.25, adsTime: 0, hipSpread: 0, adsSpread: 0, recoil: { vertical: 0, horizontal: 0, recovery: 10, firstShotMult: 1 }, range: 2.4, melee: { range: 2.4, lungeRange: 4.5, lungeSpeed: 10, arc: 0.6, swingTime: 0.75, hitDelay: 0.14 } }),
};
for (const def of Object.values(WEAPONS)) def.adsFov = Math.round((2 * Math.atan(Math.tan((80 * Math.PI) / 360) / (def.adsZoom || 1)) * 1800) / Math.PI) / 10;

export const EQUIPMENT = {
  frag: { id: 'frag', name: 'Splittergranate', short: 'Splitter', kind: 'lethal', unlockLevel: 1, count: 1, fuse: 2.8, cookable: true, radius: 6.5, innerRadius: 1.5, maxDamage: 150, minDamage: 20, throwSpeed: 18, throwPitch: 0.18, bounciness: 0.38, friction: 0.55, sticky: false, model: 'frag', sound: 'explosion' },
  semtex: { id: 'semtex', name: 'Haftgranate', short: 'Haft', kind: 'lethal', unlockLevel: 9, count: 1, fuse: 2.2, cookable: false, radius: 5.5, innerRadius: 1.5, maxDamage: 160, minDamage: 25, throwSpeed: 16, throwPitch: 0.15, bounciness: 0, friction: 1, sticky: true, model: 'semtex', sound: 'explosion' },
};

export const DEFAULT_LOADOUTS = [
  { id: 'sturm', name: 'Sturm', primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag', unlockLevel: 1 },
  { id: 'schatten', name: 'Schatten', primary: 'smg_vp9', secondary: 'pi_p9', lethal: 'frag', unlockLevel: 1 },
  { id: 'allrounder', name: 'Allrounder', primary: 'ar_kv47', secondary: 'pi_p9', lethal: 'frag', unlockLevel: 2 },
  { id: 'nahkampf', name: 'Nahkampf', primary: 'sg_bulldog', secondary: 'pi_adler', lethal: 'semtex', unlockLevel: 9 },
];

export const GUN_GAME_STEPS = [
  'smg_vp9', 'smg_qx90', 'ar_m17', 'ar_kv47', 'lmg_hm60', 'mr_sk14', 'sg_bulldog', 'sr_brecher', 'pi_adler', 'pi_p9',
  'smg_vp9', 'ar_m17', 'ar_kv47', 'sg_bulldog', 'mr_sk14', 'sr_brecher', 'pi_adler', 'knife',
];

const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

export const MODES = {
  tdm: { id: 'tdm', name: 'Team-Deathmatch', short: 'TDM', description: 'Zwei Teams, ein Ziel: als Erstes 40 Abschüsse.', teams: true, scoreLimit: 40, timeLimit: 600, defaultAllies: 5, defaultEnemies: 6, respawnDelay: 3 },
  ffa: { id: 'ffa', name: 'Jeder gegen jeden', short: 'FFA', description: 'Acht Spieler, keine Verbündeten. Wer zuerst 25 erreicht, gewinnt.', teams: false, scoreLimit: 25, timeLimit: 600, defaultAllies: 0, defaultEnemies: 7, respawnDelay: 2.5 },
  dom: { id: 'dom', name: 'Herrschaft', short: 'HER', description: 'Drei Flaggen halten – 150 Punkte gewinnen.', teams: true, scoreLimit: 150, timeLimit: 600, defaultAllies: 5, defaultEnemies: 6, respawnDelay: 4 },
  gun: { id: 'gun', name: 'Waffenspiel', short: 'WS', description: '18 Waffenstufen – der letzte Abschuss mit dem Messer.', teams: false, scoreLimit: 18, timeLimit: 600, defaultAllies: 0, defaultEnemies: 7, respawnDelay: 2 },
  training: { id: 'training', name: 'Schießstand', short: 'TRN', description: 'Waffen in Ruhe testen. Kein Zeitlimit.', teams: true, scoreLimit: 0, timeLimit: 0, defaultAllies: 0, defaultEnemies: 4, respawnDelay: 1.5 },
};

export const STREAKS = {
  uav: { id: 'uav', name: 'Aufklärer', description: 'Zeigt 30 Sekunden lang alle Gegner auf der Minikarte.', cost: 4, icon: icon('M12 3v4M4 12h4M16 12h4M12 17v4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2') },
  strike: { id: 'strike', name: 'Präzisionsschlag', description: 'Gezielter Luftschlag auf eine markierte Position.', cost: 6, icon: icon('M12 2v8M8 6l4 4 4-4M5 21h14M7 17l5-5 5 5') },
  sentry: { id: 'sentry', name: 'Wachgeschütz', description: 'Automatisches Geschütz für 45 Sekunden.', cost: 8, icon: icon('M4 20h16M8 20l4-8 4 8M12 12V8h6') },
};

export const MAPS = {
  hafen: { id: 'hafen', name: 'Hafen', subtitle: 'Containerterminal', description: 'Gestapelte Container, ein Portalkran und die Kaikante im Abendlicht.', size: 'mittel', timeOfDay: 'Abendrot', modes: ['tdm', 'ffa', 'dom', 'gun'], palette: ['#d9773a', '#2c4a63'], layout: [] },
  altstadt: { id: 'altstadt', name: 'Altstadt', subtitle: 'Mittagshitze', description: 'Verwinkelte Gassen, Dächer und ein Marktplatz mit Brunnen.', size: 'mittel', timeOfDay: 'Mittag', modes: ['tdm', 'ffa', 'dom', 'gun'], palette: ['#e8d3a8', '#6d8fb3'], layout: [] },
  werk: { id: 'werk', name: 'Werk', subtitle: 'Stillgelegte Fabrik', description: 'Laufstege, Maschinen und Ladezonen in der Abenddämmerung.', size: 'groß', timeOfDay: 'Dämmerung', modes: ['tdm', 'ffa', 'dom', 'gun'], palette: ['#6f7782', '#c9a227'], layout: [] },
  range: { id: 'range', name: 'Schießstand', subtitle: 'Training', description: 'Bahnen, Distanzmarken und Klappziele.', size: 'klein', timeOfDay: 'Tag', modes: ['training'], palette: ['#9aa38c', '#e9e6df'], layout: [] },
};
