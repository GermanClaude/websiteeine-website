// NULLPUNKT — Welt-Shading (Owner: world): EIN gemeinsamer Shader-Haken für alle Materialien der Welt.
//
//   • Sonden-Gitter (R5): indirektes Licht (Halbkugel, Umgebung diffus + Spiegelung) × Himmelssicht, + Sonnen-
//     Rückprall (1 Sprung) + gebackene Lichtgruppen. 1–2 Abfragen einer 3D-Textur (RGBA8).
//   • Fernschatten (R8): außerhalb der Nahkaskade der Sonne die einmal gerenderte statische Fernkarte (medium+)
//     bzw. die Sonnensicht der Sonden (low, ohne Schattenkarten).
//   • Höhennebel mit Sonnen-Einstreuung (R6) statt linearem Nebel.
//   • Spekulares Anti-Aliasing (R14): Rauheit aus der Streuung der Normalen im Pixel (Kaplanyan 2016).
// Alle Werte hängen an geteilten Uniforms (ein Satz für alle Materialien) – die Welt schaltet sie je Karte;
// ohne aktive Welt verhalten sich die Materialien exakt wie vorher (linearer Nebel, keine Abschattung).
//
// Mehrere Shader-Haken je Material (z. B. Weltraum-Variation aus engine/textures.js + dieser) laufen über
// addShaderPatch(): ein Verteiler statt überschriebener onBeforeCompile-Funktionen.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Verteiler für mehrere onBeforeCompile-Haken je Material
// ---------------------------------------------------------------------------
const REG = new WeakMap();
const BASE_OBC = THREE.Material.prototype.onBeforeCompile;
const BASE_KEY = THREE.Material.prototype.customProgramCacheKey;

/**
 * Shader-Haken unter einem Schlüssel registrieren (idempotent). fn(shader, renderer, material) ändert
 * shader.vertexShader/fragmentShader/uniforms. Ein vorher gesetzter eigener onBeforeCompile bleibt erhalten
 * (läuft zuerst), der Programmschlüssel enthält alle Hakennamen.
 */
export function addShaderPatch(material, key, fn) {
  let r = REG.get(material);
  if (!r) {
    const ownObc = material.onBeforeCompile !== BASE_OBC ? material.onBeforeCompile : null;
    const ownKey = material.customProgramCacheKey !== BASE_KEY ? material.customProgramCacheKey : null;
    r = { patches: new Map(), ownObc, ownKey };
    REG.set(material, r);
    material.onBeforeCompile = function (shader, renderer) {
      if (r.ownObc) r.ownObc.call(this, shader, renderer);
      for (const p of r.patches.values()) p(shader, renderer, this);
    };
    material.customProgramCacheKey = function () {
      return (r.ownKey ? r.ownKey.call(this) : '') + '|np:' + [...r.patches.keys()].join(',');
    };
  }
  if (r.patches.get(key) === fn) return material;
  r.patches.set(key, fn);
  material.needsUpdate = true;
  return material;
}

/** Hat das Material den Haken `key`? */
export function hasShaderPatch(material, key) { return !!REG.get(material)?.patches.has(key); }

/** Weltposition (vNpWorld) + Objektnormale (vNpNormal) als Varyings bereitstellen – nur einmal je Shader. */
export function ensureWorldVaryings(shader) {
  if (shader.vertexShader.includes('varying vec3 vNpWorld;')) return;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vNpWorld;\nvarying vec3 vNpNormal;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 npW = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        npW = batchingMatrix * npW;
      #endif
      #ifdef USE_INSTANCING
        npW = instanceMatrix * npW;
      #endif
      npW = modelMatrix * npW;
      vNpWorld = npW.xyz;
      vNpNormal = mat3( modelMatrix ) * objectNormal;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vNpWorld;\nvarying vec3 vNpNormal;');
}

// ---------------------------------------------------------------------------
// Geteilte Uniforms
// ---------------------------------------------------------------------------
function tex3(rgba) {
  const t = new THREE.Data3DTexture(new Uint8Array(rgba), 1, 1, 1);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'np:probe-neutral';
  return t;
}
const NEUTRAL_A = tex3([0, 0, 0, 255]);      // kein Rückprall, volle Himmelssicht
const NEUTRAL_B = tex3([255, 0, 0, 0]);      // volle Sonnensicht, keine Lichtgruppen

/** Geteilte Uniforms aller Welt-Materialien (Werte setzt die Welt; Standard = neutral). */
export const WS = {
  npProbeA: { value: NEUTRAL_A },
  npProbeB: { value: NEUTRAL_B },
  npProbeMin: { value: new THREE.Vector3() },
  npProbeSize: { value: new THREE.Vector3(1, 1, 1) },
  npProbeRes: { value: new THREE.Vector3(1, 1, 1) },
  npProbeCell: { value: 2 },
  // x: an (0/1), y: Mindest-Himmelssicht, z: Spiegel-Abschattung 0..1, w: Lichtgruppen an
  npProbe: { value: new THREE.Vector4(0, 0.04, 0.85, 0) },
  npBounce: { value: new THREE.Color(0, 0, 0) },          // Sonnenbestrahlung × Rückprall-Verstärkung × Codierfaktor
  npGroups: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  // x: Modus (0 aus = außerhalb der Nahkaskade besonnt, 1 Fernkarte, 2 Sondensicht), y/z: Überblendung (Rand der
  // Nahkaskade, 0..1 von der Mitte), w: Normalenversatz der Fernkarte (m)
  npFar: { value: new THREE.Vector4(0, 0.82, 0.97, 0.1) },
  npFarMap: { value: null },                                // DepthTexture (Vergleich) – initShading() setzt Platzhalter
  npFarMatrix: { value: new THREE.Matrix4() },
  npFarParams: { value: new THREE.Vector4(-0.0005, 1.5, 1 / 1024, 1 / 1024) }, // Tiefen-Bias, PCF-Radius (Texel), Texelgröße
  // Höhennebel: x Dichte (1/m auf Höhe z), y Abfall (1/m), z Bezugshöhe, w Startabstand (m)
  npFog: { value: new THREE.Vector4(0, 0.1, 0, 30) },
  npFogSun: { value: new THREE.Vector4(0, 1, 0, 8) },      // Richtung zur Sonne, Exponent der Vorwärtsstreuung
  npFogSunCol: { value: new THREE.Color(0, 0, 0) },
  npFogMax: { value: 1 },
  npSpecAA: { value: 1 },
};

let dummyDepth = null;
/** Platzhalter-Tiefentextur (Vergleichsmodus) anlegen – ein sampler2DShadow braucht immer eine gültige Bindung. */
export function initShading(renderer) {
  if (!renderer || !renderer.isWebGLRenderer) return;
  if (!dummyDepth || dummyDepth.renderer !== renderer) {
    const dt = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    dt.format = THREE.DepthFormat;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = dt.magFilter = THREE.LinearFilter;
    dt.name = 'np:far-shadow-dummy';
    const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, depthTexture: dt });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear(false, true, false);
    renderer.setRenderTarget(prev);
    dummyDepth = { rt, tex: dt, renderer };
  }
  if (!WS.npFarMap.value || WS.npFarMap.value.userData?.npDisposed) WS.npFarMap.value = dummyDepth.tex;
}

/** Fernkarte lösen (Platzhalter wieder einsetzen). */
export function resetFarMap() {
  if (shadingMode('far') === 1) setShadingMode({ far: 0 });
  if (dummyDepth) WS.npFarMap.value = dummyDepth.tex;
}

/** Nach WebGL-Kontextverlust: Platzhalter neu anlegen (beim nächsten initShading). */
export function dropShadingContext() { dummyDepth = null; WS.npFarMap.value = null; }

/** Alles neutral (keine Welt aktiv). */
export function resetShading() {
  setShadingMode({ probe: 0, far: 0, fog: 0, specAA: 1 });
  WS.npProbe.value.w = 0;
  WS.npProbeA.value = NEUTRAL_A; WS.npProbeB.value = NEUTRAL_B;
  WS.npBounce.value.setRGB(0, 0, 0);
  if (dummyDepth) WS.npFarMap.value = dummyDepth.tex;
}

// ---------------------------------------------------------------------------
// Shader-Bausteine
// ---------------------------------------------------------------------------
const PARS = /* glsl */ `
uniform highp sampler3D npProbeA;
uniform highp sampler3D npProbeB;
uniform vec3 npProbeMin;
uniform vec3 npProbeSize;
uniform vec3 npProbeRes;
uniform float npProbeCell;
uniform vec4 npProbe;
uniform vec3 npBounce;
uniform vec3 npGroups[ 3 ];
uniform vec4 npFar;
uniform highp sampler2DShadow npFarMap;
uniform mat4 npFarMatrix;
uniform vec4 npFarParams;
uniform vec4 npFog;
uniform vec4 npFogSun;
uniform vec3 npFogSunCol;
uniform float npFogMax;
uniform float npSpecAA;
`;

// nach shadowmap_pars_fragment (Fernkarte, Überblendung der Kaskaden)
const FUNCS = /* glsl */ `
float npFarMapShadow( vec3 wp, vec3 wn ) {
	vec4 fc = npFarMatrix * vec4( wp + wn * npFar.w, 1.0 );
	vec3 c = fc.xyz / fc.w;
	if ( c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0 ) return 1.0;
	float z = c.z + npFarParams.x;
	vec2 t = npFarParams.zw * npFarParams.y;
	return 0.25 * (
		texture( npFarMap, vec3( c.xy + vec2( -0.4, -1.0 ) * t, z ) ) +
		texture( npFarMap, vec3( c.xy + vec2( 1.0, -0.4 ) * t, z ) ) +
		texture( npFarMap, vec3( c.xy + vec2( 0.4, 1.0 ) * t, z ) ) +
		texture( npFarMap, vec3( c.xy + vec2( -1.0, 0.4 ) * t, z ) ) );
}
// Nahkaskade (three.js) → außerhalb ihres Rands die Fernkarte bzw. die Sonnensicht der Sonden
float npSunShadow( float nearS, vec4 nearCoord, vec3 wp, vec3 wn, float probeSun ) {
	if ( npFar.x < 0.5 ) return nearS;
	vec3 c = nearCoord.xyz / nearCoord.w;
	vec2 e = abs( c.xy - 0.5 ) * 2.0;
	float w = smoothstep( npFar.y, npFar.z, max( e.x, e.y ) );
	if ( c.z > 1.0 ) w = 1.0;
	if ( w <= 0.0 ) return nearS;
	float farS = npFar.x < 1.5 ? npFarMapShadow( wp, wn ) : probeSun;
	return mix( nearS, farS, w );
}
`;

// Beginn der Lichtberechnung: Weltlage, Sondenabfrage (einmal je Fragment)
const SETUP = /* glsl */ `
IncidentLight directLight;
vec3 npWP = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
vec3 npWN = inverseTransformDirection( geometryNormal, viewMatrix );
vec4 npPA = vec4( 0.0, 0.0, 0.0, 1.0 );
vec4 npPB = vec4( 1.0, 0.0, 0.0, 0.0 );
if ( npProbe.x > 0.5 ) {
	vec3 npU = ( npWP + npWN * ( 0.5 * npProbeCell ) - npProbeMin ) / npProbeSize;
	vec3 npE = min( npU, 1.0 - npU ) * npProbeRes;
	float npPW = clamp( min( min( npE.x, npE.y ), npE.z ), 0.0, 1.0 );
	if ( npPW > 0.0 ) {
		npPA = mix( npPA, texture( npProbeA, npU ), npPW );
		if ( npProbe.w > 0.5 || npFar.x > 1.5 ) npPB = mix( npPB, texture( npProbeB, npU ), npPW );
	}
}
`;

// nach lights_fragment_maps: indirektes Licht abschatten, Rückprall + Lichtgruppen addieren
const INDIRECT = /* glsl */ `
if ( npProbe.x > 0.5 ) {
	float npV = max( npPA.a, npProbe.y );
	irradiance *= npV;
	iblIrradiance *= npV;
	radiance *= mix( 1.0, npV, npProbe.z );
	irradiance += npPA.rgb * npPA.rgb * npBounce;
	if ( npProbe.w > 0.5 ) irradiance += npPB.g * npPB.g * npGroups[ 0 ] + npPB.b * npPB.b * npGroups[ 1 ] + npPB.a * npPB.a * npGroups[ 2 ];
}
`;

// Höhennebel mit Sonnen-Einstreuung (statt fog_fragment); ohne aktive Welt: linearer Nebel wie bisher
const FOG = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#else
	if ( npFog.x > 0.0 ) {
		vec3 npFW = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 npRay = npFW - cameraPosition;
		float npL = length( npRay );
		float npK = npFog.y * npRay.y;
		float npI = abs( npK ) > 0.01 ? ( 1.0 - exp( - npK ) ) / npK : 1.0 - 0.5 * npK;
		float npOD = npFog.x * exp( - npFog.y * ( cameraPosition.y - npFog.z ) ) * max( npL - npFog.w, 0.0 ) * npI;
		float npF = min( 1.0 - exp( - npOD ), npFogMax );
		float npSc = pow( max( dot( npRay / max( npL, 1e-4 ), npFogSun.xyz ), 0.0 ), npFogSun.w );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + npFogSunCol * npSc, npF );
	} else {
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	}
	#endif
#endif
`;

// Spekulares AA nach lights_physical_fragment (Rauheit schon gesetzt, dfg wird danach daraus gelesen)
const SPEC_AA = /* glsl */ `
if ( npSpecAA > 0.0 ) {
	vec3 npDx = dFdx( normal ), npDy = dFdy( normal );
	float npVar = 0.25 * ( dot( npDx, npDx ) + dot( npDy, npDy ) );
	float npKr = min( 2.0 * npVar, 0.18 ) * npSpecAA;
	material.roughness = min( sqrt( material.roughness * material.roughness + npKr ), 1.0 );
}
`;

const DIR_SHADOW_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const DIR_INFO_LINE = 'getDirectionalLightInfo( directionalLight, directLight );';

let _lightsBegin = null;
function lightsBegin() {
  if (_lightsBegin) return _lightsBegin;
  let src = THREE.ShaderChunk.lights_fragment_begin;
  const must = (find, repl) => {
    if (!src.includes(find)) throw new Error(`[shading] lights_fragment_begin: Stelle fehlt: ${find.slice(0, 50)}`);
    src = src.replace(find, repl);
  };
  must('IncidentLight directLight;', SETUP);
  // Sonne (Index 0): Kaskaden-Überblendung zur Fernkarte; andere Richtungslichter unverändert
  must(DIR_SHADOW_LINE, `#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= ( directLight.visible && receiveShadow ) ? npSunShadow( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), vDirectionalShadowCoord[ i ], npWP, npWN, npPB.r ) : 1.0;
		#else
		${DIR_SHADOW_LINE}
		#endif`);
  // ohne Schattenkarten (Einstellung „aus“): Sonnensicht der Sonden
  must(DIR_INFO_LINE, `${DIR_INFO_LINE}
		#if !defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX == 0 )
		if ( npFar.x > 1.5 ) directLight.color *= npPB.r;
		#endif`);
  _lightsBegin = src;
  return src;
}

/** Der eigentliche Haken (für MeshStandardMaterial/MeshPhysicalMaterial). */
function worldShadingPatch(shader) {
  Object.assign(shader.uniforms, WS);
  let fs = shader.fragmentShader;
  const rep = (find, repl) => {
    if (!fs.includes(find)) return false;
    fs = fs.replace(find, repl);
    return true;
  };
  rep('#include <common>', `#include <common>\n${PARS}`);
  rep('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${FUNCS}`);
  rep('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPEC_AA}`);
  rep('#include <lights_fragment_begin>', lightsBegin());
  rep('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${INDIRECT}`);
  rep('#include <fog_fragment>', FOG);
  shader.fragmentShader = fs;
}

// ---------------------------------------------------------------------------
// Nur während die Weltszene rendert aktiv: Materialien, die auch in anderen Szenen vorkommen (Viewmodel teilt
// z. B. Waffenmaterialien), bleiben dort unverändert (neutral: keine Sonden, kein Fernschatten, kein Höhennebel).
// ---------------------------------------------------------------------------
const live = { probe: 0, far: 0, fog: 0, specAA: 1 };
let liveStored = false;
function neutralize() {
  if (liveStored) return;
  live.probe = WS.npProbe.value.x; live.far = WS.npFar.value.x; live.fog = WS.npFog.value.x; live.specAA = WS.npSpecAA.value;
  WS.npProbe.value.x = 0; WS.npFar.value.x = 0; WS.npFog.value.x = 0; WS.npSpecAA.value = 0;
  liveStored = true;
}
function activate() {
  if (!liveStored) return;
  WS.npProbe.value.x = live.probe; WS.npFar.value.x = live.far; WS.npFog.value.x = live.fog; WS.npSpecAA.value = live.specAA;
  liveStored = false;
}

/**
 * Welt-Shading an eine Szene binden: aktiv nur während renderer.render(scene) – davor/danach neutral.
 * Setzt scene.onBeforeRender/onAfterRender (vorhandene Haken laufen weiter). → Lösen-Funktion
 */
export function bindShadingScene(scene) {
  if (!scene) return () => {};
  const prevB = scene.onBeforeRender, prevA = scene.onAfterRender;
  scene.onBeforeRender = function (...args) { activate(); return prevB.apply(this, args); };
  scene.onAfterRender = function (...args) { const r = prevA.apply(this, args); neutralize(); return r; };
  neutralize(); // bis zum nächsten Bild der Weltszene neutral
  return () => {
    activate();
    if (scene.onBeforeRender !== prevB) scene.onBeforeRender = prevB;
    if (scene.onAfterRender !== prevA) scene.onAfterRender = prevA;
  };
}

/** Werte setzen, egal ob gerade neutralisiert (die Welt ruft das statt direkter Zuweisungen an x-Komponenten). */
export function setShadingMode({ probe, far, fog, specAA } = {}) {
  const tgt = liveStored ? live : null;
  if (probe !== undefined) { if (tgt) tgt.probe = probe; else WS.npProbe.value.x = probe; }
  if (far !== undefined) { if (tgt) tgt.far = far; else WS.npFar.value.x = far; }
  if (fog !== undefined) { if (tgt) tgt.fog = fog; else WS.npFog.value.x = fog; }
  if (specAA !== undefined) { if (tgt) tgt.specAA = specAA; else WS.npSpecAA.value = specAA; }
}

/** Aktueller (wirksamer) Wert eines Schalters: 'probe' | 'far' | 'fog' | 'specAA'. */
export function shadingMode(key) {
  if (liveStored) return live[key];
  return key === 'probe' ? WS.npProbe.value.x : key === 'far' ? WS.npFar.value.x : key === 'fog' ? WS.npFog.value.x : WS.npSpecAA.value;
}

const _applied = new WeakSet();

/** Welt-Shading auf ein Material anwenden (nur MeshStandardMaterial/MeshPhysicalMaterial; sonst ohne Wirkung). */
export function applyWorldShadingTo(material) {
  if (!material || _applied.has(material)) return false;
  if (!material.isMeshStandardMaterial || material.userData?.noWorldShading || material.userData?.viewmodelOnly) return false;
  _applied.add(material);
  addShaderPatch(material, 'ws1', worldShadingPatch);
  return true;
}

/**
 * Welt-Shading auf alle Materialien eines Teilbaums (oder ein Material) anwenden. Für andere Module (bots,
 * effects, vehicles): `applyWorldShading(material)` – dann sind auch ihre Objekte innen dunkel, liegen im
 * Fernschatten und im Höhennebel. → Anzahl neu versorgter Materialien
 */
export function applyWorldShading(target) {
  if (!target) return 0;
  if (target.isMaterial) return applyWorldShadingTo(target) ? 1 : 0;
  let n = 0;
  target.traverse?.((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) if (applyWorldShadingTo(m)) n++;
  });
  return n;
}

/**
 * Alle beleuchteten Materialien einer Szene (auch später hinzugefügte: Figuren, Fahrzeuge …) mit dem Welt-Shading
 * versorgen – Figuren sind dann in Innenräumen ebenso dunkel wie die Wände ringsum, liegen im Fernschatten und im
 * Höhennebel. Ausnahme: material.userData.noWorldShading. → { sweep() (Sicherheitsnetz), stop() }
 */
export function watchScene(scene) {
  if (!scene) return { sweep() {}, stop() {} };
  const watched = new WeakSet();
  const nodes = [];
  const onAdd = (e) => watch(e.child);
  function watch(root) {
    root?.traverse?.((o) => {
      if (!watched.has(o)) { watched.add(o); nodes.push(new WeakRef(o)); o.addEventListener('childadded', onAdd); }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
      if (mats) for (const m of mats) applyWorldShadingTo(m);
    });
  }
  watch(scene);
  return {
    sweep() { watch(scene); },
    stop() {
      for (const r of nodes) r.deref()?.removeEventListener('childadded', onAdd);
      nodes.length = 0;
    },
  };
}
