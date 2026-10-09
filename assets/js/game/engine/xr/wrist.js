// NULLPUNKT — VR-Handgelenk-Anzeige (engine/xr): kleines Feld über dem Handgelenk der Nebenhand (wie eine Uhr).
//
// Leinwand 512 × 320 → CanvasTexture auf einer Fläche 15 × 9,4 cm, neu gezeichnet höchstens 10×/s (nur, wenn sich
// der Inhalt geändert hat). Inhalt: Leben (+ Panzerplatten), Munition/Waffe, Granaten, Stand/Zeit, kleine
// Abschussmeldungen, Trefferrahmen. Das Feld sitzt 4 cm über und 10 cm hinter dem Griff und dreht sich zum Kopf
// (bleibt lesbar, egal wie die Hand gedreht ist); weit vom Blick weg wird es blasser.

import * as THREE from 'three';

const W = 512;
const H = 320;
const RATE = 0.1; // s zwischen zwei Zeichnungen
const FONT = '"Rajdhani NP", "Rajdhani", system-ui, sans-serif';
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const OFFSET = new THREE.Vector3(0, 0.045, 0.1);

export class WristHud {
  constructor(G) {
    this.G = G;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) { this.canvas.width = W; this.canvas.height = H; }
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.texture = new THREE.CanvasTexture(this.canvas || undefined);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false, depthWrite: false });
    mat.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15 * H / W), mat);
    this.mesh.name = 'xr-handgelenk';
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.feed = []; // { text, mine, t }
    this.hitT = 0;
    this.hitKind = '';
    this._t = 0;
    this._key = '';
    /** Zähler (Tests): wie oft gezeichnet wurde, letzter Munitionstext. */
    this.draws = 0;
    this.lastAmmo = '';
  }

  /** Abschussmeldung (aus dem 'kill'-Ereignis). */
  pushKill(killer, victim, mine) {
    const name = (a) => (a && a.name ? String(a.name).slice(0, 12) : '–');
    this.feed.unshift({ text: killer && killer !== victim ? `${name(killer)} › ${name(victim)}` : `✕ ${name(victim)}`, mine, t: 6 });
    if (this.feed.length > 3) this.feed.length = 3;
    this._key = '';
  }

  /** Treffer am Gegner (kind: '' | 'head' | 'kill'). */
  hit(kind = '') {
    this.hitT = kind === 'kill' ? 0.6 : 0.3;
    this.hitKind = kind;
    this._key = '';
  }

  /**
   * Lage (je Bild): grip = { pos, quat } der Nebenhand in Weltkoordinaten (null = nicht verfolgt), head = Kopfposition,
   * fwd = Blickrichtung. Gibt false zurück, wenn das Feld verborgen ist.
   */
  place(grip, head, fwd) {
    if (!grip) { this.mesh.visible = false; return false; }
    const m = this.mesh;
    m.position.copy(OFFSET).applyQuaternion(grip.quat).add(grip.pos);
    // zum Kopf drehen (Plakat), oben bleibt oben
    _m.lookAt(head, m.position, UP);
    m.quaternion.setFromRotationMatrix(_m);
    _v.subVectors(m.position, head).normalize();
    const look = fwd ? _v.dot(fwd) : 1;
    m.material.opacity = 0.35 + 0.65 * Math.min(1, Math.max(0, (look - 0.55) / 0.3));
    m.visible = true;
    return true;
  }

  /** Inhalt fortschreiben (gedrosselt). */
  update(dt) {
    this._t -= dt;
    this.hitT = Math.max(0, this.hitT - dt);
    for (const f of this.feed) f.t -= dt;
    while (this.feed.length && this.feed[this.feed.length - 1].t <= 0) { this.feed.pop(); this._key = ''; }
    if (this._t > 0 || !this.ctx) return;
    this._t = RATE;
    const d = this._data();
    const key = JSON.stringify(d);
    if (key === this._key) return;
    this._key = key;
    this._draw(d);
  }

  _data() {
    const G = this.G;
    const p = G.player;
    const w = p && p.weapon;
    const def = w && w.currentDef;
    const st = w && w.current;
    const mode = G.mode;
    const a = p && p.alive ? p.armor : null;
    const EQ = (G.data && G.data.EQUIPMENT) || {};
    const lethal = w && w.equipment ? w.equipment.lethal : null;
    const tac = w && w.equipment ? w.equipment.tactical : null;
    const infinite = !!(mode && mode.def && mode.def.infiniteAmmo);
    const melee = !!(def && def.cls === 'melee');
    let score = '';
    if (mode && mode.teams && mode.scores) {
      const mine = p && p.team === 'B' ? 'B' : 'A';
      score = `${mode.scores[mine] || 0} : ${mode.scores[mine === 'A' ? 'B' : 'A'] || 0}`;
    } else if (p && p.stats) score = `${p.stats.kills | 0} Abschüsse`;
    const tl = mode && Number.isFinite(mode.timeLeft) ? Math.max(0, Math.ceil(mode.timeLeft)) : null;
    return {
      alive: !!(p && p.alive),
      hp: p ? Math.max(0, Math.ceil(p.health)) : 0,
      hpMax: p ? p.maxHealth || 100 : 100,
      plates: a && a.slots > 0 && a.plateHp > 0 ? Array.from({ length: a.slots | 0 }, (_, i) => Math.round(Math.min(1, Math.max(0, ((a.hp || 0) - i * a.plateHp) / a.plateHp)) * 10) / 10) : null,
      weapon: def ? def.name : '',
      mag: st && !melee ? st.mag : null,
      reserve: st && !melee ? (infinite ? '∞' : st.reserve) : null,
      low: !!(def && def.mag > 0 && st && st.mag <= Math.ceil(def.mag * 0.25)),
      reloading: !!(w && w.isReloading),
      lethal: lethal && lethal.id ? `${(EQ[lethal.id] && EQ[lethal.id].short) || 'Granate'} ${lethal.count}` : '',
      tac: tac && tac.id ? `${(EQ[tac.id] && EQ[tac.id].short) || 'Taktisch'} ${tac.count}` : '',
      score,
      time: tl == null ? '' : `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`,
      feed: this.feed.map((f) => [f.text, f.mine]),
      hit: this.hitT > 0 ? this.hitKind || 'hit' : '',
    };
  }

  _draw(d) {
    const c = this.ctx;
    this.draws++;
    c.clearRect(0, 0, W, H);
    // Grundfläche
    c.fillStyle = 'rgba(10, 12, 14, 0.78)';
    roundRect(c, 4, 4, W - 8, H - 8, 22);
    c.fill();
    c.lineWidth = d.hit ? 8 : 2;
    c.strokeStyle = d.hit === 'kill' ? '#ff5b1f' : d.hit ? '#ffffff' : 'rgba(255,255,255,0.18)';
    roundRect(c, 4, 4, W - 8, H - 8, 22);
    c.stroke();
    c.textBaseline = 'alphabetic';
    // Leben
    const hpR = Math.min(1, d.hp / Math.max(1, d.hpMax));
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(28, 34, 300, 18);
    c.fillStyle = hpR < 0.35 ? '#ff4040' : hpR < 0.7 ? '#ffc23d' : '#5fe08a';
    c.fillRect(28, 34, 300 * hpR, 18);
    c.fillStyle = '#ffffff';
    c.font = `700 40px ${FONT}`;
    c.fillText(d.alive ? String(d.hp) : '✕', 344, 56);
    if (d.plates) {
      const n = d.plates.length;
      const pw = Math.min(70, (300 - (n - 1) * 6) / n);
      d.plates.forEach((f, i) => {
        c.fillStyle = 'rgba(120,170,255,0.18)';
        c.fillRect(28 + i * (pw + 6), 60, pw, 8);
        c.fillStyle = '#7fb0ff';
        c.fillRect(28 + i * (pw + 6), 60, pw * f, 8);
      });
    }
    // Munition
    c.font = `700 88px ${FONT}`;
    c.fillStyle = d.mag === 0 ? '#ff4040' : d.low ? '#ffc23d' : '#ffffff';
    const mag = d.mag == null ? '—' : String(d.mag);
    c.fillText(mag, 28, 158);
    const mw = c.measureText(mag).width;
    c.font = `600 40px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.65)';
    const res = d.reserve == null ? '' : `/ ${d.reserve}`;
    c.fillText(res, 40 + mw, 158);
    this.lastAmmo = `${mag}${res ? ` ${res}` : ''}`;
    c.font = `600 30px ${FONT}`;
    c.fillStyle = d.reloading ? '#ffc23d' : 'rgba(255,255,255,0.8)';
    c.fillText(d.reloading ? 'Nachladen …' : d.weapon, 28, 196);
    // Granaten
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = `600 26px ${FONT}`;
    c.fillText([d.lethal, d.tac].filter(Boolean).join(' · '), 28, 232);
    // Stand / Zeit
    c.textAlign = 'right';
    c.font = `700 40px ${FONT}`;
    c.fillStyle = '#ffffff';
    c.fillText(d.time, W - 28, 112);
    c.font = `600 30px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillText(d.score, W - 28, 150);
    // Abschussmeldungen
    c.font = `600 24px ${FONT}`;
    d.feed.forEach(([text, mine], i) => {
      c.fillStyle = mine ? '#ff8a4f' : 'rgba(255,255,255,0.75)';
      c.fillText(text, W - 28, 238 + i * 28);
    });
    c.textAlign = 'left';
    this.texture.needsUpdate = true;
  }

  reset() {
    this.feed.length = 0;
    this.hitT = 0;
    this._key = '';
    this._t = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
