import { useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSoulRegistry } from './soulRegistry';

/**
 * Single shared WebGL context that renders every soul-container card in the
 * Locker's Global grid.
 *
 * A full-window, pointer-events-none overlay holds one Canvas. Each frame the
 * renderer walks the registry, and for every loaded tile sets the GL viewport
 * to that card's on-screen rect (clamped to the scroll pane) and renders the
 * model into it via the scissor test. One context paints the whole grid, so the
 * number of mods is irrelevant to the browser's ~16 live-context cap that was
 * silently dropping contexts and leaving cards blank white.
 *
 * Models render transparent everywhere except their own pixels, so all card
 * chrome underneath (frosted panel, Disabled tag, hover tint) shows through.
 */

const SPIN_RATE = 0.5; // rad/sec, matching the prior per-card auto-orbit.

/** Build the camera, lit scene, and run the per-tile scissor render loop. */
function TiledRenderer({ paneRef }: { paneRef: RefObject<HTMLElement | null> }) {
  const registry = useSoulRegistry();
  const gl = useThree((s) => s.gl);

  // Camera and lit scene are held in refs (not useMemo) because three objects
  // are mutated every frame (camera aspect, scene add/remove), which the hook
  // immutability lint forbids on memoized values. They're created once, lazily,
  // inside the frame loop.
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  // A single child slot in the scene holds exactly one tile's model at a time.
  // Replacing the slot's child each iteration (rather than add/remove on the
  // scene) guarantees a model can never get stuck across tiles or frames, so a
  // card can never show another card's model.
  const holderRef = useRef<THREE.Group | null>(null);

  // Priority > 0 hands the render loop to us: r3f stops auto-rendering its own
  // scene and we issue the per-tile draws below. The canvas is alpha:true, so
  // the renderer's default clear is transparent; we clear the whole buffer once
  // per frame (scissor off) to wipe cards that scrolled away, then each tile's
  // render auto-clears only its own scissor box before drawing.
  useFrame((_, delta) => {
    if (!cameraRef.current) {
      const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      cam.position.set(0, 0.35, 3);
      cam.lookAt(0, 0, 0);
      cameraRef.current = cam;
    }
    if (!sceneRef.current) {
      // One lit scene reused for every tile, with a dedicated holder group the
      // current tile's model is parented into for the duration of its draw.
      const s = new THREE.Scene();
      const ambient = new THREE.AmbientLight(0xffffff, 0.75);
      const key = new THREE.DirectionalLight(0xffffff, 1.3);
      key.position.set(3, 5, 2);
      const fill = new THREE.DirectionalLight(0xffffff, 0.5);
      fill.position.set(-3, 2, -2);
      const holder = new THREE.Group();
      s.add(ambient, key, fill, holder);
      sceneRef.current = s;
      holderRef.current = holder;
    }
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    const holder = holderRef.current!;

    const canvas = gl.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const pane = paneRef.current?.getBoundingClientRect() ?? null;

    // Wipe the whole buffer once (scissor off so the clear isn't boxed), then
    // draw each tile into its own scissored region without further clears.
    gl.setScissorTest(false);
    gl.clear();
    gl.setScissorTest(true);

    for (const tile of registry.tiles.values()) {
      const root = tile.root;
      const el = tile.el;
      if (!root || !el) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;

      // Clamp to the scroll pane so a card scrolling under the pane edges is
      // cropped rather than bleeding over neighbouring chrome.
      const left = pane ? Math.max(r.left, pane.left) : r.left;
      const right = pane ? Math.min(r.right, pane.right) : r.right;
      const top = pane ? Math.max(r.top, pane.top) : r.top;
      const bottom = pane ? Math.min(r.bottom, pane.bottom) : r.bottom;
      const clampW = right - left;
      const clampH = bottom - top;
      if (clampW <= 0 || clampH <= 0) continue; // fully off-screen

      // Viewport spans the FULL card rect (so the model stays anchored to the
      // card and just gets cropped); scissor restricts drawing to the clamped,
      // on-screen part. Values are logical (CSS) pixels relative to the canvas
      // with a bottom-left origin; THREE applies the pixel ratio internally, so
      // we must NOT pre-multiply by it.
      const vx = r.left - canvasRect.left;
      const vy = canvasRect.bottom - r.bottom;
      const sx = left - canvasRect.left;
      const sy = canvasRect.bottom - bottom;

      gl.setViewport(vx, vy, r.width, r.height);
      gl.setScissor(sx, sy, clampW, clampH);

      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();

      root.rotation.y += delta * SPIN_RATE;
      // Swap this tile's model into the holder (clearing whatever was there),
      // then render. The holder only ever contains this one tile's model.
      holder.clear();
      holder.add(root);
      gl.render(scene, camera);
    }
    holder.clear();
  }, 1);

  return null;
}

export default function SoulContainerCanvas({
  paneRef,
}: {
  /** The scrollable card pane; tile rects are clamped to it so models never
   *  render outside the pane (e.g. under the type header or toolbar). */
  paneRef: RefObject<HTMLElement | null>;
}) {
  return (
    // Mounted INSIDE the scroll pane (its stacking context), so z-[5] lands the
    // models above each card's background/frosted panel (z-auto) but BELOW the
    // card chrome (Active/Disabled tags z-10, retag + delete buttons z-20) so
    // that chrome paints on top of the model instead of behind it. Still
    // `fixed inset-0` (not absolute) so it overlays the viewport rather than
    // scrolling away with the pane content; per-tile scissor clamps to the pane.
    <div className="pointer-events-none fixed inset-0 z-[5]">
      {/* r3f sets pointerEvents:'auto' on its own container div, which would
          override the wrapper above and swallow every click on the page. We
          don't raycast, so force it back to none (merged after r3f's default). */}
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        style={{ pointerEvents: 'none' }}
      >
        <TiledRenderer paneRef={paneRef} />
      </Canvas>
    </div>
  );
}
