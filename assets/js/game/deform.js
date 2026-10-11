// NULLPUNKT — Verformbare Autos (Wunschliste: Zerstörung, Autos): Karosserien (Material-Oberfläche 'vehicle', z. B.
// Autolack der Hafen-PKW/Transporter) und fahrbare Jeeps bekommen Dellen. Kugeln drücken das Blech um den Einschlag
// ein (≈ 16 cm), Explosionen knautschen die Karosserie im Umkreis weg vom Explosionspunkt. Beim ersten Treffer wird das
// grobe Kastenmodell fein unterteilt (Kanten ≤ 0,3 m, Autos der Karte schon beim Laden), sonst hätten Dellen keine Punkte; Verschiebung je Punkt
// höchstens 0,38 m. Reine Optik, überall lokal aus denselben Ereignissen ('impact', 'explosion') – keine Netzbotschaft.
import * as THREE from 'three';

const EDGE = 0.3, MAX_SHIFT = 0.38;
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _inv = new THREE.Matrix4(), _box = new THREE.Box3();

/** Dreiecke unterteilen, bis keine Kante länger als maxEdge ist (alle Attribute linear gemischt). */
export function tessellate(geo, maxEdge = EDGE) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes).filter((n) => !g.attributes[n].isInterleavedBufferAttribute);
  const sizes = names.map((n) => g.attributes[n].itemSize);
  const S = sizes.reduce((a, b) => a + b, 0);
  const pos = g.attributes.position, n = pos.count;
  const vert = (i) => {
    const v = new Float32Array(S);
    let o = 0;
    names.forEach((nm, k) => { const a = g.attributes[nm]; for (let c = 0; c < sizes[k]; c++) v[o++] = a.array[i * sizes[k] + c]; });
    return v;
  };
  const mid = (a, b) => { const m = new Float32Array(S); for (let i = 0; i < S; i++) m[i] = (a[i] + b[i]) / 2; return m; };
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const out = [];
  const tri = (a, b, c, depth) => {
    const ab = len(a, b), bc = len(b, c), ca = len(c, a), m = Math.max(ab, bc, ca);
    if (m <= maxEdge || depth > 9 || out.length > 600000) { out.push(a, b, c); return; }
    if (m === ab) { const x = mid(a, b); tri(a, x, c, depth + 1); tri(x, b, c, depth + 1); }
    else if (m === bc) { const x = mid(b, c); tri(a, b, x, depth + 1); tri(a, x, c, depth + 1); }
    else { const x = mid(c, a); tri(a, b, x, depth + 1); tri(x, b, c, depth + 1); }
  };
  for (let i = 0; i + 2 < n; i += 3) tri(vert(i), vert(i + 1), vert(i + 2), 0);
  const res = new THREE.BufferGeometry();
  let o = 0;
  names.forEach((nm, k) => {
    const sz = sizes[k], arr = new Float32Array(out.length * sz);
    for (let v = 0; v < out.length; v++) for (let c = 0; c < sz; c++) arr[v * sz + c] = out[v][o + c];
    res.setAttribute(nm, new THREE.BufferAttribute(arr, sz));
    o += sz;
  });
  if (g !== geo) g.dispose();
  res.computeBoundingSphere();
  res.computeBoundingBox();
  return res;
}

export class CarDeform {
  constructor(G) {
    this.G = G;
    this.statics = [];
    this.dents = 0;
    this._dirty = new Set();
    this._t = 0;
    if (G.world && G.world.group) G.world.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
      if (o.material && o.material.userData && o.material.userData.surface === 'vehicle') this.statics.push(o);
    });
    for (const m of this.statics) this._prep(m, false); // beim Laden statt beim ersten Treffer (kein Ruckler)
    this._off = [
      G.events.on('impact', (e) => this._impact(e)),
      G.events.on('explosion', (e) => this._explosion(e)),
    ];
  }

  /** Mesh für Dellen vorbereiten (einmalig: eigene, fein unterteilte Geometrie + Ausgangslage). */
  _prep(mesh, shared) {
    const ud = mesh.userData;
    if (ud.deform) return ud.deform;
    if (!mesh.geometry || !mesh.geometry.attributes.position || (mesh.geometry.groups && mesh.geometry.groups.length > 1)) return (ud.deform = null);
    const old = mesh.geometry;
    const geo = tessellate(old, EDGE);
    mesh.geometry = geo;
    if (!shared) old.dispose();
    ud.deform = { orig: geo.attributes.position.array.slice() };
    return ud.deform;
  }

  /** Punkte um p (Welt) verschieben: dir (Welt) fest, oder radial weg von p (dir = null). */
  _dent(mesh, p, dir, r, depth, shared = false) {
    mesh.updateWorldMatrix(true, false);
    // grober Vortest über die Hüllkugel (Welt)
    const g0 = mesh.geometry;
    if (!g0.boundingSphere) g0.computeBoundingSphere();
    _d.copy(g0.boundingSphere.center).applyMatrix4(mesh.matrixWorld);
    const sc = mesh.matrixWorld.getMaxScaleOnAxis();
    if (_d.distanceTo(p) > g0.boundingSphere.radius * sc + r) return false;
    const df = this._prep(mesh, shared);
    if (!df) return false;
    _inv.copy(mesh.matrixWorld).invert();
    const lp = _p.copy(p).applyMatrix4(_inv);
    const lr = r / sc, ldepth = depth / sc, lmax = MAX_SHIFT / sc;
    const ldir = dir ? _d.copy(dir).transformDirection(_inv) : null;
    const pos = mesh.geometry.attributes.position, a = pos.array, o = df.orig;
    let moved = 0;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - lp.x, dy = a[i + 1] - lp.y, dz = a[i + 2] - lp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > lr * lr) continue;
      const d = Math.sqrt(d2), k = 1 - d / lr, w = k * k * ldepth * (0.85 + 0.3 * ((i * 7919) % 97) / 97);
      let ux, uy, uz;
      if (ldir) { ux = ldir.x; uy = ldir.y; uz = ldir.z; }
      else { const inv = d > 1e-4 ? 1 / d : 0; ux = dx * inv; uy = dy * inv * 0.6; uz = dz * inv; }
      let nx = a[i] + ux * w, ny = a[i + 1] + uy * w, nz = a[i + 2] + uz * w;
      // höchstens MAX_SHIFT von der Ausgangslage
      const sx = nx - o[i], sy = ny - o[i + 1], sz = nz - o[i + 2], s = Math.hypot(sx, sy, sz);
      if (s > lmax) { const f = lmax / s; nx = o[i] + sx * f; ny = o[i + 1] + sy * f; nz = o[i + 2] + sz * f; }
      a[i] = nx; a[i + 1] = ny; a[i + 2] = nz;
      moved++;
    }
    if (!moved) return false;
    pos.needsUpdate = true;
    this._dirty.add(mesh);
    this.dents++;
    return true;
  }

  _jeepMeshes() {
    const V = this.G.vehicles, out = [];
    if (!V || !Array.isArray(V.list)) return out;
    for (const v of V.list) {
      if (!v || !v.model || !v.model.root || !/jeep/.test(v.type || '')) continue;
      v.model.root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || /rad|wheel|reifen|glas|glass/i.test(o.name || '')) return;
        if (o.material && (o.material.transparent || o.material.isMeshBasicMaterial)) return;
        out.push(o);
      });
    }
    return out;
  }

  _impact(e) {
    if (!e || !e.point || e.exit) return;
    const dir = e.normal ? _p.copy(e.normal).negate().clone() : null;
    if (e.surface === 'vehicle') {
      const r = e.melee ? 0.22 : 0.16, depth = e.melee ? 0.06 : 0.035;
      for (const m of this.statics) this._dent(m, e.point, dir, r, depth);
      return;
    }
    // fahrbare Jeeps: Treffer in ihrer Hülle
    for (const m of this._jeepMeshes()) {
      _box.setFromObject(m).expandByScalar(0.05);
      if (_box.containsPoint(e.point)) this._dent(m, e.point, dir, 0.16, 0.03, true);
    }
  }

  _explosion(e) {
    if (!e || e.nonLethal || !e.position) return;
    const R = (e.radius || 6) * 0.75, depth = 0.16 * Math.min(2, (e.radius || 6) / 5) * (e.type === 'strike' || e.type === 'tank' ? 1.5 : 1);
    for (const m of this.statics) this._dent(m, e.position, null, R, depth);
    for (const m of this._jeepMeshes()) this._dent(m, e.position, null, R, depth, true);
  }

  /** Normalen der verbeulten Meshes gesammelt nachziehen (höchstens alle 0,1 s). */
  update(dt = 0) {
    if (!this._dirty.size) return;
    this._t += dt;
    if (this._t < 0.1) return;
    this._t = 0;
    for (const m of this._dirty) { if (m.geometry) { m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); } }
    this._dirty.clear();
  }

  dispose() {
    for (const f of this._off) f();
    this._off = [];
    this.statics = [];
    this._dirty.clear();
  }
}
