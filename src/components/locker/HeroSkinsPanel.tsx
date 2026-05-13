import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Mod } from '../../types/mod';
import { getLockerSkinKey, type MinaPreset, type MinaSelection, type MinaVariant } from '../../lib/lockerUtils';
import ModThumbnail from '../ModThumbnail';
import DownloadableSkinsSection from './DownloadableSkinsSection';
import { Skeleton } from '../common/Skeleton';

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
  minaPresets?: MinaPreset[];
  activeMinaPreset?: MinaPreset;
  minaTextures?: Mod[];
  onApplyMinaPreset?: (presetFileName: string) => void;
  minaArchivePath?: string;
  onMinaArchivePathChange?: (path: string) => void;
  minaVariants?: MinaVariant[];
  minaVariantsLoading?: boolean;
  minaVariantsError?: string | null;
  onLoadMinaVariants?: () => void;
  minaSelection?: MinaSelection;
  onMinaSelectionChange?: (selection: MinaSelection) => void;
  selectedMinaVariant?: MinaVariant;
  onApplyMinaVariant?: () => void;
}

export default function HeroSkinsPanel({
  mods,
  onSelect,
  onToggleVariant,
  hideNsfwPreviews = false,
  categoryId,
  minaPresets = [],
  activeMinaPreset,
  minaTextures = [],
  onApplyMinaPreset,
  minaArchivePath,
  onMinaArchivePathChange,
  minaVariants = [],
  minaVariantsLoading = false,
  minaVariantsError,
  onLoadMinaVariants,
  minaSelection,
  onMinaSelectionChange,
  selectedMinaVariant,
  onApplyMinaVariant,
}: HeroSkinsPanelProps) {
  const hasMods = mods.length > 0;
  const groups = useMemo(() => groupVariants(mods), [mods]);

  // TEMPORARY: Hide Mina variant customization UI until feature is stable
  const HIDE_MINA_VARIANTS = true;

  // Show variant selector when Midnight Mina textures are enabled OR a preset is active
  const hasEnabledMinaTextures = minaTextures.some((mod) => mod.enabled);
  const showMinaPresets = !HIDE_MINA_VARIANTS && minaPresets.length > 0 && Boolean(onApplyMinaPreset);
  const showMinaVariants =
    !HIDE_MINA_VARIANTS &&
    (Boolean(activeMinaPreset) || hasEnabledMinaTextures) &&
    Boolean(onLoadMinaVariants) &&
    Boolean(onMinaArchivePathChange) &&
    Boolean(minaSelection) &&
    Boolean(onMinaSelectionChange) &&
    Boolean(onApplyMinaVariant);

  return (
    <div className="space-y-2">
      {showMinaPresets && onApplyMinaPreset && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>Midnight Mina Preset</span>
            {activeMinaPreset ? (
              <span className="text-accent font-semibold">Active: {activeMinaPreset.label}</span>
            ) : (
              <span>No preset enabled</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2">
            {minaPresets.map((preset) => (
              <button
                key={preset.fileName}
                onClick={() => onApplyMinaPreset(preset.fileName)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors cursor-pointer ${preset.enabled ? 'border-accent bg-bg-tertiary' : 'border-border hover:border-accent/60'
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {minaTextures.length === 0 && (
            <div className="text-xs text-red-400">
              Missing textures VPK. Install the textures file to enable this preset.
            </div>
          )}
        </div>
      )}

      {showMinaVariants && minaArchivePath !== undefined && minaSelection && onMinaSelectionChange && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-xs text-text-secondary uppercase tracking-wider">Custom Variants</div>

          {/* Show download button or file path input */}
          {!minaArchivePath ? (
            <div className="space-y-2">
              <div className="text-xs text-text-secondary">
                Download the variations archive to unlock custom outfit options (252MB).
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    onMinaArchivePathChange?.('Downloading...');
                    const path = await window.electronAPI.downloadMinaVariations();
                    onMinaArchivePathChange?.(path);
                    onLoadMinaVariants?.();
                  } catch (err) {
                    console.error('Download failed:', err);
                    onMinaArchivePathChange?.('');
                  }
                }}
                className="w-full px-3 py-2 text-xs rounded-md border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary font-medium transition-colors cursor-pointer"
              >
                Download Outfit Presets (252MB)
              </button>
            </div>
          ) : minaArchivePath === 'Downloading...' ? (
            <div className="space-y-2" aria-busy="true" aria-live="polite">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span>Downloading variations archive... (this may take a few minutes)</span>
              </div>
              <Skeleton className="h-2 w-full" rounded="full" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={minaArchivePath}
                  onChange={(event) => onMinaArchivePathChange?.(event.target.value)}
                  placeholder="Path to variations.7z"
                  className="flex-1 bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs text-text-primary"
                />
                <button
                  type="button"
                  onClick={onLoadMinaVariants}
                  disabled={minaVariantsLoading || !minaArchivePath.trim()}
                  className="px-3 py-1 text-xs rounded-md border border-border hover:border-accent/60 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {minaVariantsLoading ? 'Loading…' : 'Load'}
                </button>
              </div>
              <div className="text-xs text-text-secondary">
                {minaVariantsLoading
                  ? 'Scanning presets…'
                  : minaVariants.length > 0
                    ? `${minaVariants.length} presets found`
                    : 'Click Load to scan for presets.'}
              </div>
              {minaVariantsLoading && (
                <div className="space-y-1.5" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="h-6 w-6" rounded="sm" />
                      <Skeleton className="h-2.5 flex-1" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {minaVariantsError && <div className="text-xs text-red-400">{minaVariantsError}</div>}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Futa</span>
              <select
                value={minaSelection.futa}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    futa: event.target.value as MinaSelection['futa'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Top</span>
              <select
                value={minaSelection.top}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    top: event.target.value as MinaSelection['top'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Sleeveless">Sleeveless</option>
                <option value="Default">Default</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Skirt</span>
              <select
                value={minaSelection.skirt}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    skirt: event.target.value as MinaSelection['skirt'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Default">Default</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Stockings</span>
              <select
                value={minaSelection.stockings}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    stockings: event.target.value as MinaSelection['stockings'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Default">Default</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Belt Sash</span>
              <select
                value={minaSelection.beltSash}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    beltSash: event.target.value as MinaSelection['beltSash'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Default">Default</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Gloves</span>
              <select
                value={minaSelection.gloves}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    gloves: event.target.value as MinaSelection['gloves'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Default">Default</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Garter</span>
              <select
                value={minaSelection.garter}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    garter: event.target.value as MinaSelection['garter'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Default">Default</option>
              </select>
            </label>
            <label className="text-[11px] text-text-secondary space-y-1">
              <span>Dress</span>
              <select
                value={minaSelection.dress}
                onChange={(event) =>
                  onMinaSelectionChange({
                    ...minaSelection,
                    dress: event.target.value as MinaSelection['dress'],
                  })
                }
                className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="None">None</option>
                <option value="Default">Default</option>
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between text-xs">
            {selectedMinaVariant ? (
              <span className="text-text-secondary truncate">{selectedMinaVariant.label}</span>
            ) : (
              <span className="text-red-400">No preset matches this selection.</span>
            )}
            <button
              type="button"
              onClick={onApplyMinaVariant}
              disabled={!selectedMinaVariant}
              className="ml-2 px-3 py-1 rounded-md border border-border text-xs hover:border-accent/60 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Apply
            </button>
          </div>
          {minaTextures.length === 0 && (
            <div className="text-xs text-red-400">
              Missing textures VPK. Install the textures file to enable this preset.
            </div>
          )}
        </div>
      )}

      {hasMods ? (
        groups.map((group) => {
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
        })
      ) : (
        <div className="text-xs text-text-secondary">
          Download a skin for this hero to manage it here.
        </div>
      )}

      {categoryId && <DownloadableSkinsSection categoryId={categoryId} />}
    </div>
  );
}
