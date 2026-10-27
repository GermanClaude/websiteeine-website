// NULLPUNKT — Graben mit dem Klappspaten (Wunschliste 10.10., Stellungskrieg): Ein Spatenhieb, der keinen Gegner
// trifft, aber den Erdboden einer Großkarte (Gelände-Höhenfeld), hebt dort Erde aus – je Hieb bis 0,4 m, so tief man
// will (Nutzer 11.10.; Grenze 60 m nur gegen Zahlenüberlauf). So entstehen eigene Schützenlöcher und Gräben (mit Sandsäcken/Bunker aus dem Bauen darüber: gedeckte
// Stellungen). Kollision, Kugeln und Bodenhöhe lesen das Höhenfeld direkt; die Geländekachel wird neu aufgebaut.
// Online entscheidet der Host: Client → 'dig' {x, z}, Host prüft Abstand und verteilt 'ev' dg an alle.
// (Echte Tunnel unter der Erde kann ein Höhenfeld nicht darstellen – gegraben wird von oben.)
import * as THREE from 'three';

// 27.10.: bis 60 m tief (Nutzerwunsch); Kartenunterkante wächst mit, Bodensicherung in Löchern (world.terrainFloor)
const R = 1.6, DY = 0.4, MAX = 60, REACH = 3.4;
const _n = new THREE.Vector3(0, 1, 0);
// Explosionskrater je Sprengsatz: Radius, Tiefe (m) bei Detonation am Boden; höher in der Luft → kleiner/flacher
const CRATER = {
  frag: [1.2, 0.28], semtex: [1.1, 0.3], impact: [1.0, 0.22], rocket: [1.8, 0.5], shell_he: [2.3, 0.75], shell_ap: [1.0, 0.25],
  drone: [1.2, 0.3], strike: [2.0, 0.6], c4: [1.6, 0.55],
};

export class Digging {
  constructor(G) {
    this.G = G;
    this.count = 0;
    const T = G.world && G.world.terrain;
    this.hf = T && T.heightfield;
    this.chunks = T && T.chunks;
    // Bodensicherung (engine/physics.js): in gegrabenen Löchern nie unter dem Gelände landen (steile Schachtwände)
    // (tiefste Geländehöhe unter der Kapsel-Grundfläche: Mitte + 4 Punkte auf Radius r – darunter steht man nie)
    if (this.hf && G.world) {
      const hf = this.hf;
      G.world.terrainFloor = (x, z, r = 0.3) => (hf.dugAt(x, z) ? Math.min(hf.heightAt(x, z), hf.heightAt(x + r, z), hf.heightAt(x - r, z), hf.heightAt(x, z + r), hf.heightAt(x, z - r)) : null);
    }
    this._off = this.hf ? [G.events.on('impact', (e) => this._impact(e)), G.events.on('explosion', (e) => this._blast(e))] : [];
  }

  get active() { return !!this.hf; }

  _impact(e) {
    const G = this.G;
    if (!e || !e.melee || e.weaponId !== 'spaten' || e.shooter !== G.player || !e.point) return;
    if (Math.abs(this.hf.heightAt(e.point.x, e.point.z) - e.point.y) > 0.2) return; // kein Erdboden (Brett, Stein …)
    const sync = G.net && G.net.sync;
    if (G.match && G.match.netRole === 'client') { if (sync && typeof sync.sendDig === 'function') sync.sendDig(e.point.x, e.point.z); return; }
    this.apply(e.point.x, e.point.z);
  }

  /**
   * Explosion am Erdboden: Trichter ins Gelände (Kollision, Kugeln, Bodenhöhe wie beim Graben). Offline/Host entscheidet
   * und verteilt den Krater ('ev' dg mit Radius/Tiefe); Clients warten darauf (ihre Explosion kommt als Netz-Ereignis).
   */
  _blast(e) {
    const G = this.G;
    if (!e || !e.position || e.nonLethal || e.net || (G.match && G.match.netRole === 'client')) return;
    const k = CRATER[e.type] || CRATER[e.weaponId] || (e.type === 'sentry' ? null : [Math.min(2, (e.radius || 4) * 0.25), 0.25]);
    if (!k) return;
    const p = e.position, gy = this.hf.heightAt(p.x, p.z);
    const h = p.y - gy;
    if (!Number.isFinite(gy) || h > k[0] * 0.9 || h < -0.5) return;
    // auf Böden, Dächern, Straßenbelag (Kartengeometrie über dem Gelände) kein Erdkrater
    const W = G.world;
    if (W && typeof W.groundHeight === 'function') { const g = W.groundHeight(p.x, p.z, p.y + 0.4); if (Number.isFinite(g) && g > gy + 0.15) return; }
    const f = 1 - Math.max(0, h) / (k[0] * 0.9);
    this.apply(p.x, p.z, false, k[0] * (0.6 + 0.4 * f), k[1] * f);
  }

  /** Host: Grabwunsch eines Clients ({x, z}) prüfen (Spieler steht nah genug) und ausführen. */
  netRequest(actor, m) {
    if (!actor || !actor.alive || !m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    if (Math.hypot(actor.position.x - m.x, actor.position.z - m.z) > REACH) return;
    this.apply(m.x, m.z);
  }

  /** Erde ausheben (alle Geräte gleich); Host verteilt online. r/dy: Explosionskrater (Trichter), sonst Spatenhieb. */
  apply(x, z, fromNet = false, r = 0, dy = 0) {
    const G = this.G;
    if (!this.hf) return false;
    const crater = r > 0 && dy > 0;
    if (crater && dy < 0.04) return false;
    const box = crater ? this.hf.dig(x, z, Math.min(3, r), Math.min(1.2, dy), 2.5, true) : this.hf.dig(x, z, R, DY, MAX);
    if (!box) return false;
    this.count++;
    // Kartenunterkante mitziehen (sonst gilt man unten im Loch als „aus der Welt gefallen“)
    const B = G.world && G.world.bounds;
    if (B && B.min && Number.isFinite(this.hf.minH) && this.hf.minH - 2 < B.min.y) B.min.y = this.hf.minH - 2;
    if (this.chunks && typeof this.chunks.refresh === 'function') this.chunks.refresh(box.minX, box.minZ, box.maxX, box.maxZ);
    const y = this.hf.heightAt(x, z);
    if (!crater && G.effects && typeof G.effects.impact === 'function') G.effects.impact(new THREE.Vector3(x, y + 0.05, z), _n, 'dirt', { big: true });
    G.events.emit('dig', { x, z, y, crater, r: crater ? Math.min(3, r) : R, dy: crater ? Math.min(1.2, dy) : DY });
    const sync = G.net && G.net.sync;
    if (!fromNet && G.match && G.match.netRole === 'host' && sync && typeof sync.relayDig === 'function') sync.relayDig(x, z, crater ? r : 0, crater ? dy : 0);
    return true;
  }

  dispose() { for (const f of this._off) f(); this._off = []; }
}
