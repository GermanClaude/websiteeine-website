// NULLPUNKT — Licht & Himmel: Preetham-Himmel mit Horizont-Dunst, PMREM-Umgebung aus dem Himmel,
// Sonne mit kamerafolgendem (texelstabilem) Schatten, Hemisphärenlicht, Nebel (Owner: world)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

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

/**
 * Erzeugt Himmel, Licht, Umgebung und Nebel.
 * def: { sun: {elevation, azimuth, color, intensity}, sky: {...}, hemi: {sky, ground, intensity},
 *        env: {intensity, ground}, fog: {color, near, far}, shadow: {size, bias, normalBias}, exposure }
 */
export function createLighting(G, def, group) {
  const renderer = G.renderer?.renderer || G.renderer;
  const preset = G.renderer?.preset || {};
  const scene = G.scene;

  const sunDir = sunVector(def.sun.elevation, def.sun.azimuth);
  const fogColor = new THREE.Color(def.fog.color);

  // Himmel
  const sky = makeSky(def.sky || {}, fogColor);
  sky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(450000);
  group.add(sky);

  // Umgebung (PMREM) aus Himmel + Bodenhalbkugel
  const envScene = new THREE.Scene();
  // Eigene Grenzen + breitere Mie-Keule: weicher Richtungsverlauf statt Hotspot (Metalle spiegeln die Map 1:1;
  // die Sonnenenergie selbst liefert das gerichtete Licht)
  const envSky = makeSky({ ...(def.sky || {}), limit: def.env?.limit }, fogColor, SKY_LIMITS.env);
  envSky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(450000);
  envSky.material.uniforms.showSunDisc.value = 0;
  envSky.material.uniforms.mieDirectionalG.value = Math.min(envSky.material.uniforms.mieDirectionalG.value, def.env?.mieDirectionalG ?? 0.72);
  envSky.material.uniforms.cloudCoverage.value *= 0.8;
  if (def.env?.tint) envSky.material.uniforms.skyTint.value.set(def.env.tint);
  envScene.add(envSky);
  const groundCol = new THREE.Color(def.env?.ground || def.hemi.ground).multiplyScalar(def.env?.groundIntensity ?? 0.5);
  const groundDome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 8, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2 - 0.03), new THREE.MeshBasicMaterial({ color: groundCol, side: THREE.BackSide, fog: false }));
  envScene.add(groundDome);
  let envMap = null, pmremRT = null;
  if (renderer && renderer.isWebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmremRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
    envMap = pmremRT.texture;
    pmrem.dispose();
  }
  groundDome.geometry.dispose(); groundDome.material.dispose();
  envSky.geometry.dispose(); envSky.material.dispose();

  // Sonne
  const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
  sun.name = 'sun';
  const shadowsOn = preset.shadows !== false;
  sun.castShadow = shadowsOn;
  // Kaskadengröße: Kartenwert, auf schwachen Stufen gedeckelt (preset.shadowExtent, z. B. 24 m auf low)
  const mapHalf = def.shadow?.size ?? 38;
  const extentFor = (p) => Math.min(mapHalf, p?.shadowExtent || Infinity);
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

  // Himmel-/Bodenlicht
  const hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, def.hemi.intensity);
  hemi.name = 'hemi';
  group.add(hemi);

  // Szene: Umgebung + Nebel
  const prev = { environment: scene.environment, fog: scene.fog, background: scene.background, environmentIntensity: scene.environmentIntensity };
  scene.environment = envMap;
  scene.environmentIntensity = def.env?.intensity ?? 0.8;
  scene.fog = new THREE.Fog(fogColor, def.fog.near, def.fog.far);
  scene.background = fogColor.clone();

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
    hemiIntensity: def.hemi.intensity,
    envMap,
    envIntensity: def.env?.intensity ?? 0.8,
    fogColor: fogColor.clone(),
    exposure: def.exposure ?? 1,
    sun, hemi, sky,
  };

  return {
    lighting,
    /** Schatten folgt der Kamera, Wolken ziehen. */
    update(dt, camera) {
      time += dt;
      sky.material.uniforms.time.value = time;
      if (!camera) return;
      sky.position.copy(camera.position);
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
      if (shadows !== undefined) sun.castShadow = shadows;
      if (mapSize && mapSize !== sun.shadow.mapSize.x) {
        sun.shadow.mapSize.set(mapSize, mapSize);
        sun.shadow.map?.dispose(); sun.shadow.map = null;
      }
      if (size && size !== shadowSize) {
        shadowSize = size; cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size; cam.updateProjectionMatrix();
        centered = false;
      }
    },
    dispose() {
      sky.geometry.dispose(); sky.material.dispose();
      sun.shadow.map?.dispose();
      pmremRT?.dispose();
      if (scene.environment === envMap) scene.environment = prev.environment;
      scene.environmentIntensity = prev.environmentIntensity ?? 1;
      scene.fog = prev.fog;
      scene.background = prev.background;
    },
  };
}
