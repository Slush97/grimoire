import type { Mod } from '../../types/mod';
import type { MinaPreset, MinaSelection, MinaVariant } from '../../lib/lockerUtils';
import ModThumbnail from '../ModThumbnail';
import DownloadableSkinsSection from './DownloadableSkinsSection';

interface HeroSkinsPanelProps {
  mods: Mod[];
  onSelect: (modId: string) => void;
  hideNsfwPreviews?: boolean;
  categoryId?: number;
  onRefreshMods?: () => void;
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
  hideNsfwPreviews = false,
  categoryId,
  onRefreshMods,
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
  const activeMod = mods.find((mod) => mod.enabled);

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
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${preset.enabled ? 'border-accent bg-bg-tertiary' : 'border-border hover:border-accent/60'
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
                    const path = await window.api.downloadMinaVariations();
                    onMinaArchivePathChange?.(path);
                    onLoadMinaVariants?.();
                  } catch (err) {
                    console.error('Download failed:', err);
                    onMinaArchivePathChange?.('');
                  }
                }}
                className="w-full px-3 py-2 text-xs rounded-md bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
              >
                Download Outfit Presets (252MB)
              </button>
            </div>
          ) : minaArchivePath === 'Downloading...' ? (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span>Downloading variations archive... (this may take a few minutes)</span>
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
                  className="px-3 py-1 text-xs rounded-md border border-border hover:border-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="ml-2 px-3 py-1 rounded-md border border-border text-xs hover:border-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
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
        mods.map((mod) => (
          <button
            key={mod.id}
            onClick={() => onSelect(mod.id)}
            className={`w-full flex items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${mod.enabled ? 'border-accent bg-bg-tertiary' : 'border-border hover:border-accent/60'
              }`}
            title={mod.enabled ? 'Active skin' : 'Set active'}
          >
            <div className="w-10 h-10 rounded-md overflow-hidden bg-bg-tertiary flex-shrink-0">
              <ModThumbnail
                src={mod.thumbnailUrl}
                alt={mod.name}
                nsfw={mod.nsfw}
                hideNsfw={hideNsfwPreviews}
                className="w-full h-full"
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-text-secondary text-[10px]">
                    No preview
                  </div>
                }
              />
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{mod.name}</div>
              <div className="text-xs text-text-secondary truncate">{mod.fileName}</div>
            </div>
            {activeMod?.id === mod.id && (
              <span className="ml-auto text-xs text-accent font-semibold">Active</span>
            )}
          </button>
        ))
      ) : (
        <div className="text-xs text-text-secondary">
          Download a skin for this hero to manage it here.
        </div>
      )}

      {categoryId && onRefreshMods && (
        <DownloadableSkinsSection
          categoryId={categoryId}
          installedModIds={mods.map((m) => m.gameBananaId).filter((id): id is number => id !== undefined)}
          hideNsfwPreviews={hideNsfwPreviews}
          onDownloadComplete={onRefreshMods}
        />
      )}
    </div>
  );
}
