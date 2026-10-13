// Aufsätze am Modell (shared/attachments.data.js): nach dem Bau der Werkswaffe (vor b.build) ergänzt –
// Mündungsgerät an Waffen ohne Mündungshelfer, Optik auf Erhöhung bei Kimme-und-Korn-Waffen, Vordergriff/Winkelgriff/
// Zweibein/Handstopp unter dem Handschutz (Vordergriff: linke Hand greift ihn, Griffart 'post'), Laser-Modul;
// nach dem Bau: Magazin länger bzw. Trommel. Optik- und Mündungstausch der Werksteile: parts.js (swapOptic/muzzleDevice).
import * as THREE from 'three';
import { muzzleDevice, mountOptic } from './parts.js';
import { getMat } from './materials.js';

const R_BY_KIND = { pistol: 0.0105, smg: 0.0115, rifle: 0.0115, lmg: 0.0135, sniper: 0.016, shotgun: 0.0145 };

export function attachToBuilder(b, att, mount) {
  if (!att) return;
  const A = (n) => b.anchors.find((a) => a.name === n);
  const mz = A('muzzle'), lh = A('leftHandGrip');
  // Laufende (vor einem neuen Mündungsgerät) für Laser/Zweibein
  const muzzleU = b._barrelEnd ?? (mz ? -mz.pos.z : 0.4);
  // Optik bei Waffen ohne Werksoptik
  if (att.optik && !b._opticDone && mount) mountOptic(b, att.optik, mount);
  // Mündung bei Waffen ohne Mündungshelfer: Gerät an der Mündung, Anker nach vorn
  if (att.muendung && !b._muzzleDone && mz && b._barrelEnd === undefined) {
    const kind = (b.meta && b.meta.kind) || 'rifle';
    const end = muzzleDevice(b, att.muendung, -mz.pos.z - 0.004, mz.pos.y, R_BY_KIND[kind] || 0.0115);
    mz.pos.z = -(end + 0.002);
  }
  const style = lh && lh.data && lh.data.style;
  const under = lh && (style === 'under' || style === 'flat');
  const vb = under ? lh.pos.y : 0, uL = under ? -lh.pos.z : 0, x0 = under ? lh.pos.x : 0;
  const hw = under ? (lh.data.w ?? lh.data.r ?? 0.024) : 0.024;
  if (under && att.unterlauf === 'griff') {
    const uG = uL + 0.02;
    b.box('polymer', 0.022, 0.012, 0.05, x0, vb - 0.005, uG, { c: 0.002 });
    b.cyl('polymer', 0.0145, 0.0158, 0.078, x0, vb - 0.048, uG, { axis: 'v', seg: b.seg(14, 6) });
    b.cyl('rubber', 0.0165, 0.0165, 0.007, x0, vb - 0.089, uG, { axis: 'v', seg: b.seg(14, 6) });
    if (b.hi) for (let i = 0; i < 4; i++) b.cyl('rubber', 0.0152, 0.0152, 0.004, x0, vb - 0.03 - i * 0.014, uG, { axis: 'v', seg: 14 });
    lh.pos.set(x0, vb - 0.014, -uG);
    lh.data = { style: 'post', rake: 0.02, gw: 0.0145, gd: 0.0158, gu: 0, ho: 0.02 };
  } else if (under && att.unterlauf === 'winkel') {
    b.side('polymer', [[uL + 0.035, vb + 0.002], [uL + 0.105, vb + 0.002], [uL + 0.094, vb - 0.02], [uL + 0.074, vb - 0.027], [uL + 0.048, vb - 0.012]], 0.02, x0, { bevel: 0.002 });
  } else if (under && att.unterlauf === 'handstopp') {
    b.box('polymer', 0.015, 0.018, 0.022, x0, vb - 0.007, uL + 0.065, { c: 0.003 });
  } else if (under && att.unterlauf === 'zweibein') {
    const uB = Math.min(uL + 0.13, muzzleU - 0.19);
    b.box('steelDark', 0.03, 0.014, 0.032, x0, vb - 0.006, uB, { c: 0.002 });
    b.cyl('steelDark', 0.004, 0.004, 0.036, x0, vb - 0.014, uB, { axis: 'x', seg: 8 });
    for (const s of [-1, 1]) {
      b.cyl('alu', 0.0048, 0.0042, 0.17, x0 + s * 0.0115, vb - 0.016, uB + 0.088, { seg: b.seg(10, 5) });
      b.box('rubber', 0.009, 0.009, 0.014, x0 + s * 0.0115, vb - 0.016, uB + 0.176, { c: 0.002 });
    }
  }
  if (under && (att.unterlauf === 'granatwerfer' || att.unterlauf === 'schrotlauf')) {
    // Unterlauf-Waffe (Alt-Feuer): Rohr unter dem Handschutz, Abzugsgehäuse; die linke Hand greift das Rohr
    const gl = att.unterlauf === 'granatwerfer', r = gl ? 0.024 : 0.014, u0 = uL - 0.03;
    const len = Math.max(0.12, Math.min(gl ? 0.24 : 0.27, muzzleU - u0 - 0.03)), y = vb - (gl ? 0.03 : 0.022);
    b.box('polymer', gl ? 0.034 : 0.026, 0.02, len * 0.6, x0, vb - 0.006, u0 + len * 0.3, { c: 0.003 });
    b.cyl('steelDark', r, r, len, x0, y, u0 + len / 2, { seg: b.seg(gl ? 18 : 14, 7) });
    b.circle('cavity', r * 0.8, x0, y, u0 + len + 0.001);
    if (gl) b.cyl('steel', r + 0.002, r + 0.002, 0.014, x0, y, u0 + len - 0.01, { seg: b.seg(18, 7) });
    else {
      b.cyl('steel', 0.01, 0.01, len * 0.85, x0, y - 0.022, u0 + len * 0.45, { seg: b.seg(10, 5) }); // Röhrenmagazin
      b.box('polymer', 0.03, 0.03, 0.07, x0, y - 0.01, u0 + len * 0.55, { c: 0.004 });             // Pumpe
    }
    b.box('steel', 0.012, 0.03, 0.02, x0, y - r - 0.012, u0 + 0.015, { c: 0.002 }); // Abzug
    lh.pos.set(x0, y - r * 0.4, -(u0 + len * 0.55));
    lh.data = { style: 'under', w: r + 0.004, h: r };
  }
  if (att.taktisch === 'laser') {
    if (style === 'pistol' || !under) {
      const v = (mz ? mz.pos.y : 0.03) - 0.03, u = muzzleU - (style === 'pistol' ? 0.045 : 0.14);
      b.box('polymer', 0.022, 0.018, 0.04, 0, v, u, { c: 0.003 });
      b.circle('glowRed', 0.0028, 0, v + 0.002, u + 0.0205);
    } else {
      const x = x0 + hw + 0.011, v = vb + (lh.data.h ?? lh.data.r ?? 0.024), u = Math.min(uL + 0.1, muzzleU - 0.06);
      b.box('polymer', 0.017, 0.02, 0.044, x, v, u, { c: 0.003 });
      b.box('alu', 0.006, 0.012, 0.03, x - 0.0105, v, u, { c: 0.001 });
      b.circle('glowRed', 0.003, x, v + 0.003, u + 0.0225);
    }
  }
}

/** Nach dem Bau: Magazin länger (Erweitert) oder mit Trommel. */
export function attachToRoot(root, att, lod = 'first') {
  if (!att || !att.magazin) return;
  const mag = root.getObjectByName('mag');
  if (!mag || mag === root) return;
  if (att.magazin === 'erweitert') {
    // Quer liegendes Magazin (QX-90 oben auf dem Gehäuse): nicht in die Höhe ziehen – das verzerrt nur Patronen/Form
    const s = magBox(mag).getSize(_v);
    if (!(s.z > s.y * 1.6)) mag.scale.y = 1.3;
    return;
  }
  if (att.magazin !== 'trommel') return;
  drumMag(root, mag, lod === 'third');
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
function magBox(mag) {
  const box = new THREE.Box3();
  mag.updateWorldMatrix(true, true);
  mag.traverse((o) => { if (o.isMesh && o.name !== 'rounds' && o.name !== 'follower') box.expandByObject(o); });
  return box;
}

/**
 * Trommelmagazin (Nutzer 13.10.2026: früher hing eine Scheibe unter einem fast vollen Kastenmagazin): vom Magazin
 * bleibt nur der kurze Zuführhals, darunter eine liegende Trommel mit Deckeln, Rippen, Nabe und Aufziehknopf.
 * Alles hängt am Teil 'mag' (Nachladen nimmt die Trommel mit) und richtet sich unabhängig von Neigung/Stauchung
 * des Magazins gerade zur Waffe aus.
 */
function drumMag(root, mag, low = false) {
  const box0 = magBox(mag);
  if (box0.isEmpty()) return;
  const size0 = box0.getSize(new THREE.Vector3());
  const SY = 0.3;
  mag.scale.y *= SY;
  const box = magBox(mag);
  const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const R = THREE.MathUtils.clamp(size0.z * 0.78, 0.034, 0.052);
  const W = THREE.MathUtils.clamp(size0.x + 0.03, 0.044, 0.06);
  const neck = 0.014;
  // g1: im Magazinraum, hebt die Stauchung auf; g2: hebt die Neigung auf (Achsen wie die Waffe)
  const g1 = new THREE.Group();
  g1.name = 'mag:trommel';
  g1.position.copy(mag.worldToLocal(top.clone()));
  g1.scale.set(1, 1 / SY, 1);
  mag.add(g1);
  const g2 = new THREE.Group();
  g2.quaternion.copy(mag.getWorldQuaternion(_q)).invert();
  g1.add(g2);
  const add = (geo, matKey, x, y, z) => {
    const m = new THREE.Mesh(geo, getMat(matKey));
    m.position.set(x, y, z);
    m.castShadow = true;
    g2.add(m);
    return m;
  };
  const cy = -(neck + R * 0.9);
  const seg = low ? 10 : 28; // Bots (Detailstufe 'third'): sparsam, ohne Kleinteile
  // Hals (Kastenstück zwischen Magazinschacht und Trommel)
  add(new THREE.BoxGeometry(size0.x + 0.002, neck + R * 0.35, Math.min(size0.z, R * 1.3)), 'polymer', 0, -(neck + R * 0.35) / 2 + 0.004, 0);
  // Trommelkörper (Achse quer) und Deckel
  add(new THREE.CylinderGeometry(R, R, W, seg).rotateZ(Math.PI / 2), 'polymer', 0, cy, 0);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(R * 1.035, R * 1.035, 0.005, seg).rotateZ(Math.PI / 2), 'polymerGrey', s * (W / 2 - 0.0015), cy, 0);
  if (low) { mag.userData.drum = true; return; }
  // Rippen um den Umfang
  for (const f of [-0.22, 0.22]) add(new THREE.CylinderGeometry(R * 1.015, R * 1.015, 0.0035, seg).rotateZ(Math.PI / 2), 'polymerGrey', f * W, cy, 0);
  // Nabe + Aufziehknopf rechts, kleine Nabe links
  add(new THREE.CylinderGeometry(R * 0.32, R * 0.36, 0.006, 20).rotateZ(Math.PI / 2), 'steelDark', W / 2 + 0.003, cy, 0);
  add(new THREE.BoxGeometry(0.006, R * 0.5, 0.006), 'steel', W / 2 + 0.0065, cy, 0);
  add(new THREE.CylinderGeometry(R * 0.2, R * 0.2, 0.004, 16).rotateZ(Math.PI / 2), 'steelDark', -W / 2 - 0.002, cy, 0);
  // Sichtfenster für den Füllstand (links, schmaler Streifen)
  add(new THREE.BoxGeometry(0.0012, R * 0.7, 0.008), 'smokeDark', -W / 2 - 0.0012, cy - R * 0.35, R * 0.55);
  mag.userData.drum = true;
}
