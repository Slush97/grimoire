import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HeroPoseViewer from '../components/locker/HeroPoseViewer';
import '../i18n';
import '../index.css';

interface PreviewCase {
  name: string;
  label: string;
  metadata: {
    exportedAt: string;
    viewer?: { rigged: { file: string }; posed: { file: string } | null };
  };
}

const status = document.getElementById('viewer-status')!;
const select = document.getElementById('hero-case') as HTMLSelectElement;
const physicsData = document.getElementById('physics-data') as HTMLSelectElement;
const fetchAsset = window.fetch.bind(window);

async function main() {
  const cases: { name: string; label: string }[] = await fetchAsset('/.codex-run/source2-physics/cases.json').then((response) => response.json());
  const available: PreviewCase[] = await Promise.all(cases.map(async (item) => ({
    ...item,
    metadata: await fetchAsset(`/.codex-run/source2-physics/${item.name}/metadata.json`).then((response) => response.json()),
  })));
  const prepared = available.filter((item) => item.metadata.viewer);
  if (!prepared.length) throw new Error('Start pnpm dev:cloth with --grimoire to export the viewer cases.');
  const byKey = new Map(prepared.map((item) => [item.name, item]));
  const byHero = new Map(prepared.map((item) => [item.label, item]));
  const info = (hero: string, rigged: boolean) => {
    const item = byHero.get(hero);
    return {
      key: item?.name ?? '',
      hasModel: !!(rigged ? item?.metadata.viewer?.rigged : item?.metadata.viewer?.posed),
      mtimeMs: item ? Date.parse(item.metadata.exportedAt) : null,
    };
  };
  // Only the Electron asset transport is replaced. The production viewer,
  // paired loader, materials, mixer, physics hook and controls all run as-is.
  const api = {
    getHeroPoseInfo: async (hero: string) => info(hero, false),
    exportHeroPose: async (hero: string) => info(hero, false),
    getRiggedHeroPose: async (hero: string) => info(hero, true),
    exportRiggedHeroPose: async (hero: string) => info(hero, true),
    getHeroEffectInfo: async () => ({ key: '', entry: null, hasEffect: false }),
  } satisfies Pick<Window['electronAPI'], 'getHeroPoseInfo' | 'exportHeroPose' | 'getRiggedHeroPose' | 'exportRiggedHeroPose' | 'getHeroEffectInfo'>;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString(), location.href);
    if (url.protocol !== 'grimoire-hero:') return fetchAsset(input, init);
    const [key, filename] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const item = byKey.get(key);
    const viewer = item?.metadata.viewer;
    if (!viewer) return new Response(null, { status: 404 });
    const file = filename === 'model-rigged.glb' ? viewer.rigged.file
      : filename === 'model.glb' ? viewer.posed?.file
        : filename === 'cloth-rigged.json' ? 'cloth.json' : null;
    if (!file) return new Response(null, { status: 404 });
    if (filename === 'cloth-rigged.json') {
      if (physicsData.value === 'missing') return new Response(null, { status: 404 });
      if (physicsData.value === 'delayed') await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const local = new URL(`/.codex-run/source2-physics/${item.name}/${file}`, location.href);
    return fetchAsset(input instanceof Request ? new Request(local, input) : local, init);
  };

  prepared.forEach((item) => select.add(new Option(item.label, item.name)));
  const requested = new URLSearchParams(location.search).get('case');
  select.value = byKey.has(requested ?? '') ? requested! : prepared[0].name;
  select.disabled = false;
  const root = createRoot(document.getElementById('hero-viewer')!);
  const render = () => {
    const item = byKey.get(select.value)!;
    history.replaceState(null, '', `?case=${encodeURIComponent(item.name)}`);
    document.title = `${item.label} in Grimoire`;
    document.getElementById('testbed-link')!.setAttribute('href', `/cloth-preview.html?case=${item.name}`);
    status.textContent = `${item.label}: Grimoire's viewer with exported base-game assets. Physics is opt-in; use the button below.`;
    root.render(<StrictMode><HeroPoseViewer key={`${item.name}:${physicsData.value}`} heroName={item.label} /></StrictMode>);
  };
  select.addEventListener('change', render);
  physicsData.addEventListener('change', render);
  render();
}

main().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : 'Could not load the Grimoire preview.';
});
