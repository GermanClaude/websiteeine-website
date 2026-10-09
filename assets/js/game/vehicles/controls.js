// NULLPUNKT — Spieler-Steuerung im Fahrzeug (Tastatur/Maus, Gamepad, Touch, VR) über das Aktionssystem von input.js.
//
// Belegung (vorhandene Aktionen; Fahrfelder liest drive-input.js – panzer-mp.md §A.5/§B.6):
//   Fahren: siehe drive-input.js (W/S, A/D, Leertaste, Touch „Gas“/„Bremse“, Gang +/−)
//   Turm/Blick: Maus, rechter Stick, Touch-Ziehen (+ Gyro); VR: Kopf
//   Feuern: fire (LMT / RT)                   Zoom: ads (RMT / LT), ads + swap = höchste Stufe
//   Waffe/Munition: swap (Mausrad, Maus 5 / Y) Sicht: crouch (C / B) bzw. Touch „Sicht“ – schaltet durch die Sichten
//   Aussteigen: interact (F tippen; Pad/VR: X 0,5 s halten)  Scheinwerfer: light (nur Fahrer)
//   Sitzwechsel: 1–4 (slot1, slot2, streak1, streak2; nur Tastatur), Pad ◀/▶ (seat_prev/seat_next), Touch „Sitz“,
//                VR seat_next
//   Ladeschütze: reload = Granate greifen bzw. Verschluss schließen, fire = einschieben, swap = Munitionssorte;
//                Touch „Laden“ (v_load) = nächster fälliger Schritt, „PG/SG“ (v_ammo). Pad/VR: reload wirkt beim
//                Loslassen nach < 0,35 s (X ist zugleich interact).
// Touch-Knöpfe (vehicles/hud.js, data-action): v_enter, v_exit, v_camera, v_seat, v_gas, v_brake, v_light, v_load, v_ammo.
import { readDriveControls } from './drive-input.js';
import { viewOf, clampRelLook } from './views.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const SEAT_ACTIONS = ['slot1', 'slot2', 'streak1', 'streak2'];
const EXIT_HOLD = 0.5, RELOAD_TAP = 0.35;
// Haltezeiten (ein lokaler Spieler): Aussteigen per Halten, Nachladen beim Loslassen (Pad/VR)
const hold = { interact: 0, reload: 0, exitDone: false };

/**
 * Eingaben eines Frames lesen und in die Sitz-Absicht schreiben.
 * opts: { frozen, view (wirksame Sicht), xr (VR aktiv) }
 * @returns {{ exit, exitHold, camera, seatTo, seatStep, nextSeat, lights, load: 'greifen'|'einschieben'|'schliessen'|'munition'|'weiter'|null, ammo }}
 */
export function readPlayerControls(input, vehicle, seat, dt, { frozen = false, view = null, xr = false } = {}) {
  const it = seat.intent;
  const out = { exit: false, exitHold: 0, camera: false, seatTo: null, seatStep: 0, nextSeat: false, lights: false, load: null, ammo: null, ads: false };
  if (!input) return out;
  const dev = input.lastDevice;
  const pad = dev === 'gamepad';
  const vr = xr || dev === 'xr';
  const noWeapons = !seat.weapons.length;
  view = view || viewOf(seat);
  // Blick
  const L = seat.look;
  const dx = input.look.dx || 0, dy = input.look.dy || 0;
  const look = view.look || (seat.def.mount ? 'mount' : 'rel');
  if (look === 'mount') {
    L.yaw = wrap(L.yaw - dx);
    L.pitch = clamp(L.pitch - dy, -0.75, 0.9);
  } else {
    L.relYaw -= dx;
    L.relPitch -= dy;
    clampRelLook(L, view);
    // Freier Blick des Fahrers zentriert sich beim Fahren langsam (nur ohne Blickeingabe)
    if (Math.abs(dx) + Math.abs(dy) > 1e-5) L.idle = 0; else L.idle += dt;
    if (seat.def.drive && look === 'rel' && L.idle > 1.2 && Math.abs(vehicle.body.speed) > 3) {
      const k = 1 - Math.exp(-dt * 1.6);
      L.relYaw += (0 - L.relYaw) * k;
      L.relPitch += (-0.05 - L.relPitch) * k;
    }
  }
  if (frozen) {
    it.throttle = 0; it.steer = 0; it.handbrake = true; it.fire = false; it.firePressed = false;
    hold.interact = hold.reload = 0;
    return out;
  }
  // Fahren (drive-input.js)
  if (seat.def.drive) readDriveControls(input, vehicle, seat, dt);
  // Nachladen-Taste: Tastatur sofort; Pad/VR erst beim Loslassen nach kurzem Tippen (X = Nachladen + Aussteigen)
  let reloadTap = false;
  if (pad || vr) {
    if (input.down('reload')) hold.reload += dt;
    else { if (hold.reload > 0 && hold.reload < RELOAD_TAP) reloadTap = true; hold.reload = 0; }
  } else {
    reloadTap = input.pressed('reload');
    hold.reload = 0;
  }
  const zooms = view.zoom || [1];
  const ads = input.active ? input.active('ads') : input.down('ads');
  const swap = input.pressed('swap') || input.pressed('v_weapon');
  out.ads = !!ads;
  // Waffen
  if (!noWeapons) {
    it.fire = input.down('fire') || input.pressed('fire');
    it.firePressed = input.pressed('fire');
    if (ads && zooms.length > 2 && swap) seat._zoomHi = !seat._zoomHi;
    else if (swap) it.cycleWeapon = true;
    if (reloadTap) it.reload = true;
  } else {
    it.fire = false;
    it.firePressed = false;
    // Ladeschütze: Handgriffe als Anfragen (Host entscheidet)
    if (seat.def.loader) {
      const g = vehicle.gun;
      if (input.pressed('v_load')) out.load = 'weiter';
      else if (input.pressed('fire')) out.load = 'einschieben';
      else if (reloadTap) out.load = g && g.step === 'eingeschoben' ? 'schliessen' : 'greifen';
      else if (swap || input.pressed('v_ammo')) out.load = 'munition';
    }
  }
  // Zoom der Sicht (Fahrer am Pad: LT ist Bremse/rückwärts)
  const zoomOk = !(seat.def.drive && pad && noWeapons);
  seat.zoomIndex = zoomOk && ads && zooms.length > 1 ? (seat._zoomHi && zooms.length > 2 ? 2 : 1) : 0;
  // Aussteigen: Tastatur/Touch tippen; Pad/VR halten
  if (input.pressed('v_exit')) out.exit = true;
  else if (pad || vr) {
    if (input.down('interact')) {
      hold.interact += dt;
      out.exitHold = Math.min(1, hold.interact / EXIT_HOLD);
      if (hold.interact >= EXIT_HOLD && !hold.exitDone) { out.exit = true; hold.exitDone = true; }
    } else { hold.interact = 0; hold.exitDone = false; }
  } else {
    out.exit = input.pressed('interact');
    hold.interact = 0; hold.exitDone = false;
  }
  out.camera = input.pressed('crouch') || input.pressed('v_camera');
  out.nextSeat = input.pressed('v_seat');
  out.lights = input.pressed('light') || input.pressed('v_light');
  if (input.pressed('seat_next')) out.seatStep = 1;
  else if (input.pressed('seat_prev')) out.seatStep = -1;
  if (!pad && !vr) for (let i = 0; i < SEAT_ACTIONS.length; i++) if (input.pressed(SEAT_ACTIONS[i])) out.seatTo = i;
  return out;
}

/** Haltezustand zurücksetzen (Ein-/Aussteigen, Sitzwechsel). */
export function resetControlHolds() { hold.interact = 0; hold.reload = 1; hold.exitDone = true; }
