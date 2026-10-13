// NULLPUNKT — Gold der ersten Stunde (Nutzer 13.10.2026): wer bis einschließlich 13.10.2026 gespielt hat, behält es für
// immer. Eigener Schlüssel 'nullpunkt:og' (nur Ja/Nein), den weder „Fortschritt zurücksetzen“ noch „Lokale Daten löschen“
// entfernt; weg nur, wenn man die Browserdaten der Seite löscht. Genutzt von shared/profile.js und site/about-view.js.

export const OG_KEY = 'nullpunkt:og';
export const OG_CUTOFF = Date.UTC(2026, 9, 13, 22, 0, 0); // 14.10.2026 00:00 MESZ

/** Liegt das Gold schon sicher im eigenen Schlüssel? */
export function ogStored(storage) {
  try { return !!(storage && JSON.parse(storage.getItem(OG_KEY) || 'null')?.og); } catch { return false; }
}

/** Gold sichern (einmal schreiben). */
export function ogKeep(storage) {
  if (!storage || ogStored(storage)) return;
  try { storage.setItem(OG_KEY, JSON.stringify({ og: true })); } catch { /* gesperrt/voll */ }
}

/**
 * Hat dieser gespeicherte Spielstand Anspruch? Gold schon im Profil, oder Spielstand aus der Zeit vor dem Gold
 * (ogChecked fehlt) mit Matches/Spielzeit/EP – oder überhaupt gespielt, solange der 13.10. noch läuft.
 */
export function ogEarned(profileRaw, fbPlay = 0, now = Date.now()) {
  const p = profileRaw && typeof profileRaw === 'object' ? profileRaw : null;
  const played = !!p && ((Number(p.matches) || 0) > 0 || (Number(p.playtime) || 0) > 0 || (Number(p.xp) || 0) > 0);
  if (p && p.og === true) return true;
  if (p && p.ogChecked !== true && (played || fbPlay > 0)) return true;
  return now < OG_CUTOFF && (played || fbPlay > 0);
}

/** Vor dem Löschen aufrufen: Anspruch aus dem noch vorhandenen Spielstand prüfen und sichern. */
export function secureOg(storage) {
  if (!storage || ogStored(storage)) return;
  let p = null, fb = 0;
  try { p = JSON.parse(storage.getItem('nullpunkt:profile') || 'null'); } catch { p = null; }
  try { fb = Number(JSON.parse(storage.getItem('nullpunkt:feedback') || '{}').play) || 0; } catch { fb = 0; }
  if (ogEarned(p, fb)) ogKeep(storage);
}
