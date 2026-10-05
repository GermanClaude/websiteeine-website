// NULLPUNKT — rotierende Minikarte (Canvas): Kartenbild aus world.minimap, Spieler fest in der Mitte mit Blick
// nach oben, Nordmarke am Rand, Mitspieler (Pfeile), Gegner beim Feuern bzw. per Aufklärer-Sweep, Flaggen
// (am Rand festgeklemmt), Wachgeschütze, Luftschlag-Zonen, Radar-Sweep bei eigenem Aufklärer,
// pulsierender roter Rand bei gegnerischem Aufklärer. Beschriftungen (N, Flaggen) als Schrift-Sprites (glyphs.js):
// fillText erzwänge je Bild eine Stilberechnung des Dokuments.

import { drawGlyph } from './glyphs.js';

const COL = {
  ally: '#38b6ff', enemy: '#ff3b3b', me: '#ffffff', gold: '#ffc23d', signal: '#ff5b1f', neutral: '#e9e6df',
  ring: 'rgba(233,230,223,.38)', bg: '#0d1013',
};
const FIRE_SHOW = 1.6; // s sichtbar nach unterdrücktem/lautem Schuss

export class Minimap {
  constructor(G, host) {
    this.G = G;
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'h-mm-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.size = 0;
    this.dpr = 1;
    this.range = 40; // m Radius
    this.world = null;
    this.mapImg = null;
    this._acc = 0;
    this._t = 0;
    this.font = '700 11px "Rajdhani NP", sans-serif';
  }

  setWorld(world) {
    this.world = world || null;
    this.mapImg = world && world.minimap && world.minimap.canvas ? world.minimap.canvas : null;
    this.resize();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const css = Math.round(Math.min(r.width, r.height)) || 160;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = css;
    const px = Math.max(16, Math.round(css * this.dpr));
    if (this.canvas.width !== px) { this.canvas.width = px; this.canvas.height = px; }
    this.font = `700 ${Math.round(11 * this.dpr)}px "Rajdhani NP", sans-serif`;
    this.range = css < 130 ? 36 : 42;
  }

  /** Zeichnet (gedrosselt auf ~30 Hz). */
  update(dt, force = false) {
    this._t += dt;
    this._acc += dt;
    if (!force && this._acc < 1 / 30) return;
    this._acc = 0;
    this.draw();
  }

  draw() {
    const G = this.G;
    const ctx = this.ctx;
    const W = this.canvas.width;
    if (!W) return;
    const p = G.player;
    const w = this.world;
    const mm = w && w.minimap;
    const half = W / 2;
    const rad = half - 2 * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    if (!p || !mm) return;
    const yaw = p.yaw || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const scale = rad / this.range; // px pro m
    const px = p.position.x;
    const pz = p.position.z;
    const toScreen = (x, z, out) => {
      const dx = (x - px) * scale;
      const dz = (z - pz) * scale;
      out.x = half + dx * cos - dz * sin;
      out.y = half + dx * sin + dz * cos;
      return out;
    };

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, rad, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, W);
    // Kartenbild
    if (this.mapImg) {
      const img = this.mapImg;
      const extent = mm.size ? mm.size.x : 100;
      const k = img.width / extent; // Kartenpixel pro m
      const uv = mm.worldToMap(px, pz);
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(yaw);
      ctx.scale(scale / k, scale / k);
      ctx.translate(-uv.u * img.width, -uv.v * img.height);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(this.mapImg, 0, 0);
      ctx.restore();
    }
    // Abdunklung zum Rand (Verlauf je Größe einmal erzeugt)
    if (!this._edge || this._edgeW !== W) {
      this._edgeW = W;
      this._edge = ctx.createRadialGradient(half, half, rad * 0.55, half, half, rad);
      this._edge.addColorStop(0, 'rgba(10,11,13,0)');
      this._edge.addColorStop(1, 'rgba(10,11,13,.55)');
    }
    ctx.fillStyle = this._edge;
    ctx.fillRect(0, 0, W, W);

    const mode = G.mode;
    const streaks = mode && mode.streaks;
    const now = G.time.elapsed;
    const pt = { x: 0, y: 0 };
    const d = this.dpr;

    // Luftschlag-Zonen
    if (streaks) {
      for (const s of streaks.strikes) {
        if (s.done) continue;
        toScreen(s.target.x, s.target.z, pt);
        const ally = p.team != null ? s.team === p.team : s.owner === p;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, s.params.radius * scale * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = ally ? 'rgba(255,91,31,.22)' : 'rgba(255,59,59,.28)';
        ctx.fill();
        ctx.strokeStyle = ally ? COL.signal : COL.enemy;
        ctx.lineWidth = 1.5 * d;
        ctx.stroke();
      }
    }

    // Radar-Sweep des eigenen Aufklärers
    const uav = streaks ? streaks.uavInfo(p) : null;
    if (uav && uav.own) {
      const e = uav.own;
      const phase = ((now - e.sweepAt) / e.interval) % 1;
      const ang = phase * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(ang);
      const g2 = ctx.createLinearGradient(0, 0, rad, 0);
      g2.addColorStop(0, 'rgba(56,182,255,0)');
      g2.addColorStop(1, 'rgba(56,182,255,.35)');
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, rad, -0.5, 0);
      ctx.closePath();
      ctx.fillStyle = g2;
      ctx.fill();
      ctx.restore();
    }

    // Wachgeschütze
    if (streaks) {
      for (const s of streaks.entities) {
        if (!s.alive) continue;
        toScreen(s.position.x, s.position.z, pt);
        const ally = s.owner === p || (p.team != null && s.team === p.team && mode.teams);
        const r = 4 * d;
        ctx.fillStyle = ally ? COL.ally : COL.enemy;
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.lineWidth = d;
        ctx.beginPath();
        ctx.rect(pt.x - r, pt.y - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Akteure
    const blips = uav && uav.own ? uav.own.blips : null;
    const blipAge = uav && uav.own ? now - uav.own.sweepAt : 0;
    for (const a of G.actors) {
      if (a === p || !a.alive) continue;
      const hostile = G.combat ? G.combat.isHostile(p, a) : a.team !== p.team;
      if (!hostile) {
        toScreen(a.position.x, a.position.z, pt);
        arrow(ctx, pt.x, pt.y, yaw - (a.yaw || 0), 5.2 * d, COL.ally);
        continue;
      }
      const fired = now - (a.lastFiredTime ?? -1e9) < FIRE_SHOW && !a._suppressedShot;
      if (fired) {
        toScreen(a.position.x, a.position.z, pt);
        dot(ctx, pt.x, pt.y, 4.2 * d, COL.enemy, 1 - (now - a.lastFiredTime) / FIRE_SHOW * 0.5);
      }
    }
    if (blips) {
      const alpha = Math.max(0.25, 1 - blipAge / (uav.own.interval * 1.4));
      for (const b of blips) {
        if (b.actor && b.actor.alive === false) continue;
        toScreen(b.x, b.z, pt);
        if (b.entity) continue;
        dot(ctx, pt.x, pt.y, 4.2 * d, COL.enemy, alpha);
      }
    }
    ctx.restore();

    // Flaggen (am Rand festgeklemmt)
    if (mode && mode.objectives && mode.objectives.length) {
      for (const f of mode.objectives) {
        toScreen(f.position.x, f.position.z, pt);
        let x = pt.x - half;
        let y = pt.y - half;
        const len = Math.hypot(x, y);
        const lim = rad - 9 * d;
        if (len > lim) { x = (x / len) * lim; y = (y / len) * lim; }
        flag(ctx, half + x, half + y, f, p.team, d, this.font);
      }
    }

    // Spieler
    arrow(ctx, half, half, 0, 6.5 * d, COL.me, true);

    // Rand + Nordmarke
    ctx.beginPath();
    ctx.arc(half, half, rad, 0, Math.PI * 2);
    ctx.lineWidth = 1.5 * d;
    ctx.strokeStyle = COL.ring;
    ctx.stroke();
    if (uav && uav.enemy) {
      const a = 0.45 + 0.35 * Math.sin(this._t * 6);
      ctx.lineWidth = 3 * d;
      ctx.strokeStyle = `rgba(255,59,59,${a.toFixed(3)})`;
      ctx.stroke();
    }
    const nx = half + Math.sin(yaw) * (rad - 9 * d);
    const ny = half - Math.cos(yaw) * (rad - 9 * d);
    ctx.fillStyle = 'rgba(10,11,13,.85)';
    ctx.beginPath();
    ctx.arc(nx, ny, 7 * d, 0, Math.PI * 2);
    ctx.fill();
    drawGlyph(ctx, 'N', this.font, COL.signal, nx, ny + 0.5 * d);
  }
}

function dot(ctx, x, y, r, color, alpha = 1) {
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = r * 0.35;
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function arrow(ctx, x, y, rot, s, color, outline = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.72, s * 0.8);
  ctx.lineTo(0, s * 0.38);
  ctx.lineTo(-s * 0.72, s * 0.8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = outline ? s * 0.28 : s * 0.22;
  ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.stroke();
  ctx.restore();
}

function flag(ctx, x, y, f, myTeam, d, font) {
  const r = 8.5 * d;
  const col = f.owner == null ? COL.neutral : f.owner === myTeam ? COL.ally : COL.enemy;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,11,13,.82)';
  ctx.fill();
  ctx.lineWidth = 2 * d;
  ctx.strokeStyle = col;
  ctx.stroke();
  if (f.capturingTeam && f.progress > 0 && f.progress < 1) {
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f.progress);
    ctx.strokeStyle = f.capturingTeam === myTeam ? COL.ally : COL.enemy;
    ctx.lineWidth = 3 * d;
    ctx.stroke();
  }
  drawGlyph(ctx, String(f.id), font, f.contested ? COL.gold : col, x, y + 0.5 * d);
}
