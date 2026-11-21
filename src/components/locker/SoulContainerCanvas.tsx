import { useEffect, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { useSoulRegistry } from './soulRegistry';

const SPIN_RATE = 0.5;
const FADE_SECONDS = 0.2;

function createRenderer() {
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 100);
  camera.position.set(0, 0.35, 3);
  camera.lookAt(0, 0, 0);
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(3, 5, 2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-3, 2, -2);
  const holder = new THREE.Group();
  scene.add(new THREE.AmbientLight(0xffffff, 0.75), key, fill, holder);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const snapshot = new THREE.WebGLRenderTarget(1024, 576, { depthBuffer: false });
  snapshot.texture.colorSpace = THREE.SRGBColorSpace;
  // The scene target contains premultiplied linear color. Unpremultiply before
  // tone mapping so both the PNG and the live viewport have identical edges.
  const material = new THREE.ShaderMaterial({
    uniforms: { source: { value: target.texture }, opacity: { value: 1 }, toneMappingExposure: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `#include <common>
#include <tonemapping_pars_fragment>
uniform sampler2D source;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(source, vUv);
  if (color.a > 0.0) color.rgb /= color.a;
  color.rgb = ACESFilmicToneMapping(color.rgb);
  gl_FragColor = vec4(color.rgb, color.a * opacity);
  #include <colorspace_fragment>
}`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(material);
  return { camera, scene, holder, target, snapshot, material, quad,
    exposure(value: number) { material.uniforms.toneMappingExposure.value = value; },
    opacity(value: number) { material.uniforms.opacity.value = value; },
    resize(width: number, height: number) {
      target.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
}

/** One WebGL context serves hover previews and serial thumbnail captures. */
export function TiledRenderer({ paneRef }: { paneRef: RefObject<HTMLElement | null> }) {
  const registry = useSoulRegistry();
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  const resources = useRef<ReturnType<typeof createRenderer> | null>(null);
  const spinning = useRef(new Set<string>());
  const reducedMotion = useRef(false);

  useEffect(() => {
    const wake = () => invalidate();
    const unsubscribe = registry.subscribe(wake);
    window.addEventListener('scroll', wake, { capture: true, passive: true });
    window.addEventListener('resize', wake);
    document.addEventListener('visibilitychange', wake);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { reducedMotion.current = motion.matches; wake(); };
    updateMotion();
    motion.addEventListener('change', updateMotion);
    const observer = new ResizeObserver(wake);
    if (paneRef.current) observer.observe(paneRef.current);
    return () => {
      unsubscribe();
      window.removeEventListener('scroll', wake, true);
      window.removeEventListener('resize', wake);
      document.removeEventListener('visibilitychange', wake);
      motion.removeEventListener('change', updateMotion);
      observer.disconnect();
      const owned = resources.current;
      if (owned) { owned.target.dispose(); owned.snapshot.dispose(); owned.material.dispose(); owned.quad.dispose(); }
      resources.current = null;
    };
  }, [registry, invalidate, paneRef]);

  useFrame((_, delta) => {
    gl.setRenderTarget(null);
    gl.setScissorTest(false);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    if (document.hidden) { spinning.current.clear(); return; }
    const pending = registry.captures.length > 0;
    const needed = pending || [...registry.tiles.values()].some(tile => tile.root && (tile.hovered || tile.opacity > 0));
    if (!needed) { spinning.current.clear(); return; }
    const owned = resources.current ?? (resources.current = createRenderer());
    const { camera, scene, holder, target, snapshot, quad } = owned;
    owned.exposure(gl.toneMappingExposure);
    const renderModel = (root: THREE.Object3D, width: number, height: number) => {
      owned.resize(width, height);
      gl.setScissorTest(false);
      gl.setRenderTarget(target);
      gl.clear();
      holder.add(root);
      try { gl.render(scene, camera); } finally { holder.clear(); }
    };

    const capture = registry.captures.shift();
    if (capture) {
      const { width, height } = capture;
      const root = registry.tiles.get(capture.id)?.root;
      if (!root) capture.reject(new Error('Preview unavailable'));
      else {
        const yaw = root.rotation.y;
        try {
          root.rotation.set(0, capture.yaw, 0);
          renderModel(root, width, height);
          snapshot.setSize(width, height);
          gl.setRenderTarget(snapshot);
          gl.clear();
          owned.opacity(1);
          quad.render(gl);
          const pixels = new Uint8Array(width * height * 4);
          gl.readRenderTargetPixels(snapshot, 0, 0, width, height, pixels);
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Image capture unavailable');
          const image = context.createImageData(width, height);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const from = ((height - 1 - y) * width + x) * 4;
              const to = (y * width + x) * 4;
              const alpha = pixels[from + 3];
              for (let c = 0; c < 3; c++) image.data[to + c] = alpha ? Math.min(255, pixels[from + c] * 255 / alpha) : 0;
              image.data[to + 3] = alpha;
            }
          }
          context.putImageData(image, 0, 0);
          capture.resolve(canvas.toDataURL('image/png'));
        } catch (error) { capture.reject(error instanceof Error ? error : new Error('Image capture failed')); }
        finally { root.rotation.set(0, yaw, 0); }
      }
    }

    const canvasRect = gl.domElement.getBoundingClientRect();
    const pane = paneRef.current?.getBoundingClientRect();
    const nextSpinning = new Set<string>();
    let animate = registry.captures.length > 0;
    const fade = Math.min(delta, 0.05) / FADE_SECONDS;
    for (const [id, tile] of registry.tiles) {
      const { root, el } = tile;
      if (!root || !el) continue;
      const rect = el.getBoundingClientRect();
      const left = Math.max(rect.left, pane?.left ?? 0, canvasRect.left);
      const right = Math.min(rect.right, pane?.right ?? canvasRect.right, canvasRect.right);
      const top = Math.max(rect.top, pane?.top ?? 0, canvasRect.top);
      const bottom = Math.min(rect.bottom, pane?.bottom ?? canvasRect.bottom, canvasRect.bottom);
      const visible = rect.width > 0 && rect.height > 0 && right > left && bottom > top;
      const wanted = tile.hovered && visible ? 1 : 0;
      registry.setOpacity(id, reducedMotion.current || !visible ? wanted
        : THREE.MathUtils.clamp(tile.opacity + (wanted ? fade : -fade), 0, 1));
      if (tile.opacity !== wanted) animate = true;
      if (tile.opacity === 0) { if (!tile.hovered) tile.onIdle?.(); continue; }
      if (tile.hovered && !tile.manual) {
        nextSpinning.add(id);
        if (spinning.current.has(id)) root.rotateY(Math.min(delta, 0.1) * SPIN_RATE);
        animate = true;
      }
      const dpr = gl.getPixelRatio();
      renderModel(root, Math.max(1, Math.round(rect.width * dpr)), Math.max(1, Math.round(rect.height * dpr)));
      gl.setRenderTarget(null);
      gl.setViewport(rect.left - canvasRect.left, canvasRect.bottom - rect.bottom, rect.width, rect.height);
      gl.setScissor(left - canvasRect.left, canvasRect.bottom - bottom, right - left, bottom - top);
      gl.setScissorTest(true);
      owned.opacity(tile.opacity);
      quad.render(gl);
    }
    gl.setRenderTarget(null);
    gl.setScissorTest(false);
    spinning.current = nextSpinning;
    if (animate) invalidate();
  }, 1);
  return null;
}

export default function SoulContainerCanvas({ paneRef }: { paneRef: RefObject<HTMLElement | null> }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[5]">
      <Canvas frameloop="demand" dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ pointerEvents: 'none' }}>
        <TiledRenderer paneRef={paneRef} />
      </Canvas>
    </div>
  );
}
