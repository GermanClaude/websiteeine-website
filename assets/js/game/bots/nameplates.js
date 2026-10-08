// NULLPUNKT — Namensschilder über Soldaten (Canvas-Sprites, konstante Bildschirmgröße).
// Verbündete: immer sichtbar (blau, Raute, auch durch Wände); Gegner: nur unter dem Fadenkreuz oder
// sehr nah, jeweils nur bei freier Sicht auf den Kopf (rot). Ein Draw Call pro sichtbarem Schild.
// Spielstil: G.match.styleFlags.nameplates ('alle' | 'team' | 'aus') wertet der BotManager je Bild aus –
// „Realistisch“ ('team') zeigt nur Mitspieler-Schilder, nie Gegner (auch nicht in FFA).
// Alle Schilder werden ohne Tiefentest gezeichnet: Verdeckung entscheidet der BotManager einmal je Schild
// (gedrosselter Sichtstrahl Kamera → Kopf) und blendet das ganze Schild ein/aus – eine Wandkante schneidet
// den Namen nie pixelweise an.
// Schilder werden über Matches hinweg wiederverwendet (Nameplate.acquire/release): Material, Textur und
// Canvas bleiben bestehen, damit eine Revanche weder das Sprite-Shaderprogramm neu linken noch Texturen
// neu anlegen muss. Nur Name/Art/Deckkraft sind je Match.
import * as THREE from 'three';

const COLORS = { ally: '#38b6ff', enemy: '#ff3b3b', ffa: '#ff3b3b' };
const POOL_MAX = 40; // mehr freie Schilder werden wirklich entsorgt (online bis 32 Spieler; Großkarte mit mehr Bots legt den Rest neu an)
const pool = [];

let fontState = 0; // 0 = nicht angefordert, 1 = lädt, 2 = fertig (oder nicht verfügbar)
const waiting = new Set(); // Schilder, die nach dem Laden der Schrift neu gezeichnet werden

function ensureFont() {
  if (fontState) return;
  if (typeof document === 'undefined' || !document.fonts) { fontState = 2; return; }
  fontState = 1;
  const done = () => {
    fontState = 2;
    for (const p of waiting) p._draw();
    waiting.clear();
  };
  document.fonts.load('700 40px "Rajdhani NP"').then(done, done);
}

export class Nameplate {
  /** Schild aus dem Vorrat (oder neu). */
  static acquire(name, kind = 'enemy') {
    const p = pool.pop();
    if (!p) return new Nameplate(name, kind);
    p._init(name, kind);
    return p;
  }

  constructor(name, kind = 'enemy') {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 80;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.SpriteMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0, fog: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = 'namensschild';
    this.sprite.renderOrder = 20;
    this.sprite.center.set(0.5, 0);
    this._init(name, kind);
  }

  /** Je-Match-Zustand setzen und Schild zeichnen. */
  _init(name, kind) {
    this.name = name;
    this.kind = kind;
    this.material.opacity = 0;
    this.sprite.visible = false;
    this.alpha = 0;
    this._target = 0;
    ensureFont();
    if (fontState === 1) waiting.add(this);
    this._draw();
  }

  setKind(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
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
   * Position (Welt, über dem Kopf), Kamera, Bildhöhe in px, Ziel-Deckkraft, dt,
   * Ausblendrate in 1/s (Standard 6 = sanft; verdeckt oder tot schneller, damit das Schild nicht über der Wand stehen bleibt),
   * sizeMul: Größenfaktor (BotManager gleicht damit den örtlichen Maßstab des Bodycam-Objektivs aus → am Bildrand
   * gleich groß wie in der Mitte).
   */
  update(pos, camera, viewH, targetAlpha, dt, fadeOut = 6, sizeMul = 1) {
    const k = 1 - Math.exp(-(targetAlpha > this.alpha ? 14 : fadeOut) * dt);
    this.alpha += (targetAlpha - this.alpha) * k;
    if (this.alpha < 0.02) { this.sprite.visible = false; return; }
    this.sprite.visible = true;
    this.sprite.position.copy(pos);
    this.material.opacity = this.alpha;
    // konstante Bildschirmgröße: 26 px Schrifthöhe
    const fov = camera && camera.isPerspectiveCamera ? camera.fov : 60;
    const px = viewH < 500 ? 24 : 32;
    const h = (px / Math.max(200, viewH)) * 2 * Math.tan((fov * Math.PI) / 360) * (sizeMul > 0 && sizeMul < 4 ? sizeMul : 1);
    this.sprite.scale.set(h * (256 / 80), h, 1);
  }

  /** Aus der Szene nehmen und für das nächste Match aufheben (GPU-Ressourcen bleiben bestehen). */
  release() {
    waiting.delete(this);
    this.sprite.removeFromParent();
    this.sprite.visible = false;
    this.alpha = 0;
    this.material.opacity = 0;
    if (pool.length < POOL_MAX && !pool.includes(this)) pool.push(this);
    else this.dispose();
  }

  /** Endgültig entsorgen (Material + Textur). */
  dispose() {
    waiting.delete(this);
    this.sprite.removeFromParent();
    this.material.dispose();
    this.texture.dispose();
    const i = pool.indexOf(this);
    if (i >= 0) pool.splice(i, 1);
  }
}

/** Alle aufgehobenen Schilder endgültig entsorgen (z. B. beim Verlassen des Spiels). */
export function disposeNameplatePool() {
  while (pool.length) pool.pop().dispose();
}
