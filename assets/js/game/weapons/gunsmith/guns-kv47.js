// KV-47 nach Referenzfoto (polnisches AKM 1971, kv47-ref.js) – Nutzer 24.10.2026: „Mach die Waffen viel detaillierter …
// nimm echte Bilder aus dem Internet und mach sie danach … Detailgrad wie bei der P-9 und der M-17“. Verfahren wie dort:
// Umrisse aus den (perspektivisch entzerrten) Fotos verfolgt und kalibriert, Bauteile als Distanzfelder mit eigener Breite
// bzw. als Blech-/Profil-Extrusionen, Holz und Gehäuse mit eigenem Atlas (kv47-tex.js). Die Baugruppen stammen aus dem
// AK-Baukasten (ak-parts.js), damit KV-74U, LM-8, Uhu und Hagel sie mit ihren eigenen Maßen nutzen.
// Detailstufen: PC hoch/ultra (b.max) feinste Netze + Kanten-/Muldenfarbe + Kleinteile, PC niedrig/mittel Standard,
// Handy (b.lite) gröbere Netze und kleiner Atlas, Bots ≤ 600 Dreiecke – Anker in allen Stufen gleich.
import * as R from './kv47-ref.js';
import { woodUV, recUV } from './kv47-tex.js';
import { akKit, akReceiver, akDustCover, akSafety, akCarrier, akRearSight, akFrontSight, akBarrel, akGasTube, akLowerHandguard, akStock, akGrip, akTriggerGroup, akMagazine, akBot } from './ak-parts.js';

const { U, V } = R;
const MAT = { rec: 'kv47Rec', steel: 'kv47Steel', wood: 'kv47Wood', mag: 'kv47Mag', bcg: 'kv47Bcg' };

export function kv47(b) {
  const K = akKit(b, R, { mat: MAT, uv: { rec: recUV, wood: woodUV } });
  let end;
  if (b.hi) {
    akStock(K); akGrip(K); akReceiver(K); akDustCover(K); akSafety(K); akCarrier(K); akTriggerGroup(K);
    akRearSight(K); akGasTube(K); akLowerHandguard(K); end = akBarrel(K); akFrontSight(K); akMagazine(K);
  } else end = akBot(K);
  // Anker (alle Stufen gleich): Mündung, Auswurf (Rückfall ohne Verschlussstirn), Abzug, Hände, Schacht, Visier
  b.anchor('muzzle', 0, R.AXIS, end + 0.002);
  b.anchor('ejection', K.hwR + 0.002, V(930), U(1900), { rz: 0.5 });
  b.anchor('trigger', 0, V(1168), U(1452));
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.33, gw: 0.0148, gd: 0.0198, gu: 0.0, ho: 0.026, tu: 0.04 } });
  b.anchor('leftHandGrip', 0, V(1098), U(2470), { data: { style: 'under', w: 0.022, h: 0.026 } });
  b.anchor('magWell', 0, V(R.MAG_PIVOT[1]), U(R.MAG_PIVOT[0]));
  b.anchor('sight', 0, V(R.SIGHT_Y), U(R.RS_BLADE[0] + 12), { data: { type: 'iron', eyeRelief: 0.38 } });
  // Wahlhebel (in SICHER gebaut): DAUER und EINZEL nach den Rastmarken rechts (Lasche 12° bzw. 19° tiefer)
  // Wahlhebel: Drehung um die Nabe von SICHER (oben, wie im Foto) auf die Marken D (−13,6°) und E (−20,5°), aus SEL_MARKS
  b.meta = { sight: 'iron', axis: R.AXIS, kind: 'rifle', selector: { auto: -0.24, semi: -0.36 } };
}
