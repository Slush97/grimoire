import { useEffect, useMemo, useState } from 'react';
import {
  Hammer,
  Library,
  Volume2,
  Image as ImageIcon,
  ShoppingBag,
  Palette,
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

// Sub-tools shown in the left rail. Library / Sound / Texture / Recolor are
// live; Items rides the Library grid (opened on item icons) for now.
const SUBTOOLS = [
  { id: 'library', icon: Library, labelKey: 'foundry.subtools.library', enabled: true },
  { id: 'sound', icon: Volume2, labelKey: 'foundry.subtools.sound', enabled: true },
  { id: 'texture', icon: ImageIcon, labelKey: 'foundry.subtools.texture', enabled: true },
  { id: 'items', icon: ShoppingBag, labelKey: 'foundry.subtools.items', enabled: true },
  { id: 'recolor', icon: Palette, labelKey: 'foundry.subtools.recolor', enabled: true },
] as const;

type SubtoolId = (typeof SUBTOOLS)[number]['id'];

export default function Foundry() {
  const settings = useAppStore((s) => s.settings);
  const hasGamePath = Boolean(settings?.deadlockPath || (settings?.devMode && settings?.devDeadlockPath));

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

  return (
    <div className="flex h-full">
      {/* Left rail: sub-tools */}
      <aside className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-bg-secondary/40 p-3">
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

      {/* Center: catalog browse */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-4 p-6">
          <PageHeader
            title={<Tx k="foundry.header.title" fallback="your mom goes to college" />}
            description={
              <Tx
                k="foundry.header.description"
                fallback="Browse the game's own asset catalog, built offline from your installed files."
              />
            }
          />

          {!hasGamePath ? (
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
          ) : active === 'sound' ? (
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
