// NULLPUNKT — Bäume fällen durch Beschuss (22.10., Brandwald-Totholz). Jede Kugel, die Holz aus einem Stamm holt
// (bullet-holes.js meldet den entfernten Querschnitt: Lochbreite × neue Tiefe), schwächt ihn in einem 30-cm-Höhenband.
// Fehlt in einem Band (mit halbem Gewicht der Nachbarbänder) gut die Hälfte des Querschnitts, bricht der Stamm dort –
// man muss ihn nicht ganz durchschießen. Der obere Teil kippt um den Bruchpunkt (Stab-Drehung: ω̇ = 3g/(2L)·sin θ)
// vom Schützen weg, schlägt auf (Staub, Splitter, Krachen, Schaden für wen er trifft), federt nach und bleibt als
// Hindernis liegen; der Stumpf bleibt stehen. Bruchstellen: Schnitt per Clipping-Ebene + Splitterkranz aus hellem Holz.
// Kollision: die Prismen des Stamms werden in den BVHs abgeschaltet, Stumpf und liegender Stamm sind Festkörper
// (building.addSolid). Online entscheidet der Host ('ev' tf), Nachzügler bekommen gefallene Bäume beim Beitritt.
import * as THREE from 'three';
import { worldPartsFrom } from './building.js';

const BAND = 0.3;      // Höhenband (m)
const BREAK = 0.52;    // Anteil des fehlenden Querschnitts, ab dem der Stamm bricht
const GRAV = 9.81;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

/** Splitterkranz an einer Bruchstelle: Ring aus Spänen unterschiedlicher Länge (up = +1 nach oben, −1 nach unten). */
function splinterCap(r, seed, up = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const P = [], I = [];
  const n = 14;
  // Mitte (leicht vertieft) + Randpunkte
  P.push(0, 0.02 * up, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.92 + rnd() * 0.12);
    P.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
  }
  for (let i = 0; i < n; i++) I.push(0, 1 + ((i + 1) % n), 1 + i);
  // Späne: schmale Keile vom Rand nach oben/unten
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.25) continue;
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5 + rnd() * 0.4) / n) * Math.PI * 2;
    const h = (0.06 + rnd() * rnd() * 0.45) * up, rin = r * (0.35 + rnd() * 0.5);
    const am = (a0 + a1) / 2;
    const b = P.length / 3;
    P.push(Math.cos(a0) * r, 0, Math.sin(a0) * r);
    P.push(Math.cos(a1) * r, 0, Math.sin(a1) * r);
    P.push(Math.cos(am) * rin, 0, Math.sin(am) * rin);
    P.push(Math.cos(am) * (r * 0.9 + rin * 0.1), h, Math.sin(am) * (r * 0.9 + rin * 0.1));
    // zwei Flächen (außen, innen), doppelseitiges Material
    I.push(b, b + 1, b + 3, b + 1, b + 2, b + 3, b + 2, b, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

export class TreeFall {
  constructor(G) {
    this.G = G;
    this.src = G.world && G.world.deadwood;
    this.dw = this.src ? this.src.dw : null;
    this.state = new Map();  // Stamm-Index → { bands: Float32Array }
    this.falling = [];       // laufende Stürze
    this.down = [];          // gefallene: { i, y, dx, dz } (Beitritt)
    this.objects = [];       // eigene Meshes (Aufräumen)
    this.solids = [];
    this.group = new THREE.Group();
    this.group.name = 'gefaellte-baeume';
    if (G.scene) G.scene.add(this.group);
    this.grid = new Map();
    if (!this.dw) return;
    this.dw.items.forEach((it, i) => {
      const k = `${Math.floor(it.x / 4)}|${Math.floor(it.z / 4)}`;
      let L = this.grid.get(k);
      if (!L) this.grid.set(k, (L = []));
      L.push(i);
    });
    const r = G.renderer && G.renderer.renderer;
    if (r) r.localClippingEnabled = true; // Bruchschnitt per Clipping-Ebene
  }

  get active() { return !!this.dw; }

  /** Proto-Maße eines Stamms (Welt): Höhe, Basisradius. */
  _dims(it) {
    const o = this.dw.protos[it.p].o;
    return { H: o.H * it.s, r0: o.r0 * it.s, o };
  }

  /** Stamm am Trefferpunkt (Rastersuche) → Index oder −1. */
  _find(p) {
    const cx = Math.floor(p.x / 4), cz = Math.floor(p.z / 4);
    let best = -1, bd = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const L = this.grid.get(`${cx + dx}|${cz + dz}`);
      if (!L) continue;
      for (const i of L) {
        const it = this.dw.items[i];
        if (it.hidden) continue;
        const { H, r0 } = this._dims(it);
        const d = Math.hypot(p.x - it.x, p.z - it.z);
        if (d > r0 * 1.6 + 0.15 || p.y < it.y - 0.4 || p.y > it.y + H + 1) continue;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  /** Radius des Stamms in Höhe rel (m über dem Fuß): verjüngt sich nach oben. */
  _radius(it, rel) {
    const { H, r0 } = this._dims(it);
    return Math.max(0.05, r0 * (1 - 0.55 * Math.min(1, rel / Math.max(H, 0.5))));
  }

  /**
   * Treffer meldet entfernten Querschnitt (m²) an einem Stamm (bullet-holes.js). Host/offline entscheidet über den Bruch.
   * dir: Schussrichtung (Fallrichtung: vom Schützen weg).
   */
  onBullet(hit, dir, area) {
    if (!this.dw || !(area > 0) || !hit || !hit.point) return;
    if (this.G.match && this.G.match.netRole === 'client') return;
    const i = this._find(hit.point);
    if (i < 0) return;
    const it = this.dw.items[i];
    const { H, o } = this._dims(it);
    if (o.H * it.s < 2.2) return; // Stümpfe fallen nicht
    let st = this.state.get(i);
    if (!st) this.state.set(i, (st = { bands: new Float32Array(Math.ceil((H + 1) / BAND) + 1) }));
    const rel = hit.point.y - it.y;
    const b = Math.max(0, Math.min(st.bands.length - 1, Math.floor(rel / BAND)));
    st.bands[b] += area;
    const r = this._radius(it, rel);
    const A = Math.PI * r * r;
    const weak = (st.bands[b] + 0.4 * ((st.bands[b - 1] || 0) + (st.bands[b + 1] || 0))) / A;
    if (weak < BREAK) return;
    // Bruch: oberhalb muss noch genug Stamm sein, sonst fällt nur die Spitze (auch ein Bruch)
    const y = it.y + Math.max(0.35, (b + 0.5) * BAND);
    if (y > it.y + H - 0.6) return;
    const l = Math.hypot(dir.x, dir.z) || 1;
    // leichte Streuung der Fallrichtung (Schwerpunkt, Neigung)
    const a = Math.atan2(dir.z / l, dir.x / l) + (Math.random() - 0.5) * 0.5;
    this.fell(i, y, Math.cos(a), Math.sin(a));
  }

  /** Baum i bricht in Höhe y und kippt Richtung (dx, dz). fromNet: vom Host; instant: ohne Sturz (Beitritt). */
  fell(i, y, dx, dz, fromNet = false, instant = false) {
    const G = this.G;
    if (!this.dw) return;
    const it = this.dw.items[i];
    if (!it || it.hidden) return;
    it.hidden = true;
    this.state.delete(i);
    this.down.push({ i, y, dx, dz });
    this.src.disable(it);
    // Nah/Fern-Verteilung ohne diesen Stamm
    if (G.camera) this.dw.update(G.camera, true);
    const { H, r0 } = this._dims(it);
    const proto = this.dw.meshes[it.p];
    const geo = proto && proto.near ? proto.near.geometry : null;
    const mats = proto && proto.near ? proto.near.material : null;
    if (!geo || !mats) return;
    const rel = y - it.y, rb = this._radius(it, rel);
    const cut = (keepBelow) => (Array.isArray(mats) ? mats : [mats]).map((m) => {
      const c = m.clone();
      c.color.multiplyScalar(it.col || 1);
      c.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, keepBelow ? -1 : 1, 0), keepBelow ? y : -y)];
      c.clipShadows = true;
      return c;
    });
    // Stumpf: gleiche Geometrie, oberhalb des Bruchs weggeschnitten, Splitterkranz oben
    const stump = new THREE.Mesh(geo, cut(true));
    stump.matrixAutoUpdate = false;
    stump.matrix.copy(it.m);
    stump.matrixWorldNeedsUpdate = true;
    stump.castShadow = true; stump.receiveShadow = true;
    stump.name = 'baumstumpf';
    this.group.add(stump);
    const woodM = (Array.isArray(mats) ? mats[1] : mats).clone();
    woodM.side = THREE.DoubleSide;
    woodM.color.multiplyScalar(1.25);
    const capS = new THREE.Mesh(splinterCap(rb, i + 1, 1), woodM);
    capS.position.set(it.x, y, it.z);
    capS.rotation.y = i * 1.3;
    capS.castShadow = true;
    this.group.add(capS);
    this.objects.push(stump, capS);
    const sp = { id: `stumpf${i}`, def: { surface: 'wood' }, mesh: stump, static: true, parts: worldPartsFrom([[0, rel / 2 + 0.15, 0, rb * 0.95, rel / 2 + 0.15, rb * 0.95, 0]], it.x, it.y - 0.3, it.z, 0) };
    if (G.building) G.building.addSolid(sp);
    this.solids.push(sp);
    // fallender Teil: Drehpunkt am Bruch (Welt), Baum relativ dazu; Schnitt wandert mit (Ebene je Bild)
    const pivot = new THREE.Group();
    pivot.position.set(it.x, y, it.z);
    const top = new THREE.Mesh(geo, cut(false));
    top.matrixAutoUpdate = false;
    // it.m relativ zum Drehpunkt
    top.matrix.copy(it.m);
    top.matrix.elements[12] -= it.x; top.matrix.elements[13] -= y; top.matrix.elements[14] -= it.z;
    top.castShadow = true; top.receiveShadow = true;
    top.name = 'fallender-stamm';
    pivot.add(top);
    const capT = new THREE.Mesh(splinterCap(rb, i + 7, -1), woodM);
    capT.rotation.y = i * 0.7;
    capT.castShadow = true;
    pivot.add(capT);
    this.group.add(pivot);
    this.objects.push(top, capT);
    const L = Math.max(0.5, it.y + H - y);
    const axis = new THREE.Vector3(dz, 0, -dx).normalize(); // Drehachse: kippt „oben“ Richtung (dx, dz)
    const f = { i, it, pivot, top, axis, L, r: rb, th: 0.04, w: 0.35, bounces: 0, done: false, dx, dz, t: 0, planes: top.material.map((m) => m.clippingPlanes[0]), localY: 0 };
    this.falling.push(f);
    G.events.emit('tree:break', { position: new THREE.Vector3(it.x, y, it.z), radius: rb });
    if (G.audio && typeof G.audio.play === 'function' && !instant) G.audio.play('debris', { position: { x: it.x, y, z: it.z }, volume: 1, pitch: 0.55 });
    if (G.effects && !instant) G.effects.impact(new THREE.Vector3(it.x + dx * rb, y, it.z + dz * rb), new THREE.Vector3(dx, 0, dz), 'wood', { scale: 1.6, exit: true });
    if (instant) { for (let k = 0; k < 600 && !f.done; k++) this._step(f, 1 / 60, true); }
    // Host verteilt
    const sync = G.net && G.net.sync;
    if (!fromNet && G.match && G.match.netRole === 'host' && sync && typeof sync.relayTree === 'function') sync.relayTree({ i, y: Math.round(y * 100) / 100, dx: Math.round(dx * 1000) / 1000, dz: Math.round(dz * 1000) / 1000 });
    // Löcher am fallenden Teil verschwinden mit ihm
    if (G.holes && typeof G.holes.removeWhere === 'function') G.holes.removeWhere((h) => h.pos.y > y + 0.02 && Math.hypot(h.pos.x - it.x, h.pos.z - it.z) < this._radius(it, h.pos.y - it.y) + 0.25 && h.pos.y < it.y + H + 1);
  }

  /** Sturz eines Stamms um einen Zeitschritt; quiet: ohne Effekte (Beitritt). */
  _step(f, dt, quiet = false) {
    const G = this.G, W = G.world;
    // Stab, der am Fuß dreht: ω̇ = 3g/(2L)·sin θ (Luftwiderstand der Äste gering gedämpft)
    f.w += ((3 * GRAV) / (2 * f.L)) * Math.sin(f.th) * dt;
    f.w *= 1 - 0.15 * dt;
    f.th += f.w * dt;
    _q.setFromAxisAngle(f.axis, f.th);
    f.pivot.quaternion.copy(_q);
    f.pivot.updateMatrixWorld(true);
    // Aufschlag: tiefster Punkt entlang des Stamms gegen den Boden (fünf Stützstellen)
    let pen = -Infinity, at = null;
    for (let k = 1; k <= 5; k++) {
      _v.set(0, (f.L * k) / 5, 0).applyQuaternion(_q).add(f.pivot.position);
      const gy = W && typeof W.groundHeight === 'function' ? W.groundHeight(_v.x, _v.z, _v.y + 1.5) : 0;
      const d = gy + f.r * (1 - (0.5 * k) / 5) - _v.y;
      if (d > pen) { pen = d; at = _v.clone(); }
    }
    if (pen > 0 && f.w > 0) {
      // zurückdrehen bis zur Berührung und abprallen
      const back = Math.min(f.th, pen / Math.max(0.5, f.L * 0.6));
      f.th -= back;
      const v = f.w;
      f.w = -v * 0.22;
      f.bounces++;
      if (!quiet && f.bounces === 1) this._impact(f, at, v);
      if (f.bounces >= 3 || Math.abs(f.w) < 0.25) { f.w = 0; this._rest(f); }
    } else if (f.th > Math.PI * 0.62) {
      // kein Boden gefunden (Abhang): liegen lassen
      f.w = 0; this._rest(f);
    }
    // Schnittebene mit dem Stamm mitführen
    _v.set(0, 0, 0).applyMatrix4(f.pivot.matrixWorld);
    _w.set(0, 1, 0).applyQuaternion(_q);
    for (const pl of f.planes) pl.setFromNormalAndCoplanarPoint(_w, _v);
  }

  /** Aufschlag: Staub entlang des Stamms, Splitter, dumpfes Krachen, Schaden für Getroffene. */
  _impact(f, at, w) {
    const G = this.G;
    const speed = Math.abs(w) * f.L;
    if (G.effects) {
      const n = Math.max(3, Math.min(8, Math.round(f.L / 2)));
      for (let k = 1; k <= n; k++) {
        _v.set(0, (f.L * k) / (n + 0.5), 0).applyQuaternion(f.pivot.quaternion).add(f.pivot.position);
        G.effects.impact(_v.clone(), _up.clone(), k % 2 ? 'dirt' : 'wood', { scale: 1.4 });
      }
    }
    if (G.audio && typeof G.audio.play === 'function') {
      G.audio.play('debris', { position: { x: at.x, y: at.y, z: at.z }, volume: 1, pitch: 0.42 });
      G.audio.play('debris', { position: { x: at.x, y: at.y, z: at.z }, volume: 0.8, pitch: 0.6, delay: 0.12 });
    }
    G.events.emit('tree:fall', { position: at.clone(), length: f.L });
    // Wer unter dem Stamm steht, wird getroffen (nur Host/offline entscheidet Schaden)
    if (G.match && G.match.netRole === 'client') return;
    const a = f.pivot.position, b = _w.set(0, f.L, 0).applyQuaternion(f.pivot.quaternion).add(a);
    for (const actor of G.actors || []) {
      if (!actor.alive || !actor.position) continue;
      const p = actor.position;
      const abx = b.x - a.x, abz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1)));
      const d = Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
      if (d > f.r + 0.45 || p.y > a.y + 2.5) continue;
      const dmg = Math.min(200, 35 + speed * 9 * (1 - t * 0.5));
      if (G.combat && typeof G.combat.damage === 'function') G.combat.damage(actor, { amount: dmg, attacker: null, weaponId: 'world', zone: 'body', dir: new THREE.Vector3(0, -1, 0), point: p.clone() });
    }
  }

  /** Stamm liegt: als Festkörper eintragen (Kollision, Deckung, Kugeln). */
  _rest(f) {
    if (f.done) return;
    f.done = true;
    const G = this.G;
    const a = f.pivot.position, b = _w.set(0, f.L, 0).applyQuaternion(f.pivot.quaternion).add(a).clone();
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, cy = Math.min(a.y, b.y);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ry = Math.atan2(-(b.z - a.z), b.x - a.x);
    const hy = Math.max(f.r, Math.abs(b.y - a.y) / 2);
    const sol = { id: `stamm${f.i}`, def: { surface: 'wood' }, mesh: f.top, static: true, parts: worldPartsFrom([[0, hy, 0, len / 2, hy, f.r * 0.9, 0]], cx, cy - f.r * 0.4, cz, ry) };
    if (G.building) G.building.addSolid(sol);
    this.solids.push(sol);
  }

  update(dt) {
    if (!this.falling.length) return;
    const h = Math.min(dt, 1 / 30);
    for (const f of this.falling) {
      if (f.done) continue;
      f.t += dt;
      // feiner Schritt (schnelle Drehung am Ende)
      const n = Math.max(1, Math.ceil(dt / h));
      for (let k = 0; k < n && !f.done; k++) this._step(f, dt / n);
    }
    this.falling = this.falling.filter((f) => !f.done);
  }

  /** Gefallene Bäume (Host → neuer Client). */
  snapshot() { return this.down.map((d) => ({ ...d })); }

  dispose() {
    const G = this.G;
    for (const s of this.solids) if (G.building) G.building.removeSolid(s);
    this.solids.length = 0;
    for (const o of this.objects) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m) m.dispose();
      // Geometrie der Stämme gehört dem Totholz (geteilt) – nur eigene Splitterkränze freigeben
      if (o.geometry && o.geometry.type === 'BufferGeometry' && !o.geometry.groups.length && o.geometry.index && o.name !== 'baumstumpf' && o.name !== 'fallender-stamm') o.geometry.dispose();
    }
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.dw) for (const it of this.dw.items) it.hidden = false;
  }
}
