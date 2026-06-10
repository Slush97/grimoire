import { useMemo } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { Mod } from '../../types/mod';
import { getLockerSkinKey } from '../../lib/lockerUtils';
import { useAppStore } from '../../stores/appStore';
import ModThumbnail from '../ModThumbnail';
import AudioPreviewPlayer from '../AudioPreviewPlayer';
import DownloadableSkinsSection from './DownloadableSkinsSection';

interface SkinGroup {
  key: string;
  variants: Mod[];
  primary: Mod;
}

// Match the Installed VariantPickerModal fallback chain so pill labels read
// the same as the picker (e.g. "Huge Eyes Updated!!!" from fileDescription)
// instead of the raw pak##_*.vpk filename.
function variantPillLabel(mod: Mod): string {
  return (
    mod.variantLabel ??
    mod.fileDescription ??
    mod.sourceFileName ??
    mod.fileName
  );
}

function groupVariants(mods: Mod[]): SkinGroup[] {
  const byKey = new Map<string, Mod[]>();
  for (const mod of mods) {
    // Mods sharing a gameBananaId are variants of the same upload. Mods
    // without a gameBananaId (custom imports, legacy installs) get their own
    // singleton group keyed by mod id so they still render.
    const key = getLockerSkinKey(mod);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(mod);
  }
  return Array.from(byKey.entries()).map(([key, variants]) => {
    variants.sort((a, b) => a.priority - b.priority);
    const primary = variants.find((v) => v.enabled) ?? variants[0];
    return { key, variants, primary };
  });
}

interface HeroSkinsPanelProps {
  mods: Mod[];
  /** Set the active group/skin for this hero. Cross-group exclusive — selecting
   *  one disables every other enabled mod for the hero. Used for single-variant
   *  groups and the group header. */
  onSelect: (modId: string) => void;
  /** Toggle a single variant within an expanded multi-variant group. Disables
   *  enabled mods from other groups for the hero but preserves sibling variants
   *  in the same group, so a model VPK + voice-lines VPK can both stay on.
   *  Falls back to onSelect when not provided. */
  onToggleVariant?: (modId: string) => void;
  hideNsfwPreviews?: boolean;
  categoryId?: number;
  /** Render thumbnails as the hero portrait instead of the mod's uploader
   *  thumbnail. Sound-section view uses this so the panel reads as the right
   *  hero at a glance even though sound uploads usually carry a generic icon. */
  useHeroPortraitThumbnails?: boolean;
  /** Canonical hero name used when useHeroPortraitThumbnails is on. */
  heroName?: string;
  /** Show the DownloadableSkinsSection footer. Off for the Sounds tab,
   *  which would otherwise surface Skin-category GameBanana results. */
  showDownloadable?: boolean;
  /** Message rendered when the mod list for this section is empty. */
  emptyMessage?: string;
  /** Optional inline shortcut to Browse for this hero. Main Locker list view only. */
  browseAction?: {
    label: string;
    onClick: () => void;
  };
}

export default function HeroSkinsPanel({
  mods,
  onSelect,
  onToggleVariant,
  hideNsfwPreviews = false,
  categoryId,
  useHeroPortraitThumbnails = false,
  heroName,
  showDownloadable = true,
  emptyMessage = 'Download a skin for this hero to manage it here.',
  browseAction,
}: HeroSkinsPanelProps) {
  const hasMods = mods.length > 0;
  const soundVolume = useAppStore((s) => s.soundVolume);
  const groups = useMemo(() => groupVariants(mods), [mods]);

  const browseLink = browseAction ? (
    <button
      type="button"
      onClick={browseAction.onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {browseAction.label}
      <ExternalLink className="h-3 w-3" />
    </button>
  ) : null;

  return (
    <div className="space-y-2">
      {hasMods ? (
        <>
          {groups.map((group) => {
          const isMulti = group.variants.length > 1;
          const groupActive = group.variants.some((v) => v.enabled);
          const enabledCount = group.variants.filter((v) => v.enabled).length;
          const primary = group.primary;
          return (
            <div
              key={group.key}
              className={`rounded-md border transition-colors ${
                groupActive
                  ? 'border-accent/60 bg-white/[0.04] backdrop-blur-sm'
                  : 'border-border bg-bg-secondary/70 hover:border-accent/60 hover:bg-bg-secondary/85'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (!isMulti) onSelect(primary.id);
                }}
                aria-disabled={isMulti}
                className={`w-full flex items-center gap-3 px-3 py-3 text-left ${
                  isMulti ? 'cursor-default' : 'cursor-pointer'
                }`}
                title={
                  isMulti
                    ? `${enabledCount}/${group.variants.length} variants enabled`
                    : groupActive
                      ? 'Active skin'
                      : 'Set active'
                }
              >
                <div className="w-20 h-20 rounded-md overflow-hidden bg-bg-tertiary flex-shrink-0">
                  <ModThumbnail
                    src={primary.thumbnailUrl}
                    alt={primary.name}
                    nsfw={primary.nsfw}
                    hideNsfw={hideNsfwPreviews}
                    heroPortrait={
                      useHeroPortraitThumbnails ? heroName : undefined
                    }
                    className="w-full h-full"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center text-text-secondary text-[10px]">
                        No preview
                      </div>
                    }
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{primary.name}</div>
                  {isMulti ? (
                    enabledCount === 0 ? (
                      // Action prompt — the card itself isn't clickable for
                      // multi-variant groups, so without this users see
                      // "0/2 active" and have no idea what to do. The
                      // chevron points at the pill row directly below.
                      <div className="flex items-center gap-1 text-xs text-accent">
                        <span>Pick a variant</span>
                        <ChevronDown className="w-3 h-3" />
                      </div>
                    ) : (
                      <div className="text-xs text-text-secondary truncate">
                        {`${enabledCount}/${group.variants.length} active`}
                      </div>
                    )
                  ) : (
                    <div className="text-xs text-text-secondary truncate">
                      {primary.fileName}
                    </div>
                  )}
                </div>
                {!isMulti && groupActive && (
                  <span className="text-xs text-accent font-semibold">Active</span>
                )}
              </button>
              {/* Sound preview. All variants of one GameBanana submission share
                  the same preview clip, so the group's primary audioUrl is the
                  representative sample. Rendered as a sibling of the toggle
                  button (not nested) so its own click handlers can stopPropagation
                  without fighting the card toggle. */}
              {primary.sourceSection === 'Sound' && primary.audioUrl && (
                <div
                  className="px-3 pb-3"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <AudioPreviewPlayer src={primary.audioUrl} compact volume={soundVolume} />
                </div>
              )}
              {isMulti && (
                <div
                  className={`flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-2 border-t ${
                    enabledCount === 0 ? 'border-accent/30 bg-accent/[0.04]' : 'border-border/60'
                  }`}
                  role="group"
                  aria-label="Variant toggles"
                >
                  {group.variants.map((variant) => {
                    const label = variantPillLabel(variant);
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() =>
                          onToggleVariant
                            ? onToggleVariant(variant.id)
                            : onSelect(variant.id)
                        }
                        aria-pressed={variant.enabled}
                        title={
                          variant.enabled
                            ? `Disable: ${label}`
                            : `Enable: ${label}`
                        }
                        className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors cursor-pointer max-w-[220px] truncate ${
                          variant.enabled
                            ? 'border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary'
                            : 'border-border bg-bg-secondary text-text-primary/80 hover:border-accent/70 hover:text-text-primary'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
          })}
          {browseLink && (
            <div className="flex justify-center px-1 pt-0.5">
              {browseLink}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-text-secondary">
          <span>{emptyMessage}</span>
          {browseLink && <span className="ml-1">{browseLink}</span>}
        </div>
      )}

      {showDownloadable && categoryId && <DownloadableSkinsSection categoryId={categoryId} />}
    </div>
  );
}
