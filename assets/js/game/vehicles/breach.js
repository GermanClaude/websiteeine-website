// NULLPUNKT — Panzer zerstören Gebäude (Nutzer 21.10.: „mit Schüssen der Panzer, MG und Hauptgeschütz, und gegen
// Gebäude fahren – erheblicher Schaden, ist ja realistisch“).
// • Granaten (projectiles.js): Sprenggranate (SG) reißt eine große, zerfetzte Bresche – Größe nach Kaliber, Werkstoff und
//   Wanddicke, auch bei Einschlag knapp vor der Wand; Panzergranate (PG) stanzt ein schmaleres Loch und fliegt mit dem
//   Rest ihrer Durchschlagsleistung weiter (bis drei Wände). Treffer an derselben Wand wachsen zu einer Bresche zusammen.
// • Rammen (sim.js onWall): Stoß = Masse × Annäherung (N·s) sammelt sich je Wandstelle und verfällt langsam (ein Jeep,
//   der drückt, reißt nichts ein; ein Kampfpanzer schiebt eine Hauswand in ~2 s ein). Reicht er für die Wand
//   (Werkstoff × Dicke × Breite der Fahrzeugfront), bricht sie in Fahrzeugbreite und -höhe durch und das Fahrzeug fährt
//   mit Restschwung weiter; sonst Anriss (wachsende Bresche am Bug) und Abprall wie bisher. Durchbruch nur ungefähr
//   frontal (RAM_COS), Breite = Wannenbreite schräg zur Wand; streifend nur Anrisse am Kontaktpunkt.
// • Einrichtung im Raum hinter einer Bresche (Möbel, Küchenzeile, Bett) und Leichtes draußen (Bank, Kiste) gibt schweren
//   Fahrzeugen nach (yields: kein Wannen-/Bodenkontakt) – sonst blieb der Panzer gleich hinter der Wand stehen.
// • Massive Bauteile, Gelände, Glas und Kartenränder bleiben fest (bullet-holes.js wallAt: nur ebene Wände ≤ 0,8–0,95 m).
// • Der Host bzw. das Einzelspiel entscheidet; die fertige Bresche geht vollständig an alle (bullet-holes.js breach →
//   'ev' br) – Durchgang, Kugeln, Sicht sind auf jedem Gerät gleich. MG: Kaliber-Lochsystem wie Infanterie (data.js).
import * as THREE from 'three';
import { collisionRay } from '../engine/physics.js';

const TAU = Math.PI * 2;
// Stile (bullet-holes.js): 0 Holz, 1 Beton, 2 Putz, 3 Metall, 4 Glas, 5 Erde, 6 Stoff, 7 Ziegel
// Widerstand je m Wanddicke relativ zu Beton (Panzergranate: Durchschlag in m Beton)
const EQ = [0.3, 1, 0.6, 25, 0, 0, 0, 0.8];
const AP_PEN = 0.009;   // PG: m Beton je mm Kaliber (120 mm ≈ 1,1 m, 37 mm ≈ 0,33 m)
const HE_PEN = 0.0055;  // SG: größte Wand (m Beton) je mm, die noch durchbricht (120 mm ≈ 0,66 m)
const HE_R = 0.0095, AP_R = 0.0026; // Breschenradius je mm Kaliber (PG: schmales Loch, Lappen klein)
const MAT_R = [1.25, 0.85, 1.15, 0.8, 0, 0, 0, 1]; // Werkstoff: Holz/Putz reißen weiter, Beton weniger
// Rammen: Widerstand (N·s) je m Dicke und m Breite; Verfall je Sekunde (Anteil des Widerstands)
const RAM_K = [25000, 150000, 60000, 4.0e6, 0, 0, 0, 120000];
const RAM_DECAY = 0.35;
// Durchbruch nur bei ungefähr frontalem Auftreffen (|Fahrtrichtung · Wandnormale| ≥ 0,8, ≈ 37°): streift ein Fahrzeug
// die Wand, reißt es am Kontaktpunkt nur an (21.10., Prüfung: ein flach streifender Kampfpanzer riss sonst die ganze
// Erdgeschossfront auf)
const RAM_COS = 0.8;
// Mauerwerk (Beton, Putz, Ziegel): eine Wand daraus bricht ram() (Bresche) – sie gibt nicht als Einrichtung nach
const MASONRY = [false, true, true, false, false, false, false, true];
// draußen (ohne Bresche davor) überfährt ein schweres Fahrzeug nur Leichtes bis 1,3 m Höhe: Holz, Blech, Stoff (Bank,
// Kiste, Fass, Karren) – Beton (Höcker, Sperren), Mauerwerk, Sandsäcke und Gelände halten
const OUT = [true, false, false, true, false, false, true, false];
const DOWN = new THREE.Vector3(0, -1, 0);
// Aufweitung zur Rückseite je Art (Shader: Radius × kb hinten): Rammen gerade, Sprengung/Durchschuss bricht aus
const KB = { he: 1.12, ap: 1.22, ram: 1.0 };
const _t = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _c = new THREE.Vector3(), _u = new THREE.Vector3();
// eigene Hilfsvektoren von fits() (läuft innerhalb von hullRay/ram, die ihre eigenen weiter brauchen)
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fc = new THREE.Vector3(), _fd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Beweglicher Festkörper ist ein Tür- oder Fensterflügel (doors.js: Ids door…/win…, nimmt Treffer an)? */
const leaf = (sol) => !!sol && typeof sol.onHit === 'function' && /^(door|win)\d/.test(String(sol.id || ''));

/** Kaliber (mm) einer Fahrzeuggranate aus ihrem Namen („120 mm …“, „75 mm …“); weaponMods ändern den Namen mit. */
export function shellCal(def) {
  const c = def && (def.cal || parseFloat(def.name));
  return Number.isFinite(c) && c > 10 ? c : 100;
}

/** Zufällige, zerfetzte Umrissform um R (Lappen, Ausbrüche) → shape(θ) → Radius (m). */
export function blob(rnd, R, irr = 0.4) {
  const N = 24, a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = R * (0.7 + 0.14 * rnd());
  const lobes = 5 + Math.floor(rnd() * 4);
  for (let j = 0; j < lobes; j++) {
    const c = Math.floor(rnd() * N), w = 1 + Math.floor(rnd() * 3), g = R * irr * (0.4 + rnd());
    for (let d = -w; d <= w; d++) a[(c + d + N) % N] += g * (1 - Math.abs(d) / (w + 1));
  }
  return (th) => {
    const u = ((((th % TAU) + TAU) % TAU) / TAU) * N;
    const i = Math.floor(u) % N, t = u - Math.floor(u);
    return a[i] + (a[(i + 1) % N] - a[i]) * t;
  };
}

/** Fahrzeugfront: abgerundetes Rechteck (Superellipse) mit Halbachsen hw × hh, Rand leicht unruhig. */
export function front(hw, hh, rnd) {
  const N = 24, j = new Float32Array(N);
  for (let i = 0; i < N; i++) j[i] = 0.98 + 0.1 * rnd();
  return (th) => {
    const c = Math.abs(Math.cos(th)) / hw, s = Math.abs(Math.sin(th)) / hh;
    const r = 1 / Math.pow(c ** 4 + s ** 4, 0.25);
    const u = ((((th % TAU) + TAU) % TAU) / TAU) * N;
    const i = Math.floor(u) % N, t = u - Math.floor(u);
    return r * (j[i] + (j[(i + 1) % N] - j[i]) * t);
  };
}

export class Breaching {
  constructor(sys) {
    this.sys = sys;
    this.recs = []; // Rammstellen: { p, n, w, acc, t, shown, last }
    this.stats = { shells: 0, apPass: 0, ram: 0, ramPartial: 0, crush: 0 };
    this._fit = new Map(); // Einrichtung je Stelle (0,25-m-Raster): { y (gibt nach), t }
    this._crushAt = 0;
  }

  get G() { return this.sys.G; }

  /** Entscheidet dieses Gerät (Einzelspiel/Host)? */
  get authority() { return !this.sys.replica && !!this.G.holes; }

  /**
   * Granate trifft feste Geometrie (Host/Einzelspiel). s: Granate (ShellPool), hit: Welttreffer, dir: Flugrichtung.
   * → { pass, keep, exit } (PG fliegt durch: Geschwindigkeitsfaktor, Austrittspunkt) oder null (Granate zündet).
   */
  shell(s, hit, dir) {
    const H = this.G.holes;
    if (!this.authority || !hit || !hit.point || hit.vehicle || hit.actor) return null;
    const def = s.def, cal = shellCal(def);
    const n = (hit.normal ? _c.copy(hit.normal) : _c.copy(dir).negate()).clone();
    if (n.dot(dir) > 0) n.negate();
    // Tür-/Fensterflügel (doors.js): die PG zerschlägt ihn und fliegt weiter; die SG zündet daran und reißt die Mauer
    // rings um die Öffnung auf (den Flügel selbst zerlegt die Explosion, doors.js)
    if (hit.solid) {
      if (!leaf(hit.solid)) return null;
      if (!def.penetrating) { this._window(hit, n, cal); return null; }
      try { hit.solid.onHit(999, s.shooter || null, def, hit); } catch { /* Beiwerk */ }
      return { pass: true, keep: 0.97, exit: hit.point.clone().addScaledVector(dir, 0.12) };
    }
    // Fensterscheibe: die PG fliegt durch (Glas zerspringt), die SG zündet daran
    if (def.penetrating && hit.surface === 'glass') return { pass: true, keep: 0.98, exit: hit.point.clone().addScaledVector(dir, 0.08) };
    const w = H.wallAt(hit.point, n, 0.95);
    this.stats.shells++;
    if (!w) {
      if (!def.penetrating) {
        if (hit.surface === 'glass') this._window(hit, n, cal);
        else this._nearWall(s, hit, n, cal);
      }
      return null;
    }
    const cosI = Math.max(0.25, -dir.dot(w.n));
    const eq = (w.thick * EQ[w.style]) / cosI; // schräg: längerer Weg durch die Wand
    const rnd = Math.random;
    if (def.penetrating) {
      if (s.pen == null) s.pen = cal * AP_PEN;
      const pass = s.pen >= eq && (s.walls | 0) < 3;
      const R = clamp(cal * AP_R * MAT_R[w.style], 0.09, 0.5) * (pass ? 1 : 0.75);
      H.breach(w, hit.point, blob(rnd, R, 0.35), { fx: 2, e: hit.point, sz: R * 2.2, kb: KB.ap });
      if (!pass) return null;
      const keep = clamp(1 - (eq / (cal * AP_PEN)) * 0.6, 0.35, 0.97);
      s.pen -= eq;
      s.walls = (s.walls | 0) + 1;
      this.stats.apPass++;
      return { pass: true, keep, exit: hit.point.clone().addScaledVector(dir, w.thick / cosI + 0.06) };
    }
    // Sprenggranate: zu dicke Wand → nur Krater (bullet-holes.js blast)
    if (eq > cal * HE_PEN) return null;
    const R = clamp(cal * HE_R * MAT_R[w.style] * clamp(1.25 - w.thick, 0.55, 1.05), 0.25, 2.4);
    H.breach(w, hit.point, blob(rnd, R, 0.42), { fx: 1, e: hit.point, sz: R * 1.6, kb: KB.he });
    return null;
  }

  /** Abbild (Client): fliegt diese Darstellungs-PG durch die Wand? Gleiche Prüfung wie der Host, keine Bresche. */
  passes(s, hit, dir) {
    const H = this.G.holes;
    if (!H || !s.def.penetrating || !hit || !hit.point || hit.vehicle || hit.actor) return null;
    if (hit.solid) return leaf(hit.solid) ? { pass: true, keep: 0.97, exit: hit.point.clone().addScaledVector(dir, 0.12) } : null;
    if (hit.surface === 'glass') return { pass: true, keep: 0.98, exit: hit.point.clone().addScaledVector(dir, 0.08) };
    const n = (hit.normal ? _c.copy(hit.normal) : _c.copy(dir).negate()).clone();
    if (n.dot(dir) > 0) n.negate();
    const w = H.wallAt(hit.point, n, 0.95);
    if (!w) return null;
    const cal = shellCal(s.def), cosI = Math.max(0.25, -dir.dot(w.n)), eq = (w.thick * EQ[w.style]) / cosI;
    if (s.pen == null) s.pen = cal * AP_PEN;
    if (s.pen < eq || (s.walls | 0) >= 3) return null;
    s.pen -= eq;
    s.walls = (s.walls | 0) + 1;
    return { pass: true, keep: clamp(1 - (eq / (cal * AP_PEN)) * 0.6, 0.35, 0.97), exit: hit.point.clone().addScaledVector(dir, w.thick / cosI + 0.06) };
  }

  /** SG schlägt knapp vor einer Wand ein (Boden, Straße): nächste Wand im Umkreis bekommt eine kleinere Bresche. */
  _nearWall(s, hit, n, cal) {
    const G = this.G, W = G.world, H = G.holes;
    if (!W || typeof W.raycast !== 'function' || n.y < 0.5) return;
    const reach = cal * 0.011;
    const o = _u.copy(hit.point).addScaledVector(n, 0.3);
    let best = null;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      _t.set(Math.cos(a), 0, Math.sin(a));
      const f = W.raycast(o, _t, reach);
      if (!f || f.solid || f.vehicle || f.targetId != null || (best && f.distance >= best.distance)) continue;
      best = { point: f.point.clone(), normal: f.normal.clone(), distance: f.distance, dir: _t.clone() };
    }
    if (!best) return;
    const nn = best.normal; if (nn.dot(best.dir) > 0) nn.negate();
    const w = H.wallAt(best.point, nn, 0.95);
    if (!w || w.thick * EQ[w.style] > cal * HE_PEN * 0.8) return;
    const R = cal * HE_R * MAT_R[w.style] * clamp(1.25 - w.thick, 0.55, 1.05) * Math.pow(1 - best.distance / reach, 0.7) * 0.85;
    if (R < 0.25) return;
    H.breach(w, best.point, blob(Math.random, R, 0.42), { fx: 1, e: best.point, sz: R * 1.5, kb: KB.he });
  }

  /** SG zündet an einer Fensterscheibe: die Mauer rings um das Fenster bricht auf (Bresche um den Einschlag). */
  _window(hit, n, cal) {
    const H = this.G.holes;
    const R = cal * HE_R * 0.9;
    const tx = _t.crossVectors(UP, n).normalize(), ty = _r.crossVectors(n, tx);
    for (const d of [0.7, 1.1, 1.5]) {
      if (d > R * 1.2) break;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const q = _u.copy(hit.point).addScaledVector(tx, Math.cos(a) * d).addScaledVector(ty, Math.sin(a) * d);
        const w = H.wallAt(q, n, 0.95);
        if (!w || Math.abs(_f.copy(w.point).sub(hit.point).dot(w.n)) > 0.45) continue;
        if (w.thick * EQ[w.style] > cal * HE_PEN) return;
        const Rw = clamp(R * MAT_R[w.style] * clamp(1.25 - w.thick, 0.55, 1.05), 0.3, 2.2);
        H.breach(w, hit.point, blob(Math.random, Rw, 0.42), { fx: 1, e: hit.point, sz: Rw * 1.5, kb: KB.he });
        return;
      }
    }
  }

  /**
   * Rammen (sim.js onWall, Host/Einzelspiel): Wanne v trifft bei p eine Wand (n zeigt zum Fahrzeug) mit der
   * Annäherung vn (m/s). → true, wenn die Wand nachgibt (Bresche in Fahrzeuggröße, kein Rückstoß).
   */
  ram(v, p, n, vn) {
    const G = this.G, H = G.holes;
    if (!this.authority || !v || !v.alive) return false;
    const now = G.time.elapsed;
    let rec = null;
    for (const r of this.recs) {
      if (r.n.dot(n) > 0.9 && r.p.distanceToSquared(p) < 9 && Math.abs(_t.copy(p).sub(r.p).dot(r.n)) < 0.3) { rec = r; break; }
    }
    const b = v.body, hb = v.def.hullBox, m = b.mass;
    const top = v.def.turretBox && v.def.turretPivot ? v.def.turretPivot[1] + v.def.turretBox[1] + v.def.turretBox[4] : hb[1] + hb[4];
    if (!rec) {
      if (this.recs.length >= 24) this.recs.shift();
      let w = H.wallAt(p, n, 0.8), dy = 0;
      // Haus auf massivem Unterbau/Sockel (Innenboden erhöht): trifft die Wanne zuerst ihn, nimmt die Wand darüber –
      // bis zur Fahrzeugoberkante – den Stoß auf (sonst prallten Lkw, Pkw und Jeep ganz ohne Schaden ab) (21.10.)
      if (!w) {
        const yTop = b.origin(_c).y + top;
        for (const k of [0.4, 0.8, 1.2, 1.6, 2.0]) {
          if (p.y + k > yTop - 0.15) break;
          w = H.wallAt(_t.copy(p).addScaledVector(UP, k), n, 0.8);
          if (w) { dy = k; break; }
        }
      }
      rec = { p: p.clone(), n: n.clone(), w, dy, acc: 0, t: now, shown: 0, last: -1 };
      this.recs.push(rec);
    }
    const w = rec.w;
    if (!w || !(RAM_K[w.style] > 0)) return false; // massiv, Gelände, Kartenrand: Wand bleibt fest
    // Breite, die das Fahrzeug in der Wand braucht: Wannenbreite schräg zur Wand (÷ cos) plus der Versatz der Wannen-
    // kanten im Prüfband von fits() (±0,6 m vor/hinter der Wand) – nicht die ganze Grundfläche (21.10.)
    const fwd = b.forward(_f);
    const cosA = Math.abs(fwd.dot(w.n)), ca = Math.max(0.5, cosA), sa = Math.sqrt(1 - ca * ca);
    const halfW = hb[3] / ca + (0.6 * sa) / ca;
    const width = Math.min(6.5, 2 * halfW);
    const R = RAM_K[w.style] * w.thick * width;
    rec.acc = Math.max(0, rec.acc - RAM_DECAY * R * Math.max(0, now - rec.t)) + m * vn;
    rec.t = now;
    const f = rec.acc / R;
    if (f >= 1 && cosA >= RAM_COS) {
      // schon durchgebrochen, das Fahrzeug passt trotzdem nicht (niedrige Decke, Querwand): bleibt Wand, keine neue Bresche
      if (rec.full) return false;
      // höchstens ein Durchbruch je 0,15 s und Fahrzeug: schiebt es sich durch Container oder Bretterbuden, träfe sonst
      // jede Wannenstichprobe einzeln eine Wand und risse in jedem Physikschritt eine Bresche – dazwischen gibt sie nach
      if (now - (v._ramAt ?? -9) < 0.15) return true;
      v._ramAt = now;
      // Durchbruch: Front in Fahrzeugbreite und -höhe (Turm eingeschlossen), Mitte dort, wo die Fahrzeugachse die Wand
      // schneidet (schräg: entlang der Fahrtrichtung, nicht senkrecht projiziert)
      const H0 = top + 0.12;
      const gy = b.origin(_c).y;
      const hc = b.toWorld(_t.set(hb[0], hb[1], hb[2]), _t);
      const fn = fwd.dot(w.n);
      const c = hc.clone().addScaledVector(fwd, -_c.copy(hc).sub(w.point).dot(w.n) / fn);
      // Höhe: Unterkante bis knapp an den höheren Boden beidseits (Häuser stehen oft erhöht – das Fahrzeug klettert die
      // Stufe hinauf und braucht dann seine volle Höhe über dem Innenboden); breach() kürzt an Boden und Decke
      const sp = H._span(c, w.n, w.thick);
      const base = Math.max(gy, Number.isFinite(sp.lo) ? sp.lo : gy);
      const yb = Math.min(gy, base) - 0.3, yt = base + H0 + 0.2;
      c.y = (yb + yt) * 0.5;
      const hw = halfW * 1.12 + 0.3, hh = (yt - yb) * 0.5;
      const msg = H.breach(w, c, front(hw, hh, Math.random), { fx: 3, e: p, sz: Math.min(3.5, width), v: v.netId | 0, vehicle: v, kb: KB.ram, recenter: true, exact: true });
      rec.full = true;
      if (!msg) return false;
      this.stats.ram++;
      G.events.emit('vehicle:ram', { vehicle: v, position: p.clone(), breach: true, width });
      const hNew = H._sync.get(msg.id);
      this._openings(hNew);
      if (!hNew || !this.fits(v, hNew)) return false;
      this.recs.splice(this.recs.indexOf(rec), 1);
      // Restschwung: die Wand nimmt einen Teil des Stoßes
      const dv = Math.min(vn * 0.8, (R * 0.45) / m);
      b.vel.addScaledVector(n, dv);
      // leichte Fahrzeuge leiden mit (Panzer kaum)
      if (!v.def.armored) v.applyDamage(Math.min(120, (R / m) * 4), { kind: 'collision', zone: 'hull', weaponId: 'vehicle_crash' });
      return true;
    }
    // Anriss: wachsende Bresche am Kontaktpunkt (Bug bzw. streifende Kante), das Fahrzeug prallt ab
    if (f >= 0.35 && f - rec.shown >= 0.2 && now - rec.last > 0.25 && rec.shown < 1.6) {
      rec.shown = f;
      rec.last = now;
      // streifend (flacher Winkel) kleiner: die Wanne schrammt entlang, statt die Wand einzudrücken
      const Rr = Math.min(hb[3] * 1.1, (0.25 + 0.6 * Math.min(f, 1.6)) * Math.min(1.1, hb[4] + 0.35)) * (0.55 + 0.45 * Math.min(1, cosA / RAM_COS));
      // Kontakt am Unterbau: der Anriss sitzt in der Wand darüber (Höhe, in der sie gefunden wurde)
      const at = rec.dy ? _t.copy(p).setY(Math.max(p.y, rec.p.y + rec.dy)) : p;
      const msg = H.breach(w, at, blob(Math.random, Rr, 0.5), { fx: 4, e: at, sz: Rr * 2, v: v.netId | 0, vehicle: v, kb: KB.he });
      if (msg) {
        this.stats.ramPartial++;
        this._openings(H._sync.get(msg.id));
        G.events.emit('vehicle:ram', { vehicle: v, position: p.clone(), breach: false, width });
      }
    }
    return false;
  }

  /**
   * Türen und Fenster, die in der Bresche h sitzen (Mitte oder eine Seitenmitte im Umriss), zerbrechen (Host/Einzelspiel;
   * doors.js verteilt) – sonst schwebte das Blatt in der Öffnung und hielte Spieler und Kugeln auf.
   */
  _openings(h) {
    const D = this.G.doors, H = this.G.holes;
    if (!D || !h || h.dead || !Array.isArray(D.items) || typeof D.act !== 'function') return;
    for (let i = 0; i < D.items.length; i++) {
      const it = D.items[i];
      if ((it.type !== 'door' && it.type !== 'window') || it.broken) continue;
      const d = it.d, dc = d.dc || [1, 0], l = Math.hypot(dc[0], dc[1]) || 1;
      // grob vorab: Abstand zur Breschenmitte
      if (Math.hypot(d.hx - h.pos.x, d.hz - h.pos.z) > h.r * h.kb + d.w + 1) continue;
      let inside = false;
      for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]]) {
        _fc.set(d.hx + (dc[0] / l) * d.w * fx, d.y + d.h * fy, d.hz + (dc[1] / l) * d.w * fx);
        const L = H._cutLocal(h, _fc);
        if (L.hh > 0.4 || L.hh < -h.tn - 0.4) break;
        if (Math.hypot(L.x, L.y) < H._cutR(h, L.x, L.y, 0.5)) { inside = true; break; }
      }
      if (inside) D.act(i, 'h', null, 999); // act(i, Aktion, Akteur, Schaden)
    }
  }

  /**
   * Wannenstrahl (sim.js hullRay) gegen die Kollisionsgeometrie: eine Bresche lässt ihn nur durch, wenn das ganze
   * Fahrzeug hindurchpasst (alle Ecken der Wanne, quer zur Wand projiziert, im Umriss) – durch einen Anriss oder ein
   * Granatloch rutscht keine Wannenecke; die Wand dort zählt weiter als Wand (Rammen sammelt weiter).
   */
  hullRay(v, o, d, len, out) {
    const G = this.G, H = G.holes, W = this.sys.world;
    if (!W) return null;
    const raw = H && H._crW0 ? (oo, dd, m) => H._crW0.call(W, oo, dd, m) : (typeof W.collisionRaycast === 'function' ? (oo, dd, m) => W.collisionRaycast(oo, dd, m) : null);
    if (!raw) return collisionRay(W, o, d, len, out);
    let hit = raw(o, d, len);
    if (hit && H) {
      // hit.distance zählt ab o (nach dem Weiterführen ergänzt)
      for (let i = 0; i < 6 && hit; i++) {
        const p = _t.copy(o).addScaledVector(d, hit.distance);
        const h = H._cutList.length ? H._cutAt(p, 1, hit.normal) : null;
        let base;
        if (!h || !this.fits(v, h)) {
          // Einrichtung im Raum hinter einer Bresche: das schwere Fahrzeug schiebt/zerdrückt sie (kein Kontakt)
          if (h || !hit.normal || !this.yields(v, p, _r.copy(hit.normal).multiplyScalar(hit.normal.dot(d) > 0 ? -1 : 1))) break;
          base = hit.distance + 0.02;
        } else {
          // längs der Wand (Strahl in der Wanddicke: Laibungen, Fugen) nur knapp hinter die Fläche, sonst hinter die Wand
          base = hit.distance + (Math.abs(d.dot(h.n)) < 0.05 ? 0.02 : H._cutExit(h, p, d));
        }
        if (base >= len) { hit = null; break; }
        hit = raw(_c.copy(o).addScaledVector(d, base), d, len - base);
        if (hit) hit.distance += base;
      }
    }
    if (!hit) return null;
    const n = hit.normal || UP;
    out.distance = hit.distance; out.nx = n.x; out.ny = n.y; out.nz = n.z;
    return out;
  }

  /**
   * Boden-/Federstrahl (sim.js groundFilter): Deckfläche von Einrichtung hinter einer Bresche übergehen – das schwere
   * Fahrzeug fährt nicht auf Tisch oder Küchenzeile hinauf, es drückt sie nieder.
   */
  groundYields(v, o, d, dist, hit) {
    if (!(hit.ny > 0.5) || !this.G.holes || !(v.def.armored || v.body.mass >= 6000)) return false;
    const p = _t.copy(o).addScaledVector(d, dist), W = this.sys.world;
    // Gelände (Höhenfeld) gibt nie nach – schnell aussortiert, ohne Strahlen
    const g = W && typeof W.heightAt === 'function' ? W.heightAt(p.x, p.z) : null;
    if (Number.isFinite(g) && p.y - g < 0.1) return false;
    return this.yields(v, p, _r.set(hit.nx, hit.ny, hit.nz));
  }

  /**
   * Gibt Einrichtung nach? (Prüfung 21.10.: der Panzer brach durch die Wand und blieb dann mit Vollgas an Küchenzeile,
   * Schrank oder Tisch dahinter stehen.) Schwere Fahrzeuge (gepanzert oder ≥ 6 t) überfahren im Raum hinter einer
   * großen Bresche (bis 9 m tief, seitlich im Umriss) alles, was nicht bis unter die Decke reicht und keine gemauerte
   * Wand ist – Möbel, Küchenzeile, Herd, Bett, Bretterverschlag; draußen nur Leichtes aus Holz, Blech oder Stoff bis
   * 1,3 m (Bank vor dem Haus, Kiste, Fass): kein Kontakt (Staub, Splitter, Krachen). Wände, Pfeiler, Kamine, Beton-
   * sperren und der Boden bleiben fest. Nur Physik – Möbel gehören zur festen Kartengeometrie und bleiben stehen.
   * p: Treffer, n: Flächennormale zum Fahrzeug.
   */
  yields(v, p, n) {
    const b = v.body, H = this.G.holes;
    if (!H || !(v.def.armored || b.mass >= 6000)) return false;
    let room = null;
    for (const h of H._sync.values()) {
      if (h.dead || h.r < 1.2) continue;
      const L = H._cutLocal(h, p), depth = -L.hh - h.tn;
      if (depth < -0.02 || depth > 9 || Math.hypot(L.x, L.y) > h.r * h.kb + 1) continue;
      room = h;
      break;
    }
    const now = this.G.time.elapsed;
    // je Stelle (0,25 m) und Flächenrichtung: dieselbe Zelle kann Deck- und Seitenfläche verschiedener Teile enthalten
    const key = `${Math.round(p.x * 4)},${Math.round(p.y * 4)},${Math.round(p.z * 4)},${Math.round(n.x * 2)},${Math.round(n.y * 2)},${Math.round(n.z * 2)},${room ? room.sync : 0}`;
    let c = this._fit.get(key);
    if (!c || now - c.t > 1.5) {
      if (this._fit.size > 600) this._fit.clear();
      c = { y: this._fitting(p, n, room), t: now };
      this._fit.set(key, c);
      if (c.y) this._crush(v, p, n);
    }
    return c.y;
  }

  /**
   * Ist bei p (Normale n) Einrichtung? room: Bresche davor – ihre Unter-/Oberkante steht für Fußboden und Decke
   * (breach() kürzt sie 5 cm davor). Deckflächen: über dem Fußboden. Seitenflächen: keine gemauerte Wand, und über dem
   * Hindernis ist Luft bis zur Decke (ein Strahl von oben trifft seine Oberseite, nicht erst den Boden).
   */
  _fitting(p, n, room) {
    const H = this.G.holes;
    // Werkstoff der sichtbaren Fläche; die Kollisionshülle (Bank, Möbel: Quader) ist oft etwas größer als das Bild –
    // dann die nächste sichtbare Fläche daneben (bis 15 cm; an einer Seitenfläche auch bis 25 cm tiefer: die Wanne
    // streift die Oberkante der Hülle, die Tischplatte liegt etwas darunter), sonst unbekannt → fest
    let f = H._ray0(_fd.copy(p).addScaledVector(n, 0.06), _fc.copy(n).negate(), 0.15);
    for (let i = 0; !f && Math.abs(n.y) < 0.5 && i < 2; i++) {
      _fd.copy(p).addScaledVector(n, 0.06);
      _fd.y -= i ? 0.25 : 0.12;
      f = H._ray0(_fd, _fc.copy(n).negate(), 0.3);
    }
    for (let i = 0; !f && i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      _fd.copy(p).addScaledVector(n, 0.06).add(_fb.set(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15));
      if (Math.abs(n.y) < 0.5) _fd.y += Math.sin(a) * 0.15; // Seitenfläche: auch darüber/darunter
      f = H._ray0(_fd, _fc.copy(n).negate(), 0.3);
    }
    if (!f || f.solid || f.vehicle || f.targetId != null) return false;
    const st = H.styleOf(f.surface);
    if (st === undefined || st === 4 || st === 5) return false; // Glas, Erde/Gelände
    let lo, hi, maxH;
    if (room) { ({ lo, hi } = this._roomY(room)); maxH = 2.4; } else {
      if (!OUT[st]) return false;
      // Boden: unter einer Deckfläche das Gelände, vor einer Seitenfläche der erste Boden darunter
      const W = this.sys.world, gh = W && typeof W.heightAt === 'function' ? W.heightAt(p.x, p.z) : NaN;
      if (n.y > 0.5 && Number.isFinite(gh)) lo = gh;
      else {
        const g0 = H._ray0(_fd.copy(p).addScaledVector(n, 0.35).setY(p.y + 0.3), DOWN, 3);
        if (!g0) return false;
        lo = p.y + 0.3 - g0.distance;
      }
      hi = lo + 3; maxH = 1.3;
    }
    if (n.y > 0.5) return p.y > lo + 0.12 && p.y < lo + maxH; // Deckfläche: Tisch, Küchenzeile, Bett, Treppe, Bank
    if (Math.abs(n.y) > 0.5) return false;
    // Rückseite (der Wannenstrahl beginnt im Hindernis): die Wanne steckt schon in nachgebender Einrichtung
    if (f.back) return p.y < lo + maxH;
    const w = H.wallAt(p, n, 0.8, 0.04); // Strahl knapp vor der Fläche (davor liegt die Bresche)
    if (w && (MASONRY[w.style] || !room)) return false; // gemauerte (Zwischen-)Wand, draußen jede Wand: bricht ram()
    const top = Math.min(hi, p.y + 2.6) - 0.05;
    if (top < p.y + 0.2) return false;
    // Strahl von oben knapp hinter der getroffenen Fläche (dünnes Brett: in seiner Mitte), trifft die Oberseite
    const k = w ? clamp(w.thick * 0.5, 0.01, 0.12) : 0.12;
    const g = H._ray0(_fd.set(p.x - n.x * k, top, p.z - n.z * k), DOWN, top - lo + 0.1);
    if (!g || g.vehicle || g.targetId != null) return false;
    const yTop = top - g.distance;
    return yTop >= p.y - 0.02 && yTop < top - 0.15 && yTop - lo < maxH;
  }

  /** Unter- und Oberkante der Bresche h über ihrer Mitte (Welt-y) → { lo, hi } */
  _roomY(h) {
    const H = this.G.holes;
    H._frame(h.n, _fa, _fb);
    const up = _fb.y >= 0 ? 1 : -1; // y-Achse des Lochs zeigt nach oben oder unten
    return { lo: h.pos.y - H._cutR(h, 0, -up, 0) * Math.abs(_fb.y), hi: h.pos.y + H._cutR(h, 0, up, 0) * Math.abs(_fb.y) };
  }

  /** Einrichtung gibt nach: Splitter, Staub, Krachen (gedrosselt). */
  _crush(v, p, n) {
    const G = this.G, now = G.time.elapsed;
    this.stats.crush++;
    if (now - this._crushAt < 0.35) return;
    this._crushAt = now;
    try {
      G.effects?.rubble?.(p, n, 'wood', 0.9);
      G.effects?.smoke?.(p.clone().addScaledVector(n, 0.3), { count: 2, color: 0x6e5d48, size: 1.2, life: 2.5, rise: 0.3, alpha: 0.35 });
      G.audio?.play?.('debris', { position: p, volume: 0.6, pitch: 0.8 });
    } catch { /* Beiwerk */ }
    const P = G.player;
    if (P && P.vehicle === v && typeof P.shake === 'function') P.shake(0.2);
  }

  /**
   * Passt die Wanne von v in den Ausschnitt h? Geprüft wird der Teil der Wanne, der gerade in der Wand steckt (Band
   * 0,6 m vor bis 0,6 m hinter ihr): die vier Längskanten in den Höhen der Wannen-Stichproben (sim.js, etwas weiter
   * gefasst) dort, wo sie das Band durchlaufen, quer zur Wand projiziert. Das Heck weit vor der Wand zählt erst, wenn es
   * herankommt – ein Panzer, der beim Hineinfahren über die Bodenstufe kippt, bleibt so nicht an seinem Heck hängen.
   * Laufwerk/Ketten unter der Wanne tragen sie über die Bruchkante. Überlappende Breschen derselben Wand zählen als eine
   * Öffnung (jeder Prüfpunkt in einer von ihnen).
   */
  fits(v, h) {
    const b = v.body, hb = v.def.hullBox, H = this.G.holes;
    const lo = -h.tn - 0.6, hi = 0.6, list = H._sameWall(h);
    for (let i = 0; i < 4; i++) {
      const x = hb[0] + (i & 1 ? hb[3] : -hb[3]), y = hb[1] + hb[4] * (i & 2 ? 0.8 : -0.6);
      b.toWorld(_fd.set(x, y, hb[2] - hb[5]), _fa);
      b.toWorld(_fd.set(x, y, hb[2] + hb[5]), _fb);
      const ha = _fc.copy(_fa).sub(h.pos).dot(h.n), he = _fc.copy(_fb).sub(h.pos).dot(h.n);
      // Abschnitt der Kante im Band (t: 0 vorn … 1 hinten)
      let t0 = 0, t1 = 1;
      if (Math.abs(he - ha) < 1e-6) { if (ha < lo || ha > hi) continue; } else {
        const ta = (lo - ha) / (he - ha), tb = (hi - ha) / (he - ha);
        t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb));
        if (t0 > t1) continue;
      }
      for (const t of [t0, (t0 + t1) * 0.5, t1]) {
        _fc.copy(_fa).lerp(_fb, t);
        if (!H._inCuts(list, _fc, 0.5, 0, 0.98)) return false;
      }
    }
    return true;
  }

  /** Alte Rammstellen vergessen (verfallen ohnehin). */
  update() {
    const now = this.G.time.elapsed;
    if (this.recs.length) this.recs = this.recs.filter((r) => now - r.t < 12);
  }

  clear() { this.recs.length = 0; this._fit.clear(); }
}
