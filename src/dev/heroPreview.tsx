import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HeroPoseViewer from '../components/locker/HeroPoseViewer';
import { heroPresentationStorageKey } from '../components/locker/heroViewerDefaults';
import { foundryDraftKey } from '../lib/foundryDrafts';
import type { ViewerBackground } from '../lib/viewerBackgrounds';
import type { MovementFxChoice, MovementEnginePreview } from '../lib/movementFx';
import type { MovementViewerPreview } from '../components/locker/MovementFxStage';
import type { FxDescriptor } from '../components/locker/fxDescriptor';
import '../i18n';
import '../index.css';

// Dev harness for the production hero viewer. Only the Electron asset transport is replaced: the
// viewer, paired loader, materials, mixer, physics hook, particles and controls all run as-is.
//
// Two case sources:
// - staged (default): exported cases under .codex-run/source2-physics (pnpm dev:cloth --grimoire);
// - cache (?source=cache): the app's own hero pose cache, read in place through the dev server
//   (scripts/hero-preview-server.mjs serves it at /@hero-cache/), with particle bundles exported by
//   scripts/export-hero-particles.ts served at /@hero-particles/<Hero>/.
//
// ?particles=off|overlay|engine picks the particle path: none, the curated overlay, or the faithful
// runtime (the engine particles option). ?scene=studio|midtown|transparent|hideout sets the viewer's
// scene and ?backdrop=none|broadway|uptown|timesSquare its backdrop, for repeatable captures.
// ?movement=<bake key> shows the Foundry movement preview of a bake exported by
// scripts/export-movement-preview.ts (served at /@movement/), looping; window.__movementReplay()
// starts it over.

interface PreviewCase {
  /** The grimoire-hero: key the viewer asks for. */
  name: string;
  label: string;
  /** Where the case's files are served from. */
  base: string;
  rigged: string | null;
  posed: string | null;
  exportedAt: number | null;
  hasEffect: boolean;
  hasParticles: boolean;
  /** Whether the case has the movement preview's clips (movement.glb). */
  hasMovement?: boolean;
}

const params = new URLSearchParams(location.search);
const cacheSource = params.get('source') === 'cache';
const status = document.getElementById('viewer-status')!;
const select = document.getElementById('hero-case') as HTMLSelectElement;
const physicsData = document.getElementById('physics-data') as HTMLSelectElement;
const particlePath = document.getElementById('particle-path') as HTMLSelectElement | null;
const fetchAsset = window.fetch.bind(window);

const heroDir = (hero: string) => hero.replace(/[^a-zA-Z0-9_-]+/g, '_');
/** A hero's directory under a movement bake's engine previews (movementEngineHeroDir). */
const heroDirOf = (hero: string) => hero.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 64) || 'hero';
const movementKey = /^[a-f0-9]{64}$/.test(params.get('movement') ?? '') ? params.get('movement')! : null;

async function stagedCases(): Promise<PreviewCase[]> {
  const cases: { name: string; label: string }[] = await fetchAsset('/.codex-run/source2-physics/cases.json').then((response) => response.json());
  return Promise.all(cases.map(async (item) => {
    const metadata: { exportedAt: string; viewer?: { rigged: { file: string }; posed: { file: string } | null } } =
      await fetchAsset(`/.codex-run/source2-physics/${item.name}/metadata.json`).then((response) => response.json());
    return {
      ...item,
      base: `/.codex-run/source2-physics/${item.name}/`,
      rigged: metadata.viewer?.rigged.file ?? null,
      posed: metadata.viewer?.posed?.file ?? null,
      exportedAt: Date.parse(metadata.exportedAt),
      hasEffect: true,
      hasParticles: false,
    };
  }));
}

async function cacheCases(): Promise<PreviewCase[]> {
  const index: { name: string; label: string; files: string[]; mtimeMs: number; particles: boolean }[] =
    await fetchAsset('/@hero-cache/index.json').then((response) => response.json());
  return index.map((item) => ({
    name: item.name,
    label: item.label,
    base: `/@hero-cache/${encodeURIComponent(item.name)}/`,
    rigged: item.files.includes('model-rigged.glb') ? 'model-rigged.glb' : null,
    posed: item.files.includes('model.glb') ? 'model.glb' : null,
    exportedAt: item.mtimeMs,
    hasEffect: item.files.includes('effect.json'),
    hasParticles: item.particles,
    hasMovement: item.files.includes('movement.glb'),
  }));
}

/** grimoire-hero://m/<key>/<file> as the dev server serves it. */
function localUrl(byKey: ReadonlyMap<string, PreviewCase>, url: string): string | null {
  const movement = /^grimoire-hero:\/\/f\/([a-f0-9]{64})\/([^?]+)/.exec(url);
  if (movement) return `/@movement/${movement[1]}/${movement[2]}`;
  const match = /^grimoire-hero:\/\/m\/([^/?]+)\/([^?]+)/.exec(url);
  if (!match) return null;
  const item = byKey.get(decodeURIComponent(match[1]));
  if (!item) return null;
  const file = match[2];
  if (file.startsWith('particles/')) return `/@hero-particles/${heroDir(item.label)}/${file.slice('particles/'.length)}`;
  if (file === 'model-rigged.glb') return item.rigged ? `${item.base}${item.rigged}` : null;
  if (file === 'model.glb') return item.posed ? `${item.base}${item.posed}` : null;
  if (file === 'cloth-rigged.json' && !cacheSource) return `${item.base}cloth.json`;
  return `${item.base}${file}`;
}

async function main() {
  const prepared = (cacheSource ? await cacheCases() : await stagedCases()).filter((item) => item.rigged || item.posed);
  if (!prepared.length) throw new Error(cacheSource ? 'The app has no cached hero poses.' : 'Start pnpm dev:cloth with --grimoire to export the viewer cases.');
  const byKey = new Map(prepared.map((item) => [item.name, item]));
  const byHero = new Map(prepared.map((item) => [item.label, item]));
  const info = (hero: string, rigged: boolean) => {
    const item = byHero.get(hero);
    return { key: item?.name ?? '', hasModel: !!(rigged ? item?.rigged : item?.posed), hasMovement: !!item?.hasMovement, mtimeMs: item?.exportedAt ?? null };
  };

  const api = {
    getHeroPoseInfo: async (hero: string) => info(hero, false),
    exportHeroPose: async (hero: string) => info(hero, false),
    getRiggedHeroPose: async (hero: string) => info(hero, true),
    exportRiggedHeroPose: async (hero: string) => info(hero, true),
    getHeroEffectInfo: async (hero: string) => {
      const item = byHero.get(hero);
      return { key: item?.name ?? '', entry: item?.hasEffect ? 'dev' : null, hasEffect: !!item?.hasEffect };
    },
    exportHeroParticles: async (hero: string) => {
      const item = byHero.get(hero);
      return { key: item?.name ?? '', hasBundle: !!item?.hasParticles, effects: item?.hasParticles ? 1 : 0 };
    },
    previewMovementEngine: async ({ heroName }: { heroName: string }) =>
      (await fetchAsset(`/@movement/${movementKey}/engine/${heroDirOf(heroName)}/preview.json`)).json() as Promise<MovementEnginePreview>,
  } satisfies Pick<Window['electronAPI'], 'getHeroPoseInfo' | 'exportHeroPose' | 'getRiggedHeroPose' | 'exportRiggedHeroPose' | 'getHeroEffectInfo' | 'exportHeroParticles'>
    & Record<'previewMovementEngine', (request: { heroName: string }) => Promise<MovementEnginePreview>>;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });

  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.startsWith('grimoire-hero:')) return fetchAsset(input, init);
    const local = localUrl(byKey, url);
    if (!local) return new Response(null, { status: 404 });
    if (url.includes('/cloth-rigged.json')) {
      if (physicsData.value === 'missing') return new Response(null, { status: 404 });
      if (physicsData.value === 'delayed') await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return fetchAsset(local, init);
  };

  // Image elements bypass fetch; send grimoire-hero: sources to the dev server too
  const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return imageSource.get!.call(this); },
    set(value: string) { imageSource.set!.call(this, localUrl(byKey, String(value)) ?? value); },
  });

  prepared.forEach((item) => select.add(new Option(item.label, item.name)));
  const requested = params.get('case');
  select.value = byKey.has(requested ?? '') ? requested! : prepared[0].name;
  select.disabled = false;
  if (particlePath) particlePath.value = ['off', 'overlay', 'engine'].includes(params.get('particles') ?? '') ? params.get('particles')! : 'overlay';
  const backdropParam = params.get('backdrop');
  const backdrop = (['none', 'broadway', 'uptown', 'timesSquare'] as const).find((value) => value === backdropParam) satisfies ViewerBackground | undefined;
  const root = createRoot(document.getElementById('hero-viewer')!);
  let replay = 0;
  const movementPreview = async (heroName: string): Promise<MovementViewerPreview | undefined> => {
    if (!movementKey) return undefined;
    const descriptor = await (await fetchAsset(`/@movement/${movementKey}/effect.${heroDirOf(heroName)}.json`)).json() as FxDescriptor & { name?: string };
    const kind: MovementFxChoice['kind'] = descriptor.name?.includes('air_dash') ? 'dash' : 'heavy-melee';
    const choice: MovementFxChoice = { kind, color: '#ffffff', palette: { mode: 'solid' }, image: null, brightness: 1, illuminated: false, outline: false, outlineColor: '#ffffff' };
    return { key: `${movementKey}:${heroName}`, descriptor, textureBaseUrl: `grimoire-hero://f/${movementKey}/effect-tex/`, kind, revision: replay, loop: true, request: { choice, heroName } };
  };
  const render = async () => {
    const item = byKey.get(select.value)!;
    const path = particlePath?.value ?? 'overlay';
    localStorage.setItem(heroPresentationStorageKey('effects'), path === 'off' ? '0' : '1');
    localStorage.setItem(heroPresentationStorageKey('sourceParticles'), path === 'engine' ? '1' : '0');
    const next = new URLSearchParams(params);
    next.set('case', item.name);
    next.set('particles', path);
    history.replaceState(null, '', `?${next.toString()}`);
    document.title = `${item.label} in Grimoire`;
    document.getElementById('testbed-link')!.setAttribute('href', `/cloth-preview.html?case=${item.name}`);
    const scene = params.get('scene');
    if (scene && ['studio', 'midtown', 'transparent', 'hideout'].includes(scene)) {
      localStorage.setItem(foundryDraftKey('', `viewer:${item.label}:view:scene`), JSON.stringify(scene));
    }
    status.textContent = `${item.label}: Grimoire's viewer with ${cacheSource ? 'the app cache' : 'exported base-game assets'}; particles: ${path}.`;
    const movement = await movementPreview(item.label);
    root.render(<StrictMode><HeroPoseViewer key={`${item.name}:${physicsData.value}:${path}`} heroName={item.label} initialBackground={backdrop}
      movementPreview={movement} /></StrictMode>);
  };
  Object.assign(window, { __movementReplay: () => { replay++; void render(); } });
  select.addEventListener('change', () => void render());
  physicsData.addEventListener('change', () => void render());
  particlePath?.addEventListener('change', () => void render());
  void render();
}

main().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : 'Could not load the Grimoire preview.';
});
