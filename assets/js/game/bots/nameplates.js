// NULLPUNKT — Namensschilder über Soldaten (Canvas-Sprites, konstante Bildschirmgröße).
// Verbündete: immer sichtbar (blau, Raute, auch durch Wände); Gegner: nur unter dem Fadenkreuz oder
// sehr nah mit freier Sicht (rot). Ein Draw Call pro sichtbarem Schild.
import * as THREE from 'three';

const COLORS = { ally: '#38b6ff', enemy: '#ff3b3b', ffa: '#ff3b3b' };
let fontReady = false;
const waiting = new Set();

function ensureFont() {
  if (fontReady || typeof document === 'undefined' || !document.fonts) return;
  fontReady = true;
  document.fonts.load('700 40px "Rajdhani NP"').then(() => {
    for (const p of waiting) p._draw();
    waiting.clear();
  }).catch(() => {});
}

export class Nameplate {
  constructor(name, kind = 'enemy') {
    this.name = name;
    this.kind = kind;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 80;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.SpriteMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: kind !== 'ally', sizeAttenuation: false, opacity: 0, fog: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = 'namensschild';
    this.sprite.renderOrder = 20;
    this.sprite.center.set(0.5, 0);
    this.sprite.visible = false;
    this.alpha = 0;
    ensureFont();
    waiting.add(this);
    this._draw();
  }

  setKind(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.material.depthTest = kind !== 'ally';
    this.material.needsUpdate = true;
    this._draw();
  }

  setName(name) {
    if (name === this.name) return;
    this.name = name;
    this._draw();
  }

  _draw() {
    const c = this.canvas, ctx = c.getContext('2d');
    const col = COLORS[this.kind] || COLORS.enemy;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = '700 38px "Rajdhani NP", "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const y = 52;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const label = this.name.length > 16 ? this.name.slice(0, 15) + '…' : this.name;
    ctx.strokeText(label, 128, y);
    ctx.fillStyle = col;
    ctx.fillText(label, 128, y);
    // Markierung: Raute (Verbündete) bzw. Pfeil (Gegner)
    ctx.beginPath();
    if (this.kind === 'ally') {
      ctx.moveTo(128, 60); ctx.lineTo(137, 69); ctx.lineTo(128, 78); ctx.lineTo(119, 69); ctx.closePath();
    } else {
      ctx.moveTo(118, 62); ctx.lineTo(138, 62); ctx.lineTo(128, 76); ctx.closePath();
    }
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fill();
    this.texture.needsUpdate = true;
  }

  /**
   * Position (Welt, über dem Kopf), Kamera, Bildhöhe in px, Ziel-Deckkraft, dt.
   */
  update(pos, camera, viewH, targetAlpha, dt) {
    const k = 1 - Math.exp(-(targetAlpha > this.alpha ? 14 : 6) * dt);
    this.alpha += (targetAlpha - this.alpha) * k;
    if (this.alpha < 0.02) { this.sprite.visible = false; return; }
    this.sprite.visible = true;
    this.sprite.position.copy(pos);
    this.material.opacity = this.alpha;
    // konstante Bildschirmgröße: 26 px Schrifthöhe
    const fov = camera && camera.isPerspectiveCamera ? camera.fov : 60;
    const px = viewH < 500 ? 30 : 34;
    const h = (px / Math.max(200, viewH)) * 2 * Math.tan((fov * Math.PI) / 360);
    this.sprite.scale.set(h * (256 / 80), h, 1);
  }

  dispose() {
    waiting.delete(this);
    this.sprite.removeFromParent();
    this.material.dispose();
    this.texture.dispose();
  }
}
