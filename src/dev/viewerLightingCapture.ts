// Dev-only NPR term readback from the production viewer, before bloom/post.
// Diffuse terms precede glass coverage. Use opaque surfaces for additive light
// budgets; the separate full composite and emission also cover glass.
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { ambientLuminanceFit } from '../lib/citadelNprLighting';
import { VIEWER_GROUND_COLOR, VIEWER_SKY_COLOR, VIEWER_HEMISPHERE_INTENSITY } from '../lib/viewerAmbientLight';
import { viewerState } from './heroFidelityCapture';

const terms = [
  'citadelOut',
  'citadelDirect * citadelBase * (1.0 - citadelMetal * noSpec) + citadelSpec + citadelDirect * citadelRim(citadelN, citadelV, citadelAo, citadelRimMask) * citadelRimOcclusion(-vViewPosition, citadelN)',
  'citadelAmb.rgb * bounce * citadelBase * (1.0 - citadelMetal * noSpec)',
  'citadelIbl',
  'citadelEmission',
  'citadelBase',
  'vec3(citadelRoughness)',
] as const;

export function captureLightingTerms() {
  const { gl, scene, camera } = viewerState();
  const selector = { value: 0 };
  const materials = new Set<THREE.Material>();
  const lights: THREE.Light[] = [];
  const hidden: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Light) lights.push(object);
    if (!(object instanceof THREE.Mesh)) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    // Unlit/additive helpers do not execute the measured shader branch. Keeping
    // their full output in a term image would mislabel it as albedo or emission.
    if (!list.every((material) => material instanceof CustomShaderMaterial
      && material.uniforms.uCitadelLighting?.value > 0.5
      && material.uniforms.uNprLighting?.value > 0.5
      && material.uniforms.uCelV2?.value > 0.5)) {
      if (object.visible) { hidden.push(object); object.visible = false; }
      return;
    }
    list.forEach((material) => materials.add(material));
  });
  const saved = [...materials].map((material) => ({ material, compile: material.onBeforeCompile, key: material.customProgramCacheKey }));
  for (const { material, compile } of saved) {
    material.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      shader.uniforms.uLightingCaptureTerm = selector;
      shader.fragmentShader = 'uniform float uLightingCaptureTerm;\n' + shader.fragmentShader.replace(
        'nprOut = citadelOut;',
        terms.map((term, index) => `${index === 0 ? 'if' : 'else if'} (uLightingCaptureTerm == ${index}.0) nprOut = ${term};`).join('\n'),
      );
    };
    material.customProgramCacheKey = () => 'viewer-lighting-capture-r3';
    material.needsUpdate = true;
  }
  const target = new THREE.WebGLRenderTarget(360, 480, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const previous = gl.getRenderTarget();
  const background = scene.background;
  const clear = gl.getClearColor(new THREE.Color());
  const alpha = gl.getClearAlpha();
  const intensities = lights.map((light) => light.intensity);
  const probes = [...materials].flatMap((material) => {
    if (!(material instanceof CustomShaderMaterial)) return [];
    const cube: unknown = material.uniforms.uNprAmbientCube?.value;
    const fit: unknown = material.uniforms.uCitadelAmbientFit?.value;
    if (!Array.isArray(cube) || !cube.every((face) => face instanceof THREE.Vector3) || !(fit instanceof THREE.Vector4)) return [];
    return [{ cube, fit, original: cube.map((face) => face.clone()), originalFit: fit.clone() }];
  });
  scene.background = null;
  gl.setClearColor(0, 0);
  const outputs: Record<string, number[]> = {};
  const read = (name: string, term: number) => {
    selector.value = term;
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    const pixels = new Float32Array(360 * 480 * 4);
    gl.readRenderTargetPixels(target, 0, 0, 360, 480, pixels);
    outputs[name] = Array.from(pixels);
  };
  try {
    read('all', 0);
    read('ambient', 2);
    read('iblSpecular', 3);
    read('emission', 4);
    read('albedo', 5);
    read('roughness', 6);
    lights.forEach((light) => { if (light instanceof THREE.HemisphereLight) light.intensity = 0; });
    read('withoutHemisphereLight', 0);
    lights.forEach((light, i) => { light.intensity = intensities[i]; });
    for (const { cube, fit, original } of probes) {
      cube.forEach((face, i) => {
        const y = i === 2 ? 1 : i === 3 ? -1 : 0;
        const hemi = VIEWER_GROUND_COLOR.clone().lerp(VIEWER_SKY_COLOR, y * 0.5 + 0.5);
        face.copy(original[i]).sub(new THREE.Vector3(hemi.r, hemi.g, hemi.b).multiplyScalar(VIEWER_HEMISPHERE_INTENSITY)).max(new THREE.Vector3());
      });
      fit.copy(ambientLuminanceFit(cube)).multiplyScalar(1 / Math.PI);
    }
    read('ambientWithoutHemisphereProbe', 2);
    for (const { cube, fit } of probes) {
      cube.forEach((face, i) => {
        const y = i === 2 ? 1 : i === 3 ? -1 : 0;
        const hemi = VIEWER_GROUND_COLOR.clone().lerp(VIEWER_SKY_COLOR, y * 0.5 + 0.5);
        face.set(hemi.r, hemi.g, hemi.b).multiplyScalar(VIEWER_HEMISPHERE_INTENSITY);
      });
      fit.copy(ambientLuminanceFit(cube)).multiplyScalar(1 / Math.PI);
    }
    read('ambientWithoutIblDiffuse', 2);
    probes.forEach(({ cube, fit, original, originalFit }) => { cube.forEach((face, i) => face.copy(original[i])); fit.copy(originalFit); });
    for (const [index, light] of lights.entries()) {
      if (!(light instanceof THREE.DirectionalLight)) continue;
      lights.forEach((entry, i) => { entry.intensity = i === index ? intensities[i] : 0; });
      read(light.position.x < 0 ? 'key' : 'fill', 1);
    }
    return { width: 360, height: 480, outputs, lights: lights.map((light, i) => ({ type: light.type, intensity: intensities[i], position: light.position.toArray() })), environmentIntensity: scene.environmentIntensity };
  } finally {
    lights.forEach((light, i) => { light.intensity = intensities[i]; });
    probes.forEach(({ cube, fit, original, originalFit }) => { cube.forEach((face, i) => face.copy(original[i])); fit.copy(originalFit); });
    scene.background = background;
    gl.setClearColor(clear, alpha);
    gl.setRenderTarget(previous);
    target.dispose();
    hidden.forEach((object) => { object.visible = true; });
    saved.forEach(({ material, compile, key }) => { material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true; });
  }
}
