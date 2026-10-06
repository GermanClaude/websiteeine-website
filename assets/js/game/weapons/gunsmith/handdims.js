// Handmaße (hands-v3): gemeinsame Quelle für das Hand-Rig (arms.js) und den Netzgenerator
// tools/assets/hands/build-hand.mjs (erzeugt glove-mesh.js). Keine Abhängigkeiten – auch in Node importierbar.
// Handkoordinaten (rechte Hand): Handgelenk im Ursprung, Finger −Z, Handrücken +Y, Daumen −X. Meter.
// Ändern → `node tools/assets/hands/build-hand.mjs` neu ausführen (glove-mesh.js prüft die Prüfsumme).

// Fingerradien: Kollisions-/Messradien (Kapseln für Kontaktlöser und Prüfwerkzeuge); das sichtbare Netz ist ≈ 4 % weiter
export const FINGERS = [
  { x: -0.0285, y: 0.001, z: -0.08, len: [0.043, 0.027, 0.022], r: [0.0089, 0.0084, 0.0078], splay: 0.07 },
  { x: -0.0093, y: 0.002, z: -0.084, len: [0.047, 0.03, 0.023], r: [0.0092, 0.0086, 0.008], splay: 0.0 },
  { x: 0.0102, y: 0.001, z: -0.081, len: [0.044, 0.028, 0.022], r: [0.0088, 0.0083, 0.0076], splay: -0.06 },
  { x: 0.0285, y: -0.002, z: -0.073, len: [0.034, 0.022, 0.019], r: [0.008, 0.0074, 0.0069], splay: -0.14 },
];
export const THUMB = { base: [-0.027, -0.011, -0.018], len: [0.042, 0.032, 0.026], r: [0.0128, 0.0112, 0.0101] };
// Ruheausrichtung des Daumengrundglieds: Blickrichtung F (Knochen −Z) und Rückenrichtung B (Knochen +Y)
export const THUMB_REST = { F: [-0.62, -0.42, -0.66], B: [-0.75, 0.6, -0.1] };

// Bindehaltung des Handschuhnetzes (Pose-Format wie arms.js POSES: f[i] = [Grund, Mittel, End, Spreizung − FINGERS.splay/2],
// t = [Quaternion Daumengrund (rechte Hand) x, y, z, w, Beugung Grund-, Endgelenk]). Finger leicht gespreizt und
// gebeugt (saubere Fugen zwischen den Fingern, Gelenke in der Mitte ihres Bewegungsbereichs → wenig Verzerrung).
export const BIND_SPLAY = [0.13, 0.035, -0.075, -0.2];
export const BIND_CURL = [[0.12, 0.2, 0.12], [0.12, 0.2, 0.12], [0.14, 0.22, 0.13], [0.16, 0.24, 0.14]];
export const BIND_THUMB_FLEX = [0.12, 0.12];

// Prüfsumme der Maße (das erzeugte Netz passt nur zu genau diesen Knochen)
export function handDimsKey() {
  const a = [];
  for (const f of FINGERS) a.push(f.x, f.y, f.z, ...f.len, f.splay);
  a.push(...THUMB.base, ...THUMB.len, ...THUMB_REST.F, ...THUMB_REST.B, ...BIND_SPLAY, ...BIND_CURL.flat(), ...BIND_THUMB_FLEX);
  let h = 0;
  for (const v of a) h = (Math.imul(h, 31) + Math.round(v * 1e5)) | 0;
  return (h >>> 0).toString(16);
}
