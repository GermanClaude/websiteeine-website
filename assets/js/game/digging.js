// NULLPUNKT — Graben mit dem Klappspaten (Wunschliste 10.10., Stellungskrieg): Ein Spatenhieb, der keinen Gegner
// trifft, aber den Erdboden einer Großkarte (Gelände-Höhenfeld), hebt dort Erde aus – je Hieb bis 0,4 m, so tief man
// will (Nutzer 11.10.; Grenze 60 m nur gegen Zahlenüberlauf). So entstehen eigene Schützenlöcher und Gräben (mit Sandsäcken/Bunker aus dem Bauen darüber: gedeckte
// Stellungen). Kollision, Kugeln und Bodenhöhe lesen das Höhenfeld direkt; die Geländekachel wird neu aufgebaut.
// Online entscheidet der Host: Client → 'dig' {x, z}, Host prüft Abstand und verteilt 'ev' dg an alle.
// (Echte Tunnel unter der Erde kann ein Höhenfeld nicht darstellen – gegraben wird von oben.)
import * as THREE from 'three';

const R = 1.6, DY = 0.4, MAX = 60, REACH = 3.4;
const _n = new THREE.Vector3(0, 1, 0);

export class Digging {
  constructor(G) {
    this.G = G;
    this.count = 0;
    const T = G.world && G.world.terrain;
    this.hf = T && T.heightfield;
    this.chunks = T && T.chunks;
    this._off = this.hf ? [G.events.on('impact', (e) => this._impact(e))] : [];
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

  /** Host: Grabwunsch eines Clients ({x, z}) prüfen (Spieler steht nah genug) und ausführen. */
  netRequest(actor, m) {
    if (!actor || !actor.alive || !m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    if (Math.hypot(actor.position.x - m.x, actor.position.z - m.z) > REACH) return;
    this.apply(m.x, m.z);
  }

  /** Erde ausheben (alle Geräte gleich); Host verteilt online. */
  apply(x, z, fromNet = false) {
    const G = this.G;
    if (!this.hf) return false;
    const box = this.hf.dig(x, z, R, DY, MAX);
    if (!box) return false;
    this.count++;
    if (this.chunks && typeof this.chunks.refresh === 'function') this.chunks.refresh(box.minX, box.minZ, box.maxX, box.maxZ);
    const y = this.hf.heightAt(x, z);
    if (G.effects && typeof G.effects.impact === 'function') G.effects.impact(new THREE.Vector3(x, y + 0.05, z), _n, 'dirt', { big: true });
    G.events.emit('dig', { x, z, y });
    const sync = G.net && G.net.sync;
    if (!fromNet && G.match && G.match.netRole === 'host' && sync && typeof sync.relayDig === 'function') sync.relayDig(x, z);
    return true;
  }

  dispose() { for (const f of this._off) f(); this._off = []; }
}
