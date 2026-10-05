// NULLPUNKT — Licht & Himmel: Preetham-Himmel mit Horizont-Dunst, PMREM-Umgebung aus dem Himmel,
// Sonne mit kamerafolgendem (texelstabilem) Schatten als Nahkaskade + zwischengespeicherte Fernkaskade
// (world/shadows.js), Hemisphärenlicht, Höhennebel mit Sonnen-Einstreuung (world/shading.js) (Owner: world)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { WS, setShadingMode } from './shading.js';
import { createFarShadow, farShadowBudget, NEAR_CAP } from './shadows.js';

const deg = THREE.MathUtils.degToRad;

/** Richtung ZUR Sonne aus Höhe/Azimut (Grad; Azimut 0 = Norden (−Z), 90 = Osten (+X)). */
export function sunVector(elevation, azimuth, out = new THREE.Vector3()) {
  const el = deg(elevation), az = deg(azimuth);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

/** Ersetzt genau eine Stelle im (vendorten, festen) Sky-Shader – fehlt sie, ist das ein Programmierfehler. */
function patch(src, find, repl) {
  if (!src.includes(find)) throw new Error(`[lighting] Sky-Shader: Stelle nicht gefunden: ${find.slice(0, 48)}`);
  return src.replace(find, repl);
}

/** Standardgrenzen der Himmelshelligkeit (linear, nach Belichtung; größter Farbkanal). */
const SKY_LIMITS = Object.freeze({
  // sichtbarer Himmel: Mie-Hof um eine tiefe Sonne (bis > 300) weich auf ≤ 4 begrenzen; Sonnenscheibe extra
  view: { knee: 1.2, max: 4, sunDisc: 20 },
  // Umgebungs-Map (PMREM): flacher, kein Hotspot, den Metalle 1:1 spiegeln würden
  env: { knee: 0.6, max: 2, sunDisc: 0 },
});

/**
 * Preetham-Himmel mit Belichtung, Tönung, Horizontdunst und begrenzter Helligkeit.
 * Der Mie-Hof einer tiefen Sonne erreicht linear mehrere Hundert (Halbfloat-Überlauf in Farblook/Bloom,
 * Bloom-Schleier über halbem Bild); er wird deshalb weich komprimiert (knee → max, farbtonerhaltend).
 * Die Sonnenscheibe wird danach mit fester Helligkeit (limits.sunDisc) und Farbe aus der Extinktion addiert.
 */
function makeSky(def, fogColor, limits = SKY_LIMITS.view) {
  const sky = new Sky();
  const u = sky.material.uniforms;
  u.turbidity.value = def.turbidity ?? 6;
  u.rayleigh.value = def.rayleigh ?? 1.6;
  u.mieCoefficient.value = def.mieCoefficient ?? 0.006;
  u.mieDirectionalG.value = def.mieDirectionalG ?? 0.82;
  u.cloudCoverage.value = def.clouds?.coverage ?? 0.3;
  u.cloudDensity.value = def.clouds?.density ?? 0.4;
  u.cloudScale.value = def.clouds?.scale ?? 0.0002;
  u.cloudElevation.value = def.clouds?.elevation ?? 0.5;
  u.cloudSpeed.value = def.clouds?.speed ?? 0.00003;
  // Belichtung + Horizontdunst (geht nahtlos in die Nebelfarbe über)
  u.skyExposure = { value: def.exposure ?? 1 };
  u.hazeColor = { value: fogColor.clone() };
  u.hazeBand = { value: new THREE.Vector2(def.hazeLow ?? -0.02, def.hazeHigh ?? 0.16) };
  u.hazeAmount = { value: def.hazeAmount ?? 0.85 };
  u.skyTint = { value: new THREE.Color(def.tint || '#ffffff') };
  // Helligkeitsgrenzen (Karten dürfen sky.limit = { knee, max, sunDisc } überschreiben)
  u.skyKnee = { value: def.limit?.knee ?? limits.knee };
  u.skyMax = { value: def.limit?.max ?? limits.max };
  u.sunDiscIntensity = { value: def.limit?.sunDisc ?? limits.sunDisc };
  let fs = sky.material.fragmentShader;
  fs = patch(fs, 'uniform float time;', `uniform float time;
    uniform float skyExposure;
    uniform vec3 hazeColor;
    uniform vec2 hazeBand;
    uniform float hazeAmount;
    uniform vec3 skyTint;
    uniform float skyKnee;
    uniform float skyMax;
    uniform float sunDiscIntensity;
    // weiche Schulter auf dem größten Kanal: unterhalb knee unverändert, darüber asymptotisch → skyMax
    vec3 npCompressSky( vec3 c ) {
      float m = max( c.r, max( c.g, c.b ) );
      if ( m <= skyKnee ) return c;
      float r = max( skyMax - skyKnee, 1e-3 );
      return c * ( ( skyKnee + r * ( 1.0 - exp( -( m - skyKnee ) / r ) ) ) / m );
    }`);
  // Sonnenscheibe nicht mehr mit ~60 000 in den Himmel mischen, sondern nach der Begrenzung addieren
  fs = patch(fs, 'vec3 sundiscColor = ( 760.0 * sundisc ) * min( vSunE * Fex, 80.0 );', `vec3 sunHue = vSunE * Fex;
      vec3 sundiscColor = sundisc * sunHue / max( max( sunHue.r, max( sunHue.g, sunHue.b ) ), 1e-6 );
      float npCloud = 0.0;`);
  fs = patch(fs, 'vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );',
    'vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );');
  fs = patch(fs, 'texColor = mix( texColor, cloudAerial, alpha );', 'texColor = mix( texColor, cloudAerial, alpha );\n\t\t\t\tnpCloud = alpha;');
  fs = patch(fs, 'gl_FragColor = vec4( texColor, 1.0 );', `
      texColor = npCompressSky( max( texColor, vec3( 0.0 ) ) * skyExposure * skyTint );
      texColor += sundiscColor * sunDiscIntensity * skyTint * ( 1.0 - npCloud );
      float hz = 1.0 - smoothstep( hazeBand.x, hazeBand.y, direction.y );
      texColor = mix( texColor, hazeColor, clamp( hz * hazeAmount + ( direction.y < 0.0 ? 1.0 : 0.0 ), 0.0, 1.0 ) );
      gl_FragColor = vec4( texColor, 1.0 );`);
  sky.material.fragmentShader = fs;
  sky.material.needsUpdate = true;
  sky.scale.setScalar(900);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.name = 'sky';
  return sky;
}

// ACES-Matrizen wie im three-Shader (Spalten) → Inverse für die Rückrechnung des vorbelichteten HDRI-Himmels
const ACES_IN_INV = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777).invert();
const ACES_OUT_INV = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert();

/**
 * Himmelskuppel aus dem HDRI der Karte (assets/lib, KTX2). Die Textur ist mit ACES und backgroundExposure
 * vorbelichtet; der Shader rechnet sie in Szenen-Leuchtdichte zurück (inverse ACES-Kurve, begrenzt), damit sie wie
 * alles andere durch Belichtung, Tonemapping (AgX/ACES), Bloom und LUT läuft. Gedreht wie die Umgebungs-Map
 * (Sonnenazimut der Karte); unter dem Horizontband geht sie in die Nebelfarbe über (keine Foto-Bodenfläche hinter
 * der Karte).
 */
function makeHdriSky(hdri, sd, fogColor, intensity) {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const c = Math.cos(hdri.rotation), sn = Math.sin(hdri.rotation);
  const mat = new THREE.ShaderMaterial({
    name: 'np:hdri-sky',
    uniforms: {
      tSky: { value: hdri.background },
      uInvOut: { value: ACES_OUT_INV }, uInvIn: { value: ACES_IN_INV },
      uScale: { value: (0.6 / (hdri.backgroundExposure || 1)) * intensity * (sd.exposureScale ?? 1) },
      uRot: { value: new THREE.Vector2(c, sn) },
      uFog: { value: fogColor.clone() },
      uHaze: { value: new THREE.Vector2(sd.hazeLow ?? -0.02, sd.hazeHigh ?? 0.12) },
      uHazeAmt: { value: sd.hazeAmount ?? 0.85 },
      uTint: { value: new THREE.Color(sd.hdriTint || '#ffffff') },
      uMax: { value: sd.hdriMax ?? 24 },
      // hdriBlend [y0, y1]: nur oberhalb sichtbar (weich ab y0 bis y1, Richtungs-y) – darunter der Preetham-Himmel
      // (Fotos mit nahen Bäumen/Mauern am Horizont, die über der Karte riesig wirken würden)
      uBlend: { value: new THREE.Vector2(sd.hdriBlend?.[0] ?? -2, sd.hdriBlend?.[1] ?? -1) },
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = ( modelMatrix * vec4( position, 0.0 ) ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position.z = gl_Position.w; // ganz hinten
      }`,
    fragmentShader: `uniform sampler2D tSky; uniform mat3 uInvOut; uniform mat3 uInvIn; uniform float uScale; uniform vec2 uRot;
      uniform vec3 uFog; uniform vec2 uHaze; uniform float uHazeAmt; uniform vec3 uTint; uniform float uMax; uniform vec2 uBlend;
      varying vec3 vDir;
      vec3 npRrtInv( vec3 x ) {
        x = clamp( x, 0.0, 0.985 );
        vec3 A = 1.0 - 0.983729 * x, B = 0.0245786 - 0.4329510 * x, C = -( 0.000090537 + 0.238081 * x );
        return ( -B + sqrt( max( B * B - 4.0 * A * C, 0.0 ) ) ) / ( 2.0 * A );
      }
      void main() {
        vec3 d = normalize( vDir );
        vec3 r = vec3( uRot.x * d.x - uRot.y * d.z, d.y, uRot.y * d.x + uRot.x * d.z );
        vec2 uv = vec2( atan( r.z, r.x ) * 0.15915494 + 0.5, asin( clamp( r.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 );
        vec3 L = max( uInvIn * npRrtInv( uInvOut * texture2D( tSky, uv ).rgb ), 0.0 ) * uScale * uTint;
        L = min( L, vec3( uMax ) );
        float hz = 1.0 - smoothstep( uHaze.x, uHaze.y, d.y );
        L = mix( L, uFog, clamp( hz * uHazeAmt + ( d.y < 0.0 ? 1.0 : 0.0 ), 0.0, 1.0 ) );
        gl_FragColor = vec4( L, smoothstep( uBlend.x, uBlend.y, d.y ) );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
    transparent: !!sd.hdriBlend,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.scale.setScalar(sd.hdriBlend ? 880 : 900);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.name = 'sky';
  sky.userData.hdri = true;
  return sky;
}

/**
 * Erzeugt Himmel, Licht, Umgebung und Nebel.
 * def: { sun: {elevation, azimuth, color, intensity}, sky: {...}, hemi: {sky, ground, intensity},
 *        env: {intensity, ground}, fog: {color, near, far}, shadow: {size, bias, normalBias}, exposure }
 * opts.hdri: Umgebung aus dem Karten-HDRI (world/library.js: { envRT, background, rotation, backgroundExposure,
 *   rebuildEnv }) – Umgebungslicht (PMREM) und, wo sichtbar, Himmel; sonst prozeduraler Preetham-Himmel.
 *   Kartenoptionen: env.hdriIntensity (Stärke des HDRI-Umgebungslichts), sky.hdri (false = Preetham-Himmel
 *   behalten), sky.hdriIntensity, sky.exposureScale, sky.hdriTint, sky.hdriMax, hemi.hdriIntensity.
 */
export function createLighting(G, def, group, { hdri = null, far = null } = {}) {
  const renderer = G.renderer?.renderer || G.renderer;
  const preset = G.renderer?.preset || {};
  const scene = G.scene;

  const sunDir = sunVector(def.sun.elevation, def.sun.azimuth);
  const fogColor = new THREE.Color(def.fog.color);

  // Himmel: HDRI-Kuppel (sofern geladen und gewünscht) oder Preetham
  const envIntensity = hdri ? (def.env?.hdriIntensity ?? def.env?.intensity ?? 0.8) : (def.env?.intensity ?? 0.8);
  const useHdriSky = !!hdri?.background && def.sky?.hdri !== false;
  const blendSky = useHdriSky && !!def.sky?.hdriBlend;
  const sky = useHdriSky && !blendSky ? makeHdriSky(hdri, def.sky || {}, fogColor, def.sky?.hdriIntensity ?? envIntensity) : makeSky(def.sky || {}, fogColor);
  if (!(useHdriSky && !blendSky)) sky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(450000);
  group.add(sky);
  // Mischform: Preetham-Himmel unten (klarer Horizont), Foto-Wolken des HDRIs darüber eingeblendet
  const skyTop = blendSky ? makeHdriSky(hdri, { ...def.sky, hazeAmount: 0 }, fogColor, def.sky?.hdriIntensity ?? envIntensity) : null;
  if (skyTop) { skyTop.renderOrder = -9; skyTop.name = 'sky-hdri'; group.add(skyTop); }

  // Umgebung (PMREM) aus Himmel + Bodenhalbkugel. Nach einem WebGL-Kontextverlust ist das Ziel leer und gehört
  // zum alten Kontext → bei 'lost' freigeben (still), bei 'restored' neu rendern (siehe unten).
  const renderEnv = () => {
    if (!renderer || !renderer.isWebGLRenderer) return null;
    const envScene = new THREE.Scene();
    // Eigene Grenzen + breitere Mie-Keule: weicher Richtungsverlauf statt Hotspot (Metalle spiegeln die Map 1:1;
    // die Sonnenenergie selbst liefert das gerichtete Licht)
    const envSky = makeSky({ ...(def.sky || {}), limit: def.env?.limit }, fogColor, SKY_LIMITS.env);
    const eu = envSky.material.uniforms;
    eu.sunPosition.value.copy(sunDir).multiplyScalar(450000);
    eu.showSunDisc.value = 0;
    eu.mieDirectionalG.value = Math.min(eu.mieDirectionalG.value, def.env?.mieDirectionalG ?? 0.72);
    eu.cloudCoverage.value *= 0.8;
    if (def.env?.tint) eu.skyTint.value.set(def.env.tint);
    envScene.add(envSky);
    const groundCol = new THREE.Color(def.env?.ground || def.hemi.ground).multiplyScalar(def.env?.groundIntensity ?? 0.5);
    const groundDome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 8, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2 - 0.03), new THREE.MeshBasicMaterial({ color: groundCol, side: THREE.BackSide, fog: false }));
    envScene.add(groundDome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    // weicher Himmel braucht keine hohe Auflösung: low 128² je Würfelseite (¼ der Rechenzeit), sonst 256²
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 2000, { size: preset.id === 'low' ? 128 : 256 });
    pmrem.dispose();
    groundDome.geometry.dispose(); groundDome.material.dispose();
    envSky.geometry.dispose(); envSky.material.dispose();
    return rt;
  };
  let pmremRT = hdri?.envRT || renderEnv();
  let envMap = pmremRT ? pmremRT.texture : null;

  // Sonne
  const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
  sun.name = 'sun';
  const shadowsOn = preset.shadows !== false;
  sun.castShadow = shadowsOn;
  // Kaskadengröße: Kartenwert, auf schwachen Stufen gedeckelt (preset.shadowExtent, z. B. 24 m auf low)
  const mapHalf = def.shadow?.size ?? 38;
  // Mit Fernkaskade (medium+) übernimmt die Nahkaskade nur noch die Nähe → kleinerer Ausschnitt, schärfere Schatten
  const extentFor = (p) => Math.min(mapHalf, p?.shadowExtent || Infinity, far && farShadowBudget(p) ? (def.shadow?.near ?? NEAR_CAP[p.id] ?? 20) : Infinity);
  const half = extentFor(preset);
  const mapSize = preset.shadowMapSize || 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const cam = sun.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = 420;
  sun.shadow.bias = def.shadow?.bias ?? -0.00035;
  sun.shadow.normalBias = def.shadow?.normalBias ?? 0.035;
  sun.shadow.radius = 2;
  group.add(sun); group.add(sun.target);
  // Fernkaskade (einmal gerendert; bake() ruft loadWorld nach dem Aufbau, wenn alle Requisiten stehen)
  const farShadow = far ? createFarShadow(G, { sunDir, bounds: far.bounds, group, exclude: far.exclude }) : null;
  let probeSun = false; // Sonnensicht des Sonden-Gitters verfügbar (Ferne auf low / ohne Schattenkarten)
  const applyFarMode = () => {
    setShadingMode({ far: farShadow?.active ? 1 : probeSun ? 2 : 0 });
  };

  // Gedrosselte Schattenkarte (low): die neue Sonne hat noch keine Karte → im nächsten Bild zeichnen lassen.
  // Ohne Karte bindet three.js eine nie hochgeladene Ersatz-Tiefentextur an den Schatten-Sampler
  // („Mismatch between texture format and sampler type“ bei jedem Zeichenaufruf).
  G.renderer?.invalidateShadows?.();

  // Himmel-/Bodenlicht
  const hemiIntensity = hdri ? (def.hemi.hdriIntensity ?? def.hemi.intensity) : def.hemi.intensity;
  const hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, hemiIntensity);
  hemi.name = 'hemi';
  group.add(hemi);

  // Szene: Umgebung + Nebel
  const prev = { environment: scene.environment, fog: scene.fog, background: scene.background, environmentIntensity: scene.environmentIntensity };
  scene.environment = envMap;
  scene.environmentIntensity = envIntensity;
  scene.fog = new THREE.Fog(fogColor, def.fog.near, def.fog.far);
  scene.background = fogColor.clone();
  // Höhennebel (Welt-Materialien): Dichte am Boden, Abfall mit der Höhe, Startabstand, Sonnen-Einstreuung.
  // Ohne Kartenwerte aus near/far abgeleitet (auf Augenhöhe ≈ wie der lineare Nebel der übrigen Materialien).
  const fd = def.fog;
  const fogSpan = Math.max(20, fd.far - fd.near);
  WS.npFog.value.set(WS.npFog.value.x, fd.falloff ?? 0.04, fd.baseY ?? 0, fd.start ?? fd.near * 0.5);
  setShadingMode({ fog: fd.height === false ? 0 : fd.density ?? 1.3 / fogSpan });
  WS.npFogMax.value = fd.max ?? 0.92;
  const sunHue = new THREE.Color(def.sun.color);
  const hueMax = Math.max(sunHue.r, sunHue.g, sunHue.b, 1e-3);
  WS.npFogSun.value.set(sunDir.x, sunDir.y, sunDir.z, fd.sunExp ?? 6);
  WS.npFogSunCol.value.copy(sunHue).multiplyScalar((fd.sun ?? 0.35) / hueMax);

  // Texelstabile Schattenkamera
  const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
  const lightRotInv = lightRot.clone().invert();
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), center = new THREE.Vector3();
  let time = 0;
  let shadowSize = half;
  let centered = false;

  const lighting = {
    sunDirection: sunDir.clone(),
    sunColor: new THREE.Color(def.sun.color),
    sunIntensity: def.sun.intensity,
    hemiSky: new THREE.Color(def.hemi.sky),
    hemiGround: new THREE.Color(def.hemi.ground),
    hemiIntensity,
    envMap,
    envIntensity,
    hdri: hdri ? hdri.id : null,
    fogColor: fogColor.clone(),
    exposure: def.exposure ?? 1,
    sun, hemi, sky,
  };

  let baked = false;
  const controller = {
    lighting,
    farShadow,
    /** Fernkaskade rendern (nach dem Aufbau; Qualitätswechsel ruft es selbst). → true, wenn aktiv */
    bakeFar() { baked = true; const ok = farShadow ? farShadow.bake() : false; applyFarMode(); return ok; },
    /** Sonden-Gitter mit Sonnensicht verfügbar? (low: Fernschatten aus den Sonden) */
    setProbeSun(on) { probeSun = !!on; applyFarMode(); },
    /** Schatten folgt der Kamera, Wolken ziehen. */
    update(dt, camera) {
      time += dt;
      if (sky.material.uniforms.time) sky.material.uniforms.time.value = time;
      if (!camera) return;
      sky.position.copy(camera.position);
      if (skyTop) skyTop.position.copy(camera.position);
      camera.getWorldDirection(fwd); fwd.y = 0;
      if (fwd.lengthSq() > 1e-6) fwd.normalize();
      // Zentrum etwas vor die Kamera legen → mehr Schatten im Blickfeld
      tmp.copy(camera.position).addScaledVector(fwd, shadowSize * 0.35);
      tmp.y = Math.max(0, camera.position.y - 2);
      // auf Texelraster einrasten (kein Flimmern beim Bewegen)
      const texel = (shadowSize * 2) / sun.shadow.mapSize.x;
      tmp.applyMatrix4(lightRotInv);
      tmp.x = Math.round(tmp.x / texel) * texel;
      tmp.y = Math.round(tmp.y / texel) * texel;
      tmp.applyMatrix4(lightRot);
      // Gedrosselte Schatten (low): Kaskade nur versetzen, wenn das Zentrum > 8 % der Kantenlänge wandert
      // (Vorhalt nach vorn deckt die Bewegung ab) – dann sofort neu zeichnen lassen; sonst bleibt die Karte gültig.
      const throttled = (G.renderer?.preset?.shadowInterval || 1) > 1;
      if (throttled && centered && tmp.distanceToSquared(center) < (shadowSize * 0.08) ** 2) return;
      center.copy(tmp); centered = true;
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(sunDir, 200);
      sun.target.updateMatrixWorld();
      if (throttled) G.renderer.invalidateShadows?.();
    },
    /** Schattenqualität nach Qualitätswechsel: { shadows, mapSize, size } oder ein Renderer-Preset. */
    setShadowQuality({ shadows, mapSize, size, preset: p } = {}) {
      if (p) { shadows = p.shadows; mapSize = p.shadowMapSize; size = extentFor(p); }
      if (p && farShadow && baked) { farShadow.bake(p); applyFarMode(); }
      let dirty = false;
      if (shadows !== undefined && shadows !== sun.castShadow) { sun.castShadow = shadows; dirty = true; }
      // Neue Kartengröße: three.js passt die bestehende Karte beim nächsten Schattenpass an (setSize) –
      // die Karte bleibt bis dahin gültig gebunden (kein Bild mit fehlender Schattentextur)
      if (mapSize && mapSize !== sun.shadow.mapSize.x) { sun.shadow.mapSize.set(mapSize, mapSize); dirty = true; }
      if (size && size !== shadowSize) {
        shadowSize = size; cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size; cam.updateProjectionMatrix();
        centered = false; dirty = true;
      }
      if (dirty) G.renderer?.invalidateShadows?.();
    },
    dispose() {
      disposed = true;
      offContext?.();
      farShadow?.dispose();
      setShadingMode({ far: 0, fog: 0 });
      sky.geometry.dispose(); sky.material.dispose();
      if (skyTop) { skyTop.geometry.dispose(); skyTop.material.dispose(); }
      sun.shadow.map?.dispose();
      pmremRT?.dispose(); pmremRT = null;
      if (scene.environment === envMap) scene.environment = prev.environment;
      scene.environmentIntensity = prev.environmentIntensity ?? 1;
      scene.fog = prev.fog;
      scene.background = prev.background;
    },
  };

  // WebGL-Kontextverlust: das PMREM-Ziel gehört zum verlorenen Kontext. Jetzt freigeben (auf dem verlorenen
  // Kontext still – später gäbe es „object does not belong to this context“), nach der Wiederherstellung neu
  // rendern und überall einsetzen, wo die alte Map hing (Weltszene, Viewmodel-Szene, lighting.envMap).
  let disposed = false;
  const swapEnv = (next) => {
    const old = envMap;
    envMap = next;
    lighting.envMap = next;
    for (const s of [scene, G.viewmodel?.scene]) if (s && old && s.environment === old) s.environment = next;
  };
  const offContext = typeof G.renderer?.onContextChange === 'function' ? G.renderer.onContextChange((state) => {
    if (state === 'lost') {
      pmremRT?.dispose(); pmremRT = null;
    } else if (state === 'restored' && !pmremRT) {
      if (hdri?.rebuildEnv) {
        // HDRI neu laden (HTTP-Cache) und PMREM neu rendern; bis dahin prozedural
        pmremRT = renderEnv();
        if (pmremRT) swapEnv(pmremRT.texture);
        const tmp = pmremRT;
        hdri.rebuildEnv().then((rt) => {
          if (disposed) { rt.dispose(); return; }
          pmremRT = rt; swapEnv(rt.texture); tmp?.dispose();
        }, () => { /* prozedural bleibt */ });
      } else {
        pmremRT = renderEnv();
        if (pmremRT) swapEnv(pmremRT.texture);
      }
    }
  }) : null;

  return controller;
}
