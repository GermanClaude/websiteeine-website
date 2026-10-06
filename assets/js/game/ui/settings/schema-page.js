// NULLPUNKT — Einfache Einstellungsseite: alle Schlüssel einer Schema-Gruppe als Zeilen (Audio, Profil, Spiel).

import { rowHtml, bindRows, syncRows } from './rows.js';

/** Kurze Erklärungen unter den Beschriftungen (alle Seiten). */
export const HINTS = {
  touchSensitivity: 'Blick ziehen auf der rechten Bildschirmhälfte.',
  aimAssist: 'Verlangsamt das Zielen über Gegnern und zieht leicht mit – Touch und Controller.',
  autoFire: 'Feuert, sobald ein Gegner im Fadenkreuz ist („einfacher Modus“).',
  quality: 'Automatisch passt sich dem Gerät an und regelt bei Ruckeln nach.',
  fov: 'Horizontales Sichtfeld, bezogen auf ein 4:3-Bild. Breitere Bildschirme sehen seitlich mehr.',
  reducedMotion: 'Weniger Wackeln, Verzeichnung und Animationen. Folgt auch der Systemeinstellung.',
  difficulty: 'Vorgabe für die Lobby.',
  adaptiveBots: 'Gegnerische Bots lernen deinen Stil (Plätze, Distanzen, Routen) und passen ihre Taktik an – leicht ab Regulär, stark auf Elite. Zielen und Reaktion bleiben unverändert.',
  playerName: 'Erscheint in Tabelle und Abschussmeldungen.',
  sensitivity: 'Rohe Mausbewegung (ohne Beschleunigung des Systems).',
  sensitivityY: 'Faktor für die senkrechte Achse – gilt für Maus, Controller, Touch und Gyro.',
  adsSensitivity: 'Kimme, Rotpunkt und Holo.',
  adsSensitivityMid: 'Zielfernrohre mit 2- bis 4-facher Vergrößerung.',
  adsSensitivityHigh: 'Scharfschützen-Optiken.',
  zoomSensitivityCoef: '0 %: gleiche Drehung je Bildmitte wie bisher. 75 %/100 %: gleiche Bewegung am Bildrand wie ohne Zoom (wie in vielen PC-Spielen).',
  freeAim: 'Die Waffe bewegt sich zuerst, die Sicht dreht erst am Rand der Totzone – wie bei Bodycam. Nicht auf Touch.',
  padCurve: 'Linear: direkt. Klassisch: fein in der Mitte. Dynamisch: fein in der Mitte, schnelle Drehung am Rand.',
  padDeadzone: 'Kleine Stick-Ausschläge werden ignoriert (gegen Abdriften).',
  padOuterDeadzone: 'Ab hier gilt der Stick als ganz ausgelenkt.',
  padSwapSticks: 'Bewegen rechts, Umsehen links.',
  padVibration: 'Bei Treffern, Abschüssen, Schaden und nahen Explosionen.',
  aimAssistStrength: 'Wie stark die Zielhilfe bremst und mitzieht.',
  aimAssistLevel: 'Stufenlos: bis 35 % nur Abbremsen über Gegnern, dann Mitziehen, ab 85 % zunehmendes Einrasten – 100 % rastet voll ein.',
  aimAssistDevices: 'Für welche Eingabegeräte die Zielhilfe gilt (mit „Alle“ auch Maus).',
  autoFireLevel: 'Verzögerung, Reichweite und Toleranz des automatischen Feuerns: niedrig = vorsichtig und kurz, hoch = sofort und auf volle Waffenreichweite.',
  autoFireDevices: 'Für welche Eingabegeräte das automatische Feuern gilt.',
  gameStyle: 'Arcade: das bekannte Spiel. Realistisch: keine Gegneranzeigen, minimales HUD, mehr Schaden, langsamere Heilung.',
  realisticCrosshair: 'Zeigt im Spielstil „Realistisch“ trotzdem ein Fadenkreuz.',
  fullscreen: 'Automatisch: Vollbild bei „Einsatz starten“ und beim Fortsetzen, auf dem Smartphone auch beim Tippen auf die Steuerung im Match. Umschalten jederzeit mit Alt + Eingabe oder der Vollbild-Taste (Belegung). Esc verlässt das Vollbild wie gewohnt und pausiert das Spiel.',
  gyroMode: 'Zielen durch Neigen und Drehen des Geräts, zusätzlich zum Ziehen.',
  touchOpacity: 'Gilt für alle Knöpfe; einzelne Knöpfe im Layout-Editor.',
  touchButtonScale: 'Gilt für alle Knöpfe; einzelne Knöpfe im Layout-Editor.',
  cameraMotion: 'Wackeln der Körperkamera beim Laufen, Atmen, Landen und unter Beschuss. Weniger hilft gegen Übelkeit.',
  weaponSway: 'Nachschwingen und Schwanken der Waffe.',
  lensStrength: 'Fischauge der Körperkamera. Die Bildmitte bleibt unverzerrt, das Zielen stimmt immer.',
  grain: 'Sensorrauschen wie bei einer echten Kamera, in dunklen Bereichen stärker.',
  lensArtifacts: 'Leichte Blockbildung und Farbunschärfe wie bei Videokompression.',
  lensBorder: 'Abgerundeter, dunkler Rand wie bei einer Körperkamera.',
  autoExposure: 'Das Bild passt sich hell und dunkel an – aus dem Flur ins Freie brennt es kurz aus.',
  sharpness: 'Nachschärfen nach der Hochskalierung.',
  upscaler: 'FSR 1.0 hält das Bild bei verkleinerter Auflösung scharf.',
  weaponPose: 'Körperkamera: Waffe tiefer und mittiger, verdeckt weniger vom Bild.',
  hudStyle: 'Realismus: kein Fadenkreuz, keine Munitions- und Lebensanzeige, keine Minikarte – wie bei Bodycam.',
  bodycamStamp: 'Uhrzeit und erfundene Geräte-ID in der Bildecke, wie bei einer Körperkamera-Aufnahme.',
  showFps: 'Bildrate unten links.',
  audioMix: 'Handy: hebt Schritte und Stimmen hervor, nimmt tiefe Bässe weg.',
};

/**
 * Seite aus einer Schema-Gruppe. extraHints überschreibt HINTS; order = feste Reihenfolge (sonst Schema-Reihenfolge).
 * Rückgabe: Fabrik (P) → Seite { keys, mount(host), unmount(), sync(key) }.
 */
export function schemaPage(group, { order = null, extraHints = {} } = {}) {
  return (P) => {
    const schema = P.settings.schema;
    let keys = Object.keys(schema).filter((k) => schema[k].group === group);
    if (order) keys = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
    let host = null;
    let off = null;
    return {
      keys,
      mount(h) {
        host = h;
        host.innerHTML = keys.map((k) => rowHtml(P, k, { hint: extraHints[k] || HINTS[k] })).join('');
        off = bindRows(host, P);
      },
      unmount() { if (off) off(); off = null; host = null; },
      sync(key) { if (host && keys.includes(key)) syncRows(host, P, key); },
    };
  };
}
