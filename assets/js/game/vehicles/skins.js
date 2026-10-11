// NULLPUNKT — Panzer-Tarnungen (Nutzer 11.10.): durch Panzerspielen freischalten. Panzer-Erfahrung (im Browser):
// 0,2 je Sekunde in einem Panzer, +8 je Abschuss mit einer Fahrzeugwaffe, +40 je zerstörtem Fahrzeug. Die gewählte
// Tarnung färbt die Fahrzeuge des eigenen Teams auf dem eigenen Bildschirm (Grundlack + zwei Tarntöne, materials.js).
import { VEHICLE_WEAPONS } from './data.js';

const KEY = 'nullpunkt.panzer';
export const TANK_SKINS = [
  { id: 'standard', name: 'Standard', xp: 0 },
  { id: 'wald', name: 'Waldtarn', xp: 60, base: 0x4b5a35, c2: 0x2f3a22, c3: 0x6b5a3a },
  { id: 'wueste', name: 'Wüstensand', xp: 150, base: 0xb39b6b, c2: 0x8f7b52, c3: 0xcdb98c },
  { id: 'winter', name: 'Wintertarn', xp: 300, base: 0xc9ccc6, c2: 0x7f837c, c3: 0xe8e8e4 },
  { id: 'stadt', name: 'Stadtgrau', xp: 500, base: 0x6d7074, c2: 0x45484c, c3: 0x9a9da0 },
  { id: 'hinterhalt', name: 'Hinterhalt', xp: 800, base: 0xa08a55, c2: 0x3e4a2c, c3: 0x6a4a2e },
  { id: 'nacht', name: 'Nachtschwarz', xp: 1200, base: 0x2e3032, c2: 0x1c1d1e, c3: 0x45474a },
  { id: 'gold', name: 'Meister (Gold)', xp: 2000, base: 0xb8923a, c2: 0x8a6a28, c3: 0xd8b65a },
];
export const tankSkin = (id) => TANK_SKINS.find((s) => s.id === id) || TANK_SKINS[0];

export function loadTankProgress() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return { xp: Math.max(0, Number(o.xp) || 0), skin: typeof o.skin === 'string' ? o.skin : 'standard' }; } catch { return { xp: 0, skin: 'standard' }; }
}
export function saveTankProgress(p) { try { localStorage.setItem(KEY, JSON.stringify({ xp: Math.round(p.xp * 10) / 10, skin: p.skin })); } catch { /* */ } }
export const skinUnlocked = (p, s) => p.xp >= s.xp;

/** Fortschritt im Match: zählt Erfahrung, meldet Freischaltungen. G.vehicles ruft update(dt) je Frame. */
export class TankProgress {
  constructor(G) {
    this.G = G;
    this.p = loadTankProgress();
    this._saveT = 0;
    const P = () => G.player;
    this._off = [
      G.events.on('kill', (e) => { if (e && e.killer === P() && !e.suicide && VEHICLE_WEAPONS[e.weaponId]) this.add(8); }),
      G.events.on('vehicle:destroyed', (e) => { if (e && e.by === P() && e.vehicle && e.vehicle.team !== P().team) this.add(40); }),
    ];
  }

  add(n) {
    const before = this.p.xp;
    this.p.xp += n;
    for (const s of TANK_SKINS) {
      if (s.xp > before && s.xp <= this.p.xp) this.G.events.emit('injury:notice', { text: `Panzer-Tarnung freigeschaltet: ${s.name}`, tone: 'gold' });
    }
  }

  update(dt) {
    const v = this.G.player && this.G.player.vehicle;
    if (v && v.def.drive === 'tracked' && v.alive) this.add(0.2 * dt);
    this._saveT += dt;
    if (this._saveT > 10) { this._saveT = 0; saveTankProgress(this.p); }
  }

  dispose() { for (const f of this._off) f(); this._off = []; saveTankProgress(this.p); }
}
