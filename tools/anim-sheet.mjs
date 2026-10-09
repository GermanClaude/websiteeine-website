// Animations-Kontaktbögen der Ego-Ansicht (Waffenlabor dev/weapons.html?view=bench): spielt je Waffe eine Aktion
// deterministisch ab (feste Schrittweite) und legt N Einzelbilder als Raster in tools/out/anim-<waffe>-<aktion>.png.
// Zusätzlich (--fps): Bildraten-Prüfung – dieselbe Aktion mit 30 und 144 Hz, größte Abweichung der Waffenlage.
//
// Aufruf (Server auf :8765):
//   node tools/anim-sheet.mjs --weapons=ar_m17,pi_p9 --acts=reload,reloadEmpty,inspect [--frames=12] [--size=640x360]
//        [--variants=0,1,2,3 | --variant=1] [--cols=6] [--pose=bodycam] [--fps] [--debug=90,10,0.8] [--focus=magWell|ejection|mag|gun]
//        [--from=0.2 --to=0.6]  (nur dieses Zeitfenster der Aktion, Anteil 0..1)
// --debug = Außenkamera (Gierwinkel°, Nickwinkel°, Abstand m) um die Waffe; mit --focus folgt sie dem Anker/Teil
// (Nahaufnahme z. B. des Magazinschachts). Je Bild wird geprüft, ob das Magazin im Schacht nur entlang der
// Einführachse läuft (anim/magwell.js): Abweichung quer/Drehung solange s < Freigang → Zeile „Schacht“ in der Ausgabe.
// Aktionen: siehe ACTS unten (reload, reloadEmpty, inspect, inspectEmpty, equip, ready, holster, melee, slash, grenade,
//           grenadeLow, sprint, jump, slide, crouch, prone, mantle, fidget, fire …). --variant(s) erzwingt Varianten (sonst die
//           des Viewmodels: Nachladen zufällig, Inspizieren im Durchlauf).
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = k => process.argv.includes(`--${k}`);
const weapons = arg('weapons', 'ar_m17').split(',');
const acts = arg('acts', 'reload').split(',');
const frames = +arg('frames', 12);
const cols = +arg('cols', 6);
const [W, H] = arg('size', '640x360').split('x').map(Number);
const variants = arg('variants', arg('variant', null));
const pose = arg('pose', 'standard');
const debug = arg('debug', null);
const scale = +arg('scale', 0.5);
const tag = arg('tag', '');
const focus = arg('focus', null);
const from = +arg('from', 0), to = +arg('to', 1);

// Aktion: start (JS im Seitenkontext, F = Prüfstand, V = Viewmodel, S = Simulation), dur (s, sonst Aktionsdauer),
// pre (Vorlauf vor dem Start in s), during (JS je Schritt, z. B. Bewegung halten)
const ACTS = {
  reload: { start: 'F.sim.mag = 9; V.playReload(false, VAR)' },
  reloadEmpty: { start: 'F.sim.mag = 0; V.update(0, { mag: 0 }); V.playReload(true, VAR)' },
  inspect: { start: 'V.playInspect(VAR)' },
  inspectEmpty: { start: 'F.sim.mag = 0; V.update(0, { mag: 0 }); V.playInspect(VAR)' },
  equip: { start: 'V._pending = { id: F.sim.id, def: null }; V._swapNow()', dur: 0.7 },
  ready: { start: 'V.playReady ? V.playReady(VAR) : 0', dur: 1.8 },
  holster: { start: 'V.setWeapon(F.sim.id === "pi_p9" ? "ar_m17" : "pi_p9")', dur: 1.2 },
  melee: { start: 'V.playMelee({ variant: VAR })' },
  slash: { start: 'V.playMelee({ variant: VAR })' },
  meleeStab: { start: 'V.playMelee({ backstab: true })' },
  grenade: { start: 'V.playGrenade("frag", { variant: VAR })' },
  grenadeLow: { start: 'S.crouch = true; V.playGrenade("frag", { variant: VAR })', pre: 0.6, preStart: 'S.crouch = true' },
  smoke: { start: 'V.playGrenade("smoke", { variant: VAR })' },
  sprint: { start: 'S.sprint = true; S.walk = true', dur: 1.6, pre: 0 },
  walk: { start: 'S.walk = true', dur: 1.6 },
  jump: { start: 'F.jump()', dur: 1.4 },
  crouch: { start: 'S.crouch = true', dur: 0.8 },
  stand: { start: 'S.crouch = false', dur: 0.8, preStart: 'S.crouch = true', pre: 0.8 },
  slide: { start: 'S.slide = true; S.crouch = true; S.walk = true', dur: 1.2 },
  prone: { start: 'S.prone = true', dur: 1.4 },
  mantle: { start: 'S.mantle = { t: 0, dur: 0.6, vault: VAR == 1 }', dur: 1.2 },
  fidget: { start: 'V.playFidget ? V.playFidget(VAR) : 0' },
  fire: { start: 'F.setFiring(true)', dur: 0.8 },
  bolt: { start: 'V.onShot(1, {}); if (V.action && VAR != null) V.action.variant = VAR', dur: 1.2 },
  idle: { start: '0', dur: 6 },
};

const browser = await chromium.launch({ args: GL_ARGS });
mkdirSync('tools/out', { recursive: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', e => logs.push('pageerror ' + e.message));
await page.goto(`${BASE}dev/weapons.html?view=bench&weapon=${weapons[0]}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bench && window.__bench.fp, null, { timeout: 120000 });
await page.addStyleTag({ content: 'aside,#controls,header,#info,#cross{display:none!important}' });

for (const weapon of weapons) {
  for (const act of acts) for (const variant of (variants == null ? [null] : variants.split(','))) {
    const A = ACTS[act];
    if (!A) { console.log('unbekannte Aktion', act); continue; }
    const res = await page.evaluate(async ({ weapon, A, frames, cols, variant, pose, debug, scale, fps, focus, from, to }) => {
      const { magWellOf } = await import('/assets/js/game/weapons/anim/magwell.js');
      const THREE = await import('three');
      const B = window.__bench, F = B.fp, V = F.vm, S = F.sim;
      B.pause(true);
      // Zustand zurücksetzen
      Object.assign(S, { ads: false, sprint: false, walk: false, crouch: false, slide: false, prone: false, mantle: null, firing: false, autoFire: false });
      V.cancelAction?.(); V.action = null;
      V.setPose?.(pose);
      F.equip(weapon);
      if (debug) { const [y, p, d] = debug.split(',').map(Number); F.debugView(y, p, d); } else F.debugView(null);
      const VAR = variant == null ? undefined : +variant;
      const run = (code) => { if (code) (new Function('F', 'V', 'S', 'B', 'VAR', code))(F, V, S, B, VAR); };
      // Prüfstand-Erweiterung: Rutschen/Liegen/Überklettern als Zustand an das Viewmodel (über G.player-Ersatz)
      const G = F.G;
      G.player = G.player || {};
      const hz = fps || 60;
      const stepN = (sec) => {
        if (!(sec > 1e-7)) return;
        const n = Math.max(1, Math.ceil(sec * hz - 1e-6)), h = sec / n;
        for (let i = 0; i < n; i++) {
          G.player.sliding = !!S.slide;
          G.player.proneBlend = Math.min(1, Math.max(0, (G.player.proneBlend || 0) + (S.prone ? 1 : -1) * h / 0.9));
          G.player.prone = !!S.prone;
          if (S.mantle) { S.mantle.t += h; G.player.mantling = S.mantle.t < S.mantle.dur; G.player.mantleProgress = Math.min(1, S.mantle.t / S.mantle.dur); G.player._mantle = G.player.mantling ? { vault: S.mantle.vault, height: 1 } : null; }
          else { G.player.mantling = false; G.player.mantleProgress = 0; G.player._mantle = null; }
          F.update(h);
        }
      };
      stepN(1.6);
      run(A.preStart);
      if (A.pre) stepN(A.pre);
      run(A.start);
      const dur = A.dur || (V.action ? Math.min(8, V.action.dur > 100 ? 4 : V.action.dur) + 0.15 : 1.5);
      const tw = Math.round(innerWidth * scale), th = Math.round(innerHeight * scale);
      // Nahaufnahme: Außenkamera folgt einem Anker/Teil
      const dbg = debug ? debug.split(',').map(Number) : null;
      const focusPos = (out) => {
        const ud = V.cur.ud;
        const o = focus === 'gun' ? V.gun : ud.anchors[focus] || ud.parts[focus] || (focus === 'ejection' ? ud.ejection : null) || ud.magazine;
        o.updateWorldMatrix(true, false);
        return o.getWorldPosition(out);
      };
      const _t = new THREE.Vector3();
      // Schachtprüfung: Magazin-Versatz gegenüber der Ruhelage, zerlegt in Achsweg s und Querabweichung
      const mw = magWellOf(V.cur);
      let worstLat = 0, worstRot = 0, worstAt = 0;
      const wellCheck = (t) => {
        const p = V.cur.ud.parts.mag, r = V.cur.rest.get('mag');
        if (!mw || !p || !r || !p.visible) return;
        const d = p.position.clone().sub(r.pos), s = d.dot(mw.axis);
        if (s > mw.clear - 0.001) return;
        const lat = d.addScaledVector(mw.axis, -s).length(), rot = 2 * Math.acos(Math.min(1, Math.abs(p.quaternion.dot(r.quat))));
        if (lat > worstLat || rot > worstRot) { worstLat = Math.max(worstLat, lat); worstRot = Math.max(worstRot, rot); worstAt = t; }
      };
      const rows = Math.ceil(frames / cols);
      const sheet = document.createElement('canvas');
      sheet.width = tw * cols; sheet.height = th * rows;
      const g = sheet.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
      const pts = [];
      let t = 0;
      const name = () => (V.action ? V.action.type + (V.action.variant != null ? '#' + V.action.variant : '') : '–');
      // Schachtprüfung über die ganze Aktion in feinen Schritten (unabhängig von den Bildern)
      for (let i = 0; i < frames; i++) {
        const target = dur * (from + (to - from) * i / Math.max(1, frames - 1));
        while (t < target - 1e-6) { const h = Math.min(1 / 120, target - t); stepN(h); t += h; wellCheck(t); }
        t = target;
        if (dbg && focus) { focusPos(_t); F.debugView(dbg[0], dbg[1], dbg[2], [_t.x, _t.y, _t.z]); }
        F.render();
        const cx = (i % cols) * tw, cy = Math.floor(i / cols) * th;
        g.drawImage(B.renderer.domElement, cx, cy, tw, th);
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(cx, cy, 150, 16);
        g.fillStyle = '#ffd34d'; g.font = '11px monospace';
        g.fillText(`${t.toFixed(2)}s ${name()}`, cx + 4, cy + 12);
        const gp = V.gun.position, gq = V.gun.quaternion;
        pts.push([gp.x, gp.y, gp.z, gq.x, gq.y, gq.z, gq.w]);
      }
      return { png: sheet.toDataURL('image/png').split(',')[1], dur, pts, well: mw ? { clear: mw.clear, lat: worstLat, rot: worstRot, at: worstAt } : null };
    }, { weapon, A, frames, cols, variant, pose, debug, scale, fps: 60, focus, from, to });
    const file = `tools/out/anim-${weapon}-${act}${variant != null ? '-v' + variant : ''}${pose !== 'standard' ? '-' + pose : ''}${debug ? '-dbg' : ''}${focus ? '-' + focus : ''}${tag}.png`;
    writeFileSync(file, Buffer.from(res.png, 'base64'));
    let fpsNote = '';
    if (flag('fps')) {
      // Gleiche Aktion bei 30 und 144 Hz: Waffenlage an denselben Zeitpunkten vergleichen
      const runAt = async (hz) => (await page.evaluate(async ({ weapon, A, frames, variant, pose, hz }) => {
        const B = window.__bench, F = B.fp, V = F.vm, S = F.sim;
        Object.assign(S, { ads: false, sprint: false, walk: false, crouch: false, slide: false, prone: false, mantle: null, firing: false, autoFire: false });
        V.cancelAction?.(); V.action = null; V.setPose?.(pose); F.equip(weapon);
        const VAR = variant == null ? undefined : +variant;
        const run = (code) => { if (code) (new Function('F', 'V', 'S', 'B', 'VAR', code))(F, V, S, B, VAR); };
        const G = F.G; G.player = G.player || {};
        let acc = 0;
        const stepN = (sec) => { acc += sec * hz; const n = Math.floor(acc + 1e-6); acc -= n; for (let i = 0; i < n; i++) { G.player.sliding = !!S.slide; F.update(1 / hz); } };
        stepN(1.6); run(A.preStart); if (A.pre) stepN(A.pre); run(A.start);
        const dur = A.dur || (V.action ? Math.min(8, V.action.dur > 100 ? 4 : V.action.dur) + 0.15 : 1.5);
        const pts = []; let t = 0;
        for (let i = 0; i < frames; i++) { const target = (dur * i) / Math.max(1, frames - 1); stepN(target - t); t = target; const gp = V.gun.position; pts.push([gp.x, gp.y, gp.z]); }
        return pts;
      }, { weapon, A, frames, variant, pose, hz }));
      const a = await runAt(30), b = await runAt(144);
      let dev = 0;
      for (let i = 0; i < a.length; i++) dev = Math.max(dev, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
      fpsNote = ` 30↔144Hz max ${(dev * 1000).toFixed(1)} mm`;
    }
    const wl = res.well ? ` Schacht: Freigang ${(res.well.clear * 1000).toFixed(0)} mm, quer max ${(res.well.lat * 1000).toFixed(2)} mm, Drehung ${(res.well.rot * 57.3).toFixed(2)}°${res.well.lat > 0.0005 || res.well.rot > 0.01 ? ` (bei ${res.well.at.toFixed(2)} s) FEHLER` : ' ok'}` : '';
    console.log(file, `${res.dur.toFixed(2)}s${fpsNote}${wl}`);
  }
}
console.log(logs.length ? logs.slice(0, 20).join('\n') : 'Konsole sauber');
await browser.close();
