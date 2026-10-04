# NULLPUNKT: Website Design Spec („Durchschuss“)

Owner: site (design director). Status: **binding for `index.html`, `assets/css/site.css`, `assets/js/site/**`**.
This spec sits on top of `docs/ARCHITECTURE.md`; the contract wins wherever the two conflict. User-facing
strings are German and final. Implement them verbatim unless data supplies the text.

---

## 0. Verdict

| Criterion (1–10) | 1 DURCHSCHUSS | 2 ABSEHEN | 3 NULLABGLEICH |
|---|---|---|---|
| Uniqueness | **10** | 8 | 7 |
| Minimalism & restraint | **9** | 7 | 6 |
| Interactivity & delight | 9 | 8 | 9 |
| Coherence with a COD-Mobile-style shooter | 7 | **9** | 8 |
| Feasibility (1 dev, vanilla JS + three.js) | 6 | 4 | **7** |
| Mobile performance | 6 | 4 | **8** |
| Accessibility | 8 | 7 | **9** |
| **Total** | **55** | 47 | 54 |

**Winner: Concept 1, DURCHSCHUSS: „Ein Schriftmusterbuch, das zurückschießt.“**

Why it wins:
- German typesetting and gunnery share a vocabulary (*Durchschuss, Laufweite, Kaliber, Schnitt, Satz, Kimme, Korn*). No other shooter site can say that.
- Shooter sites wear tactical HUD chrome, thermal optics and rulers. Concepts 2 and 3 both drift toward that genre. Concept 1 refuses it and still speaks fluent gun. It is the only one that is genuinely minimal: type, hairlines and one orange point.
- Its weaknesses are cost (kinetic per-glyph type) and a thinner link to the game's world. Restraint fixes the first (glyph caps, contained boxes, a watchdog). Grafts from Concept 3 fix the second: real meters, real ballistics and real match results.

**Grafted from 3 (NULLABGLEICH)**, each re-expressed in type:
1. Ballistic rangefinder → **„Auf Distanz“**: one distance control re-ranks all weapons by *Duellzeit* with FLIP. Weight encodes speed. Concept 1's TTK duel is merged into it.
2. Meter-true map plans → the *Sichtlinien-Satz* reads out free sightline and typical distance in meters, names the fastest weapon there, and hands the distance to the Arsenal.
3. Thermal-paper after-action strip → **„Fahne“** (galley proof): when you return from a match, the result is typeset on a perforated strip that you tear off.
4. German numerals (decimal comma, narrow no-break space before units) and a frame-time watchdog that drops to static type.
5. The 3D viewer renders on demand only and caches at most 3 models.

**Grafted from 2 (ABSEHEN):**
1. Every setting retunes the site live: name, crosshair, reduced motion, volume, quality.
2. „Breite ist Reichweite. Stärke ist Schaden.“ becomes the Arsenal legend, so width means *magnitude* everywhere data rests.
3. The effect never carries the only copy of any information.

**Explicitly rejected (do not build):**
- full-page WebGL world, camera paths, thermal/night optics, scope lens (2)
- 1 rem = 1 m scale, coordinate readouts, rulers, background grid, command line / Ctrl-K, single-key shortcuts, tape selectors, typewriter briefing (3)
- C1's scroll-driven CSS entry path: one IntersectionObserver path only
- C1's per-match accuracy glyph widths: `profile.history` has no shot counts

---

## 1. Concept

**NULLPUNKT** is a type specimen that shoots back. The page contains no photos, illustrations, cards or boxes. The game appears only as letterforms, holes, masks and hairlines. One grammar governs everything:

| Axis | Meaning at rest (data) | Meaning in motion (state) |
|---|---|---|
| `wdth` (font-stretch 62–125) | **magnitude**: wider = more (range, stat value, progress) | **tension ↔ release**: 62 = aim, reload, bolt cycle (pressure); 125 = discharge |
| `wght` (100–900) | **energy**: damage, speed, success | 100 = cold (locked, out of range, beaten); 900 = hot (firing, hit, active) |
| Orange `#FF5B1F` | the point of aim | the element you are hitting right now |
| The period „.“ | a shot; every action ends with one | |

Tone: terse, du-form, imperative. No exclamation marks; periods are shots. Phrases carry a typesetting and a gunnery meaning: „Ziel. Atmen. Punkt.“

### 1.1 Signature moments (build these first; they define the site)

1. **„Einschießen“ (Hero).**
   - The wordmark `NULLPUNKT.` is a zeroing target. Its orange period is the bullseye.
   - Five clicks or taps punch paper-white holes into the black page. The glyph nearest each hit kicks to 125/900 and springs back.
   - The site measures the group (Ø in mm, mean point of impact in clicks) and glides the bullseye under the group: „Nullpunkt gesetzt.“
2. **„Der Name feuert“ (Arsenal stage).**
   - The 3D weapon is visible only *through the letters of its name*.
   - Hold FEUER and the name fires at the weapon's real `rpm`. Each shot is a wave of width and weight through the glyphs, plus real recoil from the data.
   - The magazine empties, and the word „reloads“ over the real `reloadEmptyTime`. ZIELEN compresses the word over the real `adsTime`.
   - Dragging swells the glyphs to 900/125 until the mask dissolves and you can orbit the model.
3. **„Auf Distanz“ (Arsenal, from 3).**
   - Drag one distance (0–100 m). Ten weapon names re-rank live by *Duellzeit* (aiming time + time to kill).
   - Weight shows who wins; out-of-range weapons fall to hairline.
   - With current data the lead passes from Bulldog 12 (≤ 7 m) to QX-90, then VP-9 Viper, then Brecher .338 (≥ 24 m). Always compute this live; never hard-code it.
   - „Duell.“ fires two names against each other in real time. The loser cools to wght 100: „ausgeschaltet“.
4. **„Sichtlinien-Satz“ (Karten).**
   - Each map is a typeset floor plan drawn at true scale from `layout`. Every block is a word (CONTAINER, KRAN, HALLE …) fitted into its rectangle by the width axis.
   - Your pointer or finger is an operator. Everything it can see is set heavy; everything behind cover falls to hairline.
   - Readout: „Freie Sicht bis 46 m. Typische Distanz 21 m. Erste Wahl dort: VP-9 Viper.“
5. **„Dein Schnitt“ + „Fahne“ (Profil).**
   - Your stats cut a personal instance of Archivo: weight from K/D, width from accuracy, labelled „Archivo 742 / 81“.
   - Your last 25 matches are a line of glyphs S/N/U (Sieg/Niederlage/Unentschieden) whose weight and width are that match's kills and K/D.
   - Back from a match, a perforated galley proof with the result slides out of the status line.

---

## 2. Information architecture

One page, `index.html`, native scroll. There is no router; anchors only.

```
header.status (fixed)          NULLPUNKT. · Rufzeichen · STUFE n ◆ · Ton · [Spielen.]
nav.index (fixed, ≥1024)       Einsatz · Modi · Karten · Arsenal · Profil · Einstellungen · Steuerung · Über
main
  #nullpunkt   §00  Hero / Einschießen                    (h1)
  #einsatz     §01  EINSATZ.        Satzbau                (sentence builder)
  #modi        §02  MODI.           Regelwerk  + SERIEN.
  #karten      §03  KARTEN.         Sichtlinien-Satz
  #arsenal     §04  ARSENAL.        Schriftmusterbuch + AUF DISTANZ. + AUSRÜSTUNG.
  #profil      §05  PROFIL.         Dein Schnitt
  #einstellungen §06 EINSTELLUNGEN. Setzkasten
  #steuerung   §07  STEUERUNG.      Belegung
  #ueber       §08  ÜBER.           Impressum & Datenschutz
footer         NULLPUNKT. (cold)
aside.fahne    (after-action strip, only when a new match exists)
nav.bar (fixed bottom, <720)   [current section ▾ Index] [Spielen.]
```

Every section opens with:
- a **rail label** (mono): `§04 / ARSENAL / Schriftmusterbuch`
- a one-word **headline** justified edge to edge by the width axis (*Breitenblocksatz*), always ending in a period, e.g. `ARSENAL.`
- a one-line **tagline** (lead size)

### 2.1 Persistent chrome

**Status line** (`header.status`, fixed top, 48 px at ≥ 720, 44 px below; solid `--np-black`; a bottom hairline appears after 8 px of scroll):
- Left: `NULLPUNKT.` (Archivo 800, 15 px, ink, links to `#nullpunkt`).
- Centre (≥ 720): callsign in mono uppercase (`settings.playerName`) · `STUFE 12` + `rankIcon(level,{size:16})`. Hidden if profile is unavailable.
- Right: `Ton: aus` / `Ton: an` (mono, `button[aria-pressed]`), then `Spielen.` (Archivo 800 with an orange period).
  - `Spielen.` is **only shown while the hero CTA is out of view** (IntersectionObserver on `.hero-cta`). Hidden means the `hidden` attribute, so it leaves the tab order.
  - Below 720 px it lives in the bottom bar instead.
- Below 720 px: `NULLPUNKT.` · `STUFE 12` · `Ton`. Each target is ≥ 44 × 44 px.

**Index** (`nav.index`, ≥ 1024 only): fixed, `left: var(--g)`, `bottom: 32px`, width = rail column. Eight Archivo items at 15 px.
- Scroll-spy made of type. For each item, proximity `p = 1 − clamp(|sectionMid − viewportMid| / innerHeight, 0, 1)` gives `wdth = 75 + 40·p²` and `wght = 300 + 500·p²`.
- The active item (max p) also gets `aria-current="true"`.
- Updated in the shared rAF loop only while scrolling.

**Index dialog** (720–1023 and phones): a status-line button `Index` (phones: bottom bar left) opens a `<dialog>` listing the sections at display size (40–64 px, wdth 62 → 125 on focus/hover). Choosing one closes the dialog and jumps.

**Bottom bar** (`nav.bar`, < 720 only, shown after the hero CTA leaves view):
- Height 56 px + `env(safe-area-inset-bottom)`, solid black, top hairline.
- Left: the current section name (kinetic: 62/300 → 100/800 on change, 240 ms) acting as the Index button.
- Right: `Spielen.` (ink on black, orange period, min 120 × 44 px).
- `main` gets `padding-bottom` = bar height so nothing hides behind it.

---

## 3. Sections: content, copy, behaviour

Notation: `[x]` = a native control rendered as a type word. *(data: …)* = text comes from a shared module. „…“ = verbatim copy.

### §00 Hero: Einschießen (`#nullpunkt`)

Layout: `min-height: 100svh` grid with rows `[status space] 1fr [lead] [cta]`. The wordmark sits in the `1fr` row, so its size never moves anything else (CLS 0).

| Element | Content |
|---|---|
| Rail | „§00 / NULLPUNKT / Einschießen“ |
| h1 | `NULLPUNKT.` (sr-only text „NULLPUNKT“; visual glyphs `aria-hidden`). ≥ 720: one line fitted to the full content width. < 720: two lines `NULL` / `PUNKT.`, each fitted independently (`NULL` to wdth 125 by font size, `PUNKT.` to wdth ≈ 100). |
| Lead | „Ego-Shooter im Browser. Du gegen Bots. Kein Download, kein Konto.“ |
| Data line (mono) | „5 MODI · 4 KARTEN · 10 WAFFEN · BIS ZU 15 BOTS“: computed from `MODE_ORDER.length`, `Object.keys(MAPS).length`, `WEAPON_IDS` minus melee, max over modes of `limits.allies[1] + limits.enemies[1]`. Static HTML carries the same text. |
| CTA 1 | `Sofort spielen.`: an `<a>` filled ink with black text, 56 px tall, period orange. `href = buildPlayUrl(state)`. Mono under it: „TDM · IM HAFEN · REGULÄR“ (current config). |
| CTA 2 | `Einsatz zusammenstellen` + mono `↓`: link to `#einsatz`. |
| Hint (mono, ink-2) | „Fünf Schuss auf den Punkt.“ |

**Zeroing** (`zero.js`):
- **Target zone.** The hero's wordmark row. Pointer `click` (mouse or tap) fires; drags and scrolls never do. `touch-action: manipulation`, `user-select: none` on the visual layer.
- **Bullseye.** The orange period is also a `<button class="bull" aria-label="Auf den Nullpunkt schießen">`. Enter/Space fires at the bullseye with keyboard dispersion.
- **Dispersion.** The impact = aim point + a random offset inside the current spread radius, `r = 2 px + cursorSpreadGap` (§9; touch base 6 px, keyboard 4 px). Holding still gives tight groups; whipping the mouse gives wide ones.
- **Hole.** A circle Ø = `clamp(5px, .035 × wordmark font-size, 10px)` filled `--np-ink` (paper behind the black sheet) with a 1 px `--np-black-3` ring. It sits above the glyphs (`pointer-events:none`), so it reads as shot *through* the letters. At most 5 holes.
- **Kick.** The glyph whose box is nearest the impact (within 0.6 em) jumps to wdth 125 / wght 900 and springs back (§8, the „Einschuss“ spring). Neighbours get 40 % / 15 %.
- **Progress** (mono, replaces the hint): „Schuss 3 von 5.“
- **Result**, after shot 5:
  - Mean point of impact (MPI) relative to the bullseye centre (dx, dy in CSS px).
  - Group Ø = max pairwise distance, converted to mm (`px × 25.4 / 96`, 1 decimal, comma).
  - 1 Klick = 8 CSS px. The offset of the impact point is described as „rechts/links“ and „tief/hoch“. The correction is the inverse.
  - Copy, line 1: „Streukreis Ø 7,4 mm. Treffpunkt 2 Klick rechts, 1 tief.“
  - Copy, line 2: „Korrigiert. Nullpunkt gesetzt.“
  - Then the whole wordmark glides (640 ms, ease-out) so the bullseye centre lands on the MPI (|offset| ≤ 48 px).
  - If Ø > 40 mm or |MPI| > 48 px: no glide, and the copy reads „Streukreis Ø 52,0 mm. Ruhig atmen, neu einschießen.“
  - If it is a new personal best: „Bester Streukreis bisher.“ Store it in `nullpunkt:site.bestGroupMm`. Show „Bestwert: Ø 6,1 mm“ in the rail afterwards.
  - The result is announced once in the polite live region.
- **Reset.** The button „Neu einschießen“ appears after shot 5. It removes the holes and the glide (240 ms).
- **Reduced motion.** Holes and text appear with no kick and no glide; the copy is identical.

### §01 Einsatz: Satzbau (`#einsatz`)

Rail: „§01 / EINSATZ / Satzbau“ · Tagline: „Satz für Satz ins Gefecht.“ · Kicker (mono): „Jedes Wort ist eine Wahl.“

The match setup is **one sentence**. Templates (prepositions are part of the sentence; the `[…]` words are controls):

| Mode type | Sentence |
|---|---|
| `teams: true` (tdm, dom) | „Ich spiele [Team-Deathmatch] {im} [Hafen] mit [5] Verbündeten gegen [6] Bots auf [Regulär]. **Los.**“ |
| `teams: false` (ffa, gun) | „Ich spiele [Jeder gegen jeden] {in der} [Altstadt] gegen [7] Bots auf [Regulär]. **Los.**“ |
| `training` | „Ich gehe an den [Schießstand]. **Los.**“ (map forced to `range`, no bot slots) |

- **Map preposition `{…}`**: `hafen` „im“, `altstadt` „in der“, `werk` „im“, `range` „am“, any unknown map „auf“. It animates with the map word.
- **Bot word**: „Bot“ when there is 1, „Bots“ otherwise. „mit 1 Verbündeten“ is correct German (= „einem“) and needs no special case.
- **Controls**:
  - Each slot is a `<label>`: an sr-only slot name („Modus“, „Karte“, „Verbündete“, „Gegner“, „Stufe“), the visible word (`aria-hidden`), and a native `<select>` stretched over the word with `opacity:0` and `font-size:16px` (no iOS zoom).
  - Phones get native pickers; screen readers get proper comboboxes.
  - Visible word: Archivo 800, wdth 100, ink, 2 px underline in `--np-line-strong` at 0.12 em offset. Focus-visible makes the word and underline orange.
  - Static words: Archivo 300. Size: display-m. The sentence wraps naturally; max measure 18 words per line.
- **Data rules** (`deploy.js`):
  - Mode options come from `MODE_ORDER` → `MODES[id].name`.
  - Map options are maps whose `MAPS[id].modes` includes the mode. Fall back to `MODES[mode].recommendedMaps`, then to all non-`range` maps. `range` appears only for `training`.
  - Ally and enemy options run over `MODES[mode].limits.allies` / `.enemies` [min…max]. When the mode changes, reset both to `defaultAllies` / `defaultEnemies`.
  - Difficulty options come from `DIFFICULTY_ORDER` → `DIFFICULTIES[id].name`.
  - Every change calls `settings.patch({ lastMode, lastMap, difficulty })`. Counts live only in page state.
- **Change animation**: the old word compresses to 62/100 (120 ms ease-in), the text swaps, and the new word unfolds 62/100 → 100/800 (240 ms ease-out). Prepositions do the same.
- **„Los.“** is a plain `<a class="go">` in Archivo 900 / wdth 125 with an orange period. `href = buildPlayUrl()`. Hover or focus gives a small kick (+10 wdth spring). A click flashes the kill hitmarker (§9) and plays `ui('confirm')` if sound is on.
- **URL line** (mono, ink-2, selectable): `spielen.html?mode=tdm&map=hafen&diff=regulaer&allies=5&enemies=6`. Training: `spielen.html?mode=training&map=range`. Next to it a text button „Link kopieren“ → „Kopiert.“ (2 s, live region).
- **Notes** (mono, shown conditionally):
  - Touch device: „Am Telefon: quer halten.“
  - No WebGL: „Dein Browser meldet kein WebGL. Das Spiel läuft hier vermutlich nicht.“ The link stays.
- **Live summary** (sr-only, polite, 400 ms debounce): „Einsatz: Team-Deathmatch im Hafen, 5 Verbündete, 6 Bots, Regulär.“

`buildPlayUrl(cfg)` is exported from `deploy.js` and is the **only** URL builder. Hero, status line, bottom bar, Modi and Karten all use it with their own overrides.

### §02 Modi: Regelwerk (`#modi`)

Rail: „§02 / MODI / Regelwerk“ · Tagline: „Fünf Modi. Ein Fadenkreuz.“

Five full-width rows in `MODE_ORDER`. Each row is a disclosure, and only one is open at a time:
- **Header button** (`aria-expanded`, `aria-controls`): the mode `name` in display-m, fitted to the content column, wght 700.
- **Rail** (mono): `short` · team line · limit · time, e.g. „TDM · 6 GEGEN 6 · 40 ABSCHÜSSE · 10 MIN“.
  - Team line: `teams ? (defaultAllies+1)+' gegen '+defaultEnemies : (defaultEnemies+1)+' Spieler'`.
  - Limits: `scoreLimit` + `scoreUnit`, `formatTimeLimit(timeLimit)`. Training: „KEIN LIMIT“.
- **Expanded panel**: `tagline` (lead), `description` (body), `rules` as a mono list, „Empfohlene Karten: Hafen, Altstadt, Werk“, and the link „{name} spielen.“ = `buildPlayUrl({mode:id, map:recommendedMaps[0], allies/enemies: defaults})`.

**The name acts out its rule.**
- **Triggers**: header focus-visible, opening, or the row's centre entering the middle 20 % band of the viewport during scroll (once per pass). Hover on fine pointers is a bonus trigger, never the only one.
- One act at a time on the page; a new trigger cancels the running act.
- After acting the name settles back to rest.

| Mode | Act (≈ 1.2 s) |
|---|---|
| Team-Deathmatch | The name splits at its middle glyph. The left half turns `--np-ally`, the right half `--np-enemy`. The halves trade width twice (left 125 / right 62 → swap), then return to ink. |
| Herrschaft | Three glyphs at ≈ 1/6, 1/2, 5/6 get mono superscripts A, B, C. In sequence (300 ms stagger) each goes from wght 100 to 900 and to `--np-ally` = „eingenommen“. |
| Jeder gegen jeden | Each glyph jitters independently (random wdth 62–125, translateY ±0.04 em, new target every 90 ms) for 900 ms. No colour. |
| Waffenspiel | The whole name steps through 18 discrete weights 100 → 900 (70 ms per step). A mono counter beside it reads „01/18 VP-9 Viper“ … „18/18 Kampfmesser“ from `GUN_GAME_STEPS`. |
| Schießstand | Glyphs drop (translateY 0.3 em, wght 100, opacity .3), then pop up one by one in random order as targets (spring, 80 ms stagger) and fall again 600 ms later, left to right. |

**SERIEN.** (h3 inside §02, rail „Serienprämien“). Copy: „Abschüsse ohne Tod schalten frei, was über dir kreist.“
- Three columns (one column under 480 px).
- Each column: a huge mono numeral `4` / `6` / `8` (JetBrains Mono 200, clamp(64px, 10vw, 160px)), the `STREAKS[id].icon` (32 px, ink), the name (Archivo 700), and the description (small).
- Once per page view, when the block reaches the centre band, the numerals count 0 → n (600 ms). Reduced motion: static.

### §03 Karten: Sichtlinien-Satz (`#karten`)

Rail: „§03 / KARTEN / Sichtlinien-Satz“ · Tagline: „Miss zweimal. Schieß einmal.“ · Kicker (mono): „Bewege dich durch den Plan. Was du siehst, steht fett.“

**Tabs** (`role=tablist`, roving tabindex, arrow keys, automatic activation):
- One per map in `Object.keys(MAPS)` order, labelled with `MAPS[id].name` in display-s.
- Active tab: wdth 125 / wght 800. Others: 62 / 300.
- Phones: 2 × 2 grid with ≥ 56 px rows.
- The default tab is `settings.lastMap`.

**Panel**, desktop:

| Rail | Content |
|---|---|
| Name (display-s), `subtitle`, `description` | The plan (SVG, width = column, height from aspect) |
| Facts (mono): „TAGESZEIT {timeOfDay} · GRÖSSE {size} · MODI {short names}“ | |
| Palette: `palette` as 24 × 4 px hairline bars (the only place map colours appear) | |
| Readouts (see below) | |
| „Hier spielen.“ → `buildPlayUrl({ map:id, mode: lastMode if the map supports it, else MAPS[id].modes[0] })`; for `range`: training | |

Phones: plan first, then name, readouts, facts, link.

**Plan** (`plan.js`, SVG, viewBox in meters):
- **Bounds**: bounds of all blocks + 4 m margin.
- **Blocks**: `layout` entries `[x, z, w, d, kind, rot?]`, normalised in `data.js`. `x`, `z` are the block centre unless the `maps.data.js` header documents corner origin; this one switch lives in `data.js`. An optional `rot` in radians is honoured.
- **Draw each block**:
  - Hairline rect, `--np-line`, `vector-effect: non-scaling-stroke`.
  - **Dim word**: `<text>` in Archivo wght 200, `--np-ink-2`.
  - **Lit word**: the same `<text>` in a second group at wght 800, `--np-ink`, clipped by `<clipPath id="vis">`.
- **Words**: kind → German word from the table below; unknown kinds use `kind.toUpperCase()`. Words are fitted into the rect.
  - Rotate 90° if `d > 1.6 w`.
  - Font size = 0.62 × the short side.
  - wdth is solved from `getComputedTextLength()` measured at 62 and 125 (batched once per map, on idle).
  - If it still doesn't fit at 62, use the 3-letter abbreviation with a period („CON.“). If the block is shorter than 1.2 m, use no word.

  | kind contains | word | kind contains | word |
  |---|---|---|---|
  | container | CONTAINER | crane | KRAN |
  | warehouse, hall | HALLE | house, building | HAUS |
  | wall | MAUER | crate, box | KISTE |
  | pallet | PALETTE | truck | LKW |
  | forklift | STAPLER | well | BRUNNEN |
  | market, stall | MARKT | roof | DACH |
  | machine | MASCHINE | pipe | ROHR |
  | catwalk | STEG | stairs | TREPPE |
  | tower | TURM | sandbag | SANDSACK |
  | lane | BAHN | target | ZIEL |
  | water | WASSER | car, vehicle | WAGEN |
  | (fallback) | DECKUNG | | |

- **Non-blocking kinds** (drawn, but they don't cut sightlines): `water`, `lane`, `zone`, `spawn`, `road`, `plaza`, `flag`, `objective`, `marker`, `decal`.
- **Scale bar** (mono, rail): a hairline exactly 10 m long, labelled „10 m“.
- **Operator**: a 10 px orange dot with a 44 px invisible hit area.
  - Default position: the free point nearest the map centroid, searched on a 2 m grid.
  - **Pointer fine**: follows the pointer over the plan.
  - **Touch**: a tap moves it there; a drag that *starts on the operator* moves it (`touch-action:none` on the operator only). The plan itself keeps `touch-action: pan-y` and never traps scrolling.
  - **Keyboard**: the plan wrapper (`tabindex=0`, `role="group"`, `aria-label="Kartenplan {name}. Pfeiltasten bewegen, Umschalt für 5 Meter."`) moves the operator 1 m per arrow (Shift: 5 m), clamped to free space.
- **Visibility** (`castVisibility`):
  - Blocks → wall segments (4 per rect, rotation applied).
  - Cast 360 rays (every 1°) plus 2 extra rays at ±0.0005 rad toward each segment endpoint. Nearest ray–segment hit or bounds.
  - Sort by angle → polygon → `<clipPath><path d=…>`.
  - The polygon is also filled with `--np-signal-soft` behind the words.
  - Runs at most once per frame (rAF-coalesced). Budget < 1.5 ms on a mid-range phone for 80 blocks.
- **Readouts** (mono, live, polite region throttled to 1 s for screen readers):
  - „Freie Sicht bis 46 m.“: longest ray.
  - „Typische Distanz: 21 m.“: median ray length.
  - „Erste Wahl dort: VP-9 Viper.“: `rankAt(median)[0]` among primary weapons.
  - Link button „Im Arsenal prüfen.“ sets the Arsenal distance to the median and scrolls to `#auf-distanz`.
- **Text alternative** (visible in a `<details>` labelled „Plan als Text“, and as the SVG's `aria-describedby`): „Hafen, 108 × 92 m. 34 Deckungen: 18 Container, 1 Kran, 2 Hallen, …“ (counts per word, in descending order).
- **Tab switch**: words cross-fade (240 ms). The operator resets to the new map's default.

### §04 Arsenal: Schriftmusterbuch (`#arsenal`)

Rail: „§04 / ARSENAL / Schriftmusterbuch“ · Tagline: „Jede Waffe hat ihren eigenen Schnitt.“ · Legend (mono): „Breite ist Reichweite. Stärke ist Schaden.“

**Index** (rail at ≥ 1024; below the stage at < 1024, in two columns of ≥ 56 px tap rows):
- Grouped by `listByClass()`, each group led by a mono class label (`WEAPON_CLASSES[cls]`, e.g. „STURMGEWEHR“).
- Each weapon is a `<button aria-pressed>` showing its name in its **resting cut**, a specimen at 28–40 px:
  - `wdth = 62 + 0.63 × stats.range`
  - `wght = 100 + 8 × stats.damage`
  - So the Brecher .338 is wide and black, the QX-90 narrow and light, and the Bulldog 12 narrow and black.
- **Locked** (`!profile.isUnlocked(id)`): an outline glyph (`color: transparent; -webkit-text-stroke: 1px var(--np-ink-2)`), wght 100, and mono „AB STUFE 12“. It stays selectable.
- The selected weapon gets an orange 2 px bar to the left of the name.
- The default selection is the first weapon of `settings.lastLoadout?.primary`, else `ar_m17`.
- Selecting one updates the stage, stats and facts. On phones the stage scrolls into view (smooth unless reduced motion).

**Stage** (`.stage`): aspect 16 : 9 at ≥ 720, 1 : 1 below. `isolation: isolate; contain: strict`. Layers, bottom to top:
1. **Picture.**
   - `<canvas>` (WebGL) with clear colour `--np-ink`, rendering `createWeaponModel(def.model, {lod:'showcase'})`.
   - **Fallback**: `def.icon` SVG drawn in `--np-black` strokes on `--np-ink`, scaled to the stage width, with the note „3D-Ansicht braucht WebGL. Hier: Strichzeichnung.“ (or „Modell nicht verfügbar.“ if `models.js` fails).
2. **Letter mask.**
   - A div with `background: var(--np-black); color: #fff; mix-blend-mode: multiply`, `aria-hidden`.
   - It holds the weapon name in the resting cut, fitted to the stage width (Breitenblocksatz). Names with a space break into two lines (`M-17` / `FALKE`), each fitted, line-height .8. Cap height should be ≈ 38–45 % of the stage height.
   - Result: the picture is visible **only inside the letters**, and outside reads as page black.
3. **HUD** (not blended), Rajdhani 600:
   - Ammo bottom-right: „30 / 120“ (mag / reserve), 32–40 px.
   - Fire mode in mono: `FIRE_MODES[def.fireMode]` uppercase.
   - Buttons, round hairline circles, all real `<button>`s and the accessible path:
     - `FEUER`: 64 px, bottom-right above the ammo.
     - `ZIELEN`: 48 px, toggle `aria-pressed`.
     - `R`: 44 px, `aria-label="Nachladen"`.
   - Mono `Ansicht zurücksetzen` top-right.
   - Instruction (mono, ink-2): fine pointer „Maus halten: feuern. Ziehen: drehen. Rechts: zielen.“ · touch „FEUER halten. Wischen: drehen.“
   - Locked weapons add „Gesperrt bis Stufe 12.“; the showcase still works.
   - Knife: FEUER becomes `STECHEN`; one impulse per press, no ammo.

**Firing** (`fire.js` timing, `kinetic.js` glyphs, `stage3d.js` model):
- **Input**:
  - Fine pointer: the primary button held on the stage without moving > 4 px fires; > 4 px movement starts a drag instead (and cancels firing). The secondary button held on the stage means ADS (`contextmenu` is prevented *inside the stage only*).
  - The `FEUER` button: `pointerdown` / `pointerup`, or Space/Enter keydown / keyup while it has focus.
  - `R` key and arrows act only while focus is inside the stage.
- **Cadence** from data: shot interval = `60 / rpm` s.
  - `auto`: repeats while held.
  - `semi`: one shot per press, re-press allowed after the interval.
  - `burst`: `burstCount` shots, then a `burstDelay` gap (supported even though no current weapon uses it).
  - `bolt` / `pump`: one shot per press, then a **cycle** during which the word compresses to wdth 62 (first 40 % of the interval, ease-in) and reopens (60 %, ease-out). Plays `bolt` / `pump` sound.
- **Per shot**:
  1. Glyph wave from the left: glyph *i* gets an impulse at `t + 6 ms × i`, with Δwdth +18 and Δwght +260 (clamped to 125/900), on the critically damped spring k = 220.
  2. Word recoil:
     - `translateY −= vertical × patternV(i) × 900 px` (× `firstShotMult` on shot 0).
     - `translateX += horizontal × (patternH(i) ± rand .35) × 900 px`.
     - Recovery is exponential at `recoil.recovery` per second. Total offset is clamped to ±0.12 em.
  3. Model: a 1-frame muzzle sprite at `userData.muzzle` (40 ms fade), a back-kick of 0.02 m × strength, and pitch `+vertical × 6`, recovering at the same rate.
  4. Ammo −1, and the hitmarker flashes on the stage centre.
- **Reload**:
  - Auto when the mag hits 0 (`reloadEmptyTime`), or via `R` (`reloadTime` if mag > 0).
  - Glyphs collapse to 62/100 (120 ms), then refill left to right: glyph *i* returns at `i/n × reloadTime` (240 ms ease-out each).
  - The ammo label reads „NACHLADEN“ with a 1 px progress hairline.
  - `perShellReload`: refill in `mag − current` equal steps over `reloadEmptyTime × (missing/mag)`.
  - Reserve refills silently when exhausted (it's a showcase).
- **ADS**: over `adsTime` the word compresses to wdth 62 / wght 900 (tension), and the camera FOV divides by `min(def.adsZoom, 1.6)` (showcase cap; the Brecher's 5.5× would lose the model) centred on `userData.sight`. Releasing reverses it.
- **Drag** (grab, then dissolve):
  - On drag start the glyphs swell to 900/125 (200 ms ease-out).
  - Then the mask opacity goes to 0 (240 ms) while the renderer clear colour lerps ink → `--np-black`.
  - Yaw follows the drag (0.4°/px; touch: horizontal only); pitch ±25° (mouse only).
  - Release: inertia (friction 4 /s). After 1.6 s of idle the mask returns (reverse).
  - Keyboard (stage focused): ←/→ 15°, ↑/↓ 10°, Home resets.
- **Live region**: announces reload start/end and the selected weapon, never individual shots.

**Stats** (below the stage): six **type bars**, one per stat, in this order: SCHADEN (`damage`), KADENZ (`fireRate`), REICHWEITE (`range`), PRÄZISION (`accuracy`), BEWEGLICHKEIT (`mobility`), KONTROLLE (`control`).
- The label word is Archivo 700 at a fixed 22–28 px with `wdth = 62 + 0.63 × v`, so **the word is the bar**.
- Behind it a 1 px `--np-line` track runs to the label's width at wdth 125; the value is in mono at the right.
- Each row carries sr-only text „Schaden 51 von 100“. The visual row is `aria-hidden`.
- On weapon change, the bars animate from the old to the new value (240 ms ease-in-out).

**Facts** (`<dl>`, two columns on desktop, mono labels and Archivo values):

| Label | Value (example: KV-47) |
|---|---|
| Schaden | „33–25 · Kopf ×1,4“ (`damage.max`–`min`, `headMult`; shotgun: „8 × 16–3,5“ = pellets × per-pellet damage) |
| Abfall | „24–48 m · max. 115 m“ |
| Kadenz | „560 Schuss/min“ |
| Magazin | „30 / 120“ |
| Nachladen | „2,35 s · leer 3,05 s“ |
| Anschlag | „0,26 s“ |
| TTK | „10 m: 0,32 s · 50 m: 0,32 s“ (`ttk(def, d)`; 0 → „1 Treffer“; ∞ → „außer Reichweite“) |
| Visier | `SIGHTS[def.sight].name` |
| Feuerart | `FIRE_MODES[def.fireMode]` |
| Freischaltung | „ab Stufe 2“ |

Then `def.description` (body) and `CLASS_INFO[cls].role` (small, ink-2).

**AUF DISTANZ.** (h3, `id="auf-distanz"`). Kicker: „Zieh den Messwert. Die Liste sortiert sich nach Duellzeit.“
- **Control**: native `<input type=range min=0 max=100 step=1>` labelled „Distanz“, `aria-valuetext="24 Meter"`.
  - Styled as a hairline with ticks every 10 m and mono labels at 0 / 25 / 50 / 75 / 100 m.
  - Thumb: a 2 px × 28 px orange line with a 44 px hit area.
  - Large readout „24 m“ in display-s, orange (the measured value is this screen's point of aim).
  - Checkbox „Kopftreffer“ switches the zone to `head`. Default distance 20 m.
- **Duellzeit** `= def.adsTime × 1000 + ttk(def, d, zone)` ms. Legend (mono): „Duellzeit = Anschlag + Zeit bis Abschuss. 100 Lebenspunkte, jeder Schuss trifft.“
- **Ranking**: an `<ol>` of all non-melee weapons sorted ascending by Duellzeit; ∞ goes last in data order.
  - Row: mono rank „01“, the name (Archivo, wdth 100, `wght = 900 − 600 × (rank−1)/(finiteCount−1)`; ∞ → wght 100 outline), mono value „0,48 s · 1 Treffer“ or „außer Reichweite“.
  - Rows are `<button>`s that select the weapon.
  - Reorders use FLIP via WAAPI (240 ms ease-out), throttled to one reorder per 120 ms while dragging. DOM order always matches visual order.
- **Duel**: button „Duell.“ pits the stage weapon against the rank-1 weapon at this distance (rank 2 if the stage weapon is first).
  - Two names in a row, each in its resting cut.
  - Both first compress over their `adsTime`, then fire `shotsToKill(def, d, zone)` shots on the real `shotTime` schedule (glyph waves as on the stage, smaller).
  - The first to finish turns 900 and gains an orange period. The other cools to wght 100 over 640 ms with mono „ausgeschaltet“.
  - Live region: „Auf 24 m gewinnt Brecher .338 in 0,48 s gegen VP-9 Viper mit 0,54 s.“
  - Reduced motion: no animation; result line and final cuts only.

**AUSRÜSTUNG.** (h3, small coda): `EQUIPMENT_IDS` with icon, name, „ab Stufe n“ and two facts („Zünder 2,8 s · Radius 6,5 m“). There is no stage for equipment.

### §05 Profil: Dein Schnitt (`#profil`)

Rail: „§05 / PROFIL / Dein Schnitt“ · Tagline: „Dein Schnitt, gesetzt aus deinen Treffern.“

Data comes from `profile.get()`, `profile.stats()` and `levelProgress`, re-rendered on `profile.onChange` and `settings.onChange('playerName')`.

**Callsign cut** (display-l, fitted):
- `playerName` uppercase, with `wght = 100 + 800 × clamp(kd / 3)` and `wdth = 62 + 63 × clamp((accuracy − 0.10) / 0.40)`.
- Mono below: „ARCHIVO 742 / 81“ (rounded wght / wdth). With zero matches: „ARCHIVO 400 / 100“.
- Small mono link: „Namen ändern“ → focuses the name field in §06.

**Rank**:
- `rankIcon(level,{size:48})`, the rank name (display-s), and the word `STUFE 12` where `STUFE` is set at `wdth = 62 + 63 × progress` over a 1 px track.
- Mono: „1.240 / 3.050 EP bis Stufe 13“. At max level: „Höchststufe erreicht.“

**Figures** (`<dl>`, mono labels, Archivo 700 tabular numerals, 32–56 px):

| Label | Value |
|---|---|
| K/D | „1,42“ |
| Genauigkeit | „31 %“ |
| Kopfschüsse | „18 %“ |
| Siege | „12 · N 9 · U 1“ |
| Beste Serie | „9“ |
| Weitester Abschuss | „64 m“ |
| Spielzeit | „3 h 12 min“ |
| Matches | „22“ |

Numbers roll to new values over 600 ms ease-out when they change.

**Lieblingswaffen**: the top 3 of `weaponStats` by kills. Each shows the name in its Arsenal resting cut, „48 Abschüsse · 27 % Treffer“, and links to the weapon in the Arsenal.

**Medaillen**: up to 6 by count, „Doppelkill ×14“. A mono tier tag; only `gold` uses `--np-gold`.

**Verlauf**: an `<ol>` of up to 25 `<button>` glyphs, oldest left → newest right, each display-m.
- Letters `S` / `N` / `U` by `result`; a training match is `T`.
- `wght = 100 + 800 × clamp(kills / 30)`; `wdth = 62 + 63 × clamp((kills / max(1, deaths)) / 3)`.
- Colour: win ink, loss `--np-ink-2`, draw outline, training `--np-dim`.
- Each button's accessible name: „Sieg, Team-Deathmatch im Hafen, 24 Abschüsse, 11 Tode, 4. Oktober, 21:14“.
- Selecting one shows a mono detail line below: „S · TDM · HAFEN · 24/11/4 · 2.340 PUNKTE · +1.840 EP · 9:58 MIN · 4.10.2026“.

**Empty state** (0 matches): callsign at 400/100; „Noch kein Einsatz. Dein Schnitt ist ungeschrieben.“ and the link „Ersten Einsatz starten.“ (`buildPlayUrl()`). Figures, weapons, medals and history are hidden.

**Reset**: the text button „Profil zurücksetzen“. The first press turns it orange: „Wirklich? Alles weg.“ (4 s window). The second press runs `profile.reset()` → live „Profil gelöscht.“

**Fahne** (after-action galley proof, `fahne.js`):
- **Trigger**: on boot, or on `profile.onChange` (a game tab writing localStorage), when `history[0].at > site.lastSeenMatchAt`. On first ever visit, initialise `lastSeenMatchAt` to the newest `at` without showing a Fahne.
- **Surface**: `aside.fahne`, fixed under the status line, right-aligned, width `min(560px, 100vw − 2g)`; on phones full width minus gutters. `--np-black-2` with a perforated bottom edge (`mask: radial-gradient(circle 4px at 8px 100%, transparent 98%, #000) 0 0 / 16px 100%`) and a 1 px `--np-line` border.
- **Content**:
  - Mono header: „FAHNE · EINSATZBERICHT · 4.10.2026, 21:14“.
  - The result word fitted to the strip: „SIEG.“ (900/125), „NIEDERLAGE.“ (300/62), „UNENTSCHIEDEN.“ (600/100), „TRAINING.“ (400/100).
  - Mono: „TDM · HAFEN · 24 ABSCHÜSSE · 11 TODE · 4 ASSISTS · 2.340 PUNKTE“, then „+1.840 EP“.
  - If the level rose since `site.lastSeenLevel`: „Stufe 13 erreicht.“ plus, if the rank changed, „Neuer Dienstgrad: Stabsgefreiter.“ Plays `ui('levelup')` if sound is on.
- **Enter**: `clip-path: inset(0 0 100% 0)` → `inset(0)` in `steps(12)` over 480 ms (printer).
- **Dismiss**: the button „Abreißen“, Esc while focus is inside it or on the page body, or a vertical drag > 48 px. Exit is translateY −100 % + fade (240 ms ease-in). Then set `lastSeenMatchAt` and `lastSeenLevel`.
- Not modal: focus is not moved; the summary is announced in the polite region.
- If several matches are new, show the newest plus „+2 weitere Einsätze“.

### §06 Einstellungen: Setzkasten (`#einstellungen`)

Rail: „§06 / EINSTELLUNGEN / Setzkasten“ · Tagline: „Gilt für Website und Spiel.“

The form is generated from `SETTINGS_SCHEMA`, skipping `group: 'intern'`. One `<fieldset>` per group, in this order and with these `<legend>`s (mono):

| Group | Legend |
|---|---|
| profil | Profil |
| steuerung | Steuerung |
| hud | Fadenkreuz & HUD |
| grafik | Grafik |
| audio | Audio |
| spiel | Spiel |

Each row: the mono label (`schema.label`) in the rail, the control in the content column, ≥ 44 px tall.

| type | Control | Value label |
|---|---|---|
| number | native range (hairline track, orange thumb line, 44 px hit area). `aria-valuetext` with unit. | Archivo 700 display-s with `wdth = 62 + 63 × (v−min)/(max−min)`. Values: „1,25“, „80°“, volumes as „70 %“. |
| boolean | `input[type=checkbox][role=switch]` visually rendered as the word pair „AN / AUS“: active word 800/125, inactive 100/62. | none |
| enum | radio group of words (`schema.labels`): chosen 800/100 + underline, others 300/62. | none |
| color | native `input[type=color]` + mono hex + 5 preset swatch buttons: `#ffffff`, `#ff5b1f`, `#38b6ff`, `#5fe08a`, `#ffc23d` (each 44 px, with an `aria-label` colour name). | none |
| string (playerName) | text input, Archivo 24 px, underline only, `maxlength=16`, commit on change/blur via `profile.setName` (falls back to `settings.set`) | none |

**Previews and live retuning:**
- **`fov`**: an SVG wedge, two 1 px lines at the real angle, with `SICHTFELD` set between them (`wdth` from the value). Mono: „80° vertikal · 113° horizontal bei 16:9“ (`h = 2·atan(tan(v/2)·16/9)`).
- **`crosshairStyle` / `crosshairColor`**: the site cursor *is* the preview, plus a 64 × 64 inline preview for touch users.
- **Volumes**: on input, if sound is on, play `ui('click')` at the new level (throttle 120 ms).
- **`reducedMotion`**: applies to the site immediately (§12).
- **`quality`**: the stage DPR (`low` → 1). Mono explanation per option:
  - „Automatisch: Telefon niedrig, Rechner hoch.“
  - „Niedrig: keine Schatten, volle Bildrate.“
  - „Mittel: Schatten und Glanz.“
  - „Hoch: weiche Schatten, Kantenglättung.“
  - „Ultra: Umgebungsverdeckung, 4K-Schatten.“
- **`playerName`**: the status line and Profil callsign update live.
- **`aimAssist`**: helper text „Zieht das Fadenkreuz leicht zu nahen Gegnern. Nur Touch und Controller.“
- **`autoFire`**: helper text „Feuert von selbst, sobald das Fadenkreuz auf einem Gegner liegt. Nur Touch.“

**Syncing**: ranges write `settings.set` on `input` (throttled 50 ms). `settings.onChange` updates every control, including changes made from another tab or the game.

**Reset**: „Auf Standard setzen“ → „Wirklich zurücksetzen?“ (two-step, 4 s) → `settings.reset()`.

If `settings.persistent === false`, show the note „Speichern nicht möglich (privates Fenster?). Änderungen gelten bis zum Schließen.“

### §07 Steuerung: Belegung (`#steuerung`)

Rail: „§07 / STEUERUNG / Belegung“ · Tagline: „Drück eine Taste. Wir sagen dir, was sie tut.“

Tabs (same pattern as §03): „Touch“ · „Tastatur & Maus“ · „Gamepad“. The first tab is Touch when `(pointer: coarse)` matches, else Tastatur & Maus.

- **Touch** (text-only HUD diagram):
  - A landscape phone outline (hairline, aspect 19.5 : 9, 28 px radius; the only rounded shape on the site, because it depicts a device).
  - Words in Rajdhani 600 sit where the game places its buttons:
    - Left: joystick circle „BEWEGEN“, small „FEUER“.
    - Right half: „UMSEHEN“ (drag area), large „FEUER“, „ZIELEN“, „NACHLADEN“, „SPRINGEN“, „DUCKEN“, „GRANATE“, „WAFFE“, „SERIE“.
    - Top: „PAUSE“, „PUNKTE“, minimap „KARTE“.
  - Each word is a `<button>`; tapping one shows the mono explanation below, e.g. „FEUER · Halten feuert. Links und rechts erreichbar.“ and „BEWEGEN · Joystick bis zum Rand schieben: Dauersprint.“
  - Below: the current states of „Zielhilfe“ and „Automatisch feuern“ (from settings) with a link to §06.
- **Tastatur & Maus** (typeset key map; table semantics, two columns of key words in mono 18–24 px and actions in Archivo):
  - W A S D „Bewegen“ · Maus „Umsehen“
  - LMT „Feuer“ · RMT „Zielen (halten)“ · R „Nachladen“
  - Leertaste „Springen“ · C / Strg „Ducken, im Sprint rutschen“ · Umschalt „Sprinten“
  - V / Maus 4 „Nahkampf“ · G / Q „Granate“ · 1 / 2 / Mausrad „Waffe wechseln“
  - 3 / 4 / 5 „Serienprämien“ · Tab „Punktestand“ · Esc „Pause“

  **Tastenprobe** (key test):
  - The button „Tasten testen“ focuses the key-map widget (`tabindex=0`). The echo is active **only while that widget has focus**.
  - A pressed key lights its key word (900, orange) and shows a display-s line: „R. NACHLADEN.“ Unmapped: „X ist frei.“
  - Inside the widget, Space and the arrow keys have their default prevented. Tab and Esc are never captured (Esc blurs). Left/right mouse buttons echo FEUER / ZIELEN (context menu prevented inside the widget).
  - Hint: „Esc beendet den Test.“
- **Gamepad** (standard mapping, typeset):
  - RT „Feuer“ · LT „Zielen“ · A „Springen“ · B „Ducken“ · X „Nachladen“ · Y „Waffe wechseln“
  - LB „Granate“ · RB „Nahkampf“ · L-Stick „Bewegen (drücken: Sprint)“ · R-Stick „Umsehen“
  - Steuerkreuz „Serienprämien“ · Start „Pause“ · Ansicht „Punktestand“
  - If `input.js` exports a binding table (e.g. `GAMEPAD_BINDINGS`), render that instead. This table is the fallback and must be confirmed with core.
  - **Live**: after `gamepadconnected`, poll in the shared loop only while the tab panel is visible and the document is visible. Pressed buttons light up.
  - Status: „Kein Gamepad erkannt. Drück eine Taste am Controller.“ / „Verbunden: {id, truncated to 40 chars}“.

### §08 Über: Impressum & Datenschutz (`#ueber`)

Rail: „§08 / ÜBER / Impressum & Datenschutz“

- Lead: „NULLPUNKT ist ein Ego-Shooter, der vollständig in deinem Browser läuft. Du spielst gegen Bots, nicht gegen Menschen.“
- Statement (display-m, three lines, wght 800): „Keine Cookies. Kein Tracking. Kein Server.“
- Body: „Nichts verlässt dieses Gerät. Gespeichert wird nur, was du hier und im Spiel einstellst, im lokalen Speicher deines Browsers:“
- List (mono key, then body description):
  - `nullpunkt:settings`: „Einstellungen“
  - `nullpunkt:profile`: „Stufe, Statistik, Verlauf“
  - `nullpunkt:site`: „Website: Streukreis, zuletzt gesehener Einsatz, Ton“
- Button „Lokale Daten löschen“ opens a `<dialog>`:
  - Text: „Alle NULLPUNKT-Daten in diesem Browser löschen? Stufe, Statistik und Einstellungen gehen verloren.“
  - Buttons: [„Abbrechen“] [„Löschen.“] (orange period).
  - On confirm: `profile.reset()`, `settings.reset()`, remove `nullpunkt:site`, and remove any other `nullpunkt:*` key. Live: „Gelöscht.“ Focus returns to the trigger.
- Credits (small): „Schriften: Archivo, JetBrains Mono, Rajdhani, SIL Open Font License 1.1. 3D: three.js, MIT-Lizenz. Alle Waffen, Karten und Namen sind frei erfunden.“
- Impressum placeholder (small, `id="impressum"`): „Impressum: Angaben zum Betreiber nach § 5 DDG werden vor der Veröffentlichung ergänzt.“ Never invent operator data.

**Footer**:
- `NULLPUNKT.` fitted to the full width at wght 100 / wdth 62 („cooled“), `--np-dim` (allowed: display size). The period is ink, not orange: the gun is cold.
- Mono line: „Ziel. Atmen. Punkt.“ · „Nach oben ↑“.

---

## 4. Layout grid & breakpoints

```css
:root { --g: clamp(16px, 4vw, 64px); --gap: clamp(16px, 2.5vw, 48px); }
.sec { display:grid; column-gap:var(--gap);
  grid-template-columns: [full-start] var(--g) [rail-start] minmax(0,1fr) [axis] minmax(0,3fr) [content-end] var(--g) [full-end]; }
```

- **Rail** holds mono metadata (sticky `top: 72px` within its section). **Content** holds type.
- **Visierlinie**: one fixed 1 px vertical line in `--np-line` at the axis x, from under the status line to the bottom. Its x is computed from the grid on resize and written to `--axis-x`.
- Body measure ≤ 62ch. 8 px baseline: every vertical margin is a multiple of 8.
- Spacing scale: 4 · 8 · 16 · 24 · 40 · 64 · 104 · 168.
- Section padding-block: `clamp(104px, 16vh, 200px)`.
- Hairlines only: no boxes, no shadows, no radii (exceptions: the touch phone outline in §07, round stage HUD buttons, dialog/Fahne borders).
- **Never horizontal page scroll** at any width ≥ 320 px. Kinetic boxes use `overflow: clip`.

| Range | Name | Layout |
|---|---|---|
| 320–479 | xs | One column; rail stacks above content (mono, 12 px); Visierlinie hidden; hero wordmark in 2 lines; bottom bar; map tabs 2 × 2; weapon index 2 columns; stage 1 : 1; Serien single column |
| 480–719 | sm | As xs; Serien in 3 columns; facts `<dl>` in 2 columns |
| 720–1023 | md | Grid becomes `1fr 2fr`; Visierlinie on; status line shows callsign and level; Index dialog; stage 16 : 9; weapon index below the stage, 3 columns |
| 1024–1439 | lg | Full `1fr 3fr` grid; fixed index nav; weapon index in the rail; plan and rail side by side |
| 1440–2559 | xl | As lg; headline max size reached; content column grows |
| ≥ 2560 | 4K | Page wrapper `max-inline-size: 2560px; margin-inline: auto`; outside is page black; `--g` stays 64 px; only display type scales further (cap 320 px; hero cap 420 px) |

Touch targets: ≥ 44 × 44 px whenever `(pointer: coarse)`. Safe areas: the status line pads `env(safe-area-inset-top)`, the bottom bar pads `env(safe-area-inset-bottom)`, and side gutters use `max(var(--g), env(safe-area-inset-left/right))`.

---

## 5. Typography

Families: `--font-display` (Archivo NP, wght 100–900, wdth 62–125), `--font-mono` (JetBrains Mono NP), `--font-hud` (Rajdhani NP: **only** in the Arsenal stage HUD and the §07 touch diagram, the two places that quote the game).

| Role | Size | Line height | Default cut | Notes |
|---|---|---|---|---|
| Wordmark (h1) | fitted, 64–420 px | .8 | 800 / fitted | Breitenblocksatz |
| Headline (h2) | fitted, base `clamp(56px,16vw,280px)`, max 320 | .82 | 800 / fitted | uppercase in source, ends with „.“ |
| Display-m | `clamp(32px, 6vw, 112px)` | .95 | 300 static / 800 chosen | sentence, mode names, stage name, history glyphs |
| Display-s | `clamp(28px, 3.6vw, 64px)` | 1 | 700 / 100 | map name, readouts, value labels |
| Lead | `clamp(20px, 2vw, 28px)` | 1.3 | 380 / 100 | taglines |
| Body | `clamp(17px, 12px + 1.1vw, 19px)` | 1.55 | 400 / 100 | **never animated** |
| Small | 15 px | 1.5 | 400 / 100 | ink-2 |
| Mono label | 12 px (11 at xs, 13 at xl) | 1.3 | mono 500 | uppercase, `letter-spacing:.08em`, `font-variant-numeric: tabular-nums` |
| Mono data | 14 px (13–15) | 1.45 | mono 400 | URLs, readouts |
| HUD | 18–40 px | 1 | Rajdhani 600 | stage, touch diagram |

**Axis rules:**
- Axis extremes (wdth < 75 or > 115; wght < 200 or > 850) only at rendered sizes ≥ 48 px. Exceptions: the index nav (wdth 75–115, wght 300–800) and type bars (≥ 22 px).
- Write axes with the high-level properties `font-stretch: calc(var(--wdth) * 1%)` and `font-weight: var(--wght)`.
- `@property --wdth { syntax:'<number>'; inherits:true; initial-value:100 }` and the same for `--wght` (initial 400) let CSS transitions interpolate them. Per-glyph deltas: `font-stretch: calc(clamp(62, var(--wdth) + var(--dw, 0), 125) * 1%)`.
- Headlines and the wordmark are real text in the HTML, uppercase in source (no `text-transform`, so measurement is stable).

**Glyph availability** (measured):
- Archivo and Mono contain „ “ · × Ø − § ° … and all of Latin-1 (ä ö ü ß Ä Ö Ü).
- **„→“ exists in neither font**: do not use it.
- `↓` / `↑` exist only in JetBrains Mono: set arrows in mono.
- No ⊕ ✕ ◆ ⌀: the rank glyph comes from `rankIcon` SVG, not text.
- Never use characters that would pull in `archivo-var-ext.woff2`.

**Numbers**: `fmt.js` with `Intl.NumberFormat('de-DE')`. Decimal comma; thousands with a period („2.340“); U+202F narrow no-break space before units („24 m“, „0,48 s“, „31 %“, „80°“ has no space). Durations „3 h 12 min“ and „9:58 min“. Dates „4.10.2026, 21:14“.

**Breitenblocksatz** (`fit.js`, for every `[data-fit]`):
1. Wait for `document.fonts.ready`. Fit runs before first visibility; the hero runs synchronously after fonts load. Until then the CSS clamp size and wdth 100 apply. The hero box height is fixed by its grid row, so the swap causes no CLS.
2. Batch-read: for each element, measure the text width at the current font-size with wdth 62 and 125 (two hidden clones per run, then removed; reads first, writes after).
3. Solve linearly for the wdth that fills the container width W. If it is in [62, 125], set it and keep the CSS font-size.
4. If wdth > 125 is needed: set 125 and grow the font size to fill, capped at the role max; if still short, left-align (allowed). If wdth < 62 is needed: set 62 and shrink the font size.
5. One correction pass: measure, then scale wdth proportionally if |error| > 0.5 %.
6. Write `--wdth`, `--fit-wdth` and the font size, and store `data-fitted`.
7. Re-run on ResizeObserver (debounced to rAF), but only for elements whose container width changed by ≥ 1 px.

**Kinetic glyphs** (`kinetic.js`):
- `split(el)` wraps each glyph in `<span class="g" aria-hidden="true">` inside an `aria-hidden` visual layer. A sibling `.sr-only` holds the real text.
- Per glyph it measures a linear width model `w_i(wdth) = a_i + b_i·wdth` from the two fit measurements.
- **Width conservation** (hero wordmark and stage name only): when glyph *i* gains Δ px, distribute −Δ over the others in proportion to `b_j`, so the line never reflows.
- **Live glyph cap: 80** on the page at once. Starting a new effect over the cap first settles the oldest effect.
- Every kinetic box gets `contain: layout paint` (headlines: `contain: layout paint style`) and fixed block size from its fit.

---

## 6. Colour & surface rules

Tokens come from `tokens.css` and must not be redefined. `site.css` sets `color-scheme: dark` and `html, body { background: var(--np-black); color: var(--np-ink) }`. The site is dark only.

- **Ground**: `--np-black` everywhere. `--np-black-2` only for the `<dialog>` and the Fahne. `--np-black-3` only for hole rings.
- **Paper** (`--np-ink` as a surface) appears in exactly three places: hero bullet holes, the stage picture inside the letters, and the „Sofort spielen.“ button.
- **One orange at rest per viewport**:

  | Section | The orange element |
  |---|---|
  | Hero | the bullseye period |
  | Einsatz | the „Los.“ period |
  | Karten | operator + `--np-signal-soft` visibility fill |
  | Arsenal | distance thumb + readout + selected-weapon bar |

  Transient additions are allowed: focus ring, hover/target cursor, hitmarker, reset confirm state, mode-act glyphs. The status/bottom-bar „Spielen.“ period is the one permanent exception.
- Never use orange for body text or large fills (except the 16 % visibility fill).
- **Ally / enemy colours** only in the TDM and Herrschaft acts.
- **Gold** only in `rankIcon` (General) and gold-tier medal tags.
- **Map palettes** only as swatches in §03.
- **No gradients** (the perforation mask is not visible colour), no glows, no blur, no shadows.

**Contrast** (on `#0A0B0D`):

| Colour | Ratio | Allowed use |
|---|---|---|
| ink | ≈ 15:1 | any text |
| `--np-ink-2` | ≈ 9:1 | any text |
| `--np-signal` | ≈ 6.3:1 | text and 2 px focus rings |
| `--np-dim` | ≈ 4.3:1 | **only** for text ≥ 24 px or decorative/duplicated info |

- `prefers-contrast: more`: dim → ink-2, ink-2 → ink, `--np-line` → `--np-line-strong`, and the plan's dim words go to ink-2 / wght 300.
- `forced-colors: active`: drop `mix-blend-mode` (the stage shows name and picture separately), drop custom cursors, use system colours, and keep focus outlines (`outline-color: Highlight`).

---

## 7. Motion

**Tokens**:
- Easings: `--ease-out` (releases, entries), `--ease-in-out` (state changes), and in `site.css` `--ease-in: cubic-bezier(.7,0,.84,0)` (compress / exit).
- Durations: micro 120 ms · state 240 ms · settle 640 ms · stagger 24 ms per glyph (entries) / 6 ms per glyph (shot waves).
- Springs (semi-implicit Euler, dt clamped to 1/30):
  - *impulse* k = 220, critically damped (c = 2√k).
  - *Einschuss* k = 260, ζ = .55: a single overshoot, hero only.
  - *settle* k = 120, critically damped.

**Principles:**
- Nothing moves at rest: no idle loops, no ambient animation, no autoplay.
- Native scroll: no hijacking, no parallax, no smooth-scroll library.
- Data timings are real: `rpm`, `reloadTime`, `reloadEmptyTime`, `adsTime`, `recoil.recovery`, `shotTime`.

| Trigger | Target | Change | Timing |
|---|---|---|---|
| Headline enters (IO, 15 % visible, once) | h2 glyphs | 62/100 → fitted/800 | 640 ms ease-out, 24 ms stagger |
| Scroll velocity | h2s intersecting the viewport | `wdth −= 24·sv`, where `sv = clamp(|v|/4 px·ms⁻¹,0,1)`, low-pass τ 120 ms | continuous while scrolling; springs back in 640 ms |
| Hero shot | nearest glyph (+ neighbours 40/15 %) | → 125/900 | Einschuss spring |
| Zero result | wordmark | translate to MPI | 640 ms ease-out |
| Sentence change | slot word + preposition | → 62/100, swap, → 100/800 | 120 ms ease-in + 240 ms ease-out |
| „Los.“ / play links hover or focus | word | +10 wdth | impulse spring |
| Mode act | name glyphs | see §02 | ≈ 1.2 s, then settle |
| Mode panel open/close | panel | `grid-template-rows: 0fr → 1fr` + opacity | 240 ms ease-in-out |
| Tab switch | tab words / panel | 62/300 ↔ 125/800; cross-fade | 240 ms ease-in-out |
| Index proximity | nav items | continuous from scroll | rAF while scrolling |
| Shot (stage) | glyph wave + word recoil | +18 wdth / +260 wght; recoil per data | impulse spring; recovery `exp(−recovery·t)` |
| Bolt / pump cycle | word | → 62 → rest | 40 % ease-in / 60 % ease-out of `60/rpm` |
| Reload | glyphs | collapse → refill left to right | 120 ms ease-in; refill over `reloadTime` |
| ADS | word / camera | → 62/900; FOV ÷ `min(adsZoom, 1.6)` | `adsTime` ease-in-out |
| Grab | word, then mask | → 900/125, then mask opacity 0 | 200 ms + 240 ms ease-out |
| Weapon change | type bars, stage name | old → new cut | 240 ms ease-in-out (name: compress 120 ms, swap, expand 240 ms) |
| Ranking reorder | rows | FLIP translate | 240 ms ease-out, ≤ 1 per 120 ms |
| Duel loser | name | → wght 100 | 640 ms ease-out |
| Number change | figures | count up/down | 600 ms ease-out |
| Fahne in / out | strip | clip-path wipe / translateY + fade | 480 ms `steps(12)` / 240 ms ease-in |
| Hitmarker | cursor overlay | scale 1.2 → 1, opacity 1 → 0 | 160 ms (kill: 240 ms) linear |
| Focus ring | n/a | instant | n/a |

---

## 8. Cursor & interaction states

**Crosshair cursor** (`cursor.js`, only for `(pointer: fine)`, not `forced-colors`):
- `html.cursor-on { cursor: none }`, except native cursors on `input:not([type=range]), select, textarea, [contenteditable]` and inside `<dialog>`.
- The crosshair is one fixed inline SVG moved 1 : 1 with `translate3d` on `pointermove`: no smoothing, no lag. It is hidden on `pointerleave` of the window.
- Style and colour come from `settings.crosshairStyle` / `crosshairColor`:
  - `cross`: four 1 px hairlines, 8 px long.
  - `dot`: a 3 px dot plus a spread ring.
  - `circle`: a ring whose radius is the gap.
- **Spread**: `gap = 4 + min(24, speed_px_per_frame × 0.6)`, decaying with τ 90 ms. This is the same spread the hero zeroing uses.
- **On target** (`a, button, [role=tab], [data-target], label.slot, input[type=range]`): the gap closes to 2 px and the colour turns `--np-signal` (120 ms).
- **Click**: a hitmarker of four diagonal 6 px ticks around the hotspot (160 ms). On the primary actions („Los.“, „Sofort spielen.“, „Spielen.“, „Duell.“) a **kill hitmarker** in `--np-enemy` (240 ms).
- **Touch**: no cursor. Every `click` flashes the hitmarker at the tap point (CSS-only element, 160 ms).

**States** (every interactive element defines all of these):

| State | Treatment |
|---|---|
| Default | ink text; links show a 1 px underline at 0.12 em offset (display words: `--np-line-strong`) |
| Hover (fine pointer only) | underline → ink; display words +10 wdth (spring); cursor on-target |
| Focus-visible | `outline: 2px solid var(--np-signal); outline-offset: 3px` (display words: `0.06em`); always visible; never removed |
| Active / pressed | wght +200 for 120 ms; hitmarker |
| Selected / current | 800 weight + 2 px orange bar or underline; `aria-pressed` / `aria-selected` / `aria-current` |
| Disabled | `--np-dim`, wght 200, `cursor: not-allowed`, still focusable if it explains why (title text in sr-only) |
| Locked (weapons) | outline glyphs, wght 100, mono „AB STUFE n“ |
| Loading | mono „LÄDT …“ in ink-2; no spinners |
| Error / no data | mono „KEIN SIGNAL.“ + one body line of reason; the section's static content stays |

---

## 9. Sound (off by default)

`sound.js`:
- **Toggle**: the status-line button `Ton: aus/an` (`aria-pressed`). Persist the preference in `nullpunkt:site.sound`, but always require a user gesture before audio starts. If stored as on, the first pointer or key gesture unlocks it.
- **Engine**: on enable, `await import('../game/engine/audio.js')` in try/catch.
  - If it exports `createUiSounds`, use that.
  - Else `const a = new AudioEngine({ settings, events: null }); a.unlock()`.
  - Use `a.ui(name)` for UI and `a.play(profile, { pitch })` for weapons.
- **Fallback** (module missing or throwing), a ≈ 1 KB WebAudio synth:
  - `click`: 2 ms white noise, bandpass 3.2 kHz.
  - `confirm`: two clicks 40 ms apart.
  - `shot`: 30 ms noise burst, lowpass sweep 4 kHz → 400 Hz.
  - `reload`: two clicks 180 ms apart.
- **Mapping**:
  - `hover`: index, tabs and mode rows; fine pointer only; throttled 80 ms.
  - `click`: buttons, selects, tabs.
  - `confirm`: „Los.“, „Sofort spielen.“, „Spielen.“.
  - `back`: closing a dialog or Fahne.
  - `levelup`: Fahne with a level-up.
  - Weapons: `def.sound.profile` per shot, **capped at 12 per second** (skip extras); `reload_mag_out` at 25 % and `reload_mag_in` at 70 % of the reload; `bolt` / `pump` on cycle; `dryfire` never.
- **Gains**: UI = `masterVolume × uiVolume`; weapons = `masterVolume × sfxVolume`. Follows `settings.onChange`.
- Silent while `document.hidden`. Never plays before an explicit toggle.

---

## 10. Technical architecture

Static, native ES modules, no build step, relative URLs only. `index.html` declares the contract import map **verbatim** and loads `assets/js/site/main.js` (`type="module"`).

**Head:**
- `<html lang="de" class="no-js">`, charset, `viewport` (`width=device-width, initial-scale=1, viewport-fit=cover`).
- `<title>NULLPUNKT – Ego-Shooter im Browser</title>`.
- `meta description`: „Taktischer Ego-Shooter im Browser: fünf Modi, vier Karten, zehn Waffen, Bots. Kein Download, kein Konto, kein Tracking.“
- `theme-color #0A0B0D`, `color-scheme dark`.
- Favicon: an inline `data:` SVG (orange dot on black). No new asset files outside site ownership.
- Preloads: `assets/fonts/archivo-var.woff2` and `jetbrains-mono-var.woff2` (`as=font type=font/woff2 crossorigin`).
- Stylesheets: `fonts.css`, `tokens.css`, `site.css`.
- `modulepreload` for `main.js` and the four shared data modules.

### 10.1 Files (`assets/js/site/`)

| File | Responsibility | Exports |
|---|---|---|
| `main.js` | Boot: remove `no-js`; feature detection (WebGL via a throwaway `canvas.getContext('webgl2') \|\| 'webgl'`, no three import), reduced-motion state, `saveData`; init chrome and hero immediately; lazy-init sections via one IntersectionObserver (`rootMargin: 100% 0px`) | n/a |
| `data.js` | Defensive loader: dynamic `import()` of each shared module in try/catch, in parallel; normalisers (`normBlock`, mode/map fallbacks); roster check against contract §7 ids (unknown ids render, missing ids are skipped; logs only with `?debug=1`); static fallback names for maps/modes | `loadData() → { W, M, P, S, profile, settings, ok:{weapons,modes,maps,profile,settings} }` |
| `state.js` | Page state store (`mode, map, diff, allies, enemies, weapon, distance, zone, mapTab`) and the `nullpunkt:site` store (`{ v:1, sound:false, bestGroupMm:null, lastSeenMatchAt:0, lastSeenLevel:1 }`; try/catch, in-memory fallback) | `ui`, `site` (`get/set/onChange`) |
| `loop.js` | Single shared rAF scheduler: `add(fn) → remove`; `fn(dt,t)` returns `false` to stop; sleeps when empty or `document.hidden`. **Watchdog**: if the 1 s mean frame time is > 24 ms while kinetic tasks run, set `html.static-type` for the session | `loop` |
| `motion.js` | `reduced()` (media query OR `settings.reducedMotion` OR watchdog); spring helpers; `flip(container)` (WAAPI); IO helpers | n/a |
| `fmt.js` | de-DE formatters: `num`, `sec(ms)`, `m(v)`, `pct(f)`, `dur(s)`, `date(ts)` | n/a |
| `fit.js` | Breitenblocksatz (§5) | `fitAll(root)`, `fit(el, opts)` |
| `kinetic.js` | Glyph split, width model, per-glyph springs, waves, conservation, glyph cap | `kinetic(el, opts)` |
| `cursor.js` | Crosshair, spread, target detection, hitmarkers (pointer and touch) | `hit(kind)` |
| `nav.js` | Status line, index proximity, Index dialog, bottom bar, CTA-visibility switching, scroll squeeze (`--sv`), Visierlinie x | n/a |
| `zero.js` | §00 zeroing | n/a |
| `deploy.js` | §01 sentence builder | `buildPlayUrl(cfg)`, `mapPrep(id)` |
| `modes-view.js` | §02 rows, acts, Serien | n/a |
| `plan.js` | Pure geometry (`segmentsFrom(blocks)`, `castVisibility(segs, o, bounds) → {poly, maxDist, medianDist}`) + SVG plan builder | n/a |
| `maps-view.js` | §03 tabs, panel, readouts | n/a |
| `ballistics.js` | `duelTime(def,d,zone)`, `rankAt(d,zone,{slot})`, local fallbacks for `ttk` / `shotsToKill` / `shotTime` (`(⌈100/dmg⌉−1)·60000/rpm`) used only if the shared helpers are missing | n/a |
| `fire.js` | Pure timing controller: `createFire(def, cb)` with `press() release() reload() ads(on) update(dt)`; callbacks `onShot(i) onCycle(ms) onReload(ms, empty) onReloadEnd() onAds(on, ms)` | n/a |
| `stage3d.js` | **Lazy.** One `THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'low-power' })`; `PerspectiveCamera` fov 24; `HemisphereLight` + key `DirectionalLight` + rim light (no env map, no post-processing); Box3 framing; own minimal orbit with inertia; muzzle sprite (`CanvasTexture` radial, additive); render **on demand only** (drag, inertia, shot, ADS and mask transitions); model cache ≤ 3, LRU disposal (geometry, materials, textures); `webglcontextlost` → fallback | `createStage(canvas, opts) → { show(def), shot(s), ads(on,ms), dissolve(t), rotate(dx,dy), reset(), resize(), dispose() }` |
| `arsenal-view.js` | §04 index, stage wiring, stats, facts, Auf Distanz, Duell, Ausrüstung; imports `stage3d.js` + `../game/weapons/models.js` only when §04 is within one viewport AND WebGL AND not `saveData` (`saveData` shows the button „3D laden“) | n/a |
| `profile-view.js` | §05 | n/a |
| `fahne.js` | After-action strip | n/a |
| `settings-view.js` | §06 generated form + previews | n/a |
| `controls-view.js` | §07 tabs, Tastenprobe, gamepad polling | n/a |
| `about-view.js` | §08 storage list + delete dialog | n/a |
| `sound.js` | §9 | `sound.ui(name)`, `sound.shot(def)`, `sound.enabled` |

**Which technology per effect:**

| Effect | Technology |
|---|---|
| Headline fit, entries, sentence words, tabs, index | DOM text + `font-stretch` / `font-weight` + registered custom properties; CSS transitions for state changes; `loop.js` springs for impulses |
| Hero holes | absolutely positioned DOM dots |
| Hero kick, shot waves, reload refill | `kinetic.js` springs in the shared loop |
| Mode acts | `kinetic.js` timelines |
| Map plans | inline SVG (`<text>`, `<clipPath>`), geometry in plain JS |
| Stage | WebGL canvas + CSS `mix-blend-mode: multiply` text mask; SVG `def.icon` fallback |
| Ranking reorder | WAAPI FLIP |
| Fahne | CSS clip-path / mask |
| Cursor | one fixed SVG |
| Sound | WebAudio via the game's `AudioEngine` or the local synth |

### 10.2 Boot sequence

1. Static HTML renders the full copy. Static defaults: Sofort spielen and Los. point to `spielen.html?mode=tdm&map=hafen&diff=regulaer&allies=5&enemies=6`.
2. `main.js` runs:
   - add `js`; read reduced motion;
   - start `nav`, `cursor`, `zero` (hero is interactive as soon as fonts are ready);
   - call `loadData()`; on resolve, hydrate the hero data line and play URLs from settings.
3. `fitAll()` after `document.fonts.ready`.
4. The section IntersectionObserver initialises each view the first time it comes within one viewport. Views never block each other: a view that throws shows its error state.
5. `profile.ready` → Fahne check, Arsenal lock states, status level.

### 10.3 Data bindings

| Module | Used | Fallback if missing / incomplete |
|---|---|---|
| `shared/weapons.data.js` | `WEAPONS`, `WEAPON_IDS`, `WEAPON_CLASSES`, `CLASS_ORDER`, `CLASS_INFO`, `listByClass`, `FIRE_MODES`, `SIGHTS`, `EQUIPMENT`, `EQUIPMENT_IDS`, `GUN_GAME_STEPS`, `ttk`, `shotsToKill`, `shotTime`, `damageAt`, `MAX_HEALTH`; per def: `name, cls, slot, description, unlockLevel, damage, headMult, pellets, rpm, fireMode, burstCount, burstDelay, mag, reserve, reloadTime, reloadEmptyTime, perShellReload, adsTime, adsZoom, sight, recoil{vertical,horizontal,recovery,firstShotMult,pattern}, range, sound{profile,pitch}, model, stats, icon` | Arsenal: „KEIN SIGNAL.“ Hero count line keeps its static text. `ballistics.js` local helpers. A missing `stats` is computed as 50s. A missing `icon` gives a hatched fallback (`repeating-linear-gradient` is allowed here as texture, not colour). |
| `shared/modes.data.js` | `MODES`, `MODE_ORDER`, `STREAKS`, `STREAK_ORDER`, `DIFFICULTIES`, `DIFFICULTY_ORDER`, `MEDALS`, `formatTimeLimit`; per mode: `name, short, tagline, description, rules, scoreLimit, scoreUnit, timeLimit, teams, defaultAllies, defaultEnemies, limits, recommendedMaps, icon` | Static mode table in `data.js` (ids + names + team flags + contract limits) |
| `shared/maps.data.js` | `MAPS` (`id, name, subtitle, description, size, timeOfDay, modes, palette, layout`) | Sentence uses the static map names. §03 shows „KEIN SIGNAL. Kartenmaterial fehlt.“ |
| `shared/settings.js` | `settings.get/set/patch/all/reset/onChange/persistent/validate`, `SETTINGS_SCHEMA`, `DEFAULTS` | In-memory defaults (contract §4); §06 shows „KEIN SIGNAL.“ |
| `shared/profile.js` | `profile.get/stats/reset/onChange/isUnlocked/setName/ready`, `levelProgress`, `rankFor`, `rankIcon`, `MAX_LEVEL`; history entry fields `at, modeId, mapId, result, kills, deaths, assists, headshots, score, xp, duration, bestStreak` | §05 empty state; status level hidden; everything unlocked |
| `game/weapons/models.js` | `createWeaponModel(def.model, { lod:'showcase' })`; `userData.muzzle`, `.sight`, `.adsOffset` | `def.icon` line drawing through the mask, plus „Modell nicht verfügbar.“ |
| `game/engine/audio.js` | `createUiSounds` or `AudioEngine` (`unlock`, `ui`, `play`) | local synth |

Never edit shared modules. If a needed field is missing, add a fallback in `data.js` and mention it to the owner.

---

## 11. Performance budget

| Item | Budget |
|---|---|
| `index.html` | ≤ 16 KB gzip |
| `site.css` | ≤ 16 KB gzip |
| Site JS on the critical path (`main`, `state`, `loop`, `motion`, `fmt`, `fit`, `kinetic`, `cursor`, `nav`, `zero`, `deploy`, `data`) | ≤ 30 KB gzip |
| All site JS | ≤ 70 KB gzip |
| Shared data modules (measured: weapons 11, modes 7, profile 6, settings 3.5 KB gzip) | ≈ 30 KB |
| Fonts on first load | Archivo 90 KB + JetBrains Mono 40 KB (preloaded). Rajdhani (15 KB) only when the stage or touch diagram renders. `archivo-var-ext` never. |
| **First load, before Arsenal** | **≤ 240 KB transferred** |
| three.js (190 KB gzip) + `models.js` and gunsmith | only when §04 is within one viewport, WebGL is available and `saveData` is false |
| LCP | the hero wordmark text; ≤ 2.0 s on Lighthouse mobile |
| CLS | < 0.02 (fixed hero grid; fit only adjusts wdth at CSS font size; images none) |
| TBT | < 150 ms (fit batched; plan text measurement on `requestIdleCallback`) |
| Lighthouse mobile | Performance ≥ 90, Accessibility 100, Best Practices 100 |
| rAF | one shared loop; idle CPU 0 % at rest (verify via Performance panel: no frames when nothing moves) |
| Per frame | site JS ≤ 3 ms on desktop, ≤ 8 ms on a 4×-throttled CPU |
| Kinetic glyphs | ≤ 80 live |
| Visibility cast | ≤ 1.5 ms |
| Stage | DPR ≤ 1.5 desktop, ≤ 1 on coarse pointers or `quality: low`; canvas ≤ 1.0 MP; on-demand rendering; ≤ 3 cached models; ≤ 60 draw calls |
| Watchdog | 1 s mean frame time > 24 ms during kinetic work → `html.static-type` (resting cuts only, no waves/acts/squeeze) for the session |

---

## 12. Accessibility, reduced motion & fallbacks

**Structure:**
- Skip links first: „Zum Inhalt“ (`#einsatz`) and „Direkt spielen“ (the play URL).
- Landmarks: `header`, `nav[aria-label="Abschnitte"]`, `main`, `footer`; one h1; an h2 per section; h3 inside.
- Each section has `aria-labelledby` pointing at its h2.
- One polite live region (`#live`) owned by `main.js`. Messages are deduplicated and throttled to ≥ 1 s apart, except direct results of user actions.

**Split text:** the visual glyph layer is `aria-hidden="true"` and a `.sr-only` sibling carries the real text. Never rely on `aria-label` on generic elements.

**Widgets**: native first.
- Sentence: `<select>`; settings: native inputs.
- Tabs: WAI-ARIA tabs with roving tabindex.
- Mode rows: disclosure buttons.
- Dialogs: `<dialog>.showModal()`, with focus returned to the trigger.
- Range inputs carry `aria-valuetext` with units.
- Ranking, history and weapon index: lists of buttons whose names contain all the information.

**Keyboard:**
- Everything is reachable in DOM order.
- No global single-key shortcuts. Key capture happens only inside focused widgets (stage, plan, Tastenprobe), and Tab/Esc always work.
- Space and Enter on the FEUER button work as hold-to-fire.

**Targets & reflow:** ≥ 44 px on coarse pointers; no horizontal scroll at 320 px or at 400 % zoom; fitted text recomputes on resize and zoom.

**Contrast**: see §6. **Language**: `lang="de"`. **Focus**: always visible, 2 px orange.

**Reduced motion** (`prefers-reduced-motion: reduce` OR `settings.reducedMotion`): `html.rm`, applied live.
- Stops all springs, waves, acts, the scroll squeeze, headline entries, count-ups, the Fahne wipe, FLIP, stage inertia, auto-transitions and the zero glide.
- Words rest at their data-derived cuts (these still carry meaning).
- State changes become 120 ms opacity fades.
- Firing shows static results: the ammo count updates, and „Nachladen 2,35 s“ appears as text with the delay honoured.
- The duel shows its result line only.
- Cursor and hitmarker stay (feedback, not motion).

**No WebGL** (`html.no-webgl`):
- The stage shows the `def.icon` line drawing through the same letter mask.
- §01 shows the game warning.
- Nothing else changes.

**No JS** (`html.no-js`):
- All headings, copy and the default play links remain.
- Interactive-only elements (tabs content beyond the first, stage, plan, settings form, Tastenprobe) are hidden.
- `<noscript>` note: „Ohne JavaScript bleibt diese Seite ein Schriftmuster. Das Spiel braucht JavaScript und WebGL.“

**No storage**: settings and profile handle it themselves; `state.js` keeps `site` in memory; §06 shows the note.

**Missing module**: per-section „KEIN SIGNAL.“ and the rest keeps working. The site must never throw to the console in normal use.

---

## 13. Implementation order

1. **Skeleton**: `index.html` with all static copy, `site.css` grid, tokens and type, `fmt`, `state`, `loop`, `motion`, `data`, `fit` → every headline fitted at 360 / 1440 / 2560.
2. **Chrome & hero**: `nav`, `cursor`, `kinetic`, `zero` (signature 1). `deploy` with `buildPlayUrl`.
3. **Arsenal**: index, stats, facts, `ballistics`, Auf Distanz, Duell (signature 3), then `fire` + `stage3d` + mask (signature 2).
4. **Karten**: `plan` + `maps-view` (signature 4).
5. **Profil** + **Fahne** (signature 5). Then Einstellungen, Steuerung, Über, Modi acts, sound.
6. **Hardening**: reduced motion, no-WebGL, no-JS, watchdog, budgets, the checklist below.

---

## 14. Acceptance checklist

Test with `node tools/shot.mjs` against the shared server at 360×740, 412×915 (mobile, touch), 915×412 (mobile landscape), 768×1024, 1280×720, 1440×900, 2560×1440, plus Playwright emulation of `reducedMotion: 'reduce'`, an init script that makes `getContext('webgl'|'webgl2')` return null, and JavaScript disabled.

**Contract & hygiene**
- [ ] Only the site's files were created or changed (`index.html`, `assets/css/site.css`, `assets/js/site/**`, this doc). No shared module was edited.
- [ ] The import map is verbatim. All URLs are relative, and the site works from a sub-path (`/repo/`).
- [ ] No console errors or warnings in normal use, at any listed size, with or without WebGL. `sh tools/check.sh` passes.
- [ ] All user-facing text is German with correct umlauts and „Anführungszeichen“. No exclamation marks. No „→“ anywhere.

**Layout & type**
- [ ] No horizontal scroll at 320–2560 px or at 400 % zoom.
- [ ] Every h2 and the wordmark fill their column edge to edge (±1 %) or are left-aligned at max size. The hero is in 2 lines below 720 px.
- [ ] Below 720 px the bottom bar is visible after the hero and nothing is hidden behind it. Safe areas are respected in landscape.
- [ ] Exactly one orange element at rest per viewport (excluding the „Spielen.“ period). Dim text appears only at ≥ 24 px.

**Signature moments**
- [ ] Five hero clicks or taps give five holes and a result in mm and clicks. The glide puts the bullseye on the MPI. The best group persists across reloads. Keyboard zeroing works via the bullseye button.
- [ ] The sentence builder produces correct German for all modes (prepositions im / in der / am, Bot/Bots, the training template). The URL is valid for every combination. Map options respect mode rules. Settings `lastMode`, `lastMap`, `difficulty` are saved.
- [ ] Holding FEUER on the M-17 Falke fires about 11.7 shots/s (700 rpm) for 30 shots, then the word refills over 2,7 s (`reloadEmptyTime`). The Brecher fires once per press with a visible bolt cycle of about 1,3 s. ADS takes `adsTime`. Drag dissolves the mask, and it returns after 1,6 s idle.
- [ ] The Auf Distanz ranking re-sorts live and matches `adsTime + ttk()` for every weapon at 0, 8, 11, 24 and 50 m. Rows reorder with FLIP. The Duell outcome matches the computed Duellzeit.
- [ ] The map plan's lit words change with operator position. The readouts show meters and the first-choice weapon. „Im Arsenal prüfen.“ sets the distance. Keyboard movement works.
- [ ] With a fake profile history (written via `profile.recordMatch`), the Fahne appears once, announces itself, tears off by button, Esc and drag, and does not reappear after reload. The history glyphs and callsign cut reflect the data.

**Sections**
- [ ] Mode acts trigger on focus, tap and scroll centre (not only hover). One panel is open at a time. The links use the recommended maps.
- [ ] Every `SETTINGS_SCHEMA` key (except `intern`) has a working control. Changes in another tab or the game update the form. The crosshair setting changes the site cursor. The reduced-motion setting applies instantly.
- [ ] Tastenprobe echoes keys only while it is focused. Tab and Esc are never trapped. Gamepad polling stops when the panel is hidden.
- [ ] „Lokale Daten löschen“ removes every `nullpunkt:*` key after confirmation and resets the views live.

**Fallbacks & a11y**
- [ ] Reduced motion leaves nothing animating except 120 ms fades; all information is still present.
- [ ] Without WebGL the Arsenal shows the line drawing through the letters, §01 shows the warning, and there are no errors.
- [ ] Without JS the copy, headings and the default play link work, and the `<noscript>` note shows.
- [ ] Lighthouse mobile: Performance ≥ 90, Accessibility 100, CLS < 0.02, TBT < 150 ms. three.js is not requested before the Arsenal approaches the viewport.
- [ ] At rest (no input for 3 s) the page has no rAF callbacks and the stage does not render.
- [ ] Screen reader pass (VoiceOver iOS, NVDA): the headline words are read as whole words, the sentence controls are named, live messages are concise, and every visual-only encoding (cuts, glyph history, plan) has a text equivalent.

---

## 15. Implementierungsnotizen (site, 2026-10-04)

Stand der Umsetzung und bewusste Abweichungen von diesem Entwurf. Alles Übrige ist wie oben beschrieben gebaut.

**Dateien.** `index.html`, `assets/css/site.css`, `assets/js/site/*.js` (main, data, state, loop, motion, fmt, dom, live, config, fit, kinetic, cursor, nav, zero, deploy, sound, cuts, ballistics, fire, stage3d, arsenal-view, modes-view, plan, maps-view, profile-view, fahne, settings-view, controls-view, about-view), `assets/img/favicon.svg` (auch von `spielen.html` genutzt), `assets/img/og.png` (1200 × 630, aus der Seitenschrift gerendert).

**Abweichungen und Ergänzungen**
- *Favicon*: Datei `assets/img/favicon.svg` statt `data:`-URI, weil die Spielseite dasselbe Symbol verlinkt.
- *Impressum*: gesteuert über `assets/js/site/config.js` (`IMPRESSUM.name`, `street`, `city`, `country`, `email`, `phone`, `responsible`). Leer = Block bleibt verborgen; es wird nie etwas erfunden. Der Platzhaltersatz aus §08 entfällt dadurch.
- *Index (≥ 1024)*: Liegt Inhalt der Randspalte (Waffenindex, Kartenangaben, Einstellungsbeschriftungen, Fuß) hinter dem fixierten Index, faltet er sich auf den aktuellen Eintrag; Hover/Fokus klappt ihn wieder auf. Ohne das verdeckte der Index Teile des Arsenals.
- *Bühne am Telefon (< 720)*: Bild und Name stehen im Quadrat, darunter ein schwarzer HUD-Streifen (Seitenverhältnis 1 : 1,34) für FEUER / ZIELEN / R, Munition und Hinweis. Ab 720 liegt das HUD über dem Bild; Texte dort nutzen `mix-blend-mode: difference`, damit sie auf hellen Buchstaben lesbar bleiben (bei `forced-colors` aus).
- *Sichtlinien-Satz*: Wörter fester Deckung werden als Ganzes fett, sobald eine ihrer Kanten vom Operator aus sichtbar ist (`castVisibility` liefert `seen`); das Sichtpolygon endet an Wänden und würde Wörter im Blockinneren sonst nie erreichen. Weiche Flächen (Wasser, Bahnen …) bleiben zweilagig per `clipPath`. Gemessen wird im fetten Schnitt, damit beleuchtete Wörter in ihren Block passen.
- *Kartendaten*: `maps.data.js` liefert derzeit leere `layout`-Listen. Dann zeigt §03 Name, Daten, Palette und „Hier spielen.“ und an Stelle des Plans „KEIN SIGNAL. Für diese Karte liegt noch kein vermessener Plan vor.“ Sobald `world` die Listen füllt (`[x, z, w, d, kind, rot?]`, Mittelpunkt, Meter), erscheint der Plan ohne Änderung an der Website. Optional gezeichnet: `flags` als Mono-Buchstaben.
- *Touch-Belegung (§07)*: Ist das Telefonbild schmaler als 600 px, ist es nur Bild; bedient wird über eine Wortleiste darunter (keine überlappenden 44-px-Ziele). Zusätzlich das Wort „MESSER“, weil das Spiel einen eigenen Nahkampfknopf hat.
- *Hero am Telefon*: unter „Sofort spielen.“ ein Hinweis mit Querformat-Symbol: „Quer halten. Links laufen, rechts zielen und feuern. Touch-Steuerung“. Die Wortmarke begrenzt sich zusätzlich über die Fensterhöhe, damit im Querformat der Aufruf im ersten Bildschirm bleibt.
- *Ton*: UI-Klänge aus `game/engine/audio/ui-sounds.js` (`createUiSounds(settings, { gestures: false })`), Waffen/Nachladen/Aufstieg erst bei Bedarf aus `game/engine/audio.js` (`new AudioEngine({ settings, events: null }, { autoUnlock: false, autoMusic: false })`), sonst lokale Synthese.
- *Vitrine*: Bei LRU-Verdrängung werden nur Geometrien freigegeben; Materialien und Texturen teilt `models.js` zwischen allen Waffen. Die Kadenz läuft nach echter Zeit (die Schleife kappt `dt` für Federn bei 0,1 s).
- *Abschnitte vorzeitig aufbauen*: `ctx.ensure('arsenal' | 'settings' …)` (z. B. „Im Arsenal prüfen.“, „Namen ändern“).
- *Daten löschen*: setzt Profil, Einstellungen und `nullpunkt:site` zurück und entfernt danach alle `nullpunkt:*`-Schlüssel; die Seite schreibt erst bei der nächsten Änderung wieder.

**Geprüft** mit Playwright (SwiftShader): 360 × 740, 390 × 844 (mobil), 412 × 915, 915 × 412, 844 × 390, 768 × 1024, 1024 × 768, 1280 × 720, 1440 × 900, 1920 × 1080, 2560 × 1440; ohne WebGL, mit reduzierter Bewegung, ohne JavaScript; Tastaturreihenfolge; keine Konsolenfehler, kein waagerechter Überlauf, Touch-Ziele ≥ 44 px; in Ruhe 0 rAF-Aufrufe.

**Budgets (gzip)**: `index.html` 5,5 KB, `site.css` 13 KB, kritische Site-Skripte ≈ 29,6 KB, alle Site-Skripte zusammen ≈ 72 KB (knapp über 70 KB; der Großteil ist `arsenal-view.js`, das erst in Sichtnähe des Arsenals lädt).
