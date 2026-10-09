// Zielbild – Nachbearbeitung: GTAO → Höhendunst + Lichtstrahlen (HDR) → Waffe → Bloom → AgX → Objektiv (CA, Vignette, Korn).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Weiche Schatten mit Kontakthärtung (PCSS-artig) für Vergleichs-Sampler:
 * Blockerabstand über Vergleiche mit versetzten Empfängertiefen schätzen, dann PCF mit passendem Radius.
 * shadowRadius kodiert: floor(r / 10000) / 10 = Frustumbreite (m), mod(r, 10000) = Tiefenbereich (m).
 */
export function installSoftShadows({ sunTan = 0.0095, samples = 24 } = {}) {
  const C = THREE.ShaderChunk;
  const src = C.shadowmap_pars_fragment;
  const start = src.indexOf('float getShadow( sampler2DShadow shadowMap');
  const end = src.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )', start);
  if (start < 0 || end < 0) { console.warn('PCSS: Chunk unbekannt'); return; }
  const fn = `float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float fw = floor( shadowRadius / 10000.0 ) / 10.0;
				float dr = mod( shadowRadius, 10000.0 );
				vec2 texel = vec2( 1.0 ) / shadowMapSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				float L[5]; L[0] = 0.0015; L[1] = 0.006; L[2] = 0.02; L[3] = 0.06; L[4] = 0.17;
				float searchR = fw * L[4] * ${sunTan.toFixed(5)} / fw + 2.0 * texel.x;
				float occ[5]; for ( int j = 0; j < 5; j ++ ) occ[ j ] = 0.0;
				for ( int i = 0; i < 10; i ++ ) {
					vec2 o = vogelDiskSample( i, 10, phi ) * searchR;
					for ( int j = 0; j < 5; j ++ ) {
						float dz = fw * L[ j ] / dr;
						occ[ j ] += 1.0 - texture( shadowMap, vec3( shadowCoord.xy + o, shadowCoord.z - dz ) );
					}
				}
				if ( occ[ 0 ] < 0.01 ) {
					shadow = texture( shadowMap, shadowCoord.xyz );
				} else {
					float db = 0.0, prevL = 0.0;
					for ( int j = 0; j < 5; j ++ ) { db += ( occ[ j ] / occ[ 0 ] ) * ( fw * L[ j ] - prevL ); prevL = fw * L[ j ]; }
					float rad = max( db * ${sunTan.toFixed(5)} / fw, 1.2 * texel.x );
					float s = 0.0;
					for ( int i = 0; i < ${samples}; i ++ ) s += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${samples}, phi ) * rad, shadowCoord.z ) );
					shadow = s / ${samples}.0;
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	`;
  C.shadowmap_pars_fragment = src.slice(0, start) + fn + src.slice(end);
}

/** Schattenparameter in shadowRadius packen. */
export const packShadow = (frustumW, depthRange) => Math.round(frustumW * 10) * 10000 + Math.round(depthRange);

const HazeShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uNear: { value: 0.05 }, uFar: { value: 4000 },
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3() }, uSunUV: { value: new THREE.Vector2() }, uSunCol: { value: new THREE.Color() },
    uHazeCol: { value: new THREE.Color() }, uDensity: { value: 0.0045 }, uFalloff: { value: 0.045 }, uRays: { value: 1 }, uAspect: { value: 16 / 9 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
  #include <packing>
  varying vec2 vUv;
  uniform sampler2D tDiffuse; uniform sampler2D tDepth;
  uniform float uNear, uFar, uDensity, uFalloff, uRays, uAspect;
  uniform mat4 uProjInv, uCamWorld; uniform vec3 uCamPos, uSunDir, uSunCol, uHazeCol; uniform vec2 uSunUV;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec4 col = texture2D(tDiffuse, vUv);
    float d = texture2D(tDepth, vUv).x;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 vp = uProjInv * ndc; vp /= vp.w;
    vec3 wdir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
    float dist = length(vp.xyz);
    float mu = max(dot(wdir, uSunDir), 0.0);
    vec3 hz = uHazeCol * (1.0 + 0.6 * pow(mu, 3.0)) + uSunCol * (pow(mu, 12.0) * 1.6 + pow(mu, 80.0) * 3.0);
    if (d < 0.99999) {
      // exponentielle Höhennebel-Integration
      float b = uFalloff;
      float ry = wdir.y;
      float fogAmt = uDensity * exp(-b * uCamPos.y) * (abs(ry) > 1e-4 ? (1.0 - exp(-b * ry * dist)) / (b * ry) : dist);
      float f = 1.0 - exp(-fogAmt);
      col.rgb = mix(col.rgb, hz, clamp(f, 0.0, 1.0));
    }
    // Lichtstrahlen: radiale Unschärfe des sichtbaren Himmels Richtung Sonne
    if (uRays > 0.0) {
      vec2 dv = (uSunUV - vUv);
      float jit = hash(vUv * 1000.0);
      const int N = 56;
      vec2 st = dv / float(N) * 0.92;
      vec2 p = vUv + st * jit;
      vec3 acc = vec3(0.0); float w = 1.0;
      for (int i = 0; i < N; i++) {
        float sd = texture2D(tDepth, p).x;
        if (sd >= 0.99999 && p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
          vec3 c = texture2D(tDiffuse, p).rgb;
          vec2 q = (p - uSunUV) * vec2(uAspect, 1.0);
          float nr = exp(-dot(q, q) * 9.0);
          acc += min(c, vec3(6.0)) * nr * w;
        }
        w *= 0.985;
        p += st;
      }
      vec2 q0 = (vUv - uSunUV) * vec2(uAspect, 1.0);
      col.rgb += acc / float(N) * uRays * uSunCol * (0.6 + 0.4 * exp(-dot(q0, q0) * 2.0));
    }
    gl_FragColor = col;
  }`,
};

const LensShader = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2() }, uCA: { value: 1.6 }, uVig: { value: 0.32 }, uGrain: { value: 0.035 }, uSeed: { value: 0.37 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
  varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uCA, uVig, uGrain, uSeed;
  float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
  void main(){
    vec2 c = vUv - 0.5;
    float r2 = dot(c * vec2(uRes.x / uRes.y, 1.0), c * vec2(uRes.x / uRes.y, 1.0));
    vec2 off = c * r2 * uCA * 2.0 / uRes.y * 60.0;
    vec3 col;
    col.r = texture2D(tDiffuse, vUv - off).r;
    col.g = texture2D(tDiffuse, vUv).g;
    col.b = texture2D(tDiffuse, vUv + off).b;
    // Vignette (natürlicher cos^4-Abfall, sanft)
    float v = 1.0 - uVig * smoothstep(0.15, 1.1, r2 * 1.25);
    col *= v;
    // leichte Abstimmung: Schatten minimal kühl, Lichter warm
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * vec3(0.97, 1.0, 1.04), (1.0 - smoothstep(0.0, 0.35, l)) * 0.5);
    col = mix(col, col * vec3(1.03, 1.0, 0.96), smoothstep(0.5, 1.0, l) * 0.5);
    // Filmkorn (2-px-Körnung, überlebt das Verkleinern), luminanzabhängig
    vec2 g = floor(gl_FragCoord.xy / 2.0);
    float n = (hash(g + uSeed * 100.0) + hash(g * 1.37 + 7.1) - 1.0);
    col += n * uGrain * (1.0 - l * 0.6);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`,
};

export function buildPost(renderer, { scene, vmScene, camera, sky, w, h, sunDir, sunCol, hazeCol }) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: Number(new URLSearchParams(location.search).get('msaa') || 0) }));
  composer.setPixelRatio(1);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, w, h, undefined, { radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.blendIntensity = 0.9;
  const r0 = gtao.render.bind(gtao);
  gtao.render = (...a) => { const v = sky.visible; sky.visible = false; r0(...a); sky.visible = v; };
  composer.addPass(gtao);
  const haze = new ShaderPass(HazeShader);
  const U = haze.uniforms;
  U.uNear.value = camera.near; U.uFar.value = camera.far;
  U.uSunDir.value.copy(sunDir); U.uSunCol.value.copy(sunCol); U.uHazeCol.value.copy(hazeCol); U.uAspect.value = w / h;
  composer.addPass(haze);
  const vm = new RenderPass(vmScene, camera); vm.clear = false; vm.clearDepth = true;
  composer.addPass(vm);
  const bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.75, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lens = new ShaderPass(LensShader);
  lens.uniforms.uRes.value.set(w, h);
  composer.addPass(lens);
  const update = () => {
    camera.updateMatrixWorld();
    U.tDepth.value = gtao.depthTexture;
    U.uProjInv.value.copy(camera.projectionMatrixInverse);
    U.uCamWorld.value.copy(camera.matrixWorld);
    U.uCamPos.value.copy(camera.position);
    const sp = camera.position.clone().addScaledVector(sunDir, 1000).project(camera);
    U.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  };
  return { composer, gtao, haze, bloom, lens, update };
}
