import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pipette } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useAppStore } from '../../stores/appStore';
import {
  ACCENT_PRESETS,
  ACCENT_SWATCH_RULES,
  DEFAULT_ACCENT_COLOR,
  accentForeground,
  applyAccentColor,
  normalizeHex,
} from '../../lib/accentColor';
import { applyCustomSwatch, customSwatches, removeCustomSwatch, sameSwatches } from '../../lib/customSwatches';
import RemovableSwatch from './RemovableSwatch';
import { Button, ModalHeader } from '../common/ui';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import Tx from '../translation/Tx';

const SWATCH_BASE =
  'relative flex items-center justify-center w-9 h-9 rounded-sm border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary';

/**
 * The UI accent: preset swatches, the user's own swatches, and a pipette that
 * opens the hex picker. A picked color becomes a swatch of its own, so trying a
 * preset never loses it (the rules are in lib/customSwatches).
 *
 * Picks apply optimistically (the CSS var is written before the settings
 * round-trip) so the app re-themes on click. The custom picker only writes
 * settings.json once, on commit, rather than on every frame of a drag.
 */
export default function AccentColorPicker() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<string | null>(null);

  const current = normalizeHex(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
  const custom = customSwatches(settings?.customAccentColors, current, ACCENT_SWATCH_RULES);

  const handleCustomDraft = (color: string) => {
    applyAccentColor(color);
    setCustomDraft(color);
  };

  const commitCustomDraft = useCallback(async () => {
    setCustomPickerOpen(false);
    const color = customDraft ? normalizeHex(customDraft) : null;
    setCustomDraft(null);
    if (!color || !settings) return;
    const next = applyCustomSwatch(custom, current, color, ACCENT_SWATCH_RULES);
    if (color === current && sameSwatches(next, settings.customAccentColors ?? [], ACCENT_SWATCH_RULES)) return;
    await saveSettings({ ...settings, accentColor: color, customAccentColors: next });
  }, [customDraft, settings, saveSettings, custom, current]);

  const removeCustom = async (color: string) => {
    if (!settings) return;
    const next = removeCustomSwatch(custom, color, ACCENT_SWATCH_RULES);
    // Removing the color in use falls back to the default accent.
    const accentColor = color === current ? DEFAULT_ACCENT_COLOR : settings.accentColor;
    applyAccentColor(accentColor);
    await saveSettings({ ...settings, accentColor, customAccentColors: next });
  };

  const handleAccentChange = async (color: string) => {
    // Apply optimistically so the UI re-themes the moment the swatch is
    // clicked, even before the settings round-trip finishes. The store push
    // in saveSettings re-triggers Layout's effect, but doing it here too
    // avoids a perceptible flash on slower disks.
    applyAccentColor(color);
    if (settings) {
      // A custom color from before swatches existed is only derived while it
      // is active, so store the derived list or leaving it would lose it.
      await saveSettings({ ...settings, accentColor: color, customAccentColors: custom });
    }
  };

  const openCustomPicker = () => {
    setCustomDraft(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
    setCustomPickerOpen(true);
  };

  const customPickerTitleId = useId();
  // Dismissing (X, Escape, backdrop) cancels; only Apply saves.
  const cancelCustomPicker = () => {
    applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
    setCustomDraft(null);
    setCustomPickerOpen(false);
  };

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
              title={t(preset.nameKey)}
              aria-label={t('settings.appearance.accentNamed', { name: t(preset.nameKey) })}
              aria-pressed={isActive}
              className={`${SWATCH_BASE} ${isActive ? 'border-hl/40' : 'border-hl/10 hover:border-hl/30'}`}
              style={{ backgroundColor: preset.color }}
            >
              {isActive && <Check className="w-4 h-4" style={{ color: accentForeground(preset.color) }} />}
            </button>
          );
        })}

        {custom.map((color) => {
          const isActive = current === color;
          const name = color.toUpperCase();
          return (
            <RemovableSwatch
              key={color}
              removeLabel={t('settings.appearance.removeYourColor', { color: name })}
              onRemove={() => void removeCustom(color)}
            >
              <button
                type="button"
                onClick={() => handleAccentChange(color)}
                title={name}
                aria-label={t('settings.appearance.yourColor', { color: name })}
                aria-pressed={isActive}
                className={`${SWATCH_BASE} ${isActive ? 'border-hl/40' : 'border-hl/10 hover:border-hl/30'}`}
                style={{ backgroundColor: color }}
              >
                {isActive && <Check className="w-4 h-4" style={{ color: accentForeground(color) }} />}
              </button>
            </RemovableSwatch>
          );
        })}

        <button
          type="button"
          onClick={openCustomPicker}
          title={t('settings.appearance.pickCustomColor')}
          aria-label={t('settings.appearance.accentCustom')}
          aria-haspopup="dialog"
          className={`${SWATCH_BASE} border-hl/10 hover:border-hl/30`}
          style={{ background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }}
        >
          <Pipette className="w-3.5 h-3.5 text-black/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" />
        </button>
      </div>

      <Modal open={customPickerOpen} onClose={cancelCustomPicker} labelledBy={customPickerTitleId} size="none" panelClassName="max-w-sm">
        <ModalHeader
          title={<Tx k="settings.appearance.customAccent" fallback="Custom Accent" />}
          titleId={customPickerTitleId}
          onClose={cancelCustomPicker}
        />
        <ModalBody className="space-y-4">
          <HexColorPicker
            color={customDisplay}
            onChange={handleCustomDraft}
            style={{ width: '100%' }}
          />
          <div className="flex items-center gap-2">
            <span
              className="block w-9 h-9 rounded-sm border border-hl/10 shrink-0"
              style={{ backgroundColor: customDisplay }}
              aria-label={t('settings.appearance.selectedColorPreview')}
            />
            <span className="text-xs text-text-secondary font-mono">#</span>
            <HexColorInput
              color={customDisplay}
              onChange={handleCustomDraft}
              className="flex-1 bg-bg-tertiary border border-hl/5 rounded-sm px-2 py-1.5 text-sm font-mono text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent uppercase"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={cancelCustomPicker}
          >
            <Tx k="common.actions.cancel" fallback="Cancel" />
          </Button>
          <Button variant="primary" size="sm" onClick={() => void commitCustomDraft()}>
            <Tx k="common.actions.apply" fallback="Apply" />
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
