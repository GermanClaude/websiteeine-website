// NULLPUNKT — kleines Menü in der Brille (engine/xr): Weiter · Vignette an/aus · Drehen Schritt/flüssig ·
// Höhe kalibrieren · VR beenden. Außerdem die Ergebnistafel am Matchende („Sieg … VR wird beendet“).
//
// Eine Tafel (CanvasTexture 1024 × 640 auf 0,9 × 0,56 m) steht beim Öffnen 1,1 m vor dem Kopf und bleibt in der
// Welt stehen. Zeigen mit dem Strahl der Haupthand (Laser + Lichtpunkt), Abzug wählt; alternativ Stick hoch/runter +
// A/X. Neu gezeichnet wird nur bei Änderungen (Auswahl, Werte, Unterzeile).

import * as THREE from 'three';

const W = 1024;
const H = 640;
const PW = 0.9;
const PH = PW * H / W;
const HEAD_H = 150; // Kopfbereich der Tafel (px)
const ITEM_H = 92;
const FONT = '"Rajdhani NP", "Rajdhani", system-ui, sans-serif';
const _inv = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();

export class VrMenu {
  constructor(G) {
    this.G = G;
    this.group = new THREE.Group();
    this.group.name = 'xr-menue';
    this.group.visible = false;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) { this.canvas.width = W; this.canvas.height = H; }
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.texture = new THREE.CanvasTexture(this.canvas || undefined);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false, depthTest: false, depthWrite: false });
    mat.toneMapped = false;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat);
    this.panel.renderOrder = 1e5;
    this.group.add(this.panel);
    // Laser der Haupthand + Lichtpunkt auf der Tafel
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const lm = new THREE.LineBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.85, depthTest: false, fog: false });
    lm.toneMapped = false;
    this.laser = new THREE.Line(lg, lm);
    this.laser.frustumCulled = false;
    this.laser.renderOrder = 1e5 + 1;
    this.group.add(this.laser);
    const dm = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false });
    dm.toneMapped = false;
    this.cursor = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), dm);
    this.cursor.renderOrder = 1e5 + 2;
    this.group.add(this.cursor);
    this.open = false;
    this.kind = 'menu'; // 'menu' | 'result'
    this.items = [];
    this.hover = -1;
    this.focus = 0;
    this.title = '';
    this.sub = '';
    this._key = '';
  }

  /**
   * Öffnen vor dem Kopf. kind 'menu' (Pausenmenü) oder 'result' (Matchende, title/sub vorgegeben).
   * items = [{ id, label }] (label darf eine Funktion sein: aktueller Wert).
   */
  show(kind, head, headQuat, { items = [], title = '', sub = '' } = {}) {
    this.kind = kind;
    this.items = items;
    this.title = title;
    this.sub = sub;
    this.hover = -1;
    this.focus = 0;
    _f.set(0, 0, -1).applyQuaternion(headQuat);
    _f.y = 0;
    if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1);
    _f.normalize();
    const g = this.group;
    this.panel.position.copy(head).addScaledVector(_f, 1.1);
    this.panel.position.y = head.y - 0.12;
    _m.lookAt(head, this.panel.position, UP); // Matrix4.lookAt(eye, target): +z der Tafel zeigt zum Kopf
    this.panel.quaternion.setFromRotationMatrix(_m);
    this.panel.updateMatrixWorld(true);
    g.visible = true;
    this.open = true;
    this._key = '';
  }

  hide() {
    this.open = false;
    this.group.visible = false;
  }

  /**
   * Je Bild: ray = { origin, dir } (Haupthand, Welt) oder null; press = Abzug/A gedrückt (Flanke); nav = −1/0/1
   * (Stick-Flanke). → id des gewählten Eintrags oder null.
   */
  update(dt, ray, press, nav) {
    if (!this.open) return null;
    let picked = null;
    // Zeigen
    let hit = false;
    if (ray) {
      _inv.copy(this.panel.matrixWorld).invert();
      _o.copy(ray.origin).applyMatrix4(_inv);
      _d.copy(ray.dir).transformDirection(_inv);
      if (Math.abs(_d.z) > 1e-4) {
        const t = -_o.z / _d.z;
        if (t > 0 && t < 6) {
          _p.copy(_o).addScaledVector(_d, t);
          if (Math.abs(_p.x) <= PW / 2 && Math.abs(_p.y) <= PH / 2) {
            hit = true;
            const py = (PH / 2 - _p.y) / PH * H;
            const i = Math.floor((py - HEAD_H) / ITEM_H);
            this.hover = i >= 0 && i < this.items.length ? i : -1;
            if (this.hover >= 0) this.focus = this.hover;
            this.cursor.position.copy(_p).applyMatrix4(this.panel.matrixWorld);
            this.cursor.quaternion.copy(this.panel.quaternion);
            _p.applyMatrix4(this.panel.matrixWorld);
          }
        }
      }
      if (!hit) { this.hover = -1; _p.copy(ray.origin).addScaledVector(ray.dir, 2); }
      const a = this.laser.geometry.attributes.position;
      a.setXYZ(0, ray.origin.x, ray.origin.y, ray.origin.z);
      a.setXYZ(1, _p.x, _p.y, _p.z);
      a.needsUpdate = true;
      this.laser.visible = true;
    } else this.laser.visible = false;
    this.cursor.visible = hit;
    if (nav && this.items.length) this.focus = (this.focus + nav + this.items.length) % this.items.length;
    if (press && this.items.length) {
      const i = this.hover >= 0 ? this.hover : ray && hit ? -1 : this.focus;
      if (i >= 0) picked = this.items[i].id;
    }
    // Zeichnen nur bei Änderung (Unterzeile mit der Restzeit setzt engine/xr/index.js)
    const labels = this.items.map((it) => (typeof it.label === 'function' ? it.label() : it.label));
    const key = `${this.kind}|${this.title}|${this.sub}|${labels.join('|')}|${this.hover}|${this.focus}`;
    if (key !== this._key) { this._key = key; this._draw(labels); }
    return picked;
  }

  _draw(labels) {
    const c = this.ctx;
    if (!c) return;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(10, 12, 14, 0.9)';
    roundRect(c, 6, 6, W - 12, H - 12, 34);
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,0.2)';
    roundRect(c, 6, 6, W - 12, H - 12, 34);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = `700 64px ${FONT}`;
    c.textBaseline = 'alphabetic';
    c.fillText(this.title || 'Menü', 48, 84);
    c.font = `500 30px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillText(this.sub || '', 48, 128);
    labels.forEach((l, i) => {
      const y = HEAD_H + i * ITEM_H;
      const on = i === this.hover || (this.hover < 0 && i === this.focus);
      c.fillStyle = on ? 'rgba(255, 91, 31, 0.9)' : 'rgba(255,255,255,0.08)';
      roundRect(c, 40, y + 8, W - 80, ITEM_H - 16, 18);
      c.fill();
      c.fillStyle = '#ffffff';
      c.font = `600 42px ${FONT}`;
      c.fillText(l, 72, y + ITEM_H / 2 + 14);
    });
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.panel.geometry.dispose();
    this.panel.material.dispose();
    this.laser.geometry.dispose();
    this.laser.material.dispose();
    this.cursor.geometry.dispose();
    this.cursor.material.dispose();
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
