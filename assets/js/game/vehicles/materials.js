// NULLPUNKT — Fahrzeugmaterialien (geteilt, überdauern Matches wie die Viewmodel-Materialien).
//
// Sofort verfügbar: prozedurale Materialien aus engine/textures.js (geklont, eigene Tönung). Danach im Hintergrund
// Aufwertung auf die CC0-Fotoscan-Sätze der Bibliothek (assets/lib/loader.js: metal_painted, gunmetal_worn,
// rubber, canvas, metal_rust_painted) – die Material-Objekte bleiben dieselben, nur die Texturen werden getauscht
// (kein Neuzuweisen an Meshes, keine Shader-Varianten-Explosion: map/normalMap/ORM gibt es in beiden Fällen).
import * as THREE from 'three';
import { getMaterial } from '../engine/textures.js';
import { assets, tierFor } from '../../../lib/loader.js';
import { addShaderPatch, removeShaderPatch } from '../world/shading.js';

let SET = null;
let upgrading = null;

/** Teamfarben der Lackierung (A = Oliv, B = Sand-Grau) und Kennung (A blau, B rot – wie Killfeed/Minikarte). */
export const TEAM_TINT = { A: 0x55613f, B: 0x8c7d5c, null: 0x5f6458 };
export const TEAM_MARK = { A: 0x3d7fe0, B: 0xd8432c, null: 0xd8d2c0 };

function fromBase(name, params) {
  let base = null;
  try { base = getMaterial(name); } catch { base = null; }
  const m = base ? base.clone() : new THREE.MeshStandardMaterial();
  m.name = `veh:${name}`;
  Object.assign(m, params);
  if (params.color != null) m.color = new THREE.Color(params.color);
  return m;
}

/** Kettenglieder (Kanvas, 64×256): Platten mit Stegen, dunkler Stahl. */
function trackTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#26241f'; g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 4; i++) {
    const x = i * 32;
    g.fillStyle = '#3b3833'; g.fillRect(x + 2, 4, 26, 56);
    g.fillStyle = '#4c4842'; g.fillRect(x + 6, 6, 4, 52); g.fillRect(x + 18, 6, 4, 52);
    g.fillStyle = '#17150f'; g.fillRect(x + 29, 0, 3, 64);
    g.fillStyle = '#5a554c'; g.fillRect(x + 12, 28, 6, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** env-look (medium+): Kettenglieder 256×128 mit Greifstegen, Bolzen, Verschleiß + passende Normalenkarte (aus Höhe). */
function trackTextureHQ() {
  const W = 256, H = 128, hc = document.createElement('canvas'); hc.width = W; hc.height = H;
  const h = hc.getContext('2d');
  h.fillStyle = '#000'; h.fillRect(0, 0, W, H);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1f1d19'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const x = i * 64;
    // Platte
    g.fillStyle = '#3a3731'; g.fillRect(x + 3, 6, 54, 116);
    h.fillStyle = '#6a6a6a'; h.fillRect(x + 3, 6, 54, 116);
    // Greifsteg (quer) + Führungszahn (Mitte)
    g.fillStyle = '#56524a'; g.fillRect(x + 22, 6, 12, 116);
    h.fillStyle = '#f0f0f0'; h.fillRect(x + 22, 6, 12, 116);
    g.fillStyle = '#2b2925'; g.fillRect(x + 24, 54, 8, 20);
    h.fillStyle = '#ffffff'; h.fillRect(x + 23, 52, 10, 24);
    // Bolzen + Gummipolster
    for (const y of [16, 104]) { g.fillStyle = '#6b665c'; g.beginPath(); g.arc(x + 10, y, 4, 0, 7); g.arc(x + 48, y, 4, 0, 7); g.fill(); h.fillStyle = '#9a9a9a'; h.beginPath(); h.arc(x + 10, y, 4, 0, 7); h.arc(x + 48, y, 4, 0, 7); h.fill(); }
    g.fillStyle = '#141311'; g.fillRect(x + 58, 0, 6, H);
    // Endverbinder an beiden Kettenrändern (auch auf der Flanke sichtbar: v 0 … 0,08) mit Keilschraube
    for (const y of [0, 117]) {
      g.fillStyle = '#4d4941'; g.fillRect(x + 2, y, 54, 11);
      g.fillStyle = 'rgba(160,152,138,0.45)'; g.fillRect(x + 2, y + (y ? 0 : 9), 54, 2);
      g.fillStyle = '#26241f'; g.beginPath(); g.arc(x + 29, y + 5.5, 3.2, 0, 7); g.fill();
      h.fillStyle = '#c8c8c8'; h.fillRect(x + 2, y, 54, 11);
      h.fillStyle = '#e8e8e8'; h.beginPath(); h.arc(x + 29, y + 5.5, 3.2, 0, 7); h.fill();
    }
    // blanker Verschleiß an den Stegkanten
    g.fillStyle = 'rgba(150,145,135,0.35)'; g.fillRect(x + 22, 6, 2, 116); g.fillRect(x + 32, 6, 2, 116);
  }
  // Schmutz in den Fugen
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(52,42,30,${Math.random() * 0.35})`; g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 4, 0, 7); g.fill(); }
  const hd = h.getImageData(0, 0, W, H).data, nc = document.createElement('canvas'); nc.width = W; nc.height = H;
  const nx = nc.getContext('2d'), out = nx.createImageData(W, H);
  const at = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 3, dy = (at(x, y + 1) - at(x, y - 1)) * 3, l = Math.hypot(dx, dy, 1), o = (y * W + x) * 4;
    out.data[o] = (-dx / l * 0.5 + 0.5) * 255; out.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  nx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  const n = new THREE.CanvasTexture(nc); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.anisotropy = 4;
  return { map: t, normal: n };
}

/** Taktische Kennung (Schablone): Winkel + Nummer, weiß-grau, verwittert; je Team eine Textur (256×64). */
function markingTexture(team) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = 'rgba(226,222,208,0.92)';
  g.font = '700 46px monospace'; g.textBaseline = 'middle';
  // Winkel (A: ^, B: Balken) – lesbar wie echte Verbandsabzeichen, ohne reale Hoheitszeichen
  if (team === 'B') { g.fillRect(14, 20, 44, 9); g.fillRect(14, 35, 44, 9); } else { g.beginPath(); g.moveTo(12, 50); g.lineTo(36, 12); g.lineTo(60, 50); g.lineTo(50, 50); g.lineTo(36, 28); g.lineTo(22, 50); g.fill(); }
  g.fillText(team === 'B' ? '3 4' : team === 'A' ? '2 1' : '0 7', 84, 34);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 700; i++) { g.globalAlpha = Math.random() * 0.7; g.fillRect(Math.random() * 256, Math.random() * 64, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// env-look: Tarnung (3 Töne je Team als Faktor auf die Teamtönung), Schlamm nach Höhe über Grund, Staub auf
// Oberseiten, Lackabplatzer – alles im Fahrzeugraum (Attribut aVeh aus models.js), keine Textur, nur medium+.
const CAMO = { A: [0x39452e, 0x5c4f37], B: [0x6b5d43, 0xa69c80], null: [0x4a4f45, 0x6c6a5c] };
const _ca = new THREE.Color(), _cb = new THREE.Color();
function paintLookPatch(team) {
  const base = _ca.set(TEAM_TINT[team] ?? TEAM_TINT.null);
  const ratio = (hex) => { _cb.set(hex); return new THREE.Vector3(_cb.r / Math.max(1e-4, base.r), _cb.g / Math.max(1e-4, base.g), _cb.b / Math.max(1e-4, base.b)); };
  const [t2, t3] = CAMO[team] || CAMO.null;
  const u = { uCamo2: { value: ratio(t2) }, uCamo3: { value: ratio(t3) }, uMud: { value: new THREE.Color(0x4a3e2f) }, uDust: { value: new THREE.Color(0x9a8f78) } };
  return (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aVeh;\nattribute vec3 aVehE;\nvarying vec3 vVeh;\nvarying vec3 vVehN;\nvarying vec3 vVehE;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVeh = aVeh;\nvVehN = objectNormal;\nvVehE = aVehE;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vVeh; varying vec3 vVehN; varying vec3 vVehE;
        uniform vec3 uCamo2, uCamo3, uMud, uDust;
        float npVh( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
        float npVn( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( npVh( i ), npVh( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( npVh( i + vec3( 0.0, 1.0, 0.0 ) ), npVh( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
                      mix( mix( npVh( i + vec3( 0.0, 0.0, 1.0 ) ), npVh( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( npVh( i + vec3( 0.0, 1.0, 1.0 ) ), npVh( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z ); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float npC1 = npVn( vVeh * vec3( 0.55, 0.8, 0.55 ) ) * 0.65 + npVn( vVeh * 1.6 + 3.1 ) * 0.35;
        float npC2 = npVn( vVeh * vec3( 0.7, 0.9, 0.7 ) + 11.3 ) * 0.65 + npVn( vVeh * 2.1 + 7.0 ) * 0.35;
        float npT2 = smoothstep( 0.55, 0.59, npC1 ), npT3 = smoothstep( 0.58, 0.62, npC2 ) * ( 1.0 - npT2 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), uCamo2, npT2 ) * mix( vec3( 1.0 ), uCamo3, npT3 );
        float npMn = npVn( vVeh * vec3( 2.2, 0.8, 2.2 ) );
        float npVMud = 1.0 - smoothstep( 0.3 + npMn * 0.3, 1.05 + npMn * 0.5, vVeh.y );
        npVMud = max( npVMud, smoothstep( 0.78, 0.85, npVn( vVeh * 6.0 ) ) * ( 1.0 - smoothstep( 0.6, 1.7, vVeh.y ) ) * 0.8 );
        diffuseColor.rgb = mix( diffuseColor.rgb, uMud * ( 0.75 + 0.5 * npMn ), npVMud * 0.9 );
        float npUp = clamp( normalize( vVehN ).y, 0.0, 1.0 );
        diffuseColor.rgb = mix( diffuseColor.rgb, uDust, smoothstep( 0.6, 0.95, npUp ) * ( 0.18 + 0.34 * npVn( vVeh * 1.3 + 5.0 ) ) * ( 1.0 - npVMud ) );
        float npVCh = smoothstep( 0.8, 0.86, npVn( vVeh * 11.0 + 2.0 ) ) * ( 0.3 + 0.7 * smoothstep( 0.35, 0.9, npVn( vVeh * 1.1 ) ) ) * ( 1.0 - npVMud );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.047, 0.043 ), npVCh * 0.8 );
        // Kantenabnutzung: helle, abgeschabte Außenkanten (Abstand aus aVehE), fleckig, unter Schlamm schwächer;
        // schmaler als ~1 Pixel ausgeblendet (kein Flimmern in der Ferne)
        float npEd = min( min( vVehE.x, vVehE.y ), vVehE.z );
        float npEW = 0.007 + 0.02 * npVn( vVeh * 5.0 + 9.1 );
        float npEw = ( 1.0 - smoothstep( npEW * 0.3, npEW, npEd ) ) * smoothstep( 0.32, 0.6, npVn( vVeh * 17.0 + 4.3 ) ) * ( 1.0 - npVMud * 0.85 );
        npEw *= step( 1e-4, vVehE.x + vVehE.y + vVehE.z ) * ( 1.0 - smoothstep( npEW * 0.6, npEW * 1.8, fwidth( npEd ) ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.5 + vec3( 0.075, 0.072, 0.064 ), npEw * 0.8 );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( mix( mix( roughnessFactor, 0.97, npVMud ), 0.42, npVCh ), 0.5, npEw * 0.7 );`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix( mix( mix( metalnessFactor, 0.0, npVMud ), 0.85, npVCh ), 0.7, npEw * 0.6 );`);
  };
}

let lookOn = false, lookFns = null;
/**
 * Tarnung/Schlamm/Staub/Abplatzer an die (geteilten, matchübergreifenden) Lackmaterialien hängen – nur medium+;
 * auf low wird der Haken wieder entfernt (Qualitätswechsel/Auto-Stufe zwischen Matches). Aufruf je Match.
 */
export function applyVehicleLook(quality = 'high') {
  const want = quality !== 'low';
  if (want === lookOn) return false;
  const S = vehicleMaterials();
  if (want && !lookFns) lookFns = { A: paintLookPatch('A'), B: paintLookPatch('B'), null: paintLookPatch('null') };
  for (const k of ['A', 'B', 'null']) {
    if (want) addShaderPatch(S.paint[k], 'vehLook', lookFns[k]);
    else removeShaderPatch(S.paint[k], 'vehLook');
  }
  lookOn = want;
  return true;
}

/** Kennzeichnungs-Material je Team (Schablone, alphaTest, liegt mit Versatz auf dem Lack). */
export function markingMaterial(team) {
  const S = vehicleMaterials();
  const k = team === 'A' || team === 'B' ? team : 'null';
  if (!S.marking[k]) S.marking[k] = new THREE.MeshStandardMaterial({ name: `veh:marking${k}`, map: markingTexture(k), transparent: true, alphaTest: 0.35, depthWrite: false, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return S.marking[k];
}

/**
 * Geteilter Materialsatz. Wird einmal erzeugt; `upgrade(renderer, quality)` tauscht im Hintergrund auf
 * Fotoscan-Texturen (sicher mehrfach aufrufbar).
 */
export function vehicleMaterials() {
  if (SET) return SET;
  const paint = (team) => {
    const m = fromBase('metal_painted', { color: TEAM_TINT[team], metalness: 0.25, roughness: 0.72, envMapIntensity: 0.8 });
    m.userData.vehPaint = true; // models.js: Kantenabstand (aVehE) für die Kantenabnutzung
    return m;
  };
  SET = {
    paint: { A: paint('A'), B: paint('B'), null: paint(null) },
    dark: fromBase('gunmetal', { color: 0x3a3a38, metalness: 0.6, roughness: 0.55 }),
    rubber: fromBase('rubber', { color: 0x1d1d1d, metalness: 0, roughness: 0.92 }),
    canvas: fromBase('tarp', { color: 0x6b6345, metalness: 0, roughness: 0.95 }),
    interior: new THREE.MeshStandardMaterial({ name: 'veh:interior', color: 0x2c2d28, roughness: 0.9, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ name: 'veh:glass', color: 0x1c2428, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.6 }),
    // Optikglas der Panzer (Winkelspiegel, Zieloptik, Periskop): vergütet, undurchsichtig, spiegelnd
    optic: new THREE.MeshStandardMaterial({ name: 'veh:optic', color: 0x0d1a1f, roughness: 0.05, metalness: 0.85, envMapIntensity: 2.2, emissive: 0x06161a, emissiveIntensity: 0.6 }),
    // Turm-Innenraum (nur für den lokalen Insassen): Wandfarbe leicht selbstleuchtend (Innenlampe), Granaten mit Vertex-Farben
    cabin: new THREE.MeshStandardMaterial({ name: 'veh:cabin', color: 0x4d5446, roughness: 0.82, metalness: 0.12, emissive: 0x1b1d16, emissiveIntensity: 1 }),
    shell: new THREE.MeshStandardMaterial({ name: 'veh:shell', vertexColors: true, roughness: 0.42, metalness: 0.55, emissive: 0x0b0a08, emissiveIntensity: 1 }),
    lensOn: new THREE.MeshStandardMaterial({ name: 'veh:lensOn', color: 0xfff6e0, emissive: 0xffe9c0, emissiveIntensity: 6, roughness: 0.2 }),
    lensOff: new THREE.MeshStandardMaterial({ name: 'veh:lensOff', color: 0xb9b6ad, emissive: 0x332f26, emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.3 }),
    rearLamp: new THREE.MeshStandardMaterial({ name: 'veh:rear', color: 0x5a0d08, emissive: 0x6a0904, emissiveIntensity: 1.2, roughness: 0.3 }),
    mark: {
      A: new THREE.MeshStandardMaterial({ name: 'veh:markA', color: TEAM_MARK.A, emissive: TEAM_MARK.A, emissiveIntensity: 0.35, roughness: 0.6 }),
      B: new THREE.MeshStandardMaterial({ name: 'veh:markB', color: TEAM_MARK.B, emissive: TEAM_MARK.B, emissiveIntensity: 0.35, roughness: 0.6 }),
      null: new THREE.MeshStandardMaterial({ name: 'veh:mark', color: TEAM_MARK.null, roughness: 0.6 }),
    },
    wreck: fromBase('metal_rust', { color: 0x2a2420, metalness: 0.2, roughness: 0.95 }),
    trackTex: trackTexture(),
    trackHQ: null, // env-look: Kettenglieder mit Normalenkarte (medium+), bei Bedarf erzeugt
    marking: {},
    cone: new THREE.MeshBasicMaterial({ name: 'veh:cone', color: 0xffe2b0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    flash: new THREE.MeshBasicMaterial({ name: 'veh:flash', color: 0xffc070, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  SET.trackMats = [];
  return SET;
}

/**
 * Vorzuwärmende Fahrzeugmaterialien (Shader, die nicht sofort sichtbar sind): Scheinwerfer an, Lichtkegel, Wrack,
 * Optikglas, Turm-Innenraum (Wände, Granaten) – index.js kompiliert sie beim Anschluss mit (panzer-mp.md §D.3).
 */
export function vehicleWarmMaterials() {
  const S = vehicleMaterials();
  return [S.lensOn, S.cone, S.wreck, S.optic, S.cabin, S.shell];
}

/** Kettenmaterial je Fahrzeugseite (eigene Texturkopie → eigener Versatz für den Kettenlauf). */
export function trackMaterial(hq = false) {
  const S = vehicleMaterials();
  if (hq && !S.trackHQ) S.trackHQ = trackTextureHQ();
  const tex = (hq ? S.trackHQ.map : S.trackTex).clone();
  tex.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ name: 'veh:track', map: tex, color: 0xffffff, roughness: 0.85, metalness: 0.45 });
  if (hq) { m.normalMap = S.trackHQ.normal.clone(); m.normalMap.needsUpdate = true; m.normalScale.set(1.2, 1.2); m.roughness = 0.78; m.metalness = 0.55; }
  return m;
}

function applySet(m, set, { metalness, roughness } = {}) {
  if (!set) return;
  m.map = set.map || m.map;
  m.normalMap = set.normalMap || m.normalMap;
  if (set.ormMap) { m.aoMap = set.ormMap; m.roughnessMap = set.ormMap; m.metalnessMap = set.ormMap; }
  if (metalness != null) m.metalness = metalness;
  if (roughness != null) m.roughness = roughness;
  m.needsUpdate = true;
}

/**
 * Fotoscan-Aufwertung (Hintergrund, Fehler werden still verschluckt → prozedurale Materialien bleiben).
 * Stufe: low 512, sonst 1024 (Fahrzeuge sind keine Helden-Sätze).
 */
export function upgradeVehicleMaterials(renderer, quality = 'high') {
  applyVehicleLook(quality); // je Match (auch nach dem ersten Aufruf): low entfernt den Haken wieder
  if (upgrading) return upgrading;
  const S = vehicleMaterials();
  upgrading = (async () => {
    try {
      if (!assets.renderer && renderer) assets.setRenderer(renderer);
      if (!assets.renderer) return false;
      await assets.ready();
      const tier = Math.min(1024, tierFor(quality, 'texture'));
      const load = (id) => assets.loadTextureSet(id, tier).catch(() => null);
      const [paint, dark, rubber, canvas, rust] = await Promise.all([
        load('metal_painted'), load('gunmetal_worn'), load('rubber'), load('canvas'), load('metal_rust_painted'),
      ]);
      // Lack: einfärbbarer Satz – Farbe bleibt die Teamtönung, Rauheit/Metall aus der ORM-Karte
      for (const k of ['A', 'B', 'null']) applySet(S.paint[k], paint, { metalness: 0.9, roughness: 1 });
      applySet(S.dark, dark, { metalness: 1, roughness: 1 });
      applySet(S.rubber, rubber, { metalness: 1, roughness: 1 });
      applySet(S.canvas, canvas, { metalness: 1, roughness: 1 });
      applySet(S.wreck, rust, { metalness: 0.6, roughness: 1 });
      return true;
    } catch (err) {
      if (typeof console !== 'undefined') console.info('[vehicles] Fotoscan-Materialien nicht verfügbar – prozedural.', err && err.message);
      return false;
    }
  })();
  return upgrading;
}
