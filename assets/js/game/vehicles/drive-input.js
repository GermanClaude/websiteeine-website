// NULLPUNKT — Fahr-Eingaben des Spielers im Fahrersitz (docs/planung/panzer-mp.md §A.5): schreibt nur die Fahrfelder
// der Sitz-Absicht (throttle, steer, brake, handbrake, gearbox, shiftUp/shiftDown; löscht path/moveTo bei Handsteuerung).
//
// Getriebe „Gang halten“ (Einstellung vehGearbox 'halten', Standard für Kettenfahrzeuge – wie Squad 44):
//   W/S tippen = hoch-/runterschalten (R2 R1 N 1 … 5; Flanke von move.y: Tastatur, Pad-Stick, VR-Stick – der
//   Touch-Stick lenkt nur), dazu gear_up/gear_down (Pad RB/LB) und Touch „Gang +“/„Gang −“. Ohne Taste hält der
//   Panzer das Marschtempo des Gangs; Taste in Gangrichtung ≥ 0,25 s halten (bzw. Touch „Gas“, Pad RT) = Vollgas.
//   Leertaste / Pad A / VR A / Touch „Bremse“ (Pad LT im Sitz ohne Waffen) = Bremse. N + A/D = Drehen auf der Stelle.
// Automatik („W/S halten“, GW-4 immer): W/S = Gas/rückwärts wie bisher, Gas gegen die Fahrt bremst.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ON = 0.75, OFF = 0.35, FULL = 0.9, FULL_T = 0.25;

/** Getriebeart für den Spieler: 'hold' | 'auto' (Kettenfahrzeuge nach Einstellung, Räder immer Automatik). */
export function playerGearbox(vehicle) {
  if (!vehicle.body.tracked) return 'auto';
  const s = vehicle.G && vehicle.G.settings;
  const pref = s && typeof s.get === 'function' ? s.get('vehGearbox') : null;
  return pref === 'automatik' ? 'auto' : 'hold';
}

/** Fahrfelder eines Frames lesen und in seat.intent schreiben. */
export function readDriveControls(input, vehicle, seat, dt) {
  const it = seat.intent;
  if (!input) return;
  const st = seat._driveIn || (seat._driveIn = { armed: true, dir: 0, holdT: 0 });
  const pad = input.lastDevice === 'gamepad';
  const touch = input.mode === 'touch';
  const noWeapons = !seat.weapons.length;
  const tracked = vehicle.body.tracked;
  const gearbox = playerGearbox(vehicle);
  it.gearbox = gearbox;
  it.steer = clamp(input.move.x || 0, -1, 1);
  let manual = Math.abs(it.steer) > 0.05;

  if (gearbox === 'auto') {
    let thr = input.move.y || 0;
    if (input.down('v_gas')) thr = 1;
    if (input.down('v_brake')) thr = -1;
    if (pad && noWeapons) {
      if (input.down('fire')) thr = Math.max(thr, 1);
      if (input.down('ads')) thr = Math.min(thr, -1);
    }
    it.throttle = clamp(thr, -1, 1);
    const hb = input.down('jump') || input.down('v_handbrake');
    // Kette: Leertaste = Betriebsbremse (alle Laufrollen); Rad: Handbremse hinten (Driften) wie bisher
    it.handbrake = tracked ? !!input.down('v_handbrake') : hb;
    it.brake = tracked && input.down('jump') ? 1 : 0;
    st.armed = true; st.dir = 0; st.holdT = 0;
    if (Math.abs(it.throttle) > 0.05) manual = true;
  } else {
    // Gang halten: Schaltflanken (Tastatur digital, sonst Stick; Touch-Stick schaltet nicht)
    let y = 0;
    const kf = input.down('move_forward'), kb = input.down('move_back');
    if (kf !== kb) y = kf ? 1 : -1;
    else if (!touch) y = input.move.y || 0;
    if (st.armed) {
      if (y >= ON) { it.shiftUp = (+it.shiftUp || 0) + 1; st.armed = false; st.dir = 1; st.holdT = 0; }
      else if (y <= -ON) { it.shiftDown = (+it.shiftDown || 0) + 1; st.armed = false; st.dir = -1; st.holdT = 0; }
    } else if (Math.abs(y) < OFF) { st.armed = true; st.dir = 0; st.holdT = 0; }
    if (input.pressed('gear_up') || input.pressed('v_gear_up')) it.shiftUp = (+it.shiftUp || 0) + 1;
    if (input.pressed('gear_down') || input.pressed('v_gear_down')) it.shiftDown = (+it.shiftDown || 0) + 1;
    // Vollgas: Taste/Stick in Richtung des (Ziel-)Gangs gehalten
    const D = vehicle.body.drive;
    const gdir = Math.sign((D && D.targetGear) || 0);
    let full = 0;
    if (!st.armed && st.dir && st.dir === gdir && Math.abs(y) >= FULL) {
      st.holdT += dt;
      if (st.holdT >= FULL_T) full = 1;
    } else st.holdT = 0;
    if (input.down('v_gas')) full = 1;
    if (pad && noWeapons && input.down('fire')) full = 1;
    it.throttle = full;
    it.brake = input.down('jump') || input.down('v_brake') || (pad && noWeapons && input.down('ads')) ? 1 : 0;
    it.handbrake = !!input.down('v_handbrake');
    if (Math.abs(y) > 0.05 || it.shiftUp || it.shiftDown || full) manual = true;
  }
  if (manual) { it.path = null; it.moveTo = null; }
}
