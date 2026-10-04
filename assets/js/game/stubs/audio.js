// NULLPUNKT — Stub für engine/audio.js (§7): stumme AudioEngine mit vollständiger API.

export class AudioEngine {
  constructor(G) {
    this.G = G;
    this.unlocked = false;
    this.volumes = { master: 0.8, sfx: 1, music: 0.5, ui: 0.7 };
    this.ambience = null;
  }
  unlock() { this.unlocked = true; }
  attach(G) { this.G = G; }
  detach() {}
  play() { return null; }
  ui() { return null; }
  startAmbience(id) { this.ambience = id || null; }
  stopAmbience() { this.ambience = null; }
  update() {}
  setVolumes(v = {}) { Object.assign(this.volumes, v); }
}
