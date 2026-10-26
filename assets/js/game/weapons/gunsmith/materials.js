// Gemeinsame PBR-Materialien der Waffen (geteilt zwischen allen Modellen, LODs und Klonen).
import * as THREE from 'three';
import { wearMap, brushedMap, grainNormal, stippleNormal, knurlNormal, woodMap, reticleMap, polymerMap, drumFaceMap, drumFaceNormal, finishMaps } from './textures.js';
import { p9SlideMaps, p9FrameMaps, SLIDE_CAMO_REPEAT, FRAME_CAMO_REPEAT } from './p9-tex.js';
import { m17FurnMaps, FURN_CAMO_REPEAT } from './m17-tex.js';
import { kv47WoodMaps, kv47RecMaps, WOOD_CAMO_REPEAT, REC_CAMO_REPEAT } from './kv47-tex.js';
import { qx90FrameMaps, qx90UpperMaps, FRAME_CAMO_REPEAT as QX_FRAME_REPEAT, UPPER_CAMO_REPEAT as QX_UPPER_REPEAT } from './qx90-tex.js';
import { vp9FurnMaps, CAMO_REPEAT as VP9_CAMO_REPEAT } from './vp9-tex.js';
import { adlerMaps, CAMO_REPEAT as ADLER_CAMO_REPEAT } from './adler-tex.js';
import { p9aMaps, CAMO_REPEAT as P9A_CAMO_REPEAT } from './p9a-tex.js';
import { wirbelWoodMaps, wirbelMantelAlpha, WOOD_CAMO_REPEAT as WIRBEL_WOOD_REPEAT, MANTEL_CAMO_REPEAT as WIRBEL_MANTEL_REPEAT } from './wirbel-tex.js';
import { dropCached } from './textures.js';

const mats = new Map();

// UV-Maßstab: 1 UV-Einheit = UV_SCALE Meter (siehe builder.js boxUV)
export const UV_SCALE = 0.2;

function std(o) {
  const m = new THREE.MeshStandardMaterial(o);
  return m;
}
const solid = (m) => { m.userData.solid = true; return m; };

// Feinere Kachelung der geteilten Detailtexturen (aus der Nähe scharf statt verwaschen); Klone teilen das Bild
const fine = (t, n) => { const c = t.clone(); c.repeat.set(n, n); c.needsUpdate = true; return c; };

// Gebrauchsspuren im Shader (PC-Detailstufe): Attribut wearDirt (x = Kante/Fase blank, y = Schmutz in Kehlen, aus
// cavityColors bzw. Builder-Fasen) plus vorzeichenbehaftete Krümmung aus den Bildschirm-Ableitungen (außen = Abrieb,
// innen = Schmutz/Verdeckung). Abrieb nur fleckweise (Rauschen im Bauteil-Raum), nie als gleichmäßige Umrisslinie.
// Dazu: Unebenheiten (feine Wellen im Bauteil-Raum als Normalenstörung → Spiegelungen verziehen sich wie an echtem
// Metall), fleckige Rauheit (Fett/Griffspuren) und leichte Farbschwankung des Eloxals; Kehlen verdecken Umgebungslicht.
// Fehlt das Attribut (Bot-Detailstufe), liefert WebGL (0, 0) → nur die Krümmungsanteile.
const WEAR_GLSL = `
varying vec2 vWD; varying vec3 vObjP; uniform vec3 uWearCol;
float wh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float wn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wh3(i), wh3(i + vec3(1, 0, 0)), f.x), mix(wh3(i + vec3(0, 1, 0)), wh3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wh3(i + vec3(0, 0, 1)), wh3(i + vec3(1, 0, 1)), f.x), mix(wh3(i + vec3(0, 1, 1)), wh3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
`;
// Handy (grober Zeiger): ohne Shader-Zusätze (leichte Fassung, Nutzer 13.10.)
const WEAR_ON = !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
function wearPatch(m, { col, metal, rough, k = 1, bump = 0.00012, tone = 0.12, smear = 0.35 }) {
  if (!WEAR_ON) return m;
  const wc = new THREE.Color(col);
  const f = (v) => v.toFixed(5);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWearCol = { value: wc };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 wearDirt;\nvarying vec2 vWD;\nvarying vec3 vObjP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWD = wearDirt; vObjP = transformed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + WEAR_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wPatch = smoothstep(0.38, 0.62, wn3(vObjP * 160.0)) * 0.7 + smoothstep(0.5, 0.75, wn3(vObjP * 900.0 + 7.0)) * 0.3;
        float wLow = wn3(vObjP * 38.0 + 3.0), wBig = wn3(vObjP * 7.0 + 11.0);
        float wConv = 0.0, wConc = 0.0;
        #ifndef FLAT_SHADED
        {
          vec3 wn = normalize(vNormal), wp = -vViewPosition, px = dFdx(wp), py = dFdy(wp);
          float kx = dot(dFdx(wn), px) / max(dot(px, px), 1e-12), ky = dot(dFdy(wn), py) / max(dot(py, py), 1e-12);
          wConv = smoothstep(900.0, 2600.0, max(kx, ky));
          wConc = smoothstep(300.0, 1400.0, -min(kx, ky));
        }
        #endif
        float wEdge = clamp(max(vWD.x, wConv * 0.9) * (0.06 + 0.94 * wPatch) * ${f(k)}, 0.0, 1.0);
        float wDirt = clamp(max(vWD.y, wConc * 0.7), 0.0, 1.0);
        diffuseColor.rgb *= 1.0 + ${f(tone)} * (wBig - 0.5) + ${f(tone * 0.5)} * (wLow - 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearCol, wEdge * 0.9) * (1.0 - 0.55 * wDirt);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 + ${f(smear)} * (wLow - 0.5) + ${f(smear * 0.6)} * (wBig - 0.5);
        roughnessFactor = clamp(mix(mix(roughnessFactor, ${f(rough)}, wEdge), 0.92, wDirt), 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, ${f(metal)}, wEdge);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 wGrad = vec3(0.0); float wDet = 1.0;
        #ifndef FLAT_SHADED
        {
          // Unebenheiten: Höhe in Metern aus zwei Rauschlagen (Wellen ~2 cm, Korn ~3 mm), als Oberflächengradient
          float hgt = (wn3(vObjP * 55.0) + 0.35 * wn3(vObjP * 330.0 + 5.0)) * ${f(bump)};
          vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          wDet = dot(sx, r1);
          wGrad = sign(wDet) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
          normal = normalize(abs(wDet) * normal - wGrad);
        }
        #endif`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
          clearcoatNormal = normalize(abs(wDet) * clearcoatNormal - wGrad * 0.8);   // Glanzschicht folgt den Wellen
        #endif`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float wAO = 1.0 - 0.7 * wDirt; reflectedLight.indirectDiffuse *= wAO; reflectedLight.indirectSpecular *= wAO * wAO; }`);
  };
  m.customProgramCacheKey = () => `wear4:${col}:${metal}:${rough}:${k}:${bump}:${tone}:${smear}`;
  return m;
}
const ALU_WEAR = { col: 0x8f9398, metal: 1, rough: 0.3 }, STEEL_WEAR = { col: 0x85878a, metal: 1, rough: 0.34, bump: 0.00008 };
const POLY_WEAR = { col: 0x3d3e41, metal: 0, rough: 0.5, k: 0.7, bump: 0.00006, tone: 0.06, smear: 0.25 };
// Edelstahl (Adler): Kanten blank poliert statt dunkler Grund – heller, glatter, kaum Beulen
const STAINLESS_WEAR = { col: 0xe4e6ea, metal: 1, rough: 0.1, k: 0.75, bump: 0.00002, tone: 0.05, smear: 0.3 };
function phys(o) { return new THREE.MeshPhysicalMaterial(o); }

const DEFS = {
  // Parkerisierter Stahl / Gunmetal
  steel: () => std({ color: 0x3f4146, metalness: 0.82, roughness: 0.5, roughnessMap: wearMap(), metalnessMap: wearMap() }),
  // Brünierter Lauf
  steelDark: () => std({ color: 0x2b2c30, metalness: 0.9, roughness: 0.4, roughnessMap: wearMap() }),
  // Blankes Metall (Verschluss, Laufmündung innen sichtbar)
  steelBright: () => std({ color: 0x8d9095, metalness: 1, roughness: 0.3, roughnessMap: wearMap() }),
  // Schwarz eloxiertes Aluminium
  alu: () => std({ color: 0x2a2b2f, metalness: 0.6, roughness: 0.46, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.08, 0.08) }),
  // Cerakote Flat Dark Earth
  aluTan: () => std({ color: 0x8f7a58, metalness: 0.25, roughness: 0.62, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.3, 0.3) }),
  // Cerakote Oliv (Scharfschützengewehr-Schaft)
  aluOD: () => std({ color: 0x3f4630, metalness: 0.2, roughness: 0.66, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.35, 0.35) }),
  polymer: () => std({ color: 0x1f2023, metalness: 0.0, roughness: 0.78, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  // FDE-Kunststoff (Schaft, Magazin): Grundton × Albedo-Fleckung ≈ #66553c im Mittel (sonnenbeschienen nicht grell)
  polymerTan: () => std({ color: 0x7f6b4d, map: polymerMap(), metalness: 0.0, roughness: 0.8, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.16, 0.16) }),
  polymerOD: () => std({ color: 0x3f4630, metalness: 0.0, roughness: 0.8, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  polymerGrey: () => std({ color: 0x35383b, metalness: 0.0, roughness: 0.74, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  // Griffflächen mit Stippling
  grip: () => std({ color: 0x1c1d20, metalness: 0.0, roughness: 0.88, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.45, 0.45) }),
  gripTan: () => std({ color: 0x75644a, metalness: 0.0, roughness: 0.9, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.45, 0.45) }),
  rubber: () => std({ color: 0x18181a, metalness: 0.0, roughness: 0.9, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.22, 0.22) }),
  woodWarm: () => std({ color: 0xffffff, map: woodMap('warm'), metalness: 0.0, roughness: 0.58, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.2, 0.2) }),
  woodWalnut: () => std({ color: 0xffffff, map: woodMap('walnut'), metalness: 0.0, roughness: 0.42, roughnessMap: wearMap() }),
  stainless: () => std({ color: 0x9da1a6, metalness: 1.0, roughness: 0.36, roughnessMap: brushedMap() }),
  brass: () => std({ color: 0xc09a45, metalness: 1.0, roughness: 0.3, roughnessMap: wearMap() }),
  copper: () => std({ color: 0xb8703f, metalness: 1.0, roughness: 0.32 }),
  // Goldakzente der Waffen der ersten Stunde (UR-1, P-0, Erstlicht): poliert, bleibt unter jeder Tarnung golden
  // Pistole nach Vorbild (P-9 ≈ Glock 17): nitrierter Schlitten mit Abrieb, seidenmatter Rahmenkunststoff, Laufhaube
  slideNitride: () => std({ color: 0x323336, metalness: 0.55, roughness: 0.4, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.1, 0.1) }),
  polymerSatin: () => std({ color: 0x131416, metalness: 0.0, roughness: 0.62, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.14, 0.14) }),
  // P-9 nach Foto (p9-tex.js): Nitrid-Schlitten mit Rillen/Gravur/Kratzern, Polymerrahmen mit Würfelraster und Rillen
  // Schlitten: satiniertes Nitrid – echtes Metall (Spiegelung der Umgebung), Glanz längs gezogen (Anisotropie entlang
  // der Atlas-U-Richtung = Schlittenlänge), blank geriebene Kanten aus dem Atlas (Rauheit/Albedo)
  p9Slide: () => p9SlideMat(false), 'p9Slide@lite': () => p9SlideMat(true),
  p9Frame: () => p9FrameMat(false), 'p9Frame@lite': () => p9FrameMat(true),
  // M-17 nach Foto: eloxiertes Gehäuse (matt, leichter Glanz), Schienen-Handschutz, phosphatierter Stahl (Lauf,
  // Kornträger), Polymer-Schaft/-Griff mit eigenem Atlas (m17-tex.js)
  // M-17 (Nutzer 13.10.2026: realistisch statt „knetig“): anthrazit eloxiert mit seidiger Klarschicht (spiegelt die
  // Umgebung weich), Phosphat-Stahl matt, Magazin grau beschichtet; alle mit Gebrauchsspuren (wearPatch).
  m17Mag: () => wearPatch(std({ color: 0x4a4d51, metalness: 0.4, roughness: 0.52, roughnessMap: fine(finishMaps('alu').rough, 2), normalMap: fine(finishMaps('alu').normal, 2.5), normalScale: new THREE.Vector2(0.18, 0.18) }), { col: 0xaeb2b7, metal: 1, rough: 0.26, k: 1.15 }),
  m17Rec: () => wearPatch(phys({ color: 0x2b2d30, metalness: 0.15, roughness: 0.64, clearcoat: 0.06, clearcoatRoughness: 0.3, roughnessMap: fine(finishMaps('alu').rough, 2), normalMap: fine(finishMaps('alu').normal, 2.5), normalScale: new THREE.Vector2(0.2, 0.2) }), ALU_WEAR),
  m17Ras: () => wearPatch(phys({ color: 0x292b2e, metalness: 0.15, roughness: 0.66, clearcoat: 0.05, clearcoatRoughness: 0.3, roughnessMap: fine(finishMaps('alu').rough, 2), normalMap: fine(finishMaps('alu').normal, 2.5), normalScale: new THREE.Vector2(0.2, 0.2) }), { ...ALU_WEAR, tone: 0.16 }),
  m17Steel: () => wearPatch(std({ color: 0x2b2c2d, metalness: 0.3, roughness: 0.64, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.12, 0.12) }), { ...STEEL_WEAR, bump: 0.00004 }),
  // Verschlussgruppe (innen, keine Tarnung): manganphosphatiert, leicht geölt – matter Grund mit dünnem Ölglanz
  m17Bcg: () => wearPatch(phys({ color: 0x2c2d2e, metalness: 0.5, roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.22, roughnessMap: fine(finishMaps('steel').rough, 3), normalMap: fine(finishMaps('steel').normal, 5), normalScale: new THREE.Vector2(0.08, 0.08) }), { col: 0x9a9c9e, metal: 1, rough: 0.3, bump: 0.00003, tone: 0.06 }),
  m17RecV: () => DEFS.m17Rec(), m17RasV: () => DEFS.m17Ras(), m17SteelV: () => DEFS.m17Steel(), m17FurnV: () => DEFS.m17Furn(),
  m17Furn: () => m17FurnMat(false), 'm17Furn@lite': () => m17FurnMat(true),
  barrelNitride: () => std({ color: 0x38393c, metalness: 0.85, roughness: 0.42, roughnessMap: wearMap() }),
  // KV-47 nach Foto (25.10., Holz-Baukasten G1 in holz-tex.js): Lackholz + Pressstoffgriff (ein Atlas, Klarlack),
  // Gehäuse schwarz lackiert (Atlas mit Prägungen), brünierter Stahl (Lauf, Visier, Kleinteile), Magazin und Träger
  kv47Wood: () => kv47WoodMat(false), 'kv47Wood@lite': () => kv47WoodMat(true),
  kv47Rec: () => kv47RecMat(false), 'kv47Rec@lite': () => kv47RecMat(true),
  kv47Steel: () => wearPatch(std({ color: 0x252629, metalness: 0.5, roughness: 0.46, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.14, 0.14) }), { col: 0x8a8e94, metal: 1, rough: 0.28, bump: 0.00005, tone: 0.1 }),
  // Magazin (Prüfung 25.10.: wirkte flach blaugrau): brünierter Stahl, fast schwarz, glänzend, Kanten/Rippen blank gerieben
  kv47Mag: () => wearPatch(std({ color: 0x41454b, metalness: 0.78, roughness: 0.3, roughnessMap: fine(finishMaps('steel').rough, 2), normalMap: fine(finishMaps('steel').normal, 3), normalScale: new THREE.Vector2(0.12, 0.12) }), { col: 0xb4b8be, metal: 1, rough: 0.2, k: 1.5, bump: 0.00006, tone: 0.14 }),
  kv47Bcg: () => wearPatch(phys({ color: 0x3a3c40, metalness: 0.72, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.25, roughnessMap: fine(finishMaps('steel').rough, 3), normalMap: fine(finishMaps('steel').normal, 5), normalScale: new THREE.Vector2(0.08, 0.08) }), { col: 0xa4a7ab, metal: 1, rough: 0.22, bump: 0.00003, tone: 0.06 }),
  // QX-90 nach Foto (25.10., Polymer-Baukasten G12): Rahmen matter Spritzguss (Atlas), Lauf-/Visiergruppe schwarzer Guss
  // (Atlas, Kratzer, blanke Kanten), Ringvisier eloxiert, Kleinteile schwarzer Kunststoff, Schaftkappe gummiert, Stahl
  // (Lauf, Dämpfer, Spannhebelstangen, Schrauben) phosphatiert; Magazin Rauch-Polymer (durchscheinend, Patronen sichtbar)
  qx90Frame: () => qx90FrameMat(false), 'qx90Frame@lite': () => qx90FrameMat(true),
  qx90Upper: () => qx90UpperMat(false), 'qx90Upper@lite': () => qx90UpperMat(true),
  // Prüfung 25.10.: Optik im Foto so hell wie der Rahmen (0,97), im Modell halb so hell (0x18191b, metallisch) – matt
  // eloxiert, dunkelgrau
  qx90Optic: () => wearPatch(phys({ color: 0x3a3b3e, metalness: 0.18, roughness: 0.56, clearcoat: 0.05, clearcoatRoughness: 0.45, roughnessMap: fine(finishMaps('alu').rough, 2), normalMap: fine(finishMaps('alu').normal, 2.5), normalScale: new THREE.Vector2(0.1, 0.1) }), { ...ALU_WEAR, col: 0x8a8e93, k: 0.7 }),
  qx90Black: () => wearPatch(std({ color: 0x1c1d1f, metalness: 0.0, roughness: 0.62, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.14, 0.14) }), POLY_WEAR),
  // Schaftkappe: im Foto glatt (gummiert, matt) mit feiner Fuge, Ton wie der Rahmen – vorher kräftig gestippelt und fast schwarz
  qx90Butt: () => wearPatch(std({ color: 0x3b3c3f, metalness: 0.0, roughness: 0.82, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.07, 0.07) }), { ...POLY_WEAR, k: 0.35 }),
  // Stahl (Lauf, Dämpfer, Schrauben): Fotos glatt-matt phosphatiert, dunkelgrau – Prüfung 25.10.: wirkte genarbt
  qx90Steel: () => wearPatch(std({ color: 0x3e3f42, metalness: 0.6, roughness: 0.5, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.04, 0.04) }), { col: 0xa3a6ab, metal: 1, rough: 0.28, bump: 0.00002, tone: 0.06 }),
  qx90Rod: () => wearPatch(std({ color: 0x67645f, metalness: 0.8, roughness: 0.4, roughnessMap: fine(finishMaps('steel').rough, 3), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.1, 0.1) }), { col: 0xb8b8b4, metal: 1, rough: 0.22, bump: 0.00004, tone: 0.1 }),
  // Rauch-Polymer (Fotos: dunkel rauchbraun, glänzend, Patronen nur gedämpft zu ahnen – Prüfung 25.10.: vorher hell und
  // glasig mit grellen Patronen): fast deckend, Patronen dahinter mit eigenem, abgedunkeltem Material (qx90Rounds)
  qx90Mag: () => solid(std({ color: 0x2c241d, metalness: 0.0, roughness: 0.46, transparent: true, opacity: 0.9, envMapIntensity: 0.22 })),
  qx90Rounds: () => std({ color: 0x4e4944, vertexColors: true, metalness: 0.55, roughness: 0.52, envMapIntensity: 0.35 }),
  qx90MagTick: () => std({ color: 0x8a7656, metalness: 0.0, roughness: 0.55 }),
  qx90MagCap: () => std({ color: 0x1b1c1e, metalness: 0.0, roughness: 0.55, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  // VP-9 nach Foto (24.10.): Gehäuse aus schwarz lackiertem Stahlblech (seidenmatt, an Kanten bis auf den Stahl
  // abgerieben – das Fotovorbild ist dort fast blank), Kleinteile/Lauf brüniert, Magazin schwarz phosphatiert, Verschluss
  // geölt; Kunststoffteile (Griffstück, Handschutz, Schulterstütze) mit eigenem Atlas (vp9-tex.js)
  // 25.10. (Prüfung: wirkte genarbt wie Guss, kaum von Kunststoff zu unterscheiden): Lack glatter – Korn der Normale ×0,4,
  // kaum Beulen, leichter Lackglanz (Klarschicht); der Kunststoff bleibt matt mit Strahlkorn aus dem Atlas
  vp9Rec: () => wearPatch(phys({ color: 0x2a2c2f, metalness: 0.28, roughness: 0.44, clearcoat: 0.32, clearcoatRoughness: 0.3, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 2), normalScale: new THREE.Vector2(0.04, 0.04) }), { col: 0x7d8186, metal: 1, rough: 0.34, bump: 0.000015, k: 1.1, tone: 0.08 }),
  vp9Steel: () => wearPatch(std({ color: 0x232426, metalness: 0.55, roughness: 0.5, roughnessMap: fine(finishMaps('steel').rough, 3), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.1, 0.1) }), { ...STEEL_WEAR, bump: 0.00004 }),
  vp9Mag: () => wearPatch(std({ color: 0x202123, metalness: 0.5, roughness: 0.46, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 3), normalScale: new THREE.Vector2(0.1, 0.1) }), { col: 0x8a8d91, metal: 1, rough: 0.3, k: 0.85 }),
  vp9Bcg: () => wearPatch(phys({ color: 0x2e2f31, metalness: 0.7, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.2, roughnessMap: fine(finishMaps('steel').rough, 3), normalMap: fine(finishMaps('steel').normal, 5), normalScale: new THREE.Vector2(0.08, 0.08) }), { col: 0xa0a3a6, metal: 1, rough: 0.25, bump: 0.00003, tone: 0.06 }),
  vp9Furn: () => vp9FurnMat('max'), vp9FurnS: () => vp9FurnMat('std'), 'vp9Furn@lite': () => vp9FurnMat('lite'),
  // Adler .50 nach Foto (25.10.): Edelstahl mit eigenem Atlas (adler-tex.js – Schlitten gebürstet, Lauf poliert, Rahmen gestrahlt,
  // Rillen/Gravuren/Abrieb), Wickelgriff aus demselben Atlas (Kunststoff), Kleinteile poliert, Kimme/Korn brüniert
  adlerSteel: () => adlerMat('max', true), adlerSteelS: () => adlerMat('std', true), 'adlerSteel@lite': () => adlerMat('lite', true),
  adlerGrip: () => adlerMat('max', false), adlerGripS: () => adlerMat('std', false), 'adlerGrip@lite': () => adlerMat('lite', false),
  // Kleinteile ohne eigene Detailkarten (25.10., Bauzeit): Strich/Abrieb aus den geteilten Karten, die das Modell ohnehin lädt
  // P-9A (Glock 18C, 26.10.): Nitrid-Schlitten und Polymerrahmen teilen einen Atlas (p9a-tex.js) – je Stufe (…S = PC niedrig/mittel)
  p9aSlide: () => p9aMat('max', true), p9aSlideS: () => p9aMat('std', true), 'p9aSlide@lite': () => p9aMat('lite', true),
  p9aFrame: () => p9aMat('max', false), p9aFrameS: () => p9aMat('std', false), 'p9aFrame@lite': () => p9aMat('lite', false),
  // PS-41 Wirbel (PPSch-41, 26.10.): Birkenschaft mit Atlas (wirbel-tex.js), brünierter Stahl mit blanken Kanten (Foto: stark
  // abgegriffen, an Mantel und Gehäuse fast blank), Laufmantel mit Durchlässigkeitskarte (Schlitze), Trommel heller gebläut,
  // Verschluss geölt blank
  wirbelWood: () => wirbelWoodMat(false), 'wirbelWood@lite': () => wirbelWoodMat(true),
  wirbelSteel: () => wearPatch(std({ color: 0x323438, metalness: 0.62, roughness: 0.42, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.12, 0.12) }), WIRBEL_WEAR),
  wirbelMantel: () => wirbelMantelMat(false), 'wirbelMantel@lite': () => wirbelMantelMat(true),
  wirbelDrum: () => wearPatch(std({ color: 0x55585d, metalness: 0.78, roughness: 0.32, roughnessMap: fine(finishMaps('steel').rough, 2), normalMap: fine(finishMaps('steel').normal, 3), normalScale: new THREE.Vector2(0.1, 0.1) }), { ...WIRBEL_WEAR, k: 1.2 }),
  wirbelBolt: () => wearPatch(phys({ color: 0x55575b, metalness: 0.85, roughness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.25, roughnessMap: fine(finishMaps('steel').rough, 3), normalMap: fine(finishMaps('steel').normal, 5), normalScale: new THREE.Vector2(0.08, 0.08) }), { col: 0xb0b2b6, metal: 1, rough: 0.2 }),
  adlerPolish: () => wearPatch(std({ color: 0xc6cacf, metalness: 1.0, roughness: 0.2, roughnessMap: fine(brushedMap(), 12) }), STAINLESS_WEAR),
  adlerBlued: () => wearPatch(std({ color: 0x1d1e20, metalness: 0.6, roughness: 0.42, roughnessMap: fine(wearMap(), 6) }), { ...STEEL_WEAR, bump: 0.00003 }),
  // Trommelmagazin: eigener Kunststoff (keine Tarnung) und Deckel mit eigener Textur
  drumBody: () => std({ color: 0x2a2c30, map: polymerMap(), metalness: 0.0, roughness: 0.66, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.2, 0.2) }),
  drumFace: () => std({ color: 0xffffff, map: drumFaceMap(), normalMap: drumFaceNormal(), normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.0, roughness: 0.62 }),
  goldTrim: () => std({ color: 0xe9b949, metalness: 1.0, roughness: 0.16, envMapIntensity: 1.5 }),
  shellRed: () => std({ color: 0x8f1f17, metalness: 0.0, roughness: 0.5, roughnessMap: wearMap() }),
  knurl: () => std({ color: 0x2c2d31, metalness: 0.7, roughness: 0.5, normalMap: knurlNormal(), normalScale: new THREE.Vector2(1, 1) }),
  // Optik-Linse: dunkel, stark spiegelnd, bläulich vergütet
  lens: () => std({ color: 0x0c1b22, metalness: 1.0, roughness: 0.04, envMapIntensity: 1.6, emissive: 0x06141c, emissiveIntensity: 1 }),
  // Durchsichtige Optiklinse (Rotpunkt/ACOG): leicht bläulich vergütet, spiegelt die Umgebung
  lensClear: () => std({ color: 0x8fb8d8, metalness: 0.6, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.8 }),
  // Holo-Fenster: leicht getöntes Glas
  glass: () => std({ color: 0x9fd8d0, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.4 }),
  // Transluzentes Rauchglas/-Magazin (OG-Gewehr, Molotow-Flasche; die QX-90 hat seit 25.10. ihr eigenes qx90Mag)
  smoke: () => std({ color: 0x3c4a50, metalness: 0.1, roughness: 0.18, transparent: true, opacity: 0.62, envMapIntensity: 1.2 }),
  // Durchscheinende Polymermagazine (Rauch, Wüstenbraun, Grau wie Lancer/UMP/AUG): Patronen + Zubringer innen
  // sichtbar (magfill.js). userData.solid: zählt für den Handkontakt (contact.js) wie ein festes Teil;
  // Bot-Detailstufe: undurchsichtige Ersatzfarbe (LOD_COLORS)
  smokeTan: () => solid(std({ color: 0x9a7f55, metalness: 0.05, roughness: 0.3, transparent: true, opacity: 0.58, envMapIntensity: 1.1 })),
  smokeGrey: () => solid(std({ color: 0x5c6266, metalness: 0.05, roughness: 0.26, transparent: true, opacity: 0.52, envMapIntensity: 1.1 })),
  smokeDark: () => solid(std({ color: 0x2f363b, metalness: 0.08, roughness: 0.24, transparent: true, opacity: 0.6, envMapIntensity: 1.2 })),
  // Patronen im Magazin (InstancedMesh, Vertex-Farben Messing/Tombak bzw. rote Schrothülse) und Zubringer
  rounds: () => std({ color: 0xffffff, vertexColors: true, metalness: 0.95, roughness: 0.3 }),
  roundsShell: () => std({ color: 0xffffff, vertexColors: true, metalness: 0.35, roughness: 0.48 }),
  follower: () => std({ color: 0x8a4a22, metalness: 0.0, roughness: 0.6 }),
  paintWhite: () => std({ color: 0xdedbd2, metalness: 0.0, roughness: 0.6 }),
  paintOlive: () => std({ color: 0x505733, metalness: 0.25, roughness: 0.62, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.35, 0.35) }),
  paintYellow: () => std({ color: 0xc9a52b, metalness: 0.1, roughness: 0.55 }),
  paintSignal: () => std({ color: 0xff5b1f, metalness: 0.0, roughness: 0.5 }),
  putty: () => std({ color: 0x6f6448, metalness: 0.0, roughness: 0.95, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.6, 0.6) }),
  blade: () => std({ color: 0x9a9ea3, metalness: 1.0, roughness: 0.22, roughnessMap: brushedMap() }),
  bladeCoat: () => std({ color: 0x2a2b2d, metalness: 0.55, roughness: 0.5, roughnessMap: wearMap() }),
  // Stoffhülle (Schutzplatte, Taschen): Oliv, grob
  canvasOD: () => std({ color: 0x4a4f36, metalness: 0.0, roughness: 0.95, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.5, 0.5) }),
  cord: () => std({ color: 0x3b3f2e, metalness: 0.0, roughness: 0.95, normalMap: knurlNormal(), normalScale: new THREE.Vector2(0.8, 0.8) }),
  // Leere/Innenraum (Auswurföffnung, Laufbohrung)
  cavity: () => new THREE.MeshBasicMaterial({ color: 0x050505 }),
  // Laufkrone: blank gedrehte Fase um die Bohrung (fängt Spiegelungen, macht das Loch sichtbar)
  crown: () => std({ color: 0xa9adb2, metalness: 1.0, roughness: 0.2, side: THREE.DoubleSide }),
  // Selbstleuchtend (bloom-freundlich, kein Tonemapping)
  glowRed: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.35, 0.15), toneMapped: false }),
  glowGreen: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 0.5), toneMapped: false }),
  glowAmber: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 1.4, 0.3), toneMapped: false }),
  // Absehen
  reticleHolo: () => new THREE.MeshBasicMaterial({ map: reticleMap('holo', reticleSize), color: new THREE.Color(3.2, 0.55, 0.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  reticleDot: () => new THREE.MeshBasicMaterial({ map: reticleMap('dot', reticleSize), color: new THREE.Color(3.5, 0.3, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  reticleChevron: () => new THREE.MeshBasicMaterial({ map: reticleMap('chevron'), color: new THREE.Color(3.4, 0.7, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  // Bot-Detailstufe: zwei Sammelmaterialien mit Vertex-Farben (ein Draw Call je Gruppe)
  lodMetal: () => std({ color: 0xffffff, vertexColors: true, metalness: 0.75, roughness: 0.45, roughnessMap: wearMap() }),
  lodMatte: () => std({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.72, roughnessMap: wearMap() }),
};

// Atlas-Materialien nach Foto (24.10., Vorarbeit V4): je Stufe eigener Atlas – am Handy (Builder b.lite) die Fassung
// key@lite mit halber Kantenlänge (¼ Speicher); texKey = Eintrag im Textur-Cache, den freeAtlasMaterials freigibt
function p9SlideMat(lite) { const t = p9SlideMaps(lite); const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.map, metalness: 0.78, roughness: 1.0, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 1.1 }); m.userData.camoRepeat = SLIDE_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, { col: 0x9a9c9f, metal: 1, rough: 0.28 }); }
function p9FrameMat(lite) { const t = p9FrameMaps(lite); const m = std({ color: 0x232427, map: t.map, metalness: 0.0, roughness: 1.0, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = FRAME_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, POLY_WEAR); }
// Lackholz: Klarlack-Schicht (spiegelt weich), Abrieb heller und matt; Gehäuse: schwarzer Lack, an Kanten Stahl blank.
// Prüfung 25.10.: Holz-Abrieb schwächer (k 0,35) – im Foto keine hellen Ringe an den Handschutz-Enden, Lack weniger glänzend;
// Grundglanz unter dem Lack schwach (specularIntensity 0,4), sonst liegt ein rosa Schleier über dem Holz (Foto: dunkle Zonen satt)
function kv47WoodMat(lite) { const t = kv47WoodMaps(lite); const m = phys({ color: 0xffffff, map: t.map, metalness: 0.0, roughness: t.roughnessMap ? 1.0 : t.roughness, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), clearcoat: 0.2, clearcoatRoughness: 0.34, specularIntensity: 0.4 }); m.userData.camoRepeat = WOOD_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, { col: 0xb07850, metal: 0, rough: 0.62, k: 0.35, bump: 0.00005, tone: 0.06, smear: 0.2 }); }
// PS-41 Wirbel: Abrieb kräftig und fleckig (Kriegsfertigung, lange benutzt), Lackholz wie KV-47 mit etwas mehr Glanz
const WIRBEL_WEAR = { col: 0x9a948d, metal: 1, rough: 0.3, k: 1.4, bump: 0.00006, tone: 0.12, smear: 0.3 };
function wirbelWoodMat(lite) { const t = wirbelWoodMaps(lite); const m = phys({ color: 0xffffff, map: t.map, metalness: 0.0, roughness: t.roughnessMap ? 1.0 : t.roughness, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), clearcoat: 0.25, clearcoatRoughness: 0.32, specularIntensity: 0.4 }); m.userData.camoRepeat = WIRBEL_WOOD_REPEAT; m.userData.texKey = t.key; return wearPatch(m, { col: 0xa8704a, metal: 0, rough: 0.62, k: 0.45, bump: 0.00005, tone: 0.06, smear: 0.2 }); }
// Mantel: Rohr mit Ausschnitten über alphaMap/alphaTest (wirbel-tex.js); Innenfläche als eigene Fläche im Bauplan
function wirbelMantelMat(lite) { const t = wirbelMantelAlpha(lite); const m = std({ color: 0x323438, metalness: 0.62, roughness: 0.42, alphaMap: t.map, alphaTest: 0.5, roughnessMap: fine(finishMaps('steel').rough, 2.5), normalMap: fine(finishMaps('steel').normal, 4), normalScale: new THREE.Vector2(0.12, 0.12) }); m.userData.camoRepeat = WIRBEL_MANTEL_REPEAT; m.userData.texKey = t.key; return wearPatch(m, WIRBEL_WEAR); }
function kv47RecMat(lite) { const t = kv47RecMaps(lite); const m = phys({ color: 0xffffff, map: t.map, metalness: 0.35, roughness: t.roughnessMap ? 1.0 : t.roughness, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), clearcoat: 0.18, clearcoatRoughness: 0.4 }); m.userData.camoRepeat = REC_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, { col: 0x8c8f94, metal: 1, rough: 0.3, bump: 0.00006, tone: 0.08 }); }
// QX-90: Spritzguss matt (Rauheit aus dem Atlas, Handy konstant), Guss metallisch-schwarz mit blanken Kanten
function qx90FrameMat(lite) { const t = qx90FrameMaps(lite); const m = std({ color: 0xffffff, map: t.map, metalness: 0.0, roughness: t.roughnessMap ? 1.0 : t.roughness, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = QX_FRAME_REPEAT; m.userData.texKey = t.key; return wearPatch(m, { col: 0x4a4c50, metal: 0, rough: 0.42, k: 0.75, bump: 0.00005, tone: 0.06, smear: 0.25 }); }
// Guss (Prüfung 25.10.): weniger metallisch (0,5 → 0,25) – im Foto satinierter Lack, fast so hell wie der Rahmen
function qx90UpperMat(lite) { const t = qx90UpperMaps(lite); const m = std({ color: 0xffffff, map: t.map, metalness: 0.25, roughness: t.roughnessMap ? 1.0 : t.roughness, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = QX_UPPER_REPEAT; m.userData.texKey = t.key; return wearPatch(m, { col: 0x9a9da2, metal: 1, rough: 0.3, bump: 0.00004, tone: 0.08 }); }
function m17FurnMat(lite) { const t = m17FurnMaps(lite); const m = std({ color: 0x26272a, map: t.map, metalness: 0.0, roughness: 1.0, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = FURN_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, POLY_WEAR); }
// Handy: Atlas ohne Rauheitskarte (§8.3) – mittlere Rauheit des Kunststoffs als Konstante
// Adler: Stahl und Griff teilen den Atlas (gleicher texKey); Handy ohne Rauheitskarte (Rauheit konstant)
function adlerMat(tier, steel) { const t = adlerMaps(tier); const m = std({ color: 0xffffff, map: t.map, metalness: steel ? 1.0 : 0.0, roughness: t.roughnessMap ? 1.0 : steel ? 0.26 : 0.8, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = ADLER_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, steel ? STAINLESS_WEAR : POLY_WEAR); }
// P-9A: Schlitten wie P-9 (Nitrid, metallisch), Rahmen wie P-9 (Polymer, Atlas hell × Materialfarbe); Handy ohne Rauheitskarte
function p9aMat(tier, slide) {
  const t = p9aMaps(tier), rough = t.roughnessMap;
  const m = slide ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.map, metalness: 0.78, roughness: rough ? 1.0 : 0.46, roughnessMap: rough, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 1.1 })
    : std({ color: 0x232427, map: t.map, metalness: 0.0, roughness: rough ? 1.0 : 0.5, roughnessMap: rough, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) });
  m.userData.camoRepeat = P9A_CAMO_REPEAT; m.userData.texKey = t.key;
  return wearPatch(m, slide ? { col: 0x9a9c9f, metal: 1, rough: 0.28 } : POLY_WEAR);
}
function vp9FurnMat(tier) { const t = vp9FurnMaps(tier); const m = std({ color: 0xffffff, map: t.map, metalness: 0.0, roughness: t.roughnessMap ? 1.0 : 0.8, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = VP9_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, POLY_WEAR); }
// Schlüssel mit eigener Handy-Fassung (key@lite) und Atlas-Materialien (je Waffe freigebbar)
const LITE = new Set(['m17Furn', 'p9Slide', 'p9Frame', 'kv47Wood', 'kv47Rec', 'vp9Furn', 'qx90Frame', 'qx90Upper', 'adlerSteel', 'adlerGrip', 'p9aSlide', 'p9aFrame', 'wirbelWood', 'wirbelMantel']);
const ATLAS = new Set(['m17Furn', 'm17Furn@lite', 'p9Slide', 'p9Slide@lite', 'p9Frame', 'p9Frame@lite', 'kv47Wood', 'kv47Wood@lite', 'kv47Rec', 'kv47Rec@lite',
  'vp9Furn', 'vp9FurnS', 'vp9Furn@lite', 'qx90Frame', 'qx90Frame@lite', 'qx90Upper', 'qx90Upper@lite',
  'adlerSteel', 'adlerSteelS', 'adlerSteel@lite', 'adlerGrip', 'adlerGripS', 'adlerGrip@lite',
  'p9aSlide', 'p9aSlideS', 'p9aSlide@lite', 'p9aFrame', 'p9aFrameS', 'p9aFrame@lite',
  'wirbelWood', 'wirbelWood@lite', 'wirbelMantel', 'wirbelMantel@lite']);
/** Materialschlüssel für die Handy-Stufe (eigener, kleinerer Atlas), sonst der Schlüssel selbst. */
export function liteKey(key) { return LITE.has(key) ? key + '@lite' : key; }

// Ersatzfarben (sRGB) für texturierte Materialien in der Bot-Detailstufe
const LOD_COLORS = { woodWarm: 0x6a3a22, woodWalnut: 0x4a2d1c, polymerTan: 0x66553c, smokeTan: 0x6e5a3e, smokeGrey: 0x45494c, smokeDark: 0x25292c };
// Bot-Detailstufe ohne Erzeugung der (texturierten) Waffenmaterialien (24.10., V4: Bots ohne Atlas/Texturen – vorher
// legte schon der erste Bot mit M-17 deren Materialien samt Oberflächenkarten an, ≈ 0,2 s): Farbe wie material.color,
// Metall-Gruppe wie metalness ≥ 0,5
const LOD_META = { m17Rec: [0x2b2d30, 0], m17Ras: [0x292b2e, 0], m17Steel: [0x2b2c2d, 0], m17Mag: [0x4a4d51, 0], m17Bcg: [0x2c2d2e, 1],
  m17Furn: [0x26272a, 0], p9Slide: [0x5c5e62, 1], p9Frame: [0x232427, 0],
  kv47Wood: [0x4e1f0c, 0], kv47Rec: [0x222325, 0], kv47Steel: [0x252629, 1], kv47Mag: [0x33363b, 1], kv47Bcg: [0x3a3c40, 1],
  qx90Frame: [0x3a3b3e, 0], qx90Upper: [0x343538, 0], qx90Mag: [0x2c241d, 0], qx90Rod: [0x67645f, 1],
  // QX-90 Bots: Farben direkt (sonst baute die Bot-Stufe Alu-/Stahl-/Stippel-Kacheln nur zum Farbablesen, ≈ 130 ms)
  qx90Optic: [0x3a3b3e, 0], qx90Butt: [0x3b3c3f, 0], qx90Steel: [0x3e3f42, 1], qx90MagCap: [0x1b1c1e, 0], qx90Black: [0x1c1d1f, 0],
  qx90MagTick: [0x8a7656, 0],
  vp9Rec: [0x2a2c2f, 0], vp9Steel: [0x232426, 1], vp9Mag: [0x202123, 1], vp9Bcg: [0x2e2f31, 1], vp9Furn: [0x26272a, 0], vp9FurnS: [0x26272a, 0],
  adlerSteel: [0xb9bdc1, 1], adlerSteelS: [0xb9bdc1, 1], adlerGrip: [0x1c1d1f, 0], adlerGripS: [0x1c1d1f, 0], adlerPolish: [0xc6cacf, 1], adlerBlued: [0x1d1e20, 1],
  p9aSlide: [0x5c5e62, 1], p9aSlideS: [0x5c5e62, 1], p9aFrame: [0x232427, 0], p9aFrameS: [0x232427, 0],
  wirbelWood: [0x52230f, 0], wirbelSteel: [0x323438, 1], wirbelMantel: [0x323438, 1], wirbelDrum: [0x55585d, 1], wirbelBolt: [0x55575b, 1] };
const _lodCol = new Map();
/** Farbe (linear) + Metall-Gruppe eines Materials für die zusammengeführte Bot-Detailstufe. */
export function lodInfo(key) {
  let r = _lodCol.get(key);
  if (!r && LOD_META[key]) { r = { color: new THREE.Color(LOD_META[key][0]), metal: !!LOD_META[key][1] }; _lodCol.set(key, r); }
  if (!r) {
    if (ATLAS.has(key)) {   // nie einen Atlas für Bots erzeugen: neutrale Ersatzfarbe, Hinweis für den Bauplan
      console.warn(`[gunsmith] Atlas-Material ${key} in der Bot-Stufe – LOD_META ergänzen`);
      r = { color: new THREE.Color(0x333333), metal: false }; _lodCol.set(key, r); return r;
    }
    const m = getMat(key);
    const color = LOD_COLORS[key] !== undefined ? new THREE.Color(LOD_COLORS[key]) : (m.color ? m.color.clone() : new THREE.Color(0x333333));
    r = { color, metal: (m.metalness ?? 0) >= 0.5 };
    _lodCol.set(key, r);
  }
  return r;
}

// Materialien, die in der Bot-Detailstufe entfallen (Durchsicht, Leuchten, Hohlräume)
export const LOD_SKIP = new Set(['cavity', 'glass', 'lens', 'lensClear', 'smoke', 'reticleHolo', 'reticleDot', 'reticleChevron', 'glowRed', 'glowGreen', 'glowAmber']);

export function getMat(key) {
  let m = mats.get(key);
  if (!m) {
    const make = DEFS[key];
    if (!make) throw new Error(`Unbekanntes Waffenmaterial: ${key}`);
    m = make();
    m.name = 'gs:' + key;
    mats.set(key, m);
  }
  return m;
}

export function materialKeys() { return Object.keys(DEFS); }

// Leuchtpunkt-Größe (Einstellung reticleSize): gilt für alle Leuchtpunkt- und Holo-Visiere, auch schon gebaute
let reticleSize = 1;
export function setReticleSize(s) {
  s = Number.isFinite(s) ? Math.min(2.5, Math.max(0.4, s)) : 1;
  if (s === reticleSize) return;
  reticleSize = s;
  for (const [key, type] of [['reticleHolo', 'holo'], ['reticleDot', 'dot']]) {
    const m = mats.get(key);
    if (m) { m.map = reticleMap(type, s); m.needsUpdate = true; }
  }
}

/**
 * Material nachträglich anmelden (z. B. Schriftzüge einzelner Waffen); vorhandene Schlüssel bleiben unverändert.
 * o.lite: eigene Handy-Fassung (key@lite), o.atlas: Atlas-Material (je Waffe freigebbar, nie in der Bot-Stufe).
 */
export function defineMat(key, make, o = {}) {
  if (!DEFS[key]) DEFS[key] = make;
  if (o.lite && !DEFS[key + '@lite']) { DEFS[key + '@lite'] = o.lite; LITE.add(key); }
  if (o.atlas) { ATLAS.add(key); if (o.lite) ATLAS.add(key + '@lite'); }
}

/**
 * Freigabe je Waffe (24.10., V4): Atlas-Materialien, die keine Vorlage mehr benutzt (used = Menge der Schlüssel),
 * samt Texturen freigeben; der Atlas entsteht bei Bedarf neu. Liefert die freigegebenen Schlüssel (Tarnklone dazu
 * gibt camos.js frei).
 */
export function freeAtlasMaterials(used) {
  const freed = [];
  for (const [key, m] of [...mats]) {
    if (!ATLAS.has(key) || used.has(key)) continue;
    mats.delete(key);
    freed.push(key);
    // Texturen: der letzte Nutzer eines Cache-Eintrags gibt ihn ganz frei (dropCached), sonst nur die eigenen Karten
    // (z. B. Schrift PC ↔ Handy); Karten, die ein verbleibendes Material mitbenutzt, bleiben
    const tk = m.userData.texKey, MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'];
    if (tk && ![...mats.values()].some((o) => o.userData.texKey === tk)) dropCached(tk);
    else {
      const inUse = new Set();
      for (const o of mats.values()) for (const p of MAPS) if (o[p]) inUse.add(o[p]);
      for (const p of MAPS) if (m[p] && !inUse.has(m[p])) m[p].dispose();
    }
    m.dispose();
  }
  return freed;
}

// Vorrat für Instanz-Materialien des Viewmodels (Arme, Mündungsfeuer, Rauch, Hülsen). Beim Matchende werden sie
// hier geparkt statt entsorgt: dispose() gäbe ihre Shaderprogramme frei, und das nächste Match müsste jedes neu
// kompilieren und linken (auf Telefonen Hunderte ms). Ein Eintrag ist ein Material oder ein Objekt aus Materialien;
// Instanzzustand (Deckkraft, Textur) setzt der neue Besitzer beim Holen selbst.
const spare = new Map();

/** Material(-satz) unter `key` aus dem Vorrat holen, sonst mit make() neu anlegen. */
export function takeMaterials(key, make) {
  const list = spare.get(key);
  return list && list.length ? list.pop() : make();
}

/** Material(-satz) zurück in den Vorrat legen (ersetzt dispose(); endgültig frei erst mit disposeMaterials()). */
export function parkMaterials(key, set) {
  if (!set) return;
  let list = spare.get(key);
  if (!list) spare.set(key, (list = []));
  if (!list.includes(set)) list.push(set);
}

function disposeSet(set) {
  if (set.isMaterial) set.dispose();
  else for (const m of Object.values(set)) if (m && m.isMaterial) m.dispose();
}

export function disposeMaterials() {
  for (const m of mats.values()) m.dispose();
  mats.clear();
  for (const list of spare.values()) list.forEach(disposeSet);
  spare.clear();
}
