import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ExternalLink, GripVertical, ImagePlus, Trash2 } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Mod } from '../../types/mod';
import { getLockerSkinKey, modLoadOrder } from '../../lib/lockerUtils';
import { useAppStore } from '../../stores/appStore';
import ModThumbnail from '../ModThumbnail';
import AudioPreviewPlayer from '../AudioPreviewPlayer';
import DownloadableSkinsSection from './DownloadableSkinsSection';
import { LockerModImagePicker } from './LockerModImagePicker';

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

/** A group's enabled variant VPKs in load order (lower pak## first). */
function groupEnabledVariants(group: SkinGroup): Mod[] {
  return group.variants
    .filter((v) => v.enabled)
    .sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
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
  /** Request deletion of a whole skin group (all its variant VPKs). The page
   *  owns the confirmation dialog + the delete; the panel only asks. When
   *  omitted, no delete affordance is shown. */
  onRequestDelete?: (modIds: string[], name: string) => void;
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

/** One row of the Load order strip: a drag handle, position badge, thumbnail
 *  and name for an enabled skin group. */
function LoadOrderRow({
  group,
  position,
  hideNsfwPreviews,
  useHeroPortraitThumbnails,
  heroName,
}: {
  group: SkinGroup;
  position: number;
  hideNsfwPreviews: boolean;
  useHeroPortraitThumbnails: boolean;
  heroName?: string;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.key,
  });
  const primary = group.primary;
  const enabledCount = groupEnabledVariants(group).length;
  // The whole row is the drag handle (and keyboard-focusable via the sortable
  // attributes), so you can grab a skin anywhere on its card, not just a tiny
  // handle. touch-none keeps a drag from scrolling the sidebar mid-grab.
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={t('locker.skins.dragToReorder')}
      title={t('locker.skins.dragToReorder')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex touch-none items-center gap-2.5 rounded-md border px-2 py-1.5 transition-colors ${
        isDragging
          ? 'z-10 cursor-grabbing border-accent/40 bg-[#1c1c1c] opacity-95 shadow-lg shadow-black/40'
          : 'cursor-grab border-white/[0.08] bg-[#141414]/70 hover:border-white/[0.18] hover:bg-[#1a1a1a]/80'
      }`}
    >
      <GripVertical className="h-4 w-4 flex-shrink-0 text-white/40" aria-hidden />
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-semibold tabular-nums text-accent">
        {position}
      </span>
      <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded bg-bg-tertiary">
        <ModThumbnail
          src={primary.thumbnailUrl}
          alt={primary.name}
          nsfw={primary.nsfw}
          hideNsfw={hideNsfwPreviews}
          heroPortrait={useHeroPortraitThumbnails ? heroName : undefined}
          className="h-full w-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-white" title={primary.name}>
          {primary.name}
        </div>
        {enabledCount > 1 && (
          <div className="text-[10px] text-white/50">{`${enabledCount} files`}</div>
        )}
      </div>
    </div>
  );
}

/** Enabled skin groups for a hero in load order (top loads first / wins). */
function activeSkinGroups(mods: Mod[]): SkinGroup[] {
  return groupVariants(mods)
    .filter((g) => g.variants.some((v) => v.enabled))
    .sort(
      (a, b) =>
        modLoadOrder(groupEnabledVariants(a)[0]) - modLoadOrder(groupEnabledVariants(b)[0])
    );
}

/** Draggable list of the hero's currently-enabled skins. Top = loads first
 *  (pak01) = wins when two skins write the same file. Self-contained: pass the
 *  hero's skin `mods` and it renders nothing unless 2+ are active. Lives in the
 *  hero detail sidebar (see LockerHero), separate from the skin grid. */
export function SkinLoadOrderStrip({
  mods,
  onReorder,
  hideNsfwPreviews = false,
  useHeroPortraitThumbnails = false,
  heroName,
}: {
  mods: Mod[];
  onReorder: (orderedModIds: string[]) => void | Promise<void>;
  hideNsfwPreviews?: boolean;
  useHeroPortraitThumbnails?: boolean;
  heroName?: string;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => activeSkinGroups(mods), [mods]);
  // Local draft order so the list reflects a drop instantly instead of snapping
  // back while the rename round-trips through the main process. Re-synced from
  // props (the post-rescan order) only when the enabled SET changes (a skin was
  // enabled/disabled) — a pure reorder keeps the same set, so we keep our draft.
  // Adjusting state during render (vs an effect) is React's recommended pattern
  // for deriving state from props and avoids a cascading re-render.
  const propKeys = useMemo(() => groups.map((g) => g.key), [groups]);
  const [orderedKeys, setOrderedKeys] = useState<string[]>(propKeys);
  const [prevPropKeys, setPrevPropKeys] = useState<string[]>(propKeys);
  if (propKeys !== prevPropKeys) {
    setPrevPropKeys(propKeys);
    const sameSet =
      orderedKeys.length === propKeys.length && orderedKeys.every((k) => propKeys.includes(k));
    if (!sameSet) setOrderedKeys(propKeys);
  }

  const byKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);
  const orderedGroups = orderedKeys
    .map((k) => byKey.get(k))
    .filter((g): g is SkinGroup => Boolean(g));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = orderedKeys.indexOf(String(active.id));
    const newIndex = orderedKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextKeys = arrayMove(orderedKeys, oldIndex, newIndex);
    setOrderedKeys(nextKeys);
    const flatIds = nextKeys.flatMap((k) =>
      groupEnabledVariants(byKey.get(k)!).map((v) => v.id)
    );
    void onReorder(flatIds);
  };

  // Load order is only meaningful when 2+ skins are stacked.
  if (groups.length < 2) return null;

  return (
    <div className="animate-drop-in rounded-lg border border-white/[0.08] bg-black/20 p-2.5 backdrop-blur-sm">
      <div className="mb-2 px-0.5">
        <div className="text-xs font-semibold text-white">{t('locker.skins.loadOrder')}</div>
        <div className="text-[11px] leading-snug text-white/60">
          {t('locker.skins.loadOrderHint')}
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedKeys} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {orderedGroups.map((group, i) => (
              <LoadOrderRow
                key={group.key}
                group={group}
                position={i + 1}
                hideNsfwPreviews={hideNsfwPreviews}
                useHeroPortraitThumbnails={useHeroPortraitThumbnails}
                heroName={heroName}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/** One skin group as a media card (hero detail view). Every card holds the same
 *  height (media + title + a fixed status row); the variant chooser opens as a
 *  floating popover so expanding it never reflows the grid. */
function SkinGroupCard({
  group,
  onSelect,
  onToggleVariant,
  onRequestDelete,
  hideNsfwPreviews,
  useHeroPortraitThumbnails,
  heroName,
  soundVolume,
  loadOrderPosition,
  overrideSrc,
  onPickImage,
}: {
  group: SkinGroup;
  onSelect: (modId: string) => void;
  onToggleVariant?: (modId: string) => void;
  onRequestDelete?: (modIds: string[], name: string) => void;
  hideNsfwPreviews: boolean;
  useHeroPortraitThumbnails: boolean;
  heroName?: string;
  soundVolume: number;
  /** 1-based load-order position, shown as a corner chip. Only set when 2+
   *  skins are active for the hero (otherwise order is meaningless). */
  loadOrderPosition?: number;
  /** Issue #208: user-chosen Locker image for this skin (data URL), if any. */
  overrideSrc?: string;
  /** Open the image picker for this skin. Omitted for sound mods. */
  onPickImage?: () => void;
}) {
  const { t } = useTranslation();
  const isMulti = group.variants.length > 1;
  const groupActive = group.variants.some((v) => v.enabled);
  const enabledCount = group.variants.filter((v) => v.enabled).length;
  const primary = group.primary;
  // The user's chosen image wins over the uploader's thumbnail (issue #208).
  const displaySrc = overrideSrc ?? primary.thumbnailUrl;
  const cardRef = useRef<HTMLDivElement>(null);
  const [variantsOpen, setVariantsOpen] = useState(false);
  // Close the variant popover on any click outside the card.
  useEffect(() => {
    if (!variantsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setVariantsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [variantsOpen]);
  // Skipped when NSFW previews are hidden so we never bleed hidden imagery
  // into the glass tint, even blurred.
  const glassBackdropUrl =
    displaySrc && !(primary.nsfw && hideNsfwPreviews) ? displaySrc : null;

  return (
    <div
      ref={cardRef}
      className={`group/card relative flex flex-col rounded-[10px] border p-2.5 transition-[border-color,background-color,box-shadow] duration-200 ${
        groupActive
          ? 'border-accent bg-white/[0.02] hover:bg-white/[0.04]'
          : 'border-white/[0.08] bg-[#141414]/55 text-text-primary/75 hover:border-white/[0.16] hover:text-text-primary'
      } ${variantsOpen ? 'z-20' : ''}`}
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
            src={displaySrc}
            alt={primary.name}
            nsfw={overrideSrc ? false : primary.nsfw}
            hideNsfw={hideNsfwPreviews}
            heroPortrait={overrideSrc ? undefined : useHeroPortraitThumbnails ? heroName : undefined}
            className="h-full w-full"
            imageClassName="origin-center transform-gpu will-change-transform transition-transform duration-200 group-hover/card:scale-[1.03]"
            fallback={
              <div className="flex h-full w-full items-center justify-center text-xs text-text-secondary">
                {t('locker.skins.noPreview')}
              </div>
            }
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover/card:bg-bg-primary/20" />
        {groupActive && (
          <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-foreground">
            {t('common.status.active')}
          </span>
        )}
        {loadOrderPosition !== undefined && (
          <span
            className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-black/65 px-1.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm"
            title={t('locker.skins.loadOrderPosition', { position: loadOrderPosition })}
          >
            {`#${loadOrderPosition}`}
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
          open/close the variant popover for multi. Sits under the popover/audio
          (z-30) so those keep their own handlers. */}
      <button
        type="button"
        onClick={() => (isMulti ? setVariantsOpen((open) => !open) : onSelect(primary.id))}
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

      {/* Set Locker image (issue #208): pick this skin's view from its gallery
          or a custom upload. Hover-revealed; z-30 keeps it above the toggle. */}
      {onPickImage && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPickImage();
          }}
          aria-label={t('locker.modImage.set', { name: primary.name })}
          title={t('locker.modImage.set', { name: primary.name })}
          className={`absolute top-1.5 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white/90 opacity-0 backdrop-blur-sm transition-[opacity,background-color,color] duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/card:opacity-100 ${onRequestDelete ? 'right-9' : 'right-1.5'}`}
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Delete: removes the whole group (every variant VPK). Hover-revealed so
          it stays out of the way; z-30 keeps it above the full-card toggle. */}
      {onRequestDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(
              group.variants.map((v) => v.id),
              primary.name
            );
          }}
          aria-label={t('locker.skins.deleteSkin', { name: primary.name })}
          title={t('locker.skins.deleteSkin', { name: primary.name })}
          className="absolute right-1.5 top-1.5 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white/90 opacity-0 backdrop-blur-sm transition-[opacity,background-color,color] duration-150 hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover/card:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Sound preview. All variants of one GameBanana submission share the
          same preview clip, so the group's primary audioUrl is the
          representative sample. z-30 keeps it above the full-card toggle. */}
      {primary.sourceSection === 'Sound' && primary.audioUrl && (
        <div
          className="relative z-30 mt-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AudioPreviewPlayer src={primary.audioUrl} compact volume={soundVolume} />
        </div>
      )}

      {/* Fixed-height status row for multi-variant groups: a one-line summary
          that toggles the variant popover. Keeping it a single line means every
          card holds the same height; the popover floats (absolute) so opening
          it never reflows the grid. */}
      {isMulti && (
        <>
          <div
            className={`pointer-events-none mt-1 flex items-center gap-1 px-0.5 text-[11px] ${
              enabledCount === 0 ? 'text-accent' : 'text-text-secondary'
            }`}
          >
            <span>
              {enabledCount === 0
                ? t('locker.skins.pickAVariant')
                : `${enabledCount}/${group.variants.length} active`}
            </span>
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-200 ${variantsOpen ? 'rotate-180' : ''}`}
            />
          </div>
          {variantsOpen && (
            <div
              className="absolute left-2 right-2 top-full z-30 mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-white/[0.12] bg-bg-secondary/95 px-2 py-2 shadow-xl shadow-black/50 backdrop-blur-md"
              role="group"
              aria-label={t('locker.skins.variantToggles')}
              onMouseDown={(e) => e.stopPropagation()}
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
  onRequestDelete,
  hideNsfwPreviews,
  useHeroPortraitThumbnails,
  heroName,
  soundVolume,
  overrideSrc,
  onPickImage,
}: {
  group: SkinGroup;
  onSelect: (modId: string) => void;
  onToggleVariant?: (modId: string) => void;
  onRequestDelete?: (modIds: string[], name: string) => void;
  hideNsfwPreviews: boolean;
  useHeroPortraitThumbnails: boolean;
  heroName?: string;
  soundVolume: number;
  /** Issue #208: user-chosen Locker image for this skin (data URL), if any. */
  overrideSrc?: string;
  /** Open the image picker for this skin. Omitted for sound mods. */
  onPickImage?: () => void;
}) {
  const { t } = useTranslation();
  const isMulti = group.variants.length > 1;
  const groupActive = group.variants.some((v) => v.enabled);
  const enabledCount = group.variants.filter((v) => v.enabled).length;
  const primary = group.primary;
  // The user's chosen image wins over the uploader's thumbnail (issue #208).
  const displaySrc = overrideSrc ?? primary.thumbnailUrl;
  return (
    <div
      className={`group/row relative rounded-md border transition-colors ${
        groupActive
          ? 'border-accent/60 bg-white/[0.04] backdrop-blur-sm'
          : 'border-border bg-bg-secondary/70 hover:border-accent/60 hover:bg-bg-secondary/85'
      }`}
    >
      {onPickImage && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPickImage();
          }}
          aria-label={t('locker.modImage.set', { name: primary.name })}
          title={t('locker.modImage.set', { name: primary.name })}
          className={`absolute top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/90 opacity-0 backdrop-blur-sm transition-[opacity,background-color,color] duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/row:opacity-100 ${onRequestDelete ? 'right-10' : 'right-2'}`}
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
      )}
      {onRequestDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(
              group.variants.map((v) => v.id),
              primary.name
            );
          }}
          aria-label={t('locker.skins.deleteSkin', { name: primary.name })}
          title={t('locker.skins.deleteSkin', { name: primary.name })}
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/90 opacity-0 backdrop-blur-sm transition-[opacity,background-color,color] duration-150 hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
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
            src={displaySrc}
            alt={primary.name}
            nsfw={overrideSrc ? false : primary.nsfw}
            hideNsfw={hideNsfwPreviews}
            heroPortrait={overrideSrc ? undefined : useHeroPortraitThumbnails ? heroName : undefined}
            className="w-full h-full"
            fallback={
              <div className="w-full h-full flex items-center justify-center text-text-secondary text-[10px]">
                {t('locker.skins.noPreview')}
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
                <span>{t('locker.skins.pickAVariant')}</span>
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
          <span className="text-xs text-accent font-semibold">{t('common.status.active')}</span>
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
          aria-label={t('locker.skins.variantToggles')}
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
  onRequestDelete,
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
  const lockerModImages = useAppStore((s) => s.lockerModImages);
  // The "Locker image" (grid-thumbnail surface) the picker mirrors from.
  const lockerModThumbnails = useAppStore((s) => s.lockerModThumbnails);
  const groups = useMemo(() => groupVariants(mods), [mods]);
  // Issue #208: which skin's image picker is open (null = none). Skins only;
  // sound mods keep the hero-portrait thumbnail and get no picker.
  const [pickerGroup, setPickerGroup] = useState<SkinGroup | null>(null);
  const pickImageFor = (group: SkinGroup) =>
    group.primary.sourceSection === 'Sound' ? undefined : () => setPickerGroup(group);

  // Per-card #N chip: the load-order position of each active skin. Mirrors the
  // SkinLoadOrderStrip (now in the hero sidebar). The chip only shows when 2+
  // skins are active — a single active skin has no meaningful order.
  const loadOrderByKey = useMemo(() => {
    const map = new Map<string, number>();
    const active = groups
      .filter((g) => g.variants.some((v) => v.enabled))
      .sort(
        (a, b) =>
          modLoadOrder(groupEnabledVariants(a)[0]) - modLoadOrder(groupEnabledVariants(b)[0])
      );
    if (active.length >= 2) {
      active.forEach((g, i) => map.set(g.key, i + 1));
    }
    return map;
  }, [groups]);

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
    onRequestDelete,
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
                <SkinGroupCard
                  key={group.key}
                  group={group}
                  loadOrderPosition={loadOrderByKey.get(group.key)}
                  overrideSrc={lockerModImages[group.key]}
                  onPickImage={pickImageFor(group)}
                  {...groupProps}
                />
              ))}
            </div>
          ) : (
            groups.map((group) => (
              <SkinGroupRow
                key={group.key}
                group={group}
                overrideSrc={lockerModImages[group.key]}
                onPickImage={pickImageFor(group)}
                {...groupProps}
              />
            ))
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

      {pickerGroup && (
        <LockerModImagePicker
          mod={pickerGroup.primary}
          skinKey={pickerGroup.key}
          heroName={heroName ?? pickerGroup.primary.lockerHero ?? ''}
          lockerImageDataUrl={lockerModThumbnails[pickerGroup.key]}
          onClose={() => setPickerGroup(null)}
        />
      )}
    </div>
  );
}
