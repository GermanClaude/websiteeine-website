// NULLPUNKT — animierte Wasserfläche: zwei gegenläufig scrollende Normalmaps, spiegelt die
// PMREM-Himmelsumgebung (Fresnel über PBR), billig (keine Spiegelpass) (Owner: world)
import * as THREE from 'three';
import { getWaterNormalMap } from '../engine/textures.js';

/**
 * @param {{ x0:number, z0:number, x1:number, z1:number, y:number, color?:string, scale?:number, roughness?:number }} o
 * @returns {{ mesh: THREE.Mesh, update(dt:number):void, dispose():void }}
 */
export function createWater(o) {
  const w = o.x1 - o.x0, d = o.z1 - o.z0;
  const seg = Math.max(1, Math.round(Math.max(w, d) / 40));
  const geo = new THREE.PlaneGeometry(w, d, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate((o.x0 + o.x1) / 2, o.y, (o.z0 + o.z1) / 2);
  // weltskalierte UVs
  const pos = geo.attributes.position, uv = geo.attributes.uv, s = 1 / (o.scale ?? 9);
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * s, -pos.getZ(i) * s);
  const nm = getWaterNormalMap().clone();
  nm.needsUpdate = true;
  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: o.color || '#1f4a57', roughness: o.roughness ?? 0.07, metalness: 0.0,
    normalMap: nm, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: o.envIntensity ?? 1.25,
  });
  mat.name = 'water';
  mat.userData.surface = 'water';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN = normalize( ( texture2D( normalMap, vNormalMapUv + uTime * vec2( 0.011, 0.007 ) ).xyz * 2.0 - 1.0 )
          + ( texture2D( normalMap, vNormalMapUv * 1.83 + vec2( 0.37, 0.11 ) - uTime * vec2( 0.009, -0.013 ) ).xyz * 2.0 - 1.0 ) * 0.8 );`));
  };
  mat.customProgramCacheKey = () => 'np-water-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.receiveShadow = true;
  mesh.userData.surface = 'water';
  return {
    mesh,
    update(dt) { uTime.value += dt; },
    dispose() { geo.dispose(); mat.dispose(); nm.dispose(); },
  };
}
