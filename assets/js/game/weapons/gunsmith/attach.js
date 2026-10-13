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
 * Trommelmagazin (Nutzer 13.10.2026: kein gestauchtes Kastenmagazin mit angehängter Scheibe, sondern ein eigenes Teil):
 * das Werksmagazin wird ausgeblendet, an seiner Stelle sitzt ein eigenes Trommelmagazin – ein geformter Hals, der mit
 * Hohlkehlen in die liegende Trommel übergeht, Trommel mit Randwulsten, Deckel mit eigener Textur (Ringrippen, Speichen,
 * Sichtfenster mit Patronen, Prägung), Nabe und Aufziehknopf. Eigener Kunststoff ('drumBody'), keine Tarnung. Alles hängt
 * am Teil 'mag' (Nachladen nimmt die Trommel mit) und steht unabhängig von der Neigung des Magazins gerade zur Waffe.
 */
function drumMag(root, mag, low = false) {
  const box0 = magBox(mag);
  if (box0.isEmpty()) return;
  const size0 = box0.getSize(new THREE.Vector3());
  const piv = mag.getWorldPosition(new THREE.Vector3());
  // Magazinschacht: Querschnitt des Werksmagazins knapp unter dem Schacht (oberste 2 cm)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const p = new THREE.Vector3();
  mag.traverse((o) => {
    if (!o.isMesh) return;
    o.visible = false;
    const a = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!a) return;
    for (let i = 0; i < a.count; i++) {
      p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      if (p.y < piv.y - 0.02 || p.y > piv.y + 0.012) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
  });
  if (!Number.isFinite(x0)) { x0 = box0.min.x; x1 = box0.max.x; z0 = box0.min.z; z1 = box0.max.z; }
  const nw = THREE.MathUtils.clamp(x1 - x0, 0.018, 0.032);       // Halsbreite (quer)
  const nd = THREE.MathUtils.clamp(z1 - z0, 0.032, 0.062);       // Halstiefe (längs)
  const R = THREE.MathUtils.clamp(size0.y * 0.29, 0.04, 0.056);  // Trommelradius
  const W = THREE.MathUtils.clamp(nw * 2.2, 0.05, 0.066);        // Trommelbreite
  const vis = 0.016;                                             // sichtbarer Hals unter dem Schacht
  const cy = -(vis + R), top = 0.03;
  // g1: am Schacht im Magazinraum; g2: Achsen wie die Waffe
  const g1 = new THREE.Group();
  g1.name = 'mag:trommel';
  g1.position.copy(mag.worldToLocal(new THREE.Vector3((x0 + x1) / 2, piv.y, (z0 + z1) / 2)));
  mag.add(g1);
  const g2 = new THREE.Group();
  g2.quaternion.copy(mag.getWorldQuaternion(_q)).invert();
  g1.add(g2);
  const add = (geo, matKey, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, getMat(matKey));
    m.position.set(x, y, z);
    m.castShadow = true;
    g2.add(m);
    return m;
  };
  // Hals mit Hohlkehlen in die Trommel (Profil in z/y, quer extrudiert)
  const hw = nd / 2, a = Math.asin(Math.min(0.95, (hw + 0.012) / R));
  const P = [R * Math.sin(a), cy + R * Math.cos(a)];
  const yF = -vis + 0.004;
  const sh = new THREE.Shape();
  sh.moveTo(-hw, top);
  sh.lineTo(hw, top);
  sh.lineTo(hw, yF);
  sh.quadraticCurveTo(hw, P[1], P[0], P[1]);
  sh.absarc(0, cy, R, Math.PI / 2 - a, Math.PI / 2 + a, true);
  sh.quadraticCurveTo(-hw, P[1], -hw, yF);
  sh.lineTo(-hw, top);
  const neck = new THREE.ExtrudeGeometry(sh, { depth: nw, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0016, bevelSegments: low ? 1 : 2, curveSegments: low ? 5 : 18 });
  neck.translate(0, 0, -nw / 2).rotateY(-Math.PI / 2);
  add(neck, 'drumBody');
  const seg = low ? 12 : 40;
  // Trommel: Mantel, Randwulste, Deckel mit eigener Textur
  add(new THREE.CylinderGeometry(R, R, W, seg, 1, true).rotateZ(Math.PI / 2), 'drumBody', 0, cy, 0);
  for (const s of [-1, 1]) {
    add(new THREE.CircleGeometry(R, seg).rotateY(s * Math.PI / 2), 'drumFace', s * W / 2, cy, 0); // liest sich von beiden Seiten richtig
    if (!low) add(new THREE.TorusGeometry(R - 0.0006, 0.0034, 8, seg).rotateY(Math.PI / 2), 'drumBody', s * (W / 2 - 0.0012), cy, 0);
  }
  if (low) { mag.userData.drum = true; return; }
  // Umlaufende Griffrippe, Nabe + Aufziehknopf rechts, Gegennabe links, Rippen am Hals, Halteplatte (Magazinhalter)
  add(new THREE.TorusGeometry(R + 0.0006, 0.0022, 6, seg).rotateY(Math.PI / 2), 'drumBody', 0, cy, 0);
  add(new THREE.CylinderGeometry(R * 0.24, R * 0.27, 0.007, 24).rotateZ(Math.PI / 2), 'steelDark', W / 2 + 0.0035, cy, 0);
  add(new THREE.BoxGeometry(0.0055, R * 0.46, 0.0075), 'steel', W / 2 + 0.0075, cy, 0);
  add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.004, 12).rotateZ(Math.PI / 2), 'steelBright', W / 2 + 0.0095, cy, 0);
  add(new THREE.CylinderGeometry(R * 0.17, R * 0.17, 0.004, 20).rotateZ(Math.PI / 2), 'steelDark', -W / 2 - 0.002, cy, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(0.0016, 0.0022, nd * 0.8), 'drumBody', s * (nw / 2 + 0.0018), -0.004 - i * 0.0055, 0);
  add(new THREE.BoxGeometry(nw * 0.7, 0.008, 0.0018), 'steel', 0, -0.006, hw + 0.0012);
  mag.userData.drum = true;
}
