// NULLPUNKT — Raumerkennung für den Klang (Owner: audio): Innen/Außen, Raumgröße, Wandabstände.
// Hörer: 8 waagerechte Strahlen (45°-Schritte) + 1 nach oben, reihum 1–2 je Bild über world.raycast
// (Kosten ≈ 5–20 µs je Strahl), geglättet. Quellen: Decke + 2 Seitenstrahlen, je Akteur/Zelle gecacht.
// Schnittstelle für das spätere Sonden-Gitter der Welt (Plan §10 A2 / A-4): stellt die Welt
//   world.acoustics = { sample(x, y, z, out?) → { indoor 0..1, ceiling m|Infinity, meanFree m, openness 0..1,
//                       walls?: number[8] (Abstände in 8 Richtungen: 0 = +X, dann gegen den Uhrzeigersinn um +Y,
//                       Infinity = frei), absorb?: 0..1 (mittlere Absorption der Wände) } }
// bereit, wird sie statt der Strahlen benutzt (Tabellenabfrage, keine Strahlen mehr).

export const DIRS = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return { x: Math.cos(a), z: -Math.sin(a) }; });
const H_MAX = 40, UP_MAX = 20, OPEN = 60;
/** Reflexionsgrad je Oberfläche (1 − Absorption, grob, mittlere Frequenzen). */
export const REFLECT = { concrete: 0.85, metal: 0.92, wood: 0.62, dirt: 0.45, sand: 0.4, grass: 0.35, glass: 0.88, water: 0.9, tile: 0.88, fabric: 0.3, flesh: 0.3 };
const reflOf = (s) => REFLECT[s] ?? 0.75;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export class Acoustics {
  constructor() {
    this.world = null; this.THREE = null;
    this.walls = new Float32Array(8).fill(OPEN);   // geglättete Abstände (m)
    this.wallRefl = new Float32Array(8).fill(0);
    this.ceiling = Infinity; this.ceilRefl = 0.8;
    this.state = { indoor: 0, enclosure: 0, meanFree: OPEN, ceiling: Infinity, openness: 1, valid: false };
    this._ray = 0; this._raw = new Float32Array(9).fill(Infinity); this._rawS = new Array(9).fill(null);
    this._src = new Map(); this._v = null; this._d = null;
    this.rays = 0;          // Diagnose: Strahlen gesamt
    this.provider = null;   // 'world' | 'rays' | null
  }

  setWorld(world, THREE) {
    if (world !== this.world) {
      this.world = world || null; this._src.clear(); this._ray = 0; this._raw.fill(Infinity); this._rawS.fill(null);
      this.walls.fill(OPEN); this.wallRefl.fill(0); this.ceiling = Infinity;
      this.state = { indoor: 0, enclosure: 0, meanFree: OPEN, ceiling: Infinity, openness: 1, valid: false };
    }
    if (THREE && !this._v) { this.THREE = THREE; this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); }
  }

  _cast(x, y, z, dx, dy, dz, max) {
    const w = this.world;
    this.rays++;
    try {
      const o = this._v ? this._v.set(x, y, z) : { x, y, z }, d = this._d ? this._d.set(dx, dy, dz) : { x: dx, y: dy, z: dz };
      const h = w.raycast(o, d, max);
      return h && h.distance >= 0 ? h : null;
    } catch { return null; }
  }

  /**
   * Hörer-Sonde fortschreiben. budget = Strahlen je Aufruf. Gibt den Zustand zurück.
   * pos = Ohr (Kamera), dt für die Glättung.
   */
  update(pos, dt, budget = 2) {
    const w = this.world;
    if (!w || !pos) { this.state.valid = false; this.provider = null; return this.state; }
    const prov = w.acoustics && typeof w.acoustics.sample === 'function' ? w.acoustics : null;
    if (prov) {
      this.provider = 'world';
      let s = null; try { s = prov.sample(pos.x, pos.y, pos.z); } catch { s = null; }
      if (s) {
        if (s.walls && s.walls.length >= 8) for (let i = 0; i < 8; i++) { this._raw[i] = Number.isFinite(s.walls[i]) ? s.walls[i] : Infinity; this._rawS[i] = null; }
        this._raw[8] = s.ceiling ?? Infinity;
        this._derive(dt, s);
        return this.state;
      }
    }
    if (!w.raycast) { this.state.valid = false; return this.state; }
    this.provider = 'rays';
    for (let k = 0; k < budget; k++) {
      const i = this._ray; this._ray = (this._ray + 1) % 9;
      const h = i < 8 ? this._cast(pos.x, pos.y, pos.z, DIRS[i].x, 0, DIRS[i].z, H_MAX) : this._cast(pos.x, pos.y + 0.1, pos.z, 0, 1, 0, UP_MAX);
      this._raw[i] = h ? h.distance : Infinity; this._rawS[i] = h ? h.surface || null : null;
    }
    this._derive(dt, null);
    return this.state;
  }

  _derive(dt, prov) {
    const a = clamp(dt * 6, 0.05, 1);
    let hits = 0, sum = 0, n = 0;
    for (let i = 0; i < 8; i++) {
      const raw = this._raw[i], d = Number.isFinite(raw) ? raw : OPEN;
      this.walls[i] += (d - this.walls[i]) * (Math.abs(d - this.walls[i]) > 8 ? 1 : a); // Sprünge (Tür, Ecke) sofort
      const r = Number.isFinite(raw) ? reflOf(this._rawS[i]) * (prov?.absorb != null ? 1 - prov.absorb : 1) : 0;
      this.wallRefl[i] += (r - this.wallRefl[i]) * a;
      if (raw < 25) hits++;
      sum += Math.min(d, H_MAX); n++;
    }
    const up = this._raw[8];
    this.ceiling = up; this.ceilRefl = Number.isFinite(up) ? reflOf(this._rawS[8]) : 0;
    const enclosure = hits / 8, covered = Number.isFinite(up) && up < 16;
    const meanFree = sum / n;
    // Innen: Decke + Wände; Gasse ohne Dach = halb (frühe Reflexionen, aber kein Raumhall)
    let indoor = prov?.indoor ?? (covered ? 0.45 + 0.55 * enclosure : 0.25 * enclosure * enclosure);
    const S = this.state;
    S.indoor += (indoor - S.indoor) * clamp(dt * 4, 0.03, 1);
    S.enclosure = enclosure; S.meanFree = prov?.meanFree ?? meanFree; S.ceiling = up;
    S.openness = prov?.openness ?? clamp(1 - enclosure * (covered ? 1 : 0.6));
    S.valid = true;
  }

  /**
   * Quelle: { indoor 0..1, size m } – Decke + 2 Seitenstrahlen (Achse wechselt), gecacht je Schlüssel.
   * allow() → false, wenn das Strahlenbudget des Bildes erschöpft ist (dann Cache oder Hörerwert).
   */
  source(pos, key, now, allow) {
    const w = this.world; if (!w || !pos) return null;
    const prov = w.acoustics && typeof w.acoustics.sample === 'function' ? w.acoustics : null;
    const c = this._src.get(key);
    if (c && now - c.t < 0.6) return c;
    if (prov) {
      let s = null; try { s = prov.sample(pos.x, pos.y, pos.z); } catch { s = null; }
      if (s) { const r = { t: now, indoor: clamp(s.indoor ?? 0), size: s.meanFree ?? 20 }; this._put(key, r); return r; }
    }
    if (!w.raycast || !allow()) return c || null;
    const up = this._cast(pos.x, pos.y + 0.3, pos.z, 0, 1, 0, 16);
    const ax = (c?.ax ?? 0) ^ 1, dx = ax ? 1 : 0, dz = ax ? 0 : 1;
    let side = 0, sd = 0;
    for (const s of [1, -1]) {
      const h = allow() ? this._cast(pos.x, pos.y + 0.4, pos.z, dx * s, 0, dz * s, 25) : null;
      if (h) { side++; sd += h.distance; } else sd += 25;
    }
    const indoor = up ? 0.55 + 0.225 * side : 0.12 * side;
    const r = { t: now, indoor: c ? c.indoor * 0.35 + indoor * 0.65 : indoor, size: sd / 2, ax };
    this._put(key, r);
    return r;
  }
  _put(key, r) { this._src.set(key, r); if (this._src.size > 256) this._src.delete(this._src.keys().next().value); }

  clear() { this._src.clear(); }

  /**
   * Frühe Reflexionen für eine Quelle am Hörer (Bildquellen-Näherung): 4 Wände (±X, ±Z) + Decke.
   * right = rechte Achse des Hörers (für das Panorama). → [{ delay s, gain, pan }]
   */
  taps(right, out = []) {
    out.length = 0;
    const c = 343;
    for (const i of [0, 2, 4, 6]) {
      // Nächste der drei Richtungen um die Achse (±45°) – Ecken und schräge Wände zählen mit
      const j = [i, (i + 1) % 8, (i + 7) % 8].reduce((b, k) => (this.walls[k] < this.walls[b] ? k : b), i);
      const d = this.walls[j], refl = this.wallRefl[j];
      const fade = d > 25 ? clamp(1 - (d - 25) / 15) : 1;
      const gain = refl * fade * 0.55 / (1 + d / 1.8);
      const pan = right ? clamp(DIRS[j].x * right.x + DIRS[j].z * right.z, -1, 1) * 0.85 : 0;
      out.push({ delay: clamp(2 * d / c, 0.003, 0.24), gain, pan, d });
    }
    const up = this.ceiling;
    if (Number.isFinite(up) && up < 16) out.push({ delay: clamp(2 * up / c, 0.003, 0.1), gain: this.ceilRefl * 0.45 / (1 + up / 1.8), pan: 0, d: up });
    else out.push({ delay: 0.05, gain: 0, pan: 0, d: Infinity });
    return out;
  }
}
