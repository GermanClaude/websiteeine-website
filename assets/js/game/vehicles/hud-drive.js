// NULLPUNKT — Antriebsanzeige im Fahrzeug-HUD (docs/planung/panzer-mp.md §A.6): Gangleiste, Drehzahlbalken, Modus,
// Hinweise und Touch-Knöpfe „Gang +“/„Gang −“. (Zwischenstand: Schnittstelle steht, Anzeige folgt.)

export class DriveHUD {
  constructor(vehicleHud) {
    this.hud = vehicleHud;
  }

  /** s wie VehicleHUD.update (seated, vehicle, seat, keyFor …). */
  update(dt, s) { void dt; void s; }

  dispose() {}
}
