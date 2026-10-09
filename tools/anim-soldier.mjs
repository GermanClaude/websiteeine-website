// NULLPUNKT — Aufnahme-Prüfstand für die Soldaten-Animation (Bots + Mehrspieler-Puppen, dev/bots.html Galerie).
// Spielt jede gewünschte Animation mit fester Schrittweite ab (Zeit eingefroren, Schritte über window.__bots.step) und
// legt je Animation × Waffe einen Kontaktabzug (Bildfolge mit Zeitstempeln) nach tools/out/anim-<anim>-<waffe>.png.
// Optional: Leistungsmessung (ms je Bild für 20 Soldaten, Animator + Skelett schreiben) mit --bench.
//
// Voraussetzung: Server auf 8765 (npx http-server -p 8765 -s -c-1 .).
// Aufruf: node tools/anim-soldier.mjs [--anims=reload,reloadEmpty,...] [--weapons=ar_m17,pi_p9,...] [--frames=12]
//           [--cols=6] [--dt=0.0167] [--size=420] [--variant=sturm] [--cam=close|side|front|left|back|top|<yaw,dist,y,pitch>]
//           [--dur=Sekunden] [--from=Sekunden] [--bench] [--benchOnly] [--seed=1] [--tag=vorher]
//   --dt     Schrittweite (1/30 oder 1/144 → Bildraten-Unabhängigkeit prüfen)
//   --tag    Zusatz im Dateinamen (z. B. vorher/nachher)
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const SIZE = Number(opt.size || 420);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rechner teilen sich mehrere Prüfläufe: bei hoher Last warten (höchstens 10 min)
async function waitForLoad() {
  for (let i = 0; i < 20; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 5)) return;
    console.log(`     Last ${l1} > 5 – warte 30 s`);
    await sleep(30000);
  }
}

// Standard-Folgen: [Animation, Kamera, Dauer (s; 'reload' = aus der Waffe), Startzeit]
const DEFAULT_ANIMS = ['reload', 'reloadEmpty', 'idle', 'throw', 'melee', 'crouchwalk', 'prone'];
const CAM = { close: [-0.45, 2.3, 1.15, 0.08], upper: [-0.55, 1.45, 1.3, 0.1], upperL: [0.6, 1.45, 1.3, 0.1], front: [0, 2.6, 1.05, 0.06], side: [-Math.PI / 2, 3.0, 0.95, 0.05], left: [Math.PI / 2, 2.6, 1.1, 0.06], back: [Math.PI + 0.5, 2.6, 1.1, 0.12], top: [-0.6, 3.0, 1.0, 0.85], low: [-0.9, 3.2, 0.45, 0.03], wide: [-0.7, 4.6, 0.9, 0.12] };

const anims = String(opt.anims || DEFAULT_ANIMS.join(',')).split(',').filter(Boolean);
const weapons = String(opt.weapons || 'ar_m17').split(',').filter(Boolean);
const frames = Number(opt.frames || 12);
const cols = Number(opt.cols || 6);
const dt = Number(opt.dt || 1 / 60);

await waitForLoad();
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = await browser.newContext({ viewport: { width: 640, height: 640 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const qs = new URLSearchParams({ view: 'gallery', variants: String(opt.variant || 'sturm'), weapon: weapons[0], anim: 'idle', t: '0', quality: 'high', lod: '0', mat: 'proc' });
await page.goto(`${BASE}dev/bots.html?${qs}`);
await page.waitForFunction(() => window.__bots && window.__bots.gal && window.__bots.gal.soldiers.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(800);
if (opt.seed) await page.evaluate((seed) => { let s = seed >>> 0; Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }, Number(opt.seed));

if (!opt.benchOnly) for (const wid of weapons) {
  for (const anim of anims) {
    await waitForLoad();
    const res = await page.evaluate(async ({ wid, anim, frames, cols, dt, SIZE, cam, CAM, dur, from }) => {
      const B = window.__bots;
      const { WEAPONS } = await import('../assets/js/shared/weapons.data.js');
      const { createWeaponModel } = await import('../assets/js/game/weapons/models.js');
      const THREE = await import('three');
      const def = WEAPONS[wid] || WEAPONS.ar_m17;
      const gal = B.gal;
      gal.anim = anim;
      gal.t = 0;
      for (const s of gal.soldiers) { s.setWeaponModel(createWeaponModel(def.model, { lod: 'third' }), def); s.reset(s.home, 0); }
      // Kamera
      const c = Array.isArray(cam) ? cam : (CAM[cam] || CAM.close);
      const s0 = gal.soldiers[0];
      const o = B.orbit;
      o.target.set(s0.home.x, c[2], 0); o.dist = c[1]; o.yaw = Math.PI + c[0]; o.pitch = c[3];
      const cp = Math.cos(o.pitch);
      const camera = B.camera;
      camera.position.set(o.target.x + Math.sin(o.yaw) * cp * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * cp * o.dist);
      camera.lookAt(o.target);
      camera.updateMatrixWorld();
      // Dauer je Animation
      let D = dur;
      if (!D) {
        if (anim === 'reload') D = def.perShellReload ? 3.2 : (def.reloadTime || 2) + 0.5;
        else if (anim === 'reloadEmpty') D = def.perShellReload ? 4.2 : (def.reloadEmptyTime || 2.6) + 0.5;
        else if (anim === 'throw') D = 1.6;
        else if (anim === 'melee') D = 1.2;
        else if (anim === 'death') D = 4.0;
        else D = 3;
      }
      const t0 = from || 0;
      const rows = Math.ceil(frames / cols);
      const fw = SIZE, fh = SIZE;
      const sheet = document.createElement('canvas');
      sheet.width = cols * fw; sheet.height = rows * fh + 28;
      const g = sheet.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '15px monospace'; g.fillStyle = '#ddd';
      g.fillText(`${anim} · ${def.name} (${def.cls}) · dt ${dt.toFixed(4)} · ${D.toFixed(2)} s`, 8, 19);
      const canvas = B.renderer.domElement;
      let t = 0;
      const step = (to) => { while (t + 1e-9 < to) { const h = Math.min(dt, to - t); B.step(h); t += h; } };
      const notes = [];
      for (let k = 0; k < frames; k++) {
        const at = t0 + (frames === 1 ? 0 : (D * k) / (frames - 1));
        step(at);
        B.renderer.render(gal.scene, camera);
        const x = (k % cols) * fw, y = Math.floor(k / cols) * fh + 28;
        // quadratischer Ausschnitt
        const side = Math.min(canvas.width, canvas.height);
        g.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, x, y, fw, fh);
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y, 150, 20);
        g.fillStyle = '#fff'; g.fillText(`t=${at.toFixed(2)}`, x + 4, y + 15);
        const a = s0.anim;
        // Prüfwerte je Bild: tiefster Punkt aller Gelenke (Boden durchdrungen?), Abstand Hand ↔ Griff
        let minY = Infinity;
        for (let i = 0; i < a.wp.length; i++) minY = Math.min(minY, a.wp[i].y);
        notes.push({ t: +at.toFixed(2), minY: +minY.toFixed(3), state: s0.state });
      }
      void THREE;
      return { url: sheet.toDataURL('image/png'), notes };
    }, { wid, anim, frames, cols, dt, SIZE, cam: opt.cam ? (String(opt.cam).includes(',') ? String(opt.cam).split(',').map(Number) : String(opt.cam)) : (/^(crouchwalk|walk|run|sprint|air|prone|proneIdle|crawl|jump|vault|start|stop)$/.test(anim) ? 'side' : anim === 'death' ? 'wide' : /^(reload|reloadEmpty|throw|melee)/.test(anim) ? 'upper' : 'close'), CAM, dur: opt.dur ? Number(opt.dur) : 0, from: opt.from ? Number(opt.from) : 0 });
    const file = `${OUT}/anim-${anim}-${wid}${opt.tag ? '-' + opt.tag : ''}.png`;
    writeFileSync(file, Buffer.from(res.url.split(',')[1], 'base64'));
    const low = Math.min(...res.notes.map((n) => n.minY));
    console.log(`Bild: ${file}  (tiefstes Gelenk ${low.toFixed(3)} m)`);
  }
}

if (opt.bench || opt.benchOnly) {
  await waitForLoad();
  const r = await page.evaluate(async () => {
    const { createSoldier } = await import('../assets/js/game/bots/character.js');
    const { WEAPONS } = await import('../assets/js/shared/weapons.data.js');
    const { createWeaponModel } = await import('../assets/js/game/weapons/models.js');
    const THREE = await import('three');
    const ids = ['ar_m17', 'pi_p9', 'sg_bulldog', 'lmg_hm60', 'smg_vp9'];
    const list = [];
    for (let i = 0; i < 20; i++) {
      const s = createSoldier({ team: 'A', variant: i, quality: 'low', models: { createWeaponModel } });
      const def = WEAPONS[ids[i % ids.length]];
      s.setWeaponModel(createWeaponModel(def.model, { lod: 'third' }), def);
      s.reset(new THREE.Vector3(i, 0, 0), 0);
      list.push(s);
    }
    const P = (i, t) => {
      const k = i % 5;
      const v = new THREE.Vector3(k === 0 ? 0 : Math.sin(t + i) * 4, 0, k === 0 ? 0 : -Math.cos(t * 0.7 + i) * 4);
      const def = list[i].def;
      const rl = (t + i * 0.37) % 4;
      return { velocity: v, aimYaw: Math.sin(t * 0.3 + i), aimPitch: 0.1, crouch: k === 3, sprint: k === 2, ads: k === 1 ? 1 : 0, onGround: true,
        reloading: k === 4 && rl < 2, reloadProgress: rl / 2, perShell: !!def.perShellReload, idleLook: k === 0, position: list[i].home || new THREE.Vector3(i, 0, 0), firing: k === 1 && (t * 10 | 0) % 2 === 0 };
    };
    const runs = [];
    let t = 0;
    for (let w = 0; w < 120; w++) { t += 1 / 60; for (let i = 0; i < 20; i++) list[i].animate(1 / 60, P(i, t)); }
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let f = 0; f < 300; f++) { t += 1 / 60; for (let i = 0; i < 20; i++) list[i].animate(1 / 60, P(i, t)); }
      runs.push((performance.now() - t0) / 300);
    }
    runs.sort((a, b) => a - b);
    for (const s of list) s.dispose();
    return { min: runs[0], median: runs[3], runs };
  });
  console.log(`Leistung: 20 Soldaten animieren = ${r.min.toFixed(3)} ms/Bild (min), ${r.median.toFixed(3)} ms (Median) – ${r.runs.map((x) => x.toFixed(3)).join(' ')}`);
}

await browser.close();
const uniq = [...new Set(errors)];
console.log(uniq.length ? `Konsolenfehler: ${uniq.slice(0, 6).join(' | ')}` : 'keine Konsolenfehler');
