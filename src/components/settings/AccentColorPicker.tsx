import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Pipette } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useAppStore } from '../../stores/appStore';
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR, applyAccentColor } from '../../lib/accentColor';
import { Button } from '../common/ui';
import { useBackdropDismiss } from '../common/useBackdropDismiss';
import Tx from '../translation/Tx';

const SWATCH_BASE =
  'relative flex items-center justify-center w-9 h-9 rounded-sm border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary';

/**
 * The UI accent: preset swatches plus a custom hex pick.
 *
 * Picks apply optimistically (the CSS var is written before the settings
 * round-trip) so the app re-themes on click. The custom picker only writes
 * settings.json once, on commit, rather than on every frame of a drag.
 */
export default function AccentColorPicker() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useAppStore();
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<string | null>(null);

  const handleAccentChange = async (color: string) => {
    // Apply optimistically so the UI re-themes the moment the swatch is
    // clicked, even before the settings round-trip finishes. The store push
    // in saveSettings re-triggers Layout's effect, but doing it here too
    // avoids a perceptible flash on slower disks.
    applyAccentColor(color);
    if (settings) {
      await saveSettings({ ...settings, accentColor: color });
    }
  };

  const handleCustomDraft = (color: string) => {
    applyAccentColor(color);
    setCustomDraft(color);
  };

  const commitCustomDraft = useCallback(async () => {
    setCustomPickerOpen(false);
    if (customDraft && settings && customDraft.toLowerCase() !== settings.accentColor?.toLowerCase()) {
      await saveSettings({ ...settings, accentColor: customDraft });
    }
    setCustomDraft(null);
  }, [customDraft, settings, saveSettings]);

  const openCustomPicker = () => {
    setCustomDraft(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
    setCustomPickerOpen(true);
  };

  useEffect(() => {
    if (!customPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void commitCustomDraft();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [customPickerOpen, commitCustomDraft]);

  // Dismiss on backdrop click, but not when the gesture merely ends there
  // (drag-selecting the hex field and releasing outside used to commit).
  const customPickerBackdropRef = useBackdropDismiss<HTMLDivElement>(
    useCallback(() => void commitCustomDraft(), [commitCustomDraft]),
    customPickerOpen
  );

  const current = (settings?.accentColor ?? DEFAULT_ACCENT_COLOR).toLowerCase();
  const isCustomActive = !ACCENT_PRESETS.some((p) => p.color.toLowerCase() === current);
  const customDisplay = customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR;

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          <Tx k="settings.appearance.accent.title" fallback="Accent color" />
        </h3>
        <p className="text-xs text-text-secondary">
          <Tx
            k="settings.appearance.accent.description"
            fallback="Used for buttons, links, highlights, and focus rings throughout the app."
          />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((preset) => {
          const isActive = current === preset.color.toLowerCase();
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleAccentChange(preset.color)}
              title={preset.name}
              aria-label={t('settings.appearance.accentNamed', { name: preset.name })}
              aria-pressed={isActive}
              className={`${SWATCH_BASE} ${isActive ? 'border-hl/40' : 'border-hl/10 hover:border-hl/30'}`}
              style={{ backgroundColor: preset.color }}
            >
              {isActive && <Check className="w-4 h-4 text-black/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" />}
            </button>
          );
        })}

        <button
          type="button"
          onClick={openCustomPicker}
          title={t('settings.appearance.pickCustomColor')}
          aria-label={t('settings.appearance.accentCustom')}
          aria-pressed={isCustomActive}
          aria-haspopup="dialog"
          className={`${SWATCH_BASE} ${isCustomActive ? 'border-hl/40' : 'border-hl/10 hover:border-hl/30'}`}
          style={
            isCustomActive
              ? { backgroundColor: customDisplay }
              : { background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }
          }
        >
          <Pipette className="w-3.5 h-3.5 text-black/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" />
        </button>
      </div>

      {customPickerOpen && createPortal(
        <div
          ref={customPickerBackdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          role="presentation"
        >
          <div
            className="bg-bg-secondary border border-hl/10 rounded-sm p-6 w-full max-w-sm relative overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.appearance.customAccentColor')}
          >
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <h3 className="text-lg font-semibold text-text-primary tracking-wide font-reaver mb-4 flex items-center gap-2">
              <Pipette className="w-4 h-4 text-accent-ink" />
              <Tx k="settings.appearance.customAccent" fallback="Custom Accent" />
            </h3>
            <div className="space-y-4">
              <HexColorPicker
                color={customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR}
                onChange={handleCustomDraft}
                style={{ width: '100%' }}
              />
              <div className="flex items-center gap-2">
                <span
                  className="block w-9 h-9 rounded-sm border border-hl/10 shrink-0"
                  style={{ backgroundColor: customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR }}
                  aria-label={t('settings.appearance.selectedColorPreview')}
                />
                <span className="text-xs text-text-secondary font-mono">#</span>
                <HexColorInput
                  color={customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR}
                  onChange={handleCustomDraft}
                  className="flex-1 bg-bg-tertiary border border-hl/5 rounded-sm px-2 py-1.5 text-sm font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent uppercase"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
                    setCustomDraft(null);
                    setCustomPickerOpen(false);
                  }}
                >
                  <Tx k="common.actions.cancel" fallback="Cancel" />
                </Button>
                <Button variant="primary" size="sm" onClick={() => void commitCustomDraft()}>
                  <Tx k="common.actions.apply" fallback="Apply" />
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
