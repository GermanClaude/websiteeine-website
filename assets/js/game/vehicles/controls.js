// NULLPUNKT — Spieler-Steuerung im Fahrzeug (Tastatur/Maus, Gamepad, Touch) über das Aktionssystem von input.js.
//
// Belegung (vorhandene Aktionen, keine neuen Tasten nötig – GROSSKAMPF_PLAN §10):
//   Gas/Bremse/Lenken: Bewegung (W/S/A/D, linker Stick, Touch-Stick: y = Gas, x = Lenken) + Touch „Gas“/„Bremse“
//   Handbremse: jump (Leertaste / A)          Turm/Blick: Maus, rechter Stick, Touch-Ziehen (+ Gyro)
//   Feuern: fire (LMT / RT)                   Optik/Zoom: ads (RMT / LT); Mausrad bei 3 Stufen: Vergrößerung
//   Waffe/Munition: swap (Mausrad, Maus 5 / Y)  Kamera 1P/3P: crouch (C / B) bzw. Touch „Kamera“
//   Aussteigen: interact (F / X)              Sitzwechsel: slot1, slot2, streak1–3 (1–5), Touch „Sitz“
//   Scheinwerfer: light (T / Steuerkreuz ▼)
// Gamepad, Sitz ohne Waffe (Fahrer Geländewagen): RT = Gas, LT = Bremse/rückwärts (wie in BF).
// Touch-Knöpfe (vehicles/hud.js, data-action): v_enter, v_exit, v_camera, v_seat, v_gas, v_brake, v_light.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const SEAT_ACTIONS = ['slot1', 'slot2', 'streak1', 'streak2', 'streak3'];

/**
 * Eingaben eines Frames lesen und in die Sitz-Absicht schreiben.
 * @returns {{ exit:boolean, camera:boolean, seatTo:number|null, nextSeat:boolean, lights:boolean }}
 */
export function readPlayerControls(input, vehicle, seat, dt, { frozen = false } = {}) {
  const it = seat.intent;
  const out = { exit: false, camera: false, seatTo: null, nextSeat: false, lights: false };
  if (!input) return out;
  const pad = input.lastDevice === 'gamepad';
  const noWeapons = !seat.weapons.length;
  // Blick
  const L = seat.look;
  const dx = input.look.dx || 0, dy = input.look.dy || 0;
  if (seat.def.mount) {
    L.yaw = wrap(L.yaw - dx);
    L.pitch = clamp(L.pitch - dy, -0.75, 0.9);
  } else {
    L.relYaw = clamp(L.relYaw - dx, -2.1, 2.1);
    L.relPitch = clamp(L.relPitch - dy, -0.7, 0.75);
    // Freier Blick zentriert sich beim Fahren langsam (nur ohne Blickeingabe)
    if (Math.abs(dx) + Math.abs(dy) > 1e-5) L.idle = 0; else L.idle += dt;
    if (seat.def.drive && L.idle > 1.2 && Math.abs(vehicle.body.speed) > 3) {
      const k = 1 - Math.exp(-dt * 1.6);
      L.relYaw += (0 - L.relYaw) * k;
      L.relPitch += (-0.05 - L.relPitch) * k;
    }
  }
  if (frozen) {
    it.throttle = 0; it.steer = 0; it.handbrake = true; it.fire = false; it.firePressed = false;
    return out;
  }
  // Fahren
  if (seat.def.drive) {
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
  // Waffen
  if (!noWeapons) {
    it.fire = input.down('fire') || input.pressed('fire');
    it.firePressed = input.pressed('fire');
    const zooms = (seat.def.fp && seat.def.fp.zoom) || [1];
    const ads = input.active ? input.active('ads') : input.down('ads');
    const swap = input.pressed('swap') || input.pressed('v_weapon');
    if (ads && zooms.length > 2 && swap) seat._zoomHi = !seat._zoomHi;
    else if (swap) it.cycleWeapon = true;
    seat.zoomIndex = ads && zooms.length > 1 ? (seat._zoomHi && zooms.length > 2 ? 2 : 1) : 0;
    if (input.pressed('reload')) it.reload = true;
  } else {
    it.fire = false;
    seat.zoomIndex = 0;
  }
  out.exit = input.pressed('interact') || input.pressed('v_exit');
  out.camera = input.pressed('crouch') || input.pressed('v_camera');
  out.nextSeat = input.pressed('v_seat');
  out.lights = input.pressed('light') || input.pressed('v_light');
  for (let i = 0; i < SEAT_ACTIONS.length; i++) if (input.pressed(SEAT_ACTIONS[i])) out.seatTo = i;
  return out;
}
