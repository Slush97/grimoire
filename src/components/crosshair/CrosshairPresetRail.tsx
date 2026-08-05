import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Trash2, X, XCircle } from 'lucide-react';
import type { CrosshairPreset } from '../../stores/crosshairStore';
import { Button } from '../common/ui';
import { Input } from '../common/forms';
import { showToast } from '../../stores/toastStore';
import Tx from '../translation/Tx';
import CrosshairPreview from './CrosshairPreview';

interface CrosshairPresetRailProps {
  presets: CrosshairPreset[];
  activePresetId: string | null;
  onLoad: (preset: CrosshairPreset) => void;
  onApply: (presetId: string) => void;
  onDelete: (presetId: string) => void;
  onSave: (name: string) => Promise<void>;
  onClearActive: () => void;
}

/**
 * Presets as a horizontal rail under the stage rather than a grid at the far
 * bottom of the page. Saving lives here too: the place you keep presets is the
 * place you'd look to make one, and the old header slot made the toolbar swap
 * itself for a text field mid-edit.
 */
export default function CrosshairPresetRail({
  presets,
  activePresetId,
  onLoad,
  onApply,
  onDelete,
  onSave,
  onClearActive,
}: CrosshairPresetRailProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [isNaming, setIsNaming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const commitSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave(name.trim());
      // Only on success: a failed write must not look like it worked by
      // clearing the name and closing the field.
      setName('');
      setIsNaming(false);
    } catch (error) {
      console.error('Failed to save crosshair preset:', error);
      showToast(t('crosshair.presets.saveFailed'), { tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-sm border border-hl/5 bg-bg-secondary/50 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hl/5 px-4 py-2.5">
        <h3 className="font-reaver text-sm tracking-wide text-text-primary">
          <Tx
            k="crosshair.presets.savedTitle"
            values={{ count: presets.length }}
            fallback={`Saved Presets (${presets.length})`}
          />
        </h3>
        <div className="flex items-center gap-2">
          {activePresetId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onClearActive}
              icon={XCircle}
              title={t('crosshair.presets.deselectTitle')}
            >
              <Tx k="crosshair.presets.deselectActive" fallback="Deselect Active" />
            </Button>
          )}
          {isNaming ? (
            <div className="flex items-center gap-2">
              <Input
                inputSize="sm"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('crosshair.presetNamePlaceholder')}
                className="w-40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSave();
                  if (e.key === 'Escape') setIsNaming(false);
                }}
                autoFocus
              />
              <Button size="sm" onClick={commitSave} disabled={!name.trim()} isLoading={isSaving}>
                <Tx k="common.actions.save" fallback="Save" />
              </Button>
              <button
                type="button"
                onClick={() => setIsNaming(false)}
                className="cursor-pointer text-text-secondary hover:text-text-primary"
                title={t('common.actions.cancel')}
                aria-label={t('common.actions.cancel')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setIsNaming(true)}>
              <Tx k="crosshair.actions.saveCurrent" fallback="Save current" />
            </Button>
          )}
        </div>
      </div>

      {presets.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-text-secondary">
          <Tx
            k="crosshair.presets.empty"
            fallback="No presets yet. Save the current crosshair to switch back to it later."
          />
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto p-3">
          {presets.map((preset) => {
            const isActive = preset.id === activePresetId;
            return (
              <div
                key={preset.id}
                className={`group relative h-24 w-24 shrink-0 overflow-hidden rounded-sm border bg-bg-tertiary transition-colors ${
                  isActive ? 'border-accent ring-1 ring-accent' : 'border-hl/5 hover:border-hl/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onLoad(preset)}
                  title={preset.name}
                  className="flex h-full w-full cursor-pointer items-center justify-center"
                >
                  <CrosshairPreview size={72} scale={1440 / 1080} settings={preset.settings} transparent />
                </button>

                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-3 text-center text-[10px] font-medium text-white/90">
                  {preset.name}
                </span>

                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-black/65 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => onApply(preset.id)}
                    className="cursor-pointer rounded-sm border border-accent/40 bg-accent/10 p-1.5 text-text-primary transition-colors hover:border-accent/60 hover:bg-accent/20"
                    title={t('crosshair.actions.applyToGame')}
                    aria-label={t('crosshair.actions.applyToGame')}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(preset.id)}
                    className="cursor-pointer rounded-sm bg-red-500/20 p-1.5 text-state-danger transition-colors hover:bg-red-500/40"
                    title={t('common.actions.delete')}
                    aria-label={t('common.actions.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
