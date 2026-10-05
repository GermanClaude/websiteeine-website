// Schnittliste der aufgenommenen Klänge (Owner: audio-research). Jede Zeile = eine Ausgabedatei
// assets/lib/audio/<group>/<name>_<v>.mp3. Zeiten in Sekunden (Einsätze mit tools/audio/onsets.mjs gemessen).
// Felder: src (fs:<freesound-id> | ffsl:<pfad> | kenney:<datei>), at (Einsatz), len, pre (Vorlauf, Std. 2 ms), fade (Ausblenden),
// fadeIn, hp/lp (Hz), eq [{type,f,g,q}], ch (1|2), width (Stereobreite 0..1), rate, kbps, target {peak|lufs}, ceil,
// gainFrom ("<name>_<v>": gleicher Pegel wie diese Datei – Nachhall bleibt physikalisch zum Fern-Schuss passend),
// loop (Nahtlose Schleife: Überblendlänge in s), layer (near|far|tail|mech|oneshot|bed), catalog (Katalogname der Engine), mix/note (Hinweise).

const FF = 'ffsl:';
export const SOURCES = {
  ffsl: {
    title: 'The Free Firearm Sound Library – „Prepared SFX Library“',
    author: 'The Free Firearm Sound Library (Kickstarter-Projekt, freefirearmsfx.com); OpenGameArt-Upload von „bart“',
    url: 'https://opengameart.org/content/the-free-firearm-sound-library',
    file: 'https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z',
    license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    note: 'Laut Projekt: „Our team holds CC0 NO RIGHTS RESERVED for this library.“ Echte Schüsse, 96 kHz/24 bit Stereo, je Waffe Nah- und Mittel-Distanz (Mikrofone vor dem Schützen, Freigelände).',
  },
  kenney: {
    title: 'Kenney – Impact Sounds (1.0)', author: 'Kenney (www.kenney.nl)', url: 'https://kenney.nl/assets/impact-sounds',
    file: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', note: 'License.txt im Archiv: CC0.',
  },
};

const R = [];
const add = (o) => R.push(o);
const many = (base, list) => list.forEach((x, i) => add({ ...base, v: i + 1, ...(Array.isArray(x) ? { src: x[0], at: x[1], ...(x[2] || {}) } : x) }));

// ------------------------------------------------------------------ Schüsse (FFSL, echte Aufnahmen)
const GUNS = {
  //  near: [datei, einsatz] · far: Mittel-Distanz-Aufnahme (Fern-Schicht + Nachhall-Schicht)
  ar: { len: 1.1, near: [['AR-15/D_32P.wav', 0.702], ['AR-15/D_32P.wav', 5.645], ['Savage 10 .300 Blackout/T_27P.wav', 0.948], ['Savage 10 .300 Blackout/T_27P.wav', 4.966]], far: [['AR-15/D_24P.wav', 0.547], ['AR-15/D_24P.wav', 3.908]], what: 'AR-15 (5,56) + Savage 10 (.300 BLK)' },
  ar_heavy: { len: 1.2, near: [['AK-47/C_28P.wav', 0.609], ['AK-47/C_28P.wav', 3.255], ['AK-47/C_28P.wav', 6.019], ['AK-47/C_28P.wav', 9.154]], far: [['AK-47/C_31P.wav', 0.336], ['AK-47/C_31P.wav', 4.399]], what: 'AK-47 (7,62×39)' },
  smg: { len: 0.95, punch: 5, near: [['Carl Gustav M45/G_31P.wav', 0.308], ['Carl Gustav M45/G_31P.wav', 3.499], ['PPSh/P_30P.wav', 0.967], ['PPSh/P_30P.wav', 4.385]], far: [['Carl Gustav M45/G_20P.wav', 2.257], ['PPSh/P_16P.wav', 5.249]], what: 'Carl Gustav M45 (9 mm) + PPSh (7,62×25)' },
  lmg: { len: 1.25, near: [['Mosin Nagant/M_21P.wav', 1.032], ['Mosin Nagant/M_21P.wav', 5.018], ['Mosin Nagant/M_21P.wav', 9.154]], far: [['Mosin Nagant/M_26P.wav', 1.136], ['Mosin Nagant/M_26P.wav', 6.103]], what: 'Mosin-Nagant (7,62×54R – Patrone des PKM)' },
  sniper: { len: 1.6, eq: [{ type: 'lowshelf', f: 160, g: -5 }], hp: 40, near: [['Tikka/W_29P.wav', 0.575], ['Tikka/W_29P.wav', 5.663], ['1917/B_24P.wav', 1.306], ['1917/B_24P.wav', 6.729]], far: [['Tikka/W_24P.wav', 0.752], ['Tikka/W_24P.wav', 5.375]], what: 'Tikka T3 + Springfield 1917 (.30-06)' },
  shotgun: { len: 1.4, near: [['Nova/O_21P.wav', 0.429], ['Nova/O_21P.wav', 3.463], ['Model 12/K_22P.wav', 0.840], ['Model 12/K_22P.wav', 7.443]], far: [['Nova/O_17P.wav', 0.692], ['Model 12/K_17P.wav', 0.905]], what: 'Benelli Nova + Winchester Model 12 (12 ga)' },
  pistol: { len: 0.9, punch: 5, near: [['Walther PPQ/X_39P.wav', 1.405], ['Walther PPQ/X_39P.wav', 6.442], ['Walther PPQ/X_39P.wav', 10.658], ['Bersa/F_47P.wav', 0.332]], far: [['Walther PPQ/X_31P.wav', 1.083], ['Walther PPQ/X_31P.wav', 5.240]], what: 'Walther PPQ (9 mm) + Bersa (.380)' },
  pistol_heavy: { len: 1.1, near: [['1911/A_42P.wav', 0.939], ['1911/A_42P.wav', 5.000], ['Smith & Wesson 642/V_27P.wav', 0.803], ['Smith & Wesson 642/V_27P.wav', 6.217]], far: [['1911/A_34P.wav', 1.540], ['Smith & Wesson 642/V_22P.wav', 0.670]], what: '1911 (.45 ACP) + S&W 642 (.38 Special)' },
  // zusätzlich für neue Waffen (noch kein Katalogeintrag)
  dmr: { len: 1.2, extra: true, near: [['SKS/U_14P.wav', 3.575], ['SKS/U_14P.wav', 6.753], ['SKS/U_14P.wav', 10.208]], far: [['SKS/U_19P.wav', 2.612], ['SKS/U_19P.wav', 8.014]], what: 'Norinco SKS (7,62×39) – Präzisionsgewehr/Halbautomat' },
  lever: { len: 1.2, extra: true, near: [['Marlin 336/I_22P.wav', 0.738], ['Marlin 336/I_22P.wav', 7.002]], far: [['Marlin 336/I_17P.wav', 0.603]], what: 'Marlin 336 (.30-30) – Unterhebel' },
};
for (const [p, g] of Object.entries(GUNS)) {
  const cat = g.extra ? null : `gun_${p}`;
  many({ name: `gun_${p}`, group: 'gun', layer: 'near', catalog: cat, len: g.len, fade: g.len * 0.55, hp: g.hp ?? 28, eq: g.eq, punch: g.punch ?? 6, ch: 2, width: 0.6, rate: 44100, kbps: 160, cutoff: 19000, target: { peak: -1.5 },
    note: `Nah/Spieler: ${g.what}` }, g.near.map(([f, at]) => [FF + f, at]));
  many({ name: `gunfar_${p}`, group: 'gun', layer: 'far', catalog: g.extra ? null : `gunfar_${p}`, len: 2.8, fade: 1.5, hp: 50, ch: 1, rate: 32000, kbps: 64, target: { peak: -1.5 },
    note: `Mittel-Distanz mit echtem Freigelände-Echo: ${g.what}` }, g.far.map(([f, at]) => [FF + f, at]));
  // Nachhall-Schicht: dieselbe Mittel-Distanz-Aufnahme ohne Direktschall, gleicher Pegel wie die Fern-Datei
  many({ name: `guntail_${p}`, group: 'gun', layer: 'tail', catalog: null, len: 2.6, pre: -0.04, fadeIn: 0.05, fade: 1.4, hp: 70, ch: 2, width: 1, rate: 32000, kbps: 80,
    note: `Außen-Nachhall (ohne Direktschall) zum Unterlegen des eigenen Schusses: ${g.what}` }, g.far.map(([f, at], i) => [FF + f, at, { gainFrom: `gunfar_${p}_${i + 1}` }]));
}
// Schwer: .50 BMG (Nahschuss, Nachhall vom Tikka)
add({ name: 'gun_sniper_heavy', v: 1, group: 'gun', layer: 'near', catalog: null, src: 'fs:668071', at: 0.015, len: 1.5, fade: 0.8, hp: 30, ch: 2, width: 0.7, rate: 44100, kbps: 160, cutoff: 19000, target: { peak: -1.5 }, note: '.50 BMG am Schießstand (inkl. Hülse am Boden), für ein künftiges Anti-Material-Gewehr' });
// Schallgedämpft (echte Aufnahmen, Pistole)
many({ name: 'gunsup_pistol', group: 'gun', layer: 'near', catalog: null, ch: 2, width: 0.7, rate: 44100, kbps: 112, hp: 40, target: { peak: -3 }, note: 'Schallgedämpfte Pistole (1911) – echte Aufnahmen' }, [
  ['fs:827945', 0.021, { len: 0.6, fade: 0.3 }], ['fs:627087', 0.0, { len: 1.3, fade: 0.7 }],
]); // Freesound 255716 („silenced PP7 … recorded“ – PP7 ist ein Spielname, Herkunft unklar) bewusst nicht verwendet
// Mechanik-Schicht unter dem eigenen Schuss (Verschluss/Schlitten), leise beimischen
add({ name: 'mech_rifle', v: 1, group: 'gun', layer: 'mech', catalog: null, src: 'fs:263513', at: 4.25, len: 0.45, fade: 0.25, hp: 120, ch: 1, rate: 44100, kbps: 80, target: { peak: -3 }, note: 'AR-15 Verschlussfang/Verschluss schnellt vor – unter Gewehrschüsse mischen (≈ −14 dB)' });
add({ name: 'mech_pistol', v: 1, group: 'gun', layer: 'mech', catalog: null, src: 'fs:151067', at: 0.085, len: 0.3, fade: 0.15, hp: 150, ch: 1, rate: 44100, kbps: 80, target: { peak: -3 }, note: 'Beretta M9 Schlitten schnellt vor – unter Pistolenschüsse mischen (≈ −16 dB)' });

// ------------------------------------------------------------------ Handhabung / Nachladen (Freesound CC0)
const H = { group: 'handling', layer: 'oneshot', ch: 1, rate: 44100, kbps: 80, hp: 80, target: { lufs: -16 }, ceil: -1.5 };
many({ ...H, name: 'reload_mag_out', catalog: 'reload_mag_out', note: 'AR-15 Magazin heraus (Blue Snowball)' }, [['fs:263513', 0.0, { len: 0.95, fade: 0.3 }], ['fs:263513', 2.22, { len: 0.6, fade: 0.2 }]]);
many({ ...H, name: 'reload_mag_in', catalog: 'reload_mag_in', note: 'AR-15 Magazin einsetzen (antippen + einrasten)' }, [['fs:263513', 1.0, { len: 0.95, fade: 0.3 }], ['fs:263513', 2.82, { len: 0.6, fade: 0.25 }], ['fs:588734', 1.3, { len: 0.6, fade: 0.3 }]]);
many({ ...H, name: 'reload_bolt', catalog: 'reload_bolt', note: 'Ladehebel zurück + vorschnellen (AR-15, AK/RPK)' }, [['fs:263513', 3.40, { len: 0.82, fade: 0.25 }], ['fs:171632', 0.17, { len: 0.7, fade: 0.35 }]]);
many({ ...H, name: 'bolt', catalog: 'bolt', note: 'Kammerverschluss repetieren (Mauser 98k ORTF, .22 TLM103)' }, [['fs:802673', 0.07, { len: 0.75, fade: 0.2 }], ['fs:802673', 0.98, { len: 0.75, fade: 0.2 }], ['fs:706404', 0.03, { len: 1.0, fade: 0.25 }]]);
many({ ...H, name: 'pump', catalog: 'pump', note: 'Vorderschaft repetieren (echte Pumpflinten)' }, [['fs:613801', 0.03, { len: 0.8, fade: 0.3 }], ['fs:449614', 0.0, { len: 0.48, fade: 0.12 }]]);
many({ ...H, name: 'slide_release', catalog: null, note: 'Pistolenschlitten schnellt vor (Nachladen Pistole, statt reload_bolt)' }, [['fs:151067', 0.085, { len: 0.3, fade: 0.12 }], ['fs:151070', 0.06, { len: 0.3, fade: 0.12 }], ['fs:854486', 0.18, { len: 0.45, fade: 0.2 }]]);
many({ ...H, name: 'reload_pistol', catalog: null, note: '1911: Magazin einsetzen + Schlitten (Zoom H4n, innen)' }, [['fs:396331', 0.0, { len: 1.0, fade: 0.35 }]]);
many({ ...H, name: 'dryfire', catalog: 'dryfire', target: { lufs: -20 }, note: 'Abzug ohne Patrone (S&W 9 mm, Ruger 10/22, Glock 17)' }, [['fs:588733', 0.055, { len: 0.3, fade: 0.12 }], ['fs:725402', 0.03, { len: 0.4, fade: 0.15 }], ['fs:842748', 0.0, { len: 0.27, fade: 0.1 }]]);

// ------------------------------------------------------------------ Hülsen
const SH = { group: 'foley', layer: 'oneshot', ch: 1, rate: 44100, kbps: 64, hp: 200, target: { lufs: -22 }, ceil: -3 };
many({ ...SH, name: 'shell_concrete', note: 'Messinghülsen auf Beton (25 cm, Tascam DR-40)' }, [['fs:337235', 0.017, { len: 0.62, fade: 0.25 }], ['fs:337235', 0.685, { len: 0.7, fade: 0.3 }], ['fs:337235', 1.403, { len: 0.75, fade: 0.3 }], ['fs:337235', 2.183, { len: 0.7, fade: 0.3 }]]);
many({ ...SH, name: 'shell_hard', note: 'Einzelne Hülse auf Tisch/harter Fläche' }, [['fs:370805', 0.12, { len: 0.4, fade: 0.15 }], ['fs:778028', 0.0, { len: 0.3, fade: 0.12 }]]);
many({ ...SH, name: 'shell_shotgun', hp: 120, note: 'Schrotpatronenhülsen fallen (Holzboden / draußen)' }, [['fs:773860', 0.0, { len: 0.95, fade: 0.35 }], ['fs:620929', 0.07, { len: 0.95, fade: 0.4 }]]);

// ------------------------------------------------------------------ Schritte, Landung, Körper
const ST = { group: 'step', layer: 'oneshot', ch: 1, rate: 44100, kbps: 64, hp: 60, target: { lufs: -24 }, ceil: -3 };
many({ ...ST, name: 'step_concrete', catalog: 'step_concrete', note: 'Wanderstiefel auf Stein' }, [0.098, 0.696, 1.259, 1.810].map(t => ['fs:521590', t, { len: 0.4, fade: 0.15 }]));
many({ ...ST, name: 'step_wood', catalog: 'step_wood', note: 'Wanderstiefel auf Holzbohle' }, [0.102, 0.538, 0.937, 1.402].map(t => ['fs:521589', t, { len: 0.36, fade: 0.12 }]));
many({ ...ST, name: 'step_dirt', catalog: 'step_dirt', note: 'Feldweg (Ferse + Abrollen)' }, [0.126, 0.674, 1.090, 1.613].map(t => ['fs:682127', t, { len: 0.42, fade: 0.15 }]));
many({ ...ST, name: 'step_gravel', catalog: null, note: 'Wanderstiefel auf Kies (Engine: Alias gravel→dirt; als eigene Fläche nutzbar)' }, [0.101, 0.859, 1.564, 2.234].map(t => ['fs:521588', t, { len: 0.5, fade: 0.2 }]));
many({ ...ST, name: 'step_metal', catalog: 'step_metal', note: 'Metallsteg (für Spiele geschnitten)' }, [0.611, 1.119, 1.621, 3.278].map(t => ['fs:834029', t, { len: 0.48, fade: 0.2 }]));
many({ ...ST, name: 'step_grass', catalog: 'step_grass', hp: 80, note: 'Kenney Impact Sounds (Gras)' }, [0, 1, 2, 3].map(i => [`kenney:footstep_grass_00${i}.ogg`, 0.0, { pre: 0, len: 0.6, fade: 0.25 }]));
add({ ...ST, name: 'land', v: 1, catalog: 'land', src: 'fs:422754', at: 0.035, len: 0.2, fade: 0.08, note: 'Landung auf Stein (Zoom H2n)' });
const BF = { group: 'foley', layer: 'oneshot', ch: 1, rate: 32000, kbps: 64, hp: 40, target: { lufs: -16 }, ceil: -1.5 };
many({ ...BF, name: 'bodyfall', catalog: null, note: 'Körper fällt (zu death/Ragdoll)' }, [['fs:504626', 0.131, { len: 1.45, fade: 0.5 }], ['fs:454418', 0.2, { len: 1.0, fade: 0.4 }], ['fs:675924', 0.032, { len: 1.6, fade: 0.6 }]]);

// ------------------------------------------------------------------ Einschläge
const IM = { group: 'impact', layer: 'oneshot', ch: 1, rate: 44100, kbps: 64, hp: 60, target: { lufs: -16 }, ceil: -1.5 };
many({ ...IM, name: 'impact_concrete', catalog: 'impact_concrete', note: 'Stein/Ziegel-Treffer mit Splittern (MKH416; Axt auf Ziegel; Kenney Spitzhacke)' }, [['fs:569510', 0.0, { pre: 0, len: 0.95, fade: 0.5 }], ['fs:321478', 0.456, { len: 0.38, fade: 0.2 }], ['kenney:impactMining_000.ogg', 0.0, { pre: 0, len: 0.8, fade: 0.4, hp: 150 }]]);
many({ ...IM, name: 'impact_wood', catalog: 'impact_wood', note: 'Steine auf Holz (als Kugeleinschlag aufgenommen)' }, [['fs:319226', 0.173, { len: 0.2, fade: 0.1 }], ['fs:319228', 0.094, { len: 0.17, fade: 0.08 }], ['fs:319227', 0.069, { len: 0.4, fade: 0.2 }]]);
many({ ...IM, name: 'impact_dirt', catalog: 'impact_dirt', note: 'Stein in Erde; Peitsche auf Boden (hell)' }, [['fs:319229', 0.333, { len: 0.6, fade: 0.3 }], ['fs:319222', 0.285, { len: 0.6, fade: 0.3 }], ['fs:789388', 0.011, { len: 0.6, fade: 0.3 }]]);
many({ ...IM, name: 'impact_metal', catalog: 'impact_metal', note: 'Topf/Pfanne „Ping“; Kenney Metall (bandbegrenzt)' }, [['fs:351371', 0.037, { len: 0.38, fade: 0.2 }], ['kenney:impactMetal_medium_000.ogg', 0.0, { pre: 0, len: 0.27, fade: 0.12 }], ['kenney:impactPlate_light_000.ogg', 0.0, { pre: 0, len: 0.4, fade: 0.2 }]]);
many({ ...IM, name: 'impact_glass', catalog: 'impact_glass', note: 'Glasbruch (fern, innen); Kenney Glas' }, [['fs:565182', 0.031, { len: 1.0, fade: 0.5 }], ['kenney:impactGlass_heavy_000.ogg', 0.0, { pre: 0, len: 0.24, fade: 0.1 }]]);
many({ ...IM, name: 'hit_flesh', catalog: 'hit_flesh', rate: 32000, note: '„Visceral Bullet Impacts“ – nur der Körpertreffer, ohne Pfeifen' }, [[0.168, 0.15], [0.468, 0.2], [0.818, 0.15], [1.565, 0.2]].map(([t, l]) => ['fs:423301', t, { len: l, fade: 0.07 }]));
// bullet_crack: einzige echte Aufnahme (Freesound 855248) stammt aus einem NATO-Channel-Video – Rechtekette unklar → nicht verwendet, prozedurale N-Welle bleibt.
many({ ...IM, name: 'bullet_whiz', catalog: 'bullet_whiz', note: 'Vorbeiflug (Peitsche, Unterschall)' }, [['fs:789222', 0.023, { len: 0.6, fade: 0.3 }]]);

// ------------------------------------------------------------------ Explosion, Granate, Nahkampf
const FX = { group: 'fx', layer: 'oneshot', ch: 2, width: 0.8, rate: 44100, kbps: 112, hp: 25, target: { peak: -1.5 }, ceil: -1.5 };
many({ ...FX, name: 'explosion', catalog: 'explosion', note: 'Granate/Sprengung mittlere Distanz (Kinoton); Sprengung aus US-Regierungsvideo (gemeinfrei)' }, [['fs:516914', 0.30, { len: 4.5, fade: 2.5 }], ['fs:182429', 0.0, { pre: 0, len: 3.0, fade: 1.5 }]]);
many({ ...FX, name: 'explosion_far', catalog: 'explosion_far', ch: 1, rate: 32000, kbps: 64, note: 'Ferne Explosion (metallisch, Kostrava); Granate auf Truppenübungsplatz (qubodup, Ende abrupt → ausgeblendet)' }, [['fs:324277', 0.079, { len: 5.0, fade: 2.5 }], ['fs:162363', 0.008, { len: 0.59, fade: 0.3 }]]);
const GR = { group: 'fx', layer: 'oneshot', ch: 1, rate: 44100, kbps: 64, hp: 80, target: { lufs: -16 }, ceil: -1.5 };
many({ ...GR, name: 'grenade_bounce', catalog: 'grenade_bounce', note: 'Blechdose springt auf Beton' }, [['fs:92622', 0.508, { len: 0.3, fade: 0.12 }], ['fs:92622', 0.949, { len: 0.28, fade: 0.12 }], ['fs:92622', 1.25, { len: 0.6, fade: 0.3 }]]);
add({ ...GR, name: 'grenade_spoon', v: 1, catalog: null, src: 'fs:259553', at: 0.158, len: 1.2, fade: 0.6, note: 'Granatenbügel fällt zu Boden (nach grenade_pin)' });
many({ ...GR, name: 'melee_swing', catalog: 'melee_swing', target: { lufs: -20 }, note: 'Bambus-/Stockschwung' }, [['fs:60013', 0.016, { len: 0.42, fade: 0.15 }], ['fs:352719', 0.1, { len: 0.45, fade: 0.2 }]]);
many({ ...GR, name: 'melee_hit', catalog: 'melee_hit', note: 'Messerstich (Melone/Kohl)' }, [['fs:411743', 0.472, { len: 0.25, fade: 0.1 }], ['fs:411743', 0.955, { len: 0.3, fade: 0.12 }], ['fs:179222', 0.155, { len: 0.4, fade: 0.2 }]]);

// ------------------------------------------------------------------ Atmosphäre (nahtlose Schleifen)
const AMB = { group: 'amb', layer: 'bed', fade: 0, rate: 24000, target: { lufs: -26 }, ceil: -6, hp: 40 };
add({ ...AMB, name: 'amb_bed_harbor', v: 1, catalog: 'amb_bed_harbor', src: 'fs:254130', at: 0.8, len: 24, loop: 2, ch: 1, kbps: 48, note: 'Hafen: Boote am Steg, Wellen, Fahnen (Sennheiser 416)' });
add({ ...AMB, name: 'amb_bed_desert', v: 1, catalog: 'amb_bed_desert', src: 'fs:457556', at: 0.4, len: 24, loop: 2, ch: 2, kbps: 64, note: 'Altstadt: ferne Stadt (Dubai)' });
add({ ...AMB, name: 'amb_bed_industrial', v: 1, catalog: 'amb_bed_industrial', src: 'fs:278987', at: 0.4, len: 20, loop: 1.8, ch: 2, kbps: 64, note: 'Werk: große Lagerhalle/Fabrik' });
add({ ...AMB, name: 'amb_bed_range', v: 1, catalog: 'amb_bed_range', src: 'fs:458113', at: 4, len: 28, loop: 2, ch: 2, kbps: 64, note: 'Schießstand: Land im Morgengrauen (Zikaden, Vögel)' });

// Mischhinweise für die Integration (Manifest-Feld „mix“):
// matchDb = Pegelkorrektur in dB auf den Katalog-gain, damit die Aufnahme so laut sitzt wie der heutige prozedurale Klang
// (lauteste 400 ms, Variante 1 gegen Variante 0; dev/audio-lab.html → Messung). Schüsse: +7…+10 dB → die Transiente
// läuft dann in den Master-Limiter (gewollt: „Punch“). relNearDb = Pegel der Schicht relativ zum Nahschuss des Spielers.
const MATCH = {"gun_ar":7.5,"gunfar_ar":7,"gun_ar_heavy":7.5,"gunfar_ar_heavy":10.5,"gun_smg":9,"gunfar_smg":10,"gun_lmg":9.5,"gunfar_lmg":6.5,"gun_sniper":10,"gunfar_sniper":5.5,"gun_shotgun":8.5,"gunfar_shotgun":7,"gun_pistol":9.5,"gunfar_pistol":8,"gun_pistol_heavy":7,"gunfar_pistol_heavy":3.5,"reload_mag_out":-4,"reload_mag_in":-0.5,"reload_bolt":-4,"bolt":-1,"pump":-1,"dryfire":1,"slide_release":-1.5,"reload_pistol":-2.5,"melee_swing":0,"melee_hit":10.5,"step_concrete":-2.5,"step_wood":1,"step_dirt":2,"step_gravel":1,"step_metal":1,"step_grass":10,"land":8,"impact_concrete":-3,"impact_wood":6.5,"impact_dirt":0.5,"impact_metal":-0.5,"impact_glass":1.5,"hit_flesh":0,"bullet_whiz":1.5,"explosion":1.5,"explosion_far":0.5,"grenade_bounce":-5.5,"grenade_spoon":9,"bodyfall":4.5,"amb_bed_harbor":1.5,"amb_bed_desert":9,"amb_bed_industrial":13.5,"amb_bed_range":10.5};
for (const r of R) {
  const m = {};
  if (MATCH[r.name] != null) m.matchDb = MATCH[r.name];
  if (r.layer === 'tail') m.relNearDb = -8;
  if (r.layer === 'mech') m.relNearDb = -14;
  if (r.name.startsWith('shell_')) m.delay = [0.35, 0.7];
  if (Object.keys(m).length) r.mix = m;
}

export const RECIPES = R;
