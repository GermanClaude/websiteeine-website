// Erzeugt docs/AUDIO_SOURCES.md aus Rezepten + Freesound-Metadaten (tools/out/audio/meta/*.json) + Manifest.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const META = resolve(ROOT, 'tools/out/audio/meta');
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const LIC = { 'CC0-1.0': '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)', 'CC-BY-4.0': '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)', 'CC-BY-3.0': '[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)' };

export function sourceInfo(src, SOURCES) {
  const kind = src.slice(0, src.indexOf(':')), rest = src.slice(src.indexOf(':') + 1);
  if (kind === 'fs') {
    const p = resolve(META, `${rest}.json`);
    if (!existsSync(p)) return { key: src, title: `Freesound #${rest}`, author: '?', url: `https://freesound.org/s/${rest}/`, license: '?' };
    const m = JSON.parse(readFileSync(p, 'utf8'));
    return { key: src, title: m.title, author: m.user, url: m.page, license: m.license, licenseUrl: m.licenseUrl, attribution: m.attributionRequired, orig: m.original, desc: m.description, fetched: m.fetched, preview: m.preview };
  }
  const S = SOURCES[kind];
  return { key: kind, title: S.title + (kind === 'ffsl' ? ` – ${rest}` : ` – ${rest}`), author: S.author, url: S.url, license: S.license, licenseUrl: S.licenseUrl, file: S.file, note: S.note };
}

export function writeSourcesDoc(RECIPES, SOURCES, manifest) {
  const L = [];
  L.push('# NULLPUNKT – Herkunft der aufgenommenen Klänge', '');
  L.push('Alle Dateien unter `assets/lib/audio/**` sind aus Aufnahmen mit **CC0** (gemeinfrei) geschnitten. Es wird **keine** Datei mit NC/ND/SA- oder unklarer Lizenz verwendet. Eine Namensnennung ist bei CC0 nicht nötig – wir nennen die Urheber trotzdem (siehe unten).', '');
  L.push('- Erzeugt von `tools/audio/build.mjs` aus der Schnittliste `tools/audio/recipes.mjs` (diese Datei wird dabei neu geschrieben).');
  L.push('- Freesound: abgerufen wurde jeweils die öffentliche HQ-Vorschau (Ogg Vorbis, ~110–190 kbit/s) – sie steht unter derselben Lizenz wie das Original; Lizenz je Datei auf der Klangseite geprüft (`tools/audio/fs-fetch.mjs` bricht bei anderer Lizenz als CC0/CC BY ab).');
  L.push('- Free Firearm Sound Library: Archiv „Prepared SFX Library.7z“ von OpenGameArt (CC0).');
  L.push('- Kenney Impact Sounds: Archiv von kenney.nl (CC0, `License.txt`).');
  L.push(`- Stand: ${manifest.generated} · ${manifest.totals.files} Dateien · ${manifest.totals.MB} MB · ${manifest.totals.seconds} s Audio.`, '');
  L.push('Wiederherstellen der Rohdaten (nicht im Repo, `tools/out/` ist ignoriert):', '');
  L.push('```sh', 'node tools/audio/fs-search.mjs "<suche>"          # Kandidaten (nur CC0-Filter) → tools/out/audio/candidates.json', 'node tools/audio/fs-fetch.mjs <id> …              # Metadaten + HQ-Vorschau je Freesound-ID',
    'curl -L -o tools/out/audio/ffsl/prepared.7z "https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z"   # entpacken (7za) nach tools/out/audio/ffsl/',
    'curl -L -o tools/out/audio/kenney/impact.zip "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip"  # entpacken nach tools/out/audio/kenney/impact/',
    'node tools/audio/build.mjs                        # schneiden, normalisieren, MP3 kodieren, Manifest + diese Datei', '```', '');
  // Quellen (eindeutig)
  const uniq = new Map();
  for (const r of RECIPES) { const s = sourceInfo(r.src, SOURCES); const k = s.key; if (!uniq.has(k)) uniq.set(k, { ...s, outputs: [] }); uniq.get(k).outputs.push(`${r.name}_${r.v}`); }
  L.push('## Quellen', '');
  L.push('| Quelle | Urheber | Lizenz | Original | verwendet in |', '|---|---|---|---|---|');
  for (const s of uniq.values()) {
    const orig = s.orig ? `${esc(s.orig.type)} ${esc(s.orig.sampleRate)} ${esc(s.orig.bitDepth)} ${esc(s.orig.channels)}` : (s.key === 'ffsl' ? 'WAV 96 kHz/24 bit Stereo' : s.key === 'kenney' ? 'Ogg Vorbis' : '');
    L.push(`| [${esc(s.key === 'ffsl' || s.key === 'kenney' ? s.title.split(' – ')[0] : s.title)}](${s.url}) | ${esc(s.author)} | ${LIC[s.license] || esc(s.license)} | ${orig} | ${s.outputs.length} Datei${s.outputs.length > 1 ? 'en' : ''} |`);
  }
  L.push('');
  for (const s of uniq.values()) if (s.note) L.push(`- **${esc(s.title.split(' – ')[0])}:** ${esc(s.note)} Download: ${s.file}`);
  L.push('');
  // Dateien
  L.push('## Dateien', '');
  const groups = {};
  for (const r of RECIPES) (groups[r.group] ||= []).push(r);
  for (const [g, rs] of Object.entries(groups)) {
    L.push(`### ${g}/`, '', '| Datei | Quelle | Urheber | Lizenz | Schnitt | Bearbeitung | Größe |', '|---|---|---|---|---|---|---|');
    for (const r of rs) {
      const s = sourceInfo(r.src, SOURCES), m = manifest.sounds[r.name]?.variants.find(v => v.v === r.v);
      const cut = r.loop ? `${r.at}–${(r.at + r.len + r.loop).toFixed(2)} s (Schleife, ${r.loop} s Überblendung)` : `ab ${(r.at - (r.pre ?? 0.002)).toFixed(3)} s, ${r.len} s`;
      const proc = [r.ch === 1 ? 'Mono' : `Stereo${r.width != null && r.width !== 1 ? ` (Breite ${r.width})` : ''}`, r.hp ? `HP ${r.hp} Hz` : '', r.lp ? `TP ${r.lp} Hz` : '', ...(r.eq || []).map(e => `${e.type} ${e.f} Hz ${e.g} dB`), r.denoise ? 'Entrauschen' : '', r.punch ? `Limiter +${r.punch} dB (Dichte)` : '', r.cutoff ? `MP3-Grenzfrequenz ${r.cutoff / 1000} kHz` : '',
        r.fadeIn ? `Einblenden ${r.fadeIn} s` : '', r.fade ? `Ausblenden ${(+r.fade).toFixed(2)} s` : '', r.gainFrom ? `Pegel wie ${r.gainFrom}` : r.target?.lufs != null ? `${r.target.lufs} LUFS (M max)` : `Spitze ${r.target?.peak ?? r.ceil ?? -1.5} dBFS`, `MP3 ${r.kbps} kbit/s ${r.rate / 1000} kHz`].filter(Boolean).join(', ');
      L.push(`| \`${g}/${r.name}_${r.v}.mp3\` | [${esc(s.title)}](${s.url}) | ${esc(s.author)} | ${LIC[s.license] || esc(s.license)} | ${cut} | ${proc} | ${m ? (m.bytes / 1024).toFixed(1) + ' KB' : ''} |`);
    }
    L.push('');
  }
  L.push('## Geprüft und verworfen', '');
  L.push('- **Lizenz ungeeignet:** „Handling Guns“ (OpenGameArt, CC BY-SA 3.0 – Weitergabe unter gleichen Bedingungen nicht vorgesehen), Sonniss GDC-Pakete (lizenzfrei, aber keine Weitergabe der Rohdateien in einem öffentlichen Repo), Pixabay/Zapsplat-Website (eigene Lizenzen ohne Weitergaberecht), BBC Sound Effects (nur nicht-kommerziell), alles mit NC/ND.');
  L.push('- **Herkunft unklar (vermutlich aus Spielen kopiert):** u. a. Freesound „G36-E Fire“, „Sniper Rifle M24 SFX.mp3“, „galil/ak47 reload sound.mp3“ – trotz CC0-Angabe nicht verwendet.');
  L.push('- **Qualität:** viele CC0-Schussaufnahmen auf Freesound sind stark übersteuert (Crest-Faktor 4–10 dB, tausende geclippte Samples, z. B. „M16 burst in street“, „AK47 Shot“, „Single Gunshot“-Reihe) oder synthetisch („created with Audacity“, „Physically Synthesized“). Die FFSL-Aufnahmen haben 17–22 dB Crest-Faktor, Rauschboden −64…−92 dBFS und volle Bandbreite.');
  L.push('- **Unklare Rechtekette:** „Real Bullet Flyby Sound“ (Freesound 855248, aus einem NATO-Channel-Video extrahiert – kein US-Regierungswerk) und „Silenced Pistol Layered“ (Freesound 255716, „PP7“ – vermutlich aus einem Spiel aufgenommen) trotz CC0-Kennzeichnung entfernt. Behalten wurden nur Video-Auszüge von US-Bundesbehörden (gemeinfrei nach 17 U.S.C. § 105): Freesound 182429 und 162363 (qubodup).');
  L.push('- **Kenney-Schritte Beton/Holz:** stark bandbegrenzt (Holz < 1,4 kHz) → nur Gras übernommen.');
  L.push('- **Airsoft-Nachladeklänge** („AK-47 being unloaded and reloaded“, aus Airsoft-Waffen gemischt) zugunsten echter AR-15/Mauser/Pumpflinten-Aufnahmen verworfen.');
  L.push('');
  writeFileSync(resolve(ROOT, 'docs/AUDIO_SOURCES.md'), L.join('\n'));
  console.log('docs/AUDIO_SOURCES.md geschrieben');
}
