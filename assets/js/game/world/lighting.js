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

function makeSky(def, fogColor) {
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
  let fs = sky.material.fragmentShader;
  fs = fs.replace('uniform float time;', `uniform float time;
    uniform float skyExposure;
    uniform vec3 hazeColor;
    uniform vec2 hazeBand;
    uniform float hazeAmount;
    uniform vec3 skyTint;`);
  fs = fs.replace('gl_FragColor = vec4( texColor, 1.0 );', `
      texColor *= skyExposure * skyTint;
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
  const envSky = makeSky(def.sky || {}, fogColor);
  envSky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(450000);
  envSky.material.uniforms.showSunDisc.value = 0;
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
  const half = def.shadow?.size ?? 38;
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
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3();
  let time = 0;
  let shadowSize = half;

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
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(sunDir, 200);
      sun.target.updateMatrixWorld();
    },
    setShadowQuality({ shadows, mapSize, size } = {}) {
      if (shadows !== undefined) sun.castShadow = shadows;
      if (mapSize && mapSize !== sun.shadow.mapSize.x) {
        sun.shadow.mapSize.set(mapSize, mapSize);
        sun.shadow.map?.dispose(); sun.shadow.map = null;
      }
      if (size) { shadowSize = size; cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size; cam.updateProjectionMatrix(); }
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
