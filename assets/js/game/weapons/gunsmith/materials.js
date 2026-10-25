// Gemeinsame PBR-Materialien der Waffen (geteilt zwischen allen Modellen, LODs und Klonen).
import * as THREE from 'three';
import { wearMap, brushedMap, grainNormal, stippleNormal, knurlNormal, woodMap, reticleMap, polymerMap, drumFaceMap, drumFaceNormal, finishMaps } from './textures.js';
import { p9SlideMaps, p9FrameMaps, SLIDE_CAMO_REPEAT, FRAME_CAMO_REPEAT } from './p9-tex.js';
import { m17FurnMaps, FURN_CAMO_REPEAT } from './m17-tex.js';
import { vp9FurnMaps, CAMO_REPEAT as VP9_CAMO_REPEAT } from './vp9-tex.js';
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
  // Transluzentes Magazin (QX-90)
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
function m17FurnMat(lite) { const t = m17FurnMaps(lite); const m = std({ color: 0x26272a, map: t.map, metalness: 0.0, roughness: 1.0, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = FURN_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, POLY_WEAR); }
// Handy: Atlas ohne Rauheitskarte (§8.3) – mittlere Rauheit des Kunststoffs als Konstante
function vp9FurnMat(tier) { const t = vp9FurnMaps(tier); const m = std({ color: 0xffffff, map: t.map, metalness: 0.0, roughness: t.roughnessMap ? 1.0 : 0.8, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1) }); m.userData.camoRepeat = VP9_CAMO_REPEAT; m.userData.texKey = t.key; return wearPatch(m, POLY_WEAR); }
// Schlüssel mit eigener Handy-Fassung (key@lite) und Atlas-Materialien (je Waffe freigebbar)
const LITE = new Set(['m17Furn', 'p9Slide', 'p9Frame', 'vp9Furn']);
const ATLAS = new Set(['m17Furn', 'm17Furn@lite', 'p9Slide', 'p9Slide@lite', 'p9Frame', 'p9Frame@lite', 'vp9Furn', 'vp9FurnS', 'vp9Furn@lite']);
/** Materialschlüssel für die Handy-Stufe (eigener, kleinerer Atlas), sonst der Schlüssel selbst. */
export function liteKey(key) { return LITE.has(key) ? key + '@lite' : key; }

// Ersatzfarben (sRGB) für texturierte Materialien in der Bot-Detailstufe
const LOD_COLORS = { woodWarm: 0x6a3a22, woodWalnut: 0x4a2d1c, polymerTan: 0x66553c, smokeTan: 0x6e5a3e, smokeGrey: 0x45494c, smokeDark: 0x25292c };
// Bot-Detailstufe ohne Erzeugung der (texturierten) Waffenmaterialien (24.10., V4: Bots ohne Atlas/Texturen – vorher
// legte schon der erste Bot mit M-17 deren Materialien samt Oberflächenkarten an, ≈ 0,2 s): Farbe wie material.color,
// Metall-Gruppe wie metalness ≥ 0,5
const LOD_META = { m17Rec: [0x2b2d30, 0], m17Ras: [0x292b2e, 0], m17Steel: [0x2b2c2d, 0], m17Mag: [0x4a4d51, 0], m17Bcg: [0x2c2d2e, 1],
  m17Furn: [0x26272a, 0], p9Slide: [0x5c5e62, 1], p9Frame: [0x232427, 0],
  vp9Rec: [0x2a2c2f, 0], vp9Steel: [0x232426, 1], vp9Mag: [0x202123, 1], vp9Bcg: [0x2e2f31, 1], vp9Furn: [0x26272a, 0], vp9FurnS: [0x26272a, 0] };
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
