// NULLPUNKT — Fahr-Eingaben des Spielers im Fahrersitz (docs/planung/panzer-mp.md §A.5): schreibt nur die Fahrfelder
// der Sitz-Absicht (throttle, steer, brake, handbrake, gearbox, shiftUp/shiftDown).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Fahrfelder eines Frames lesen und in seat.intent schreiben. */
export function readDriveControls(input, vehicle, seat, dt) {
  const it = seat.intent;
  if (!input) return;
  const pad = input.lastDevice === 'gamepad';
  const noWeapons = !seat.weapons.length;
  let thr = input.move.y || 0;
  if (input.down('v_gas')) thr = 1;
  if (input.down('v_brake')) thr = -1;
  if (pad && noWeapons) {
    if (input.down('fire')) thr = Math.max(thr, 1);
    if (input.down('ads')) thr = Math.min(thr, -1);
  }
  it.throttle = clamp(thr, -1, 1);
  it.steer = clamp(input.move.x || 0, -1, 1);
  it.handbrake = input.down('jump') || input.down('v_handbrake');
  it.brake = 0;
  if (Math.abs(it.throttle) > 0.05 || Math.abs(it.steer) > 0.05) { it.path = null; it.moveTo = null; }
}
