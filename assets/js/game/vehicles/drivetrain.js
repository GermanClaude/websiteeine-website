// NULLPUNKT — Triebwerk und Getriebe (docs/planung/panzer-mp.md §A): leistungsbasierter Motor (Drehmomentkurve über
// der Drehzahl, Ladedruck-Verzug), hydrodynamischer Wandler (Drehmomentwandlung beim Anfahren), Gänge + Achs-/
// Seitenvorgelege + Triebradradius, Wirkungsgrad, Motorbremse. Zwei Getriebearten:
//   'hold' — „Gang halten“ (wie Squad 44): Tippen schaltet (shift), ein Drehzahlregler hält ohne Taste die
//            Marschdrehzahl des Gangs (Tempo wird gehalten), Vollgas bis zur Abregeldrehzahl; kein Auto-Runterschalten.
//   'auto' — Automatik (GW-4, Bots, Autopilot): Gas −1 … 1, Gangwahl nach Drehzahl, Kickdown.
// Zustand in `state` (= body.drive): HUD, Klang und Netz lesen nur diese Felder (auf Abbildern schreibt sie das Netz).
// Reibungsgrenze, Roll-/Luft-/Steigungswiderstand und Drehmassen rechnet sim.js (je Rad bzw. Laufrolle).

const RPM = 60 / (2 * Math.PI); // rad/s → 1/min
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Gangliste eines Fahrzeugs, aufsteigend: z. B. [-2, -1, 0, 1, 2, 3, 4, 5]. */
export function gearList(def) {
  const g = (def && def.engine && def.engine.gears) || {};
  const out = [0];
  for (const k of Object.keys(g)) { const n = +k; if (n && Number.isFinite(n)) out.push(n); }
  return out.sort((a, b) => a - b);
}

/** Anzeigename eines Gangs: 'R2' | 'R1' | 'N' | '1' … (nur ein Rückwärtsgang, z. B. GW-4: 'R'). */
export function gearName(def, g) {
  if (!g) return 'N';
  if (g > 0) return String(g);
  const list = gearList(def);
  return list[0] === -1 ? 'R' : 'R' + (-g);
}

/** Drehmoment (Nm) aus der Kurve [[1/min, Nm], …], linear; oberhalb des letzten Punkts 0. */
export function torqueAt(curve, n) {
  if (!curve || !curve.length) return 0;
  if (n <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (n <= curve[i][0]) {
      const a = curve[i - 1], b = curve[i];
      return a[1] + (b[1] - a[1]) * (n - a[0]) / (b[0] - a[0]);
    }
  }
  return 0;
}

export class Drivetrain {
  constructor(def) {
    this.def = def;
    this.E = def.engine || {};
    this.gears = gearList(def);
    this.state = {
      gear: 0, targetGear: 0, shifting: false,
      rpm: 0, rpmNorm: 0, throttle: 0,
      gearbox: 'auto', lugging: false, slip: 0,
    };
    this.shiftT = 0;        // Restzeit der Schaltpause (Kupplung offen)
    this.Te = 0;            // wirksames Motormoment (Nm, folgt mit Ladedruck-Verzug)
    this.vF = 0;            // letzte Längsgeschwindigkeit (Richtungssperre beim Schalten)
    this.engineOn = false;  // Motor läuft (Fahrer an Bord; aus 2 s nach dem Aussteigen)
    this.offT = 0;
    this.autoHold = 0;      // Automatik: Sperre nach einem Schaltvorgang (kein Pendeln)
    this.nWheel = 0;        // Drehzahl aus der Fahrt (1/min) – Prüfstand/Tests
    this.force = 0;         // Zugkraft am Triebrad (N, vorwärts positiv, vor der Reibungsgrenze)
    this.onGear = null;     // (gear, blocked) => void – vehicle.js meldet daraus `vehicle:gear`
    this._out = { force: 0, brake: 0 };
  }

  /** Gesamtübersetzung eines Gangs (Getriebe × Achse), 0 in N. */
  ratio(g) {
    const r = g ? this.E.gears && this.E.gears[g] : 0;
    return r ? r * (this.E.finalDrive || 1) : 0;
  }

  /** Synchrondrehzahl eines Gangs bei Längsgeschwindigkeit vF (1/min, 0 gegen die Gangrichtung). */
  syncRpm(g, vF = this.vF) {
    const i = this.ratio(g);
    if (!i) return 0;
    return Math.max(0, vF * Math.sign(g)) * i / (this.E.sprocketR || 0.35) * RPM;
  }

  _emit(gear, blocked) { if (this.onGear) try { this.onGear(gear, blocked); } catch { /* Ereignis optional */ } }

  /**
   * Schalten: n > 0 hoch, n < 0 runter (je Schritt in der Gangliste R2 R1 N 1 … 5). Richtungssperre: in einen Gang
   * gegen die Fahrtrichtung erst unter 1,5 m/s (sonst bleibt der Wählhebel stehen, Meldung mit blocked). Jedes Tippen
   * startet die Schaltpause neu. → true, wenn sich der Zielgang geändert hat.
   */
  shift(n) {
    const s = this.state;
    n = Math.trunc(+n || 0);
    if (!n) return false;
    const step = Math.sign(n);
    let changed = false;
    for (let k = 0; k < Math.abs(n); k++) {
      const i = this.gears.indexOf(s.targetGear);
      const next = this.gears[i + step];
      if (next === undefined) break;
      if (next !== 0 && Math.sign(next) * this.vF <= -1.5) { this._emit(s.gear, true); break; }
      s.targetGear = next;
      changed = true;
    }
    if (changed) { s.shifting = true; this.shiftT = this.E.shiftTime ?? 0.5; }
    return changed;
  }

  /** Gang sofort setzen (ohne Schaltpause), z. B. N beim Verlassen des Fahrersitzes. */
  setGear(g) {
    const s = this.state;
    g = this.gears.includes(g) ? g : 0;
    const was = s.gear;
    s.gear = s.targetGear = g;
    s.shifting = false;
    this.shiftT = 0;
    if (g !== was) this._emit(g, false);
  }

  /** Fahrersitz leer/inaktiv: N, Motor aus nach 2 s. */
  park(dt) {
    if (this.state.gear || this.state.targetGear) this.setGear(0);
    this.offT += dt;
    if (this.offT > 2 && this.engineOn) {
      this.engineOn = false;
      const s = this.state;
      s.rpm = 0; s.rpmNorm = 0; s.throttle = 0; s.lugging = false; this.Te = 0;
    }
  }

  /** Fahrer bedient: Motor an (Anlasser ohne Verzug). */
  run() {
    this.offT = 0;
    if (!this.engineOn) { this.engineOn = true; if (this.state.rpm < (this.E.idleRpm || 700) * 0.5) this.state.rpm = this.E.idleRpm || 700; }
  }

  /** Zielgang für die Automatik beim Einkuppeln in Fahrt: kleinster Gang ohne Überdrehen. */
  _autoGear(dir, vF) {
    const E = this.E, lim = (E.autoUp || E.ratedRpm) * 0.9;
    let pick = null, top = dir;
    for (const g of this.gears) {
      if (Math.sign(g) !== dir) continue;
      if (Math.abs(g) > Math.abs(top)) top = g;
      if (this.syncRpm(g, vF) <= lim && (pick === null || Math.abs(g) < Math.abs(pick))) pick = g;
    }
    return pick ?? top;
  }

  /**
   * Ein Simulationsschritt. vF = Längsgeschwindigkeit (m/s), controls = body.controls, mods = body.mods,
   * surface = Oberflächenname (für Erweiterungen; Reibung/Rollwiderstand rechnet sim.js je Rad).
   * → { force (N, vorwärts positiv; Zugkraft minus Motorbremse, vor Reibungsgrenze), brake (0 … 1, wirksame Bremse) }
   */
  step(h, vF, controls, mods, surface) {
    void surface;
    const E = this.E, s = this.state, out = this._out;
    const c = controls || {};
    this.vF = vF;
    const idle = E.idleRpm || 700, rated = E.ratedRpm || 2600;
    const cut = mods && mods.cutRpm ? Math.min(E.cutRpm || rated, mods.cutRpm) : (E.cutRpm || rated);
    const mode = c.gearbox === 'hold' ? 'hold' : 'auto';
    s.gearbox = mode;
    const maxG = (mods && mods.maxGear) || 99;
    const immobile = !!(mods && mods.immobile);
    let brake = clamp(+c.brake || 0, 0, 1);
    let thr = 0;
    out.force = 0;

    // Gang-Obergrenze (Kettenschaden): höhere Gänge sind gesperrt
    if (Math.abs(s.targetGear) > maxG) { s.targetGear = Math.sign(s.targetGear) * maxG; if (!s.shifting) { s.shifting = true; this.shiftT = E.shiftTime ?? 0.5; } }
    if (Math.abs(s.gear) > maxG && !s.shifting) { s.shifting = true; this.shiftT = E.shiftTime ?? 0.5; s.targetGear = Math.sign(s.gear) * maxG; }

    // --- Automatik: Gangwahl aus der Gasrichtung (Gas gegen die Fahrt = Bremse)
    const steerIn = Math.abs(+c.steer || 0);
    if (mode === 'auto' && this.engineOn) {
      const t = clamp(+c.throttle || 0, -1, 1);
      const want = t > 0.05 ? 1 : t < -0.05 ? -1 : 0;
      const moving = vF > 0.8 ? 1 : vF < -0.8 ? -1 : 0;
      if (want) {
        if (moving && want !== moving) brake = Math.max(brake, Math.abs(t));
        else {
          if (Math.sign(s.targetGear) !== want) this.setGear(Math.abs(vF) < 0.8 ? want : this._autoGear(want, vF));
          thr = Math.abs(t);
        }
      } else if (Math.abs(vF) < 0.3 && s.gear && steerIn < 0.1) this.setGear(0); // steht ohne Gas: N (Schlaf möglich)
    }

    // --- Schaltpause
    if (s.shifting) {
      this.shiftT -= h;
      if (this.shiftT <= 0) this._engage(cut, mode);
    }
    // Vorwahl (Gang halten): gewählter kleinerer Gang wird eingelegt, sobald die Drehzahl es erlaubt
    if (!s.shifting && s.gear !== s.targetGear && s.gear && Math.sign(s.targetGear) !== -Math.sign(s.gear)) {
      const next = s.gear - Math.sign(s.gear);
      if (!next || this.syncRpm(next, vF) <= (E.cruiseRpm || rated)) { s.shifting = true; this.shiftT = E.shiftTime ?? 0.5; }
    }
    const pending = !s.shifting && s.gear !== s.targetGear;

    const g = s.gear, dir = Math.sign(g);
    const i = this.ratio(g), r = E.sprocketR || 0.35, eta = E.efficiency || 0.8;
    const nWheel = this.syncRpm(g, vF);
    this.nWheel = nWheel;
    let n = s.rpm, lug = false;

    if (!this.engineOn) {
      // Motor aus: Drehzahl fällt auf 0
      this.Te = 0;
      n = s.rpm + (0 - s.rpm) * Math.min(1, h / 0.5);
      if (n < 20) n = 0;
    } else if (!g || s.shifting || immobile) {
      // N / Kupplung offen: keine Zugkraft; Drehzahl läuft zur Synchron- bzw. Leerlaufdrehzahl (frei: Gas = hochdrehen)
      thr = mode === 'hold' ? clamp(+c.throttle || 0, 0, 1) : thr;
      if (brake > 0) thr = 0;
      let target = idle + (cut - idle) * thr * 0.9;
      if (s.shifting && s.targetGear) target = Math.max(idle, Math.min(cut, this.syncRpm(s.targetGear, vF)));
      if (!g && !s.shifting && steerIn > 0.1) target = Math.max(target, E.pivotRpm || idle + (rated - idle) * 0.47); // Neutrallenkung
      const tau = s.shifting ? 0.12 : 0.3;
      n = s.rpm + (target - s.rpm) * Math.min(1, h / tau);
      this.Te += (torqueAt(E.torque, n) * thr * (mods ? mods.torque ?? 1 : 1) - this.Te) * Math.min(1, h / (E.torqueLag || 0.25));
      // Schleppverluste von Getriebe/Laufwerk ohne Kraftschluss (Ausrollen), Feststellbremse im Stand
      if (E.neutralDrag) out.force = -clamp(vF / 0.5, -1, 1) * E.neutralDrag;
      if (!g && !s.shifting && Math.abs(vF) < 0.3 && steerIn < 0.1) brake = Math.max(brake, 1);
    } else {
      // Gang eingelegt: Drehzahlregler (Gang halten) bzw. Fahrpedal (Automatik)
      if (mode === 'hold') {
        const want = (+c.throttle || 0) > 0.01 ? cut : (E.cruiseRpm || rated);
        thr = pending ? clamp(+c.throttle || 0, 0, 1) : clamp(Math.max(+c.throttle || 0, (want - s.rpm) / 200), 0, 1);
      }
      if (brake > 0) thr = 0;
      // Wandler: unterhalb der Überbrückung Schlupf mit Drehmomentwandlung
      const conv = E.converter;
      let k = 1;
      if (conv && nWheel < conv.coupleRpm) {
        n = Math.max(nWheel, idle + (conv.stallRpm - idle) * thr);
        k = 1 + (conv.mult - 1) * (1 - nWheel / conv.coupleRpm);
      } else n = Math.max(nWheel, conv ? 0 : idle * 0.6);
      const T = n > cut ? 0 : torqueAt(E.torque, n);
      this.Te += (T * thr * (mods ? mods.torque ?? 1 : 1) - this.Te) * Math.min(1, h / (E.torqueLag || 0.25));
      let F = dir * Math.max(0, this.Te) * k * i * eta / r;
      // Motorbremse: Schleppmoment über den Gang (nur ohne Last, weich ausgeblendet); über Abregeldrehzahl ×3
      const eb = E.engineBrake;
      if (eb && nWheel > idle) {
        const w = clamp(1 - thr / 0.15, 0, 1);
        if (w > 0) {
          let Tb = eb[0] + eb[1] * (Math.min(nWheel, cut * 1.15) - idle);
          if (nWheel > cut) Tb *= 3;
          if (conv && nWheel < conv.coupleRpm) Tb *= nWheel / conv.coupleRpm;
          F -= dir * Tb * w * i / (eta * r);
        }
      }
      out.force = F;
      lug = Math.abs(g) >= 2 && thr > 0.8 && nWheel < (E.lugRpm || idle + (rated - idle) * 0.26);
    }
    if (n > cut * 1.12) n = cut * 1.12;
    s.rpm = n;
    s.rpmNorm = this.engineOn || n > 0 ? Math.max(0, (n - idle) / (rated - idle)) : 0;
    s.throttle = thr;
    s.lugging = lug;
    if (immobile) out.force = 0;
    this.force = out.force;
    out.brake = brake;
    if (mode === 'auto' && this.engineOn) this._autoShift(h, thr, n, nWheel, maxG, cut);
    return out;
  }

  /** Kupplung schließt: Zielgang einlegen; beim Herunterschalten nie über die Abregeldrehzahl (Rest bleibt Vorwahl). */
  _engage(cut, mode) {
    const s = this.state;
    let g = s.targetGear;
    if (g && this.syncRpm(g) > cut) {
      // nächstgrößerer Gang derselben Richtung, der die Drehzahl verträgt
      const dir = Math.sign(g);
      while (this.gears.includes(g + dir) && this.syncRpm(g) > cut) g += dir;
    }
    const was = s.gear;
    s.gear = g;
    if (mode !== 'hold') s.targetGear = g;
    s.shifting = false;
    this.shiftT = 0;
    this.autoHold = 0.8;
    if (g !== was || g !== s.targetGear) this._emit(g, false);
  }

  /** Automatik: hochschalten ab autoUp, runter ab autoDown (nur bei überbrücktem Wandler), Kickdown bei Vollgas. */
  _autoShift(h, thr, n, nWheel, maxG, cut) {
    const E = this.E, s = this.state;
    this.autoHold = Math.max(0, this.autoHold - h);
    if (s.shifting || !s.gear) return;
    const g = s.gear, dir = Math.sign(g);
    // fast stehend (Kurve auf der Stelle, Anhalten): zurück in den 1. Gang bzw. R1, wie eine Wandlerautomatik
    if (Math.abs(g) > 1 && Math.abs(this.vF) < 1.0) { this.setGear(dir); return; }
    if (this.autoHold > 0) return;
    const up = g + dir, down = g - dir;
    const conv = E.converter, couple = conv ? conv.coupleRpm : 0;
    const kick = E.kickRpm || (E.idleRpm + (E.ratedRpm - E.idleRpm) * 0.42);
    const upRpm = Math.min(E.autoUp, cut * 0.94); // Notlauf (niedrige Abregelung): früher hochschalten
    if (n >= upRpm && this.gears.includes(up) && Math.abs(up) <= maxG && thr > 0.05) {
      s.targetGear = up; s.shifting = true; this.shiftT = E.shiftTime ?? 0.5;
    } else if (Math.abs(g) > 1 && this.syncRpm(down) < upRpm * 0.92
      && ((n <= E.autoDown && nWheel >= 0.6 * couple) || (thr > 0.9 && n < kick))) {
      // runter nur, wenn der kleinere Gang nicht gleich wieder hochschalten müsste (kein Pendeln)
      s.targetGear = down; s.shifting = true; this.shiftT = E.shiftTime ?? 0.5;
    }
  }
}
