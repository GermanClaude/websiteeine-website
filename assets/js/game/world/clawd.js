// NULLPUNKT — Geheimnis „Clawd“ (Nutzer 12.10.): kleines Maskottchen von Claude Code als Easter Egg. Klötzchenfigur
// (Körper, Ärmchen, vier Beinchen, Augen „> <“), wenige Dreiecke, ohne Kollision und ohne Zufall aus dem Kartengenerator
// (Kollisions-Hash bleibt gleich). Atmet, schaut sich um, dreht sich zum Spieler; beim Fund hüpft und winkt es.
// Fund: aus der Nähe (≤ 1,3 m) oder aus ≤ 3,5 m angesehen, auf derselben Ebene → ctx.secretFound (secret:found).
// Die Figur gehört Anthropic; im Spiel steht sie nur als kleine Hommage (siehe LICENSE, Ausnahmen).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ORANGE = '#d97757', EYE = '#1a1412';

function part(w, h, d, x, y, z, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * Setzt Clawd auf (x, y, z) (y = Standfläche), Blick nach lokal +z, gedreht um ry.
 * o = { id, name, size (Körperbreite, Standard 0,2 m) }
 */
export function clawd(b, ctx, x, y, z, ry = 0, o = {}) {
  const W = o.size || 0.2, H = W * 0.74, D = W * 0.56, LEG = W * 0.2;
  const mat = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.62, metalness: 0, emissive: '#3a1408', emissiveIntensity: 0.35 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.5, metalness: 0 });
  for (const m of [mat, eyeMat]) m.userData.disposable = true;

  // Körper + vier Beinchen in einer Reihe (wie das Pixelbild)
  const body = [part(W, H, D, 0, LEG + H / 2, 0)];
  for (const lx of [-0.39, -0.17, 0.17, 0.39]) body.push(part(W * 0.11, LEG + 0.004, D * 0.5, lx * W, LEG / 2, 0));
  // Augen „>“ (links) und „<“ (rechts): je zwei Balken, die sich zur Mitte hin treffen
  const eyes = [], L = W * 0.2, T = W * 0.065, a = 0.55, ey = LEG + H * 0.6, ez = D / 2 + 0.002;
  for (const s of [-1, 1]) {
    const tipX = s * W * 0.14, cx = tipX + s * (L / 2) * Math.cos(a);
    eyes.push(part(L, T, 0.006, cx, ey + (L / 2) * Math.sin(a), ez, s * a));
    eyes.push(part(L, T, 0.006, cx, ey - (L / 2) * Math.sin(a), ez, -s * a));
  }
  const root = new THREE.Group(), fig = new THREE.Group();
  root.name = 'clawd';
  root.position.set(x, y, z);
  root.rotation.y = ry;
  const bodyMesh = new THREE.Mesh(mergeGeometries(body), mat);
  const eyeMesh = new THREE.Mesh(mergeGeometries(eyes), eyeMat);
  for (const g of [...body, ...eyes]) g.dispose();
  fig.add(bodyMesh, eyeMesh);
  // Ärmchen seitlich, mit Drehpunkt am Körper (winken beim Fund)
  const armGeo = part(W * 0.13, H * 0.26, D * 0.5, 0, 0, 0);
  const arms = [-1, 1].map((s) => {
    const p = new THREE.Group();
    p.position.set(s * W / 2, LEG + H * 0.52, 0);
    const m = new THREE.Mesh(armGeo, mat);
    m.position.x = s * W * 0.065;
    p.add(m);
    fig.add(p);
    return p;
  });
  for (const m of [bodyMesh, eyeMesh, ...arms.map((p) => p.children[0])]) { m.castShadow = true; m.receiveShadow = true; }
  root.add(fig);

  const secret = { id: o.id || 'clawd', name: o.name || 'Clawd' };
  const cam = new THREE.Vector3(), fwd = new THREE.Vector3(), to = new THREE.Vector3(), centre = new THREE.Vector3(x, y + LEG + H / 2, z);
  let t = 0, found = false, happy = 0, cool = 0, look = 0, lookAt = 0, lookT = 3;

  b.object(root, {
    update(dt, camera) {
      if (!camera) return;
      dt = Math.min(dt || 0.016, 0.1);
      camera.getWorldPosition(cam);
      const dist = cam.distanceTo(centre);
      if (dist > 30) return;
      t += dt;
      cool = Math.max(0, cool - dt);
      // gleiche Ebene (nicht durch Decke/Boden), Spieler lebt
      const pl = ctx.player?.();
      const level = cam.y > y - 0.5 && cam.y < y + 1.8 && pl && pl.alive !== false;
      let seen = false;
      if (level && dist < 3.5) {
        camera.getWorldDirection(fwd);
        to.copy(centre).sub(cam).normalize();
        seen = dist < 1.3 || fwd.dot(to) > 0.95;
      }
      if (seen && cool <= 0) {
        happy = 1.6; cool = 8;
        if (!found) { found = true; ctx.secretFound?.(secret); }
      }
      // Blick: zum Spieler, wenn nah, sonst gelegentlich umschauen
      if (level && dist < 4) {
        const yaw = Math.atan2(cam.x - x, cam.z - z) - ry;
        lookAt = Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(yaw), Math.cos(yaw))));
      } else if ((lookT -= dt) <= 0) {
        lookT = 3 + ((t * 7.31) % 4);
        lookAt = lookAt ? 0 : (((t * 13.7) % 1) - 0.5) * 0.8;
      }
      look += (lookAt - look) * Math.min(1, dt * 4);
      fig.rotation.y = look;
      // Atmen, beim Fund drei Hüpfer und Winken
      const breath = 1 + Math.sin(t * 2.2) * 0.018;
      fig.scale.set(1 / Math.sqrt(breath), breath, 1);
      if (happy > 0) {
        happy = Math.max(0, happy - dt);
        const p = (1.6 - happy) / 1.6;
        fig.position.y = Math.abs(Math.sin(p * Math.PI * 3)) * W * 0.28 * (1 - p * 0.4);
        arms[0].rotation.z = -0.25 - Math.abs(Math.sin(t * 14)) * 0.9;
        arms[1].rotation.z = 0.25 + Math.abs(Math.sin(t * 14 + 1)) * 0.9;
      } else {
        fig.position.y = 0;
        arms[0].rotation.z += (Math.sin(t * 1.3) * 0.06 - arms[0].rotation.z) * Math.min(1, dt * 6);
        arms[1].rotation.z += (-Math.sin(t * 1.3) * 0.06 - arms[1].rotation.z) * Math.min(1, dt * 6);
      }
    },
  });
  return root;
}
