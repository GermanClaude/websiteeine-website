// NULLPUNKT — Rufnamen der Bots (fiktiv, deutsch geprägt), ohne Wiederholung innerhalb eines Matches.
export const CALLSIGNS = [
  'Falke', 'Wolf', 'Kobra', 'Specht', 'Luchs', 'Dachs', 'Bussard', 'Fuchs', 'Rabe', 'Iltis', 'Otter', 'Marder',
  'Hornisse', 'Viper', 'Adler', 'Habicht', 'Keiler', 'Sperber', 'Elster', 'Kranich', 'Uhu', 'Wiesel', 'Bär',
  'Taifun', 'Granit', 'Kiesel', 'Nordlicht', 'Funke', 'Anker', 'Bolzen', 'Lotse', 'Schmied', 'Kompass', 'Riff',
  'Sturmvogel', 'Möwe', 'Gämse', 'Steinbock', 'Hummel', 'Natter', 'Polarfuchs', 'Kauz', 'Nebel', 'Schakal',
  'Zander', 'Hecht', 'Waran', 'Föhn', 'Basalt', 'Quarz', 'Kolibri', 'Ozelot', 'Puma', 'Lanze', 'Pfeil',
];
const PREFIX = ['', '', '', 'Ober', 'Alt', 'Jung', 'Grau', 'Schwarz'];

/** Liefert eine Namensauswahl ohne Dubletten (bereits vergebene Namen werden übersprungen). */
export function pickNames(count, used = new Set(), rnd = Math.random) {
  const pool = CALLSIGNS.filter((n) => !used.has(n));
  const out = [];
  for (let i = 0; i < count; i++) {
    if (pool.length) {
      const k = (rnd() * pool.length) | 0;
      const n = pool.splice(k, 1)[0];
      out.push(n);
      used.add(n);
    } else {
      let n;
      let tries = 0;
      do {
        const base = CALLSIGNS[(rnd() * CALLSIGNS.length) | 0];
        const pre = PREFIX[(rnd() * PREFIX.length) | 0];
        n = pre ? pre + base.toLowerCase() : `${base} ${2 + ((rnd() * 8) | 0)}`;
      } while (used.has(n) && ++tries < 20);
      used.add(n);
      out.push(n);
    }
  }
  return out;
}
