import { useMemo, useState } from 'react';
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
  const built = Array.from(byKey.entries()).map(([key, variants]) => {
    variants.sort((a, b) => a.priority - b.priority);
    const primary = variants.find((v) => v.enabled) ?? variants[0];
    return { key, variants, primary };
  });
  // Pin active groups (any enabled variant) to the top so the selected skin is
  // always the first card/row in the panel. Array.sort is stable in V8, so the
  // active and inactive partitions each keep their original relative order.
  built.sort((a, b) => {
    const aActive = a.variants.some((v) => v.enabled) ? 0 : 1;
    const bActive = b.variants.some((v) => v.enabled) ? 0 : 1;
    return aActive - bActive;
  });
  return built;
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
  /** 'list' (default): compact thumbnail rows, used by the Locker list view's
   *  narrow inline expansion. 'cards': the 2-up media-card grid used by the
   *  hero detail view, sharing the Global view's card language (glass backdrop
   *  tinted by the cover art, accent glow when active, dim when not). */
  layout?: 'list' | 'cards';
}

/** One skin group as a media card (hero detail view). The whole card is the
 *  select control for single-variant groups; multi-variant groups select via
 *  their footer pills instead, mirroring the list rows' behavior. */
function SkinGroupCard({
  group,
  onSelect,
  onToggleVariant,
  hideNsfwPreviews,
  useHeroPortraitThumbnails,
  heroName,
  soundVolume,
}: {
  group: SkinGroup;
  onSelect: (modId: string) => void;
  onToggleVariant?: (modId: string) => void;
  hideNsfwPreviews: boolean;
  useHeroPortraitThumbnails: boolean;
  heroName?: string;
  soundVolume: number;
}) {
  const isMulti = group.variants.length > 1;
  const groupActive = group.variants.some((v) => v.enabled);
  const enabledCount = group.variants.filter((v) => v.enabled).length;
  const primary = group.primary;
  // Variant tray, collapsed by default so multi-variant cards match the
  // single-variant card height. Starts open when nothing is enabled yet:
  // that's the one moment the user must pick before anything works.
  const [variantsOpen, setVariantsOpen] = useState(enabledCount === 0);
  // Skipped when NSFW previews are hidden so we never bleed hidden imagery
  // into the glass tint, even blurred.
  const glassBackdropUrl =
    primary.thumbnailUrl && !(primary.nsfw && hideNsfwPreviews) ? primary.thumbnailUrl : null;

  return (
    <div
      className={`group/card relative flex flex-col rounded-[10px] border p-2.5 transition-[border-color,background-color,box-shadow] duration-200 ${
        groupActive
          ? 'border-accent bg-white/[0.02] hover:bg-white/[0.04]'
          : 'border-white/[0.08] bg-[#141414]/55 text-text-primary/75 hover:border-white/[0.16] hover:text-text-primary'
      }`}
    >
      {/* Glass backdrop: a blurred copy of the cover art bleeds behind the
          card so it's tinted by its own thumbnail, matching the Global view
          and Installed grid cards. */}
      {glassBackdropUrl && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[10px]">
          <img
            src={glassBackdropUrl}
            alt=""
            aria-hidden
            draggable={false}
            className={`h-full w-full scale-[1.35] object-cover blur-2xl saturate-[1.4] transition-opacity duration-200 ${
              groupActive ? 'opacity-55' : 'opacity-30 grayscale-[0.4]'
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0f0f0f]/45 via-[#0f0f0f]/65 to-[#0f0f0f]/[0.88]" />
        </div>
      )}

      {/* Media: aspect-video cover, dimmed when the group is inactive. */}
      <div className="relative mb-2 aspect-video w-full overflow-hidden rounded-lg border border-white/[0.08] bg-bg-tertiary">
        <div
          className={`h-full w-full transition-[filter,opacity] duration-200 ${
            groupActive ? '' : 'grayscale-[0.6] opacity-[0.7]'
          }`}
        >
          <ModThumbnail
            src={primary.thumbnailUrl}
            alt={primary.name}
            nsfw={primary.nsfw}
            hideNsfw={hideNsfwPreviews}
            heroPortrait={useHeroPortraitThumbnails ? heroName : undefined}
            className="h-full w-full"
            imageClassName="origin-center transform-gpu will-change-transform transition-transform duration-200 group-hover/card:scale-[1.03]"
            fallback={
              <div className="flex h-full w-full items-center justify-center text-xs text-text-secondary">
                No preview
              </div>
            }
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover/card:bg-bg-primary/20" />
        {groupActive && (
          <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-foreground">
            Active
          </span>
        )}
      </div>

      {/* Title. */}
      <div className="min-w-0 px-0.5">
        <h3
          className="min-w-0 truncate text-sm font-semibold leading-tight text-text-primary"
          title={primary.name}
        >
          {primary.name}
        </h3>
      </div>

      {/* Whole card is the primary control: select for single-variant groups,
          open/close the variant tray for multi. Sits under the tray/audio
          (z-20) so those keep their own handlers. */}
      <button
        type="button"
        onClick={() =>
          isMulti ? setVariantsOpen((open) => !open) : onSelect(primary.id)
        }
        aria-pressed={isMulti ? undefined : groupActive}
        aria-expanded={isMulti ? variantsOpen : undefined}
        aria-label={
          isMulti
            ? `${variantsOpen ? 'Hide' : 'Show'} variants: ${primary.name}`
            : groupActive
              ? `Active skin: ${primary.name}`
              : `Set active: ${primary.name}`
        }
        title={
          isMulti
            ? variantsOpen
              ? 'Hide variants'
              : 'Show variants'
            : groupActive
              ? 'Active skin'
              : 'Set active'
        }
        className="absolute inset-0 z-10 cursor-pointer rounded-[10px]"
      />

      {/* Sound preview. All variants of one GameBanana submission share the
          same preview clip, so the group's primary audioUrl is the
          representative sample. z-20 keeps it above the full-card toggle. */}
      {primary.sourceSection === 'Sound' && primary.audioUrl && (
        <div
          className="relative z-20 mt-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AudioPreviewPlayer src={primary.audioUrl} compact volume={soundVolume} />
        </div>
      )}

      {/* Variant state line + collapsible tray (multi-variant groups only).
          Collapsed it's a one-line summary, so the card holds the same height
          as its single-variant neighbors; the whole-card button (z-10 under
          this) toggles it. */}
      {isMulti && (
        <>
          <div
            className={`pointer-events-none mt-0.5 flex items-center gap-1 px-0.5 text-[11px] ${
              enabledCount === 0 ? 'text-accent' : 'text-text-secondary'
            }`}
          >
            <span>
              {enabledCount === 0
                ? 'Pick a variant'
                : `${enabledCount}/${group.variants.length} active`}
            </span>
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-200 ${
                variantsOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
          {variantsOpen && (
            <div
              className={`relative z-20 mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 ${
                enabledCount === 0 ? 'border-accent/30 bg-accent/[0.04]' : 'border-white/[0.08]'
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
                      onToggleVariant ? onToggleVariant(variant.id) : onSelect(variant.id)
                    }
                    aria-pressed={variant.enabled}
                    title={variant.enabled ? `Disable: ${label}` : `Enable: ${label}`}
                    className={`max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
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
        </>
      )}
    </div>
  );
}

/** One skin group as a compact thumbnail row (Locker list view). */
function SkinGroupRow({
  group,
  onSelect,
  onToggleVariant,
  hideNsfwPreviews,
  useHeroPortraitThumbnails,
  heroName,
  soundVolume,
}: {
  group: SkinGroup;
  onSelect: (modId: string) => void;
  onToggleVariant?: (modId: string) => void;
  hideNsfwPreviews: boolean;
  useHeroPortraitThumbnails: boolean;
  heroName?: string;
  soundVolume: number;
}) {
  const isMulti = group.variants.length > 1;
  const groupActive = group.variants.some((v) => v.enabled);
  const enabledCount = group.variants.filter((v) => v.enabled).length;
  const primary = group.primary;
  return (
    <div
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
            heroPortrait={useHeroPortraitThumbnails ? heroName : undefined}
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
                  onToggleVariant ? onToggleVariant(variant.id) : onSelect(variant.id)
                }
                aria-pressed={variant.enabled}
                title={variant.enabled ? `Disable: ${label}` : `Enable: ${label}`}
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
  layout = 'list',
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

  const groupProps = {
    onSelect,
    onToggleVariant,
    hideNsfwPreviews,
    useHeroPortraitThumbnails,
    heroName,
    soundVolume,
  };

  return (
    <div className="space-y-2">
      {hasMods ? (
        <>
          {layout === 'cards' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <SkinGroupCard key={group.key} group={group} {...groupProps} />
              ))}
            </div>
          ) : (
            groups.map((group) => <SkinGroupRow key={group.key} group={group} {...groupProps} />)
          )}
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
