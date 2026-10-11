// NULLPUNKT — Wärmebild der Panzeroptiken (Nutzer 11.10.): in der Hauptzieloptik, im Weitwinkel und im Rundblickperiskop
// mit G umschaltbar. Bild „weiß-heiß“: Szene grau mit hohem Kontrast (CSS-Filter auf der Leinwand – ohne eigenen
// Renderdurchgang), Menschen leuchten weiß (Eigenleuchten ihrer Materialien), Fahrzeuge warm grau. Materialien werden
// beim Ausschalten wiederhergestellt; neu gespawnte Soldaten übernimmt der Sekundentakt. Rein lokal.
const FILTER = 'grayscale(1) contrast(1.55) brightness(0.78)';

export class Thermal {
  constructor(G) {
    this.G = G;
    this.on = false;
    this._mats = new Map();   // Material → { e: Farbe, i: Stärke }
    this._t = 0;
  }

  get canvas() { const r = this.G.renderer && this.G.renderer.renderer; return r && r.domElement; }

  set(on) {
    on = !!on;
    if (on === this.on) return;
    this.on = on;
    const c = this.canvas;
    if (c) c.style.filter = on ? FILTER : '';
    if (on) this._apply(); else this._restore();
    this.G.events.emit('vehicle:thermal', { on });
  }

  toggle() { this.set(!this.on); }

  /** allowed: aktuelle Sicht erlaubt Wärmebild (sonst aus). */
  update(dt, allowed) {
    if (this.on && !allowed) { this.set(false); return; }
    if (!this.on) return;
    this._t += dt;
    if (this._t > 1) { this._t = 0; this._apply(); }
  }

  _heat(mat, k) {
    if (!mat || !mat.emissive || this._mats.has(mat)) return;
    this._mats.set(mat, { e: mat.emissive.clone(), i: mat.emissiveIntensity ?? 1 });
    mat.emissive.setRGB(1, 1, 1);
    mat.emissiveIntensity = k;
  }

  _apply() {
    const G = this.G;
    for (const a of G.actors || []) {
      const r = a && a.soldier && a.soldier.root;
      if (!r) continue;
      const k = a.alive ? 0.95 : 0.35; // Gefallene kühlen ab
      r.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) this._heat(m, k); });
    }
    const V = G.vehicles;
    for (const v of (V && V.list) || []) {
      const r = v && v.model && v.model.root;
      if (r) r.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) this._heat(m, v.alive ? 0.22 : 0.08); });
    }
  }

  _restore() {
    for (const [m, s] of this._mats) { m.emissive.copy(s.e); m.emissiveIntensity = s.i; }
    this._mats.clear();
  }

  dispose() { this.set(false); this._restore(); }
}
