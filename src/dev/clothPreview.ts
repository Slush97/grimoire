import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { parseFeModel } from '../lib/feModel';
import { CLOTH_TIMESTEP, clothSimulationCoverage, createClothSimHarness, type ClothSimHarness } from '../lib/useClothSim';
import { ClothOverlay } from './clothOverlay';

function element<T extends HTMLElement>(id: string, ctor: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof ctor)) throw new Error(`Missing preview element: ${id}`);
  return value;
}
const viewport = element('viewport', HTMLDivElement);
const status = element('status', HTMLParagraphElement);
const metrics = element('metrics', HTMLPreElement);
const clipSelect = element('clip', HTMLSelectElement);
const physics = element('physics', HTMLInputElement);
const frozen = element('frozen', HTMLInputElement);
const bonesToggle = element('skeleton', HTMLInputElement);
const play = element('play', HTMLButtonElement);
const view = element('view', HTMLSelectElement);
const checks = element('checks', HTMLButtonElement);
const checksResult = element('checks-result', HTMLPreElement);
const checksSummary = element('checks-summary', HTMLElement);
const comparison = element('comparison', HTMLSelectElement);
const referenceLabel = element('reference-label', HTMLDivElement);
const nodesToggle = element('nodes', HTMLInputElement);
const targetsToggle = element('targets', HTMLInputElement);
const collidersToggle = element('colliders', HTMLInputElement);
const speed = element('speed', HTMLSelectElement);
const seekTime = element('seek-time', HTMLInputElement);
const diagnostics = element('diagnostics', HTMLPreElement);
const caseSelect = element('case', HTMLSelectElement);
const alignMotion = element('align-motion', HTMLInputElement);
const inputs = document.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button, select, input');
inputs.forEach((input) => { input.disabled = true; });

async function main() {
  const available: { name: string; label: string }[] = await fetch('/.codex-run/source2-physics/cases.json').then((response) => response.json());
  const requested = new URLSearchParams(location.search).get('case');
  const selected = available.find((item) => item.name === requested) ?? available[0];
  if (!selected) throw new Error('No exported cases. Start pnpm dev:cloth.');
  available.forEach((item) => caseSelect.add(new Option(item.label, item.name)));
  caseSelect.value = selected.name;
  caseSelect.addEventListener('change', () => { location.search = new URLSearchParams({ case: caseSelect.value }).toString(); });
  element('hero-name', HTMLHeadingElement).textContent = selected.label;
  document.title = `${selected.label} physics preview`;
  const assets = `/.codex-run/source2-physics/${selected.name}`;
  const [gltf, raw, metadata] = await Promise.all([
    new GLTFLoader().loadAsync(`${assets}/model.glb`),
    fetch(`${assets}/cloth.json`).then((response) => response.json()),
    fetch(`${assets}/metadata.json`).then((response) => response.json()),
  ]);
  const model = parseFeModel(raw);
  if (!model) throw new Error('Export did not contain a FeModel.');
  const grimoireLink = element('grimoire-link', HTMLAnchorElement);
  grimoireLink.hidden = !metadata.viewer;
  grimoireLink.href = `/hero-preview.html?case=${selected.name}`;
  const coverage = clothSimulationCoverage(model);
  const gaps = (status: 'not-implemented' | 'approximate') => coverage.featureGaps
    .filter((gap) => gap.status === status).map((gap) => `${gap.label.toLowerCase()} (${gap.count})`).join(', ');
  element('coverage-note', HTMLParagraphElement).textContent = [
    gaps('not-implemented') && `Not simulated: ${gaps('not-implemented')}.`,
    gaps('approximate') && `Approximate: ${gaps('approximate')}.`,
    coverage.integrators.unknown > 0 && `Unrecognized integrators: ${coverage.integrators.unknown}.`,
    coverage.decodeIssues > 0 && `Decode issues: ${coverage.decodeIssues}.`,
    'In-game visual match is unverified.',
  ].filter(Boolean).join(' ');
  const generatedNodes = new Set([...model.ctrlOffsets, ...model.softOffsets].map((offset) => offset.child));
  const inputIndices = model.nodes.map((_, index) => index).filter((index) => !generatedNodes.has(index));
  const root = gltf.scene;
  const makeScene = (object: THREE.Object3D) => {
    const result = new THREE.Scene();
    result.background = new THREE.Color('#202633');
    const key = new THREE.DirectionalLight(0xffedd6, 3.5);
    key.position.set(4, 6, 3);
    const fill = new THREE.DirectionalLight(0x9cbeff, 2);
    fill.position.set(-4, 3, -3);
    result.add(object, key, fill, new THREE.HemisphereLight(0xddeaff, 0x474347, 2.4), new THREE.GridHelper(8, 16, 0x647086, 0x343f50));
    return result;
  };
  const scene = makeScene(root);
  const reference = metadata.reference ? await new GLTFLoader().loadAsync(metadata.reference.url) : null;
  const referenceRoot = reference?.scene ?? clone(root);
  const referenceFrame = new THREE.Group();
  referenceFrame.matrixAutoUpdate = false;
  referenceFrame.add(referenceRoot);
  const referenceScene = makeScene(referenceFrame);
  const referenceClips = reference?.animations ?? gltf.animations;
  comparison.options[1].textContent = reference ? 'S2V exported animation' : 'Animation without physics';
  const updateReferenceCaption = () => {
    referenceLabel.textContent = comparison.value === 'targets' ? 'Generated animation targets' : comparison.options[1].textContent;
    element('reference-note', HTMLParagraphElement).textContent = comparison.value === 'targets'
      ? `Right: compiled FeModel targets reconstructed from ${reference ? 'S2V' : 'vpkmerge'} animation, with no forces or constraint relaxation. This isolates the shape that drives the solver.`
      : reference
        ? 'Right: the same clip exported by S2V, in this renderer. It provides an animation baseline, not a live physics simulation.'
        : 'Right: the same vpkmerge animation without physics. Start with --s2v <CLI path> to compare S2V exports.';
  };
  updateReferenceCaption();
  const overlay = new ClothOverlay();
  scene.add(overlay.group);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewport.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.25, 0);
  const cameraFit = (aspect: number) => Math.max(1, 0.75 / aspect);
  const updateCamera = () => {
    const distance = 6.2 * cameraFit(camera.aspect);
    camera.position.set(view.value === 'Side' ? distance : 0, 1.5, view.value === 'Back' ? -distance : view.value === 'Side' ? 0 : distance);
    controls.update();
  };
  updateCamera();
  view.addEventListener('change', updateCamera);
  const resizeViewport = () => {
    const previousFit = cameraFit(camera.aspect);
    camera.aspect = viewport.clientWidth / viewport.clientHeight / (comparison.value === 'off' ? 1 : 2);
    camera.position.sub(controls.target).multiplyScalar(cameraFit(camera.aspect) / previousFit).add(controls.target);
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    referenceLabel.hidden = comparison.value === 'off';
    viewport.classList.toggle('comparison', comparison.value !== 'off');
  };
  const resize = new ResizeObserver(resizeViewport);
  resize.observe(viewport);
  comparison.addEventListener('change', resizeViewport);
  const skeleton = new THREE.SkeletonHelper(root);
  skeleton.visible = false;
  scene.add(skeleton);
  bonesToggle.addEventListener('change', () => { skeleton.visible = bonesToggle.checked; });
  const bind = new Map<THREE.Object3D, { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 }>();
  let skinnedMeshes = 0;
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const neutral = new THREE.MeshStandardMaterial({ color: '#b6bac1', metalness: 0, roughness: 0.8 });
  for (const rig of [root, referenceRoot]) rig.traverse((object) => {
    if (object instanceof THREE.Mesh) originalMaterials.set(object, object.material);
    if (object instanceof THREE.SkinnedMesh) { object.frustumCulled = false; if (rig === root) skinnedMeshes++; }
    if (object instanceof THREE.Bone) bind.set(object, { position: object.position.clone(), rotation: object.quaternion.clone(), scale: object.scale.clone() });
  });
  element('neutral', HTMLInputElement).addEventListener('change', (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    originalMaterials.forEach((material, mesh) => { mesh.material = enabled ? neutral : material; });
  });
  for (const clip of gltf.animations) clipSelect.add(new Option(clip.name, clip.name));
  clipSelect.add(new Option('Bind pose', '__bind'));
  if (gltf.animations.some((clip) => clip.name === metadata.clips[0])) clipSelect.value = metadata.clips[0];
  const mixer = new THREE.AnimationMixer(root);
  const referenceMixer = new THREE.AnimationMixer(referenceRoot);
  const bodyIndices = model.nodes.map((_, index) => index)
    .filter((index) => index < model.rotLockStaticNodeCount && !generatedNodes.has(index));
  const motionAnchor = bodyIndices.map((index) => model.nodes[index])
    .find((node) => root.getObjectByName(node.name) && referenceRoot.getObjectByName(node.name));
  const motionCorrection = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const anchorTransform = (bone: THREE.Object3D) => new THREE.Matrix4().compose(
    bone.getWorldPosition(new THREE.Vector3()), bone.getWorldQuaternion(new THREE.Quaternion()).normalize(), unitScale);
  const syncReferenceMotion = () => {
    referenceFrame.matrix.identity();
    referenceFrame.updateWorldMatrix(true, true);
    motionCorrection.identity();
    if (motionAnchor) {
      root.updateWorldMatrix(true, true);
      // S2V bakes movement data into every root track. Remove only the shared
      // rigid motion, measured at an animation-owned body control, for an in-place comparison.
      motionCorrection.copy(anchorTransform(root.getObjectByName(motionAnchor.name)!))
        .multiply(anchorTransform(referenceRoot.getObjectByName(motionAnchor.name)!).invert());
      if (alignMotion.checked) referenceFrame.matrix.copy(motionCorrection);
      referenceFrame.updateWorldMatrix(true, true);
    }
  };
  alignMotion.addEventListener('change', syncReferenceMotion);
  let harness: ClothSimHarness | null = null;
  let referenceHarness: ClothSimHarness | null = null;
  let elapsed = 0;
  let playing = false;
  let checking = false;
  let checkReport: unknown = null;
  const matched = model.nodes.filter((node) => root.getObjectByName(node.name)).length;
  const missingInputs = inputIndices.filter((index) => !root.getObjectByName(model.nodes[index].name)).map((index) => model.nodes[index].name);
  const missingReferenceInputs = inputIndices.filter((index) => !referenceRoot.getObjectByName(model.nodes[index].name)).map((index) => model.nodes[index].name);
  const reset = () => {
    harness?.dispose();
    referenceHarness?.dispose();
    mixer.stopAllAction();
    referenceMixer.stopAllAction();
    for (const [object, pose] of bind) {
      object.position.copy(pose.position);
      object.quaternion.copy(pose.rotation);
      object.scale.copy(pose.scale);
    }
    root.updateWorldMatrix(true, true);
    referenceRoot.updateWorldMatrix(true, true);
    harness = physics.checked ? createClothSimHarness(root, model) : null;
    referenceHarness = comparison.value === 'targets' ? createClothSimHarness(referenceRoot, model, { mode: 'targets' }) : null;
    mixer.time = 0;
    referenceMixer.time = 0;
    const clip = gltf.animations.find((item) => item.name === clipSelect.value);
    if (clip) mixer.clipAction(clip).reset().play();
    const referenceClip = referenceClips.find((item) => item.name === clipSelect.value);
    if (referenceClip) referenceMixer.clipAction(referenceClip).reset().play();
    mixer.update(0);
    referenceMixer.update(0);
    referenceHarness?.step(CLOTH_TIMESTEP);
    syncReferenceMotion();
    elapsed = 0;
  };
  comparison.addEventListener('change', () => {
    updateReferenceCaption();
    if ((comparison.value === 'targets') !== Boolean(referenceHarness)) reset();
  });
  const advance = (dt: number) => {
    const animate = (delta: number) => {
      elapsed += delta;
      if (!frozen.checked) mixer.update(delta);
      if (referenceHarness) referenceHarness.step(delta, (tick) => { if (!frozen.checked) referenceMixer.update(tick); });
      else if (!frozen.checked) referenceMixer.update(delta);
    };
    if (harness) harness.step(dt, animate);
    else animate(dt);
    root.updateWorldMatrix(true, true);
    referenceRoot.updateWorldMatrix(true, true);
    syncReferenceMotion();
  };
  const report = () => ({ metadata, clip: clipSelect.value, physics: physics.checked, frozen: frozen.checked,
    elapsed, animationTime: mixer.time, matched, controls: model.nodes.length, skinnedMeshes,
    generatedControlsWithoutBones: model.nodes.length - matched - missingInputs.length, missingInputs, missingReferenceInputs,
    referencePose: comparison.value === 'targets' ? 'generated-targets' : 'exported-animation',
    referenceAlignment: { enabled: alignMotion.checked, anchor: motionAnchor?.name ?? null, correction: motionCorrection.toArray() },
    metrics: harness?.metrics() ?? null, snapshot: harness?.snapshot() ?? null, checks: checkReport });
  clipSelect.addEventListener('change', reset);
  physics.addEventListener('change', reset);
  element('reset', HTMLButtonElement).addEventListener('click', reset);
  play.addEventListener('click', () => { playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; });
  element('tick', HTMLButtonElement).addEventListener('click', () => { playing = false; play.textContent = 'Play'; advance(CLOTH_TIMESTEP); });
  element('step', HTMLButtonElement).addEventListener('click', () => { for (let i = 0; i < 120; i++) advance(CLOTH_TIMESTEP); });
  element('seek', HTMLButtonElement).addEventListener('click', () => {
    playing = false;
    play.textContent = 'Play';
    frozen.checked = false;
    const seconds = THREE.MathUtils.clamp(Number(seekTime.value) || 0, 0, 60);
    reset();
    for (let i = 0; i < Math.round(seconds / CLOTH_TIMESTEP); i++) advance(CLOTH_TIMESTEP);
  });
  element('settle', HTMLButtonElement).addEventListener('click', () => {
    frozen.checked = true;
    playing = false;
    play.textContent = 'Play';
    for (let i = 0; i < 1200; i++) advance(CLOTH_TIMESTEP);
  });
  const pose = (rig: THREE.Object3D = root) => model.nodes.map((node) => {
    const bone = rig.getObjectByName(node.name);
    return { position: bone?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(),
      rotation: bone?.getWorldQuaternion(new THREE.Quaternion()).normalize() ?? new THREE.Quaternion() };
  });
  const poseDifference = (before: ReturnType<typeof pose>, after: ReturnType<typeof pose>, count = before.length) => ({
    position: Math.max(0, ...before.slice(0, count).map((node, index) => node.position.distanceTo(after[index].position))),
    angle: Math.max(0, ...before.slice(0, count).map((node, index) => node.rotation.angleTo(after[index].rotation))),
  });
  const staticTargetWritebackError = () => {
    const snapshot = harness?.snapshot();
    if (!snapshot) return 0;
    const transform = new THREE.Matrix4().fromArray(snapshot.modelToWorld);
    return Math.max(0, ...snapshot.nodes.slice(0, model.staticNodeCount).map((node) => {
      const bone = root.getObjectByName(node.name);
      return bone ? bone.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(node.target).applyMatrix4(transform)) : 0;
    }));
  };
  checks.addEventListener('click', async () => {
    if (checking) return;
    checking = true;
    playing = false;
    play.textContent = 'Play';
    inputs.forEach((input) => { input.disabled = true; });
    const cases = [];
    try {
      comparison.value = 'reference';
      updateReferenceCaption();
      resizeViewport();
      alignMotion.checked = true;
      for (const clip of gltf.animations) {
        clipSelect.value = clip.name;
        frozen.checked = false;
        physics.checked = false;
        reset();
        for (let i = 0; i < 600; i++) advance(CLOTH_TIMESTEP);
        const animatedPose = pose();
        const referencePose = pose(referenceRoot);
        const exportDifference = poseDifference(animatedPose, referencePose);
        const inputDifference = poseDifference(inputIndices.map((index) => animatedPose[index]), inputIndices.map((index) => referencePose[index]));
        const referenceMotionCorrection = motionCorrection.toArray();
        const referenceMatched = model.nodes.filter((node) => referenceRoot.getObjectByName(node.name)).length;
        let reference: ReturnType<typeof pose> | undefined;
        for (const fps of [30, 60, 144, 360]) {
          physics.checked = true;
          reset();
          checksResult.textContent = `Checking ${clip.name} at ${fps} FPS...`;
          checksSummary.textContent = checksResult.textContent;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const start = performance.now();
          for (let i = 0; i < 5 * fps; i++) advance(1 / fps);
          const duration = performance.now() - start;
          const solvedPose = pose();
          reference ??= solvedPose;
          const snapshot = harness?.snapshot();
          cases.push({ clip: clip.name, fps, milliseconds: duration,
            exportPositionDifference: exportDifference.position,
            animationInputDifference: inputDifference,
            referenceMotionCorrection,
            referenceControlsMatched: referenceMatched,
            frameRateDifference: poseDifference(reference, solvedPose),
            bodyAnchorDifference: poseDifference(bodyIndices.map((index) => animatedPose[index]), bodyIndices.map((index) => solvedPose[index])),
            staticPositionError: staticTargetWritebackError(),
            metrics: harness?.metrics(),
            maxContactDepth: Math.max(0, ...snapshot?.contacts.map((contact) => contact.depth) ?? []),
            maxRodError: Math.max(0, ...snapshot?.rods.map((rod) => rod.error) ?? []),
            maxTriangleCorrection: Math.max(0, ...snapshot?.triangles.map((triangle) => triangle.correction) ?? []),
            maxQuadCorrection: Math.max(0, ...snapshot?.quads.map((quad) => quad.correction) ?? []),
          });
        }
      }
      frozen.checked = true;
      for (let i = 0; i < 1200; i++) advance(CLOTH_TIMESTEP);
      const settledPose = pose();
      for (let i = 0; i < 120; i++) advance(CLOTH_TIMESTEP);
      const after = pose();
      const damped = model.nodes.map((node, index) => ({ node, index }))
        .filter(({ node }) => !node.pinned && node.animVertex > 0).map(({ index }) => index);
      const passed = cases.filter((test) => missingInputs.length === 0 && missingReferenceInputs.length === 0
        && test.referenceControlsMatched === matched && test.animationInputDifference.position < 1e-5
        && test.metrics?.finite === 1 && test.metrics.simulationSteps === 600
        && test.frameRateDifference.position < 1e-7 && test.frameRateDifference.angle < 1e-6
        && test.bodyAnchorDifference.position < 1e-7 && test.bodyAnchorDifference.angle < 1e-6
        && test.staticPositionError < 1e-7).length;
      checkReport = {
        poseChecks: { passed, total: cases.length },
        renderedControls: matched, generatedControlsWithoutBones: model.nodes.length - matched - missingInputs.length,
        animationInputs: inputIndices.length,
        missingInputs, missingReferenceInputs,
        units: { posePosition: 'meters', poseAngle: 'radians', solverDistance: 'Source units' },
        cases,
        frozenPoseChangeAfterTenSeconds: poseDifference(settledPose, after),
        dampedClothChangeAfterTenSeconds: poseDifference(damped.map((index) => settledPose[index]), damped.map((index) => after[index])),
        settled: harness?.metrics(),
        reference: metadata.reference?.label ?? 'vpkmerge animation without physics',
        referenceAlignmentAnchor: motionAnchor?.name ?? null,
        note: 'Exporter checks require matching animation inputs. Generated cloth roots use different static anchoring in the two exporters; their raw position difference is reported separately. Zero-damping chains may keep swinging. These checks do not establish in-game visual parity.',
      };
      checksResult.textContent = JSON.stringify(checkReport, null, 2);
      checksSummary.textContent = `${passed}/${cases.length} pose and anchor checks passed`;
    } catch (error) {
      checksResult.textContent = error instanceof Error ? error.message : String(error);
      checksSummary.textContent = 'Checks failed. Expand for details.';
    } finally {
      checking = false;
      inputs.forEach((input) => { input.disabled = false; });
    }
  });
  element('report', HTMLButtonElement).addEventListener('click', async () => {
    const result = element('report-result', HTMLParagraphElement);
    try {
      const response = await fetch('/__cloth/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report()) });
      if (!response.ok) throw new Error(await response.text() || `Report could not be saved (HTTP ${response.status}).`);
      const saved = await response.json();
      result.textContent = `Saved to ${saved.file}`;
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  reset();
  inputs.forEach((input) => { input.disabled = false; });
  let last = performance.now();
  let lastDiagnostics = -Infinity;
  renderer.setAnimationLoop((time) => {
    if (playing && !checking) advance(Math.min((time - last) / 1000, 0.1) * Number(speed.value));
    last = time;
    controls.update();
    if (!checking) {
      const showOverlay = nodesToggle.checked || targetsToggle.checked || collidersToggle.checked;
      const snapshot = (showOverlay || time - lastDiagnostics > 150) ? harness?.snapshot() : undefined;
      overlay.group.visible = Boolean(showOverlay && snapshot && harness?.metrics().simulationSteps);
      if (snapshot) overlay.update(snapshot, { nodes: nodesToggle.checked, targets: targetsToggle.checked, colliders: collidersToggle.checked });
      if (time - lastDiagnostics > 150) {
        const worstContact = snapshot?.contacts.sort((a, b) => b.depth - a.depth)[0];
        const worstRod = snapshot?.rods.sort((a, b) => b.error - a.error)[0];
        const hingeErrors = snapshot?.hinges.flatMap((hinge) => hinge.excess === null ? [] : [hinge.excess]) ?? [];
        diagnostics.textContent = snapshot ? `Body penetration: ${worstContact?.depth.toFixed(4) ?? '0'} Source units\nRod limit error: ${worstRod?.error.toFixed(4) ?? '0'} Source units`
          + (snapshot.hinges.length > 0 ? `\nHinge limit error: ${hingeErrors.length ? THREE.MathUtils.radToDeg(Math.max(...hingeErrors)).toFixed(2) + ' degrees' : 'unavailable'}` : '')
          + (snapshot.triangles.length > 0 ? `\nTriangle correction: ${Math.max(...snapshot.triangles.map((triangle) => triangle.correction)).toFixed(4)} Source units` : '')
          + (snapshot.quads.length > 0 ? `\nQuad correction: ${Math.max(...snapshot.quads.map((quad) => quad.correction)).toFixed(4)} Source units` : '')
          + (worstContact ? `\nContact: ${snapshot.nodes[worstContact.node].name} / ${worstContact.shape}` : '')
          + (worstRod && worstRod.error > 1e-4 ? `\nRod: ${snapshot.nodes[worstRod.a].name} -> ${snapshot.nodes[worstRod.b].name}` : '') : 'Enable physics to inspect solver data.';
        status.textContent = `${elapsed.toFixed(3)} seconds | animation ${mixer.time.toFixed(3)}\n${matched} rendered controls | ${model.nodes.length - matched - missingInputs.length} generated controls | ${missingInputs.length} unresolved`;
        metrics.textContent = JSON.stringify(harness?.metrics() ?? { physics: 'off' }, null, 2);
        lastDiagnostics = time;
      }
    }
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const compare = comparison.value !== 'off';
    const firstWidth = compare ? Math.floor(width / 2) : width;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, firstWidth, height);
    renderer.setScissor(0, 0, firstWidth, height);
    renderer.render(scene, camera);
    if (compare) {
      renderer.setViewport(firstWidth, 0, width - firstWidth, height);
      renderer.setScissor(firstWidth, 0, width - firstWidth, height);
      renderer.render(referenceScene, camera);
    }
    renderer.setScissorTest(false);
  });
  window.addEventListener('pagehide', () => { harness?.dispose(); referenceHarness?.dispose(); overlay.dispose(); neutral.dispose(); controls.dispose(); resize.disconnect(); renderer.dispose(); }, { once: true });
}
void main().catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); console.error(error); });
