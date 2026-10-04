// NULLPUNKT — Skelett des Soldaten (Bindepose, Modellraum: Füße im Ursprung, Blick −Z, rechts +X).
// Alle Knochen haben in der Bindepose die Einheitsrotation; Gliedmaßen zeigen entlang −Y.
// Die Animation (animator.js) rechnet eine eigene Vorwärtskinematik im Modellraum und schreibt nur
// lokale Quaternionen (+ Hüftposition) in die three.js-Knochen.

export const BONES = [
  // name, parent, offset (relativ zum Elternknochen)
  ['hips', -1, [0, 0.95, 0]],
  ['spine', 0, [0, 0.1, 0]],
  ['chest', 1, [0, 0.2, 0]],
  ['neck', 2, [0, 0.235, 0.0]],
  ['head', 3, [0, 0.085, 0.005]],
  ['upperArmL', 2, [-0.19, 0.185, 0.0]],
  ['foreArmL', 5, [0, -0.28, 0]],
  ['handL', 6, [0, -0.25, 0]],
  ['upperArmR', 2, [0.19, 0.185, 0.0]],
  ['foreArmR', 8, [0, -0.28, 0]],
  ['handR', 9, [0, -0.25, 0]],
  ['thighL', 0, [-0.1, -0.04, 0]],
  ['shinL', 11, [0, -0.42, 0]],
  ['footL', 12, [0, -0.41, 0]],
  ['thighR', 0, [0.1, -0.04, 0]],
  ['shinR', 14, [0, -0.42, 0]],
  ['footR', 15, [0, -0.41, 0]],
];

export const BONE = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const BONE_COUNT = BONES.length;

/** Bindepositionen im Modellraum (Summe der Offsets). */
export const BIND = (() => {
  const out = [];
  for (let i = 0; i < BONES.length; i++) {
    const [, p, o] = BONES[i];
    const base = p >= 0 ? out[p] : [0, 0, 0];
    out.push([base[0] + o[0], base[1] + o[1], base[2] + o[2]]);
  }
  return out;
})();

/** Maße für IK und Ragdoll. */
export const DIM = {
  upperArm: 0.28,
  foreArm: 0.25,
  hand: 0.085,
  thigh: 0.42,
  shin: 0.41,
  ankle: 0.08, // Knöchelhöhe über der Sohle
  hipWidth: 0.1,
  hipDrop: 0.04,
  shoulderX: 0.19,
  shoulderY: 0.185,
  standHip: 0.935,
  crouchHip: 0.6,
  headCenter: [0, 0.11, -0.015], // relativ zum Kopfknochen
};
