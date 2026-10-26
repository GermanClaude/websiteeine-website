// NULLPUNKT — Zielpunkte der neuen Modi je Karte (Plan M1/B7, 26.10.): eigene Datei, damit die Karten-Spur in
// world/maps/<karte>.js arbeiten kann, ohne dass sich Modi und Karten in die Quere kommen.
//   { <karte>: { hp: [...], sd, ctf, gf, abwehr } } – bisher nur hp (Stellung). Eintrag: { id, name, x, z, radius,
//   y? (Suchhöhe für die Bodenanpassung, z. B. Galerien), band? [unten, oben] (m relativ zum Boden der Zone; ohne:
//   ±2,6 m wie Herrschaft) }.
// world/index.js mischt die Punkte über modusZielQuellen()/modusZieleBauen() in world.objectives (Bodenhöhe aus dem
// Welt-Worker wie bei den Herrschaftsflaggen). Reihenfolge = Wanderung der Stellung. Jede Karte ist spiegelgleich in z
// (Team A +z, Team B −z): Zonen liegen auf der Mittellinie oder paarweise gespiegelt, damit kein Team im Vorteil ist.
// Prüfregeln (tools/hp-test.mjs): Zone ≥ 20 m von den Team-Startbereichen, Kartenpunkte (mappoints.js) ≥ 4 m außerhalb
// des Kreises, Mittelpunkt frei und über den Navigationsgraph erreichbar (Prüfstand dev/world.html → „Modus-Ziele“).

export const MODUS_ZIELE = Object.freeze({
  werk: {
    hp: [
      { id: '1', name: 'Walzhalle', x: -9, z: 0, radius: 6, band: [-1, 2.4] },
      { id: '2', name: 'Halle 9', x: -68, z: 0, radius: 6 },
      { id: '3', name: 'Kesselhaus', x: 37, z: 0, radius: 6, band: [-1, 6] },
      { id: '4', name: 'Lkw-Hof Nord', x: -39, z: -17, radius: 5 },
      { id: '5', name: 'Lkw-Hof Süd', x: -39, z: 17, radius: 5 },
    ],
  },
  altstadt: {
    hp: [
      { id: '1', name: 'Brunnenplatz', x: 10, z: 0, radius: 6 }, // östlich des Brunnens: das Glockenseil (−4,5, 0) bleibt draußen
      { id: '2', name: 'Kirche', x: 25, z: 0, radius: 6 },
      { id: '3', name: 'Torhaus', x: -21.5, z: 0, radius: 5 },
      { id: '4', name: 'Werkstatt', x: 40.5, z: 0, radius: 5 },
      { id: '5', name: 'Ölbaumplatz', x: 56, z: 0, radius: 6 }, // westlich des Ölbaums (Stamm bei x 58–61)
    ],
  },
  hafen: {
    hp: [
      { id: '1', name: 'Kranplatz', x: -24, z: 0, radius: 6 },
      { id: '2', name: 'Lagerhalle 3', x: 28, z: 0, radius: 7 },
      { id: '3', name: 'Kaikante', x: -36.5, z: 0, radius: 7 },
      { id: '4', name: 'Schuppen 4', x: 63, z: 0, radius: 6 },
    ],
  },
  bibliothek: {
    hp: [
      // Die Brücken (z ±11) lagen nur 14 m über einem Startbereich und hatten kaum Platz (9 Nav-Knoten) – stattdessen
      // wechseln Galerien (y 4,4) und Lesesaal (Boden) auf der Mittellinie ab (Prüfstand 26.10.)
      { id: '1', name: 'Rotunde', x: 0, z: 0, radius: 5 },
      { id: '2', name: 'Westgalerie', x: -34, z: 0, y: 4.4, radius: 4, band: [-0.6, 2.6] },
      { id: '3', name: 'Lesesaal Ost', x: 20, z: 0, radius: 5 },
      { id: '4', name: 'Ostgalerie', x: 34, z: 0, y: 4.4, radius: 4, band: [-0.6, 2.6] },
      { id: '5', name: 'Lesesaal West', x: -20, z: 0, radius: 5 },
    ],
  },
});

/** Alle Ziele einer Karte (leer, wenn es keine gibt). */
export function modusZiele(mapId) {
  return MODUS_ZIELE[mapId] || {};
}

/** Quellpunkte für die Bodenanpassung im Welt-Worker: [{ kind: 'hp', o }] in fester Reihenfolge. */
export function modusZielQuellen(mapId) {
  const out = [];
  for (const [kind, list] of Object.entries(modusZiele(mapId))) for (const o of list || []) out.push({ kind, o });
  return out;
}

/**
 * Ziele für world.objectives: { hp: [{ id, name, position, radius, band }] }. yAt(k) = Bodenhöhe des k-ten Quellpunkts
 * (Welt-Worker); V = THREE.Vector3 (übergeben, damit diese Datendatei three.js nicht selbst lädt).
 */
export function modusZieleBauen(src, yAt, V) {
  const out = {};
  src.forEach(({ kind, o }, k) => {
    const y = yAt(k);
    (out[kind] || (out[kind] = [])).push({
      id: String(o.id), name: o.name || String(o.id), position: new V(o.x, Number.isFinite(y) ? y : o.y ?? 0, o.z),
      radius: o.radius ?? 5, band: Array.isArray(o.band) ? [o.band[0], o.band[1]] : null,
    });
  });
  return out;
}
