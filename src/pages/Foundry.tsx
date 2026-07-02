import { useEffect, useMemo, useState } from 'react';
import {
  Hammer,
  Library,
  Volume2,
  Image as ImageIcon,
  ShoppingBag,
  Palette,
  ArrowLeft,
} from 'lucide-react';
import { EmptyState, PageHeader } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';
import { useAppStore } from '../stores/appStore';
import { foundryHeroes, foundryWarmCache } from '../lib/api';
import type { HeroInfo } from '../types/foundry';
import LibraryBrowse from '../components/foundry/LibraryBrowse';
import SoundBrowse from '../components/foundry/SoundBrowse';
import TextureBrowse from '../components/foundry/TextureBrowse';
import RecolorTool from '../components/foundry/RecolorTool';
import FoundryHeroGrid from '../components/foundry/FoundryHeroGrid';
import HeroWorkshop from '../components/foundry/HeroWorkshop';

// Sub-tools shown in the left rail of the Catalog (tool-first) mode. Library /
// Sound / Texture / Recolor are live; Items rides the Library grid for now.
const SUBTOOLS = [
  { id: 'library', icon: Library, labelKey: 'foundry.subtools.library', enabled: true },
  { id: 'sound', icon: Volume2, labelKey: 'foundry.subtools.sound', enabled: true },
  { id: 'texture', icon: ImageIcon, labelKey: 'foundry.subtools.texture', enabled: true },
  { id: 'items', icon: ShoppingBag, labelKey: 'foundry.subtools.items', enabled: true },
  { id: 'recolor', icon: Palette, labelKey: 'foundry.subtools.recolor', enabled: true },
] as const;

type SubtoolId = (typeof SUBTOOLS)[number]['id'];
type Mode = 'heroes' | 'catalog';

export default function Foundry() {
  const settings = useAppStore((s) => s.settings);
  const hasGamePath = Boolean(settings?.deadlockPath || (settings?.devMode && settings?.devDeadlockPath));

  // Hero-first is the primary Foundry experience: pick a hero, edit everything.
  // The Catalog (tool-first) mode keeps the original asset-browse rail.
  const [mode, setMode] = useState<Mode>('heroes');
  const [selectedHero, setSelectedHero] = useState<HeroInfo | null>(null);
  const [active, setActive] = useState<SubtoolId>('library');
  const [heroes, setHeroes] = useState<HeroInfo[]>([]);

  // Roster (codename -> name) loads once; warm the catalog cache opportunistically
  // so the Sound tool opens without the cold voice-line rescan.
  useEffect(() => {
    if (!hasGamePath) return;
    let cancelled = false;
    foundryHeroes()
      .then((roster) => {
        if (!cancelled) setHeroes(roster);
      })
      .catch(() => {
        /* roster failure is non-fatal: labels fall back to the codename */
      });
    void foundryWarmCache();
    return () => {
      cancelled = true;
    };
  }, [hasGamePath]);

  const heroNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of heroes) map.set(h.codename, h.name);
    return map;
  }, [heroes]);

  // No game path: same gate regardless of mode.
  if (!hasGamePath) {
    return (
      <div className="space-y-4 p-6">
        <PageHeader
          title={<Tx k="foundry.header.title" fallback="Foundry" />}
          description={
            <Tx
              k="foundry.header.description"
              fallback="Browse the game's own asset catalog, built offline from your installed files."
            />
          }
        />
        <EmptyState
          icon={Hammer}
          title={<Tx k="foundry.empty.noPath.title" fallback="Set your Deadlock path" />}
          description={
            <Tx
              k="foundry.empty.noPath.description"
              fallback="Foundry reads the asset catalog from your installed game. Set the Deadlock path in Settings to get started."
            />
          }
        />
      </div>
    );
  }

  // Hero workshop: full-bleed, no page chrome (mirrors the Locker hero view).
  if (mode === 'heroes' && selectedHero) {
    return (
      <HeroWorkshop
        hero={selectedHero}
        heroNames={heroNames}
        onBack={() => setSelectedHero(null)}
      />
    );
  }

  // Hero roster landing.
  if (mode === 'heroes') {
    return (
      <div className="space-y-4 p-6">
        <PageHeader
          title={<Tx k="foundry.header.title" fallback="Foundry" />}
          description={
            <Tx
              k="foundry.heroes.subtitle"
              fallback="Pick a hero to edit their look, abilities, voice, and icons."
            />
          }
          action={
            <button
              type="button"
              onClick={() => setMode('catalog')}
              className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary cursor-pointer"
            >
              <Library size={15} />
              <Tx k="foundry.browseCatalog" fallback="Browse full catalog" />
            </button>
          }
        />
        <FoundryHeroGrid heroes={heroes} onPick={setSelectedHero} />
      </div>
    );
  }

  // Catalog (tool-first) mode: the original asset-browse rail.
  return (
    <div className="flex h-full">
      <aside className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-bg-secondary/40 p-3">
        <button
          type="button"
          onClick={() => setMode('heroes')}
          className="mb-1 flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
        >
          <ArrowLeft size={15} />
          <Tx k="foundry.backToHeroes" fallback="Heroes" />
        </button>
        <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">
          <Tx k="foundry.subtools.heading" fallback="Workshop" />
        </span>
        {SUBTOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = active === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              disabled={!tool.enabled}
              onClick={() => tool.enabled && setActive(tool.id)}
              className={`flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-accent/10 font-medium text-accent'
                  : tool.enabled
                    ? 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                    : 'cursor-default text-text-secondary/50'
              }`}
            >
              <Icon size={16} />
              <span className="flex-1 text-left"><Tx k={tool.labelKey} fallback={tool.id} /></span>
              {!tool.enabled && (
                <span className="text-[9px] uppercase tracking-wide text-text-secondary/40">
                  <Tx k="foundry.subtools.soon" fallback="soon" />
                </span>
              )}
            </button>
          );
        })}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-4 p-6">
          <PageHeader
            title={<Tx k="foundry.header.title" fallback="Foundry" />}
            description={
              <Tx
                k="foundry.header.description"
                fallback="Browse the game's own asset catalog, built offline from your installed files."
              />
            }
          />

          {active === 'sound' ? (
            <SoundBrowse heroes={heroes} heroNames={heroNames} />
          ) : active === 'texture' ? (
            <TextureBrowse heroes={heroes} heroNames={heroNames} />
          ) : active === 'recolor' ? (
            <RecolorTool heroes={heroes} />
          ) : active === 'items' ? (
            <LibraryBrowse heroNames={heroNames} initialCategory="item-icon" />
          ) : (
            <LibraryBrowse heroNames={heroNames} />
          )}
        </div>
      </div>
    </div>
  );
}
