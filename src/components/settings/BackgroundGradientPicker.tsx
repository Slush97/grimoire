import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Ban, Check, Pipette } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useAppStore } from '../../stores/appStore';
import {
  BACKGROUND_BASE,
  BACKGROUND_GRADIENT_PRESETS,
  applyBackgroundGradient,
  backgroundGradientPreviewCss,
  sameGradient,
  type BackgroundGradient,
} from '../../lib/backgroundGradient';
import { Button, SegmentedControl } from '../common/ui';
import { useBackdropDismiss } from '../common/useBackdropDismiss';
import Tx from '../translation/Tx';

const CUSTOM_FALLBACK: BackgroundGradient = { from: '#8b5cf6', to: '#06b6d4' };

// Same 36px square as the accent swatches directly above, so the two picker
// rows read as one control group instead of two differently-sized grids.
const TILE_BASE =
  'group relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-sm border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary';

/** A gradient swatch that shows the real thing, corner to corner. */
function GradientTile({
  gradient,
  active,
  label,
  onClick,
  children,
}: {
  gradient: BackgroundGradient | null;
  active: boolean;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`${TILE_BASE} ${active ? 'border-accent/70' : 'border-white/10 hover:border-white/30'}`}
      style={{ background: gradient ? backgroundGradientPreviewCss(gradient) : BACKGROUND_BASE }}
    >
      {children}
      {/* Ringed badge: it is accent-colored and the swatch under it can be any
          hue, so on the warm presets it would otherwise sit orange-on-amber.
          Only on the plain gradient tiles: at this size the badge would collide
          with a centered icon, so tiles that carry one (none, custom) show
          their active state through the border alone, as the accent picker's
          custom swatch does. */}
      {active && !children && (
        <span className="absolute right-0.5 top-0.5 rounded-sm bg-accent p-0.5 text-accent-foreground ring-1 ring-black/40">
          <Check className="h-2.5 w-2.5" aria-hidden />
        </span>
      )}
    </button>
  );
}

/**
 * Background glow picker: presets plus a two-corner custom pick.
 *
 * Mirrors the accent-color row directly above it, including the live-preview
 * behaviour: dragging in the custom picker repaints the app immediately but
 * only writes settings.json on Apply, so a drag doesn't hammer the disk.
 */
export default function BackgroundGradientPicker() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useAppStore();
  const saved = settings?.backgroundGradient ?? null;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<BackgroundGradient>(CUSTOM_FALLBACK);
  const [corner, setCorner] = useState<'from' | 'to'>('from');

  const isPreset = !!saved && BACKGROUND_GRADIENT_PRESETS.some((p) => sameGradient(p, saved));
  const isCustomActive = !!saved && !isPreset;

  const select = async (gradient: BackgroundGradient | null) => {
    applyBackgroundGradient(gradient);
    if (settings) {
      await saveSettings({ ...settings, backgroundGradient: gradient });
    }
  };

  const openPicker = () => {
    setDraft(saved ?? CUSTOM_FALLBACK);
    setCorner('from');
    setPickerOpen(true);
  };

  const updateDraft = (color: string) => {
    const next = { ...draft, [corner]: color };
    setDraft(next);
    applyBackgroundGradient(next);
  };

  const cancel = useCallback(() => {
    setPickerOpen(false);
    applyBackgroundGradient(saved);
  }, [saved]);

  const commit = useCallback(async () => {
    setPickerOpen(false);
    applyBackgroundGradient(draft);
    if (settings && !sameGradient(draft, saved)) {
      await saveSettings({ ...settings, backgroundGradient: draft });
    }
  }, [draft, saved, settings, saveSettings]);

  useEffect(() => {
    if (!pickerOpen) return;
    // Escape commits, matching the accent picker directly above: both dismiss
    // gestures keep the pick, and Cancel is the one explicit way to revert.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void commit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen, commit]);

  // Clicking the backdrop commits, matching the accent picker's gesture.
  const backdropRef = useBackdropDismiss<HTMLDivElement>(
    useCallback(() => void commit(), [commit]),
    pickerOpen
  );

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          <Tx k="settings.appearance.background.title" fallback="Background glow" />
        </h3>
        <p className="text-xs text-text-secondary">
          <Tx
            k="settings.appearance.background.description"
            fallback="Tint the app background with light bleeding in from the top-left and bottom-right corners."
          />
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <GradientTile
          gradient={null}
          active={!saved}
          label={t('settings.appearance.background.none')}
          onClick={() => void select(null)}
        >
          <Ban className="h-4 w-4 text-text-secondary" aria-hidden />
        </GradientTile>

        {BACKGROUND_GRADIENT_PRESETS.map((preset) => (
          <GradientTile
            key={preset.id}
            gradient={preset}
            active={sameGradient(preset, saved)}
            label={preset.name}
            onClick={() => void select({ from: preset.from, to: preset.to })}
          />
        ))}

        <button
          type="button"
          onClick={openPicker}
          title={t('settings.appearance.background.custom')}
          aria-label={t('settings.appearance.background.custom')}
          aria-pressed={isCustomActive}
          aria-haspopup="dialog"
          className={`${TILE_BASE} ${isCustomActive ? 'border-accent/70' : 'border-white/10 hover:border-white/30'}`}
          style={
            isCustomActive
              ? { background: backgroundGradientPreviewCss(saved) }
              : { background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }
          }
        >
          <Pipette
            className={`h-3.5 w-3.5 ${isCustomActive ? 'text-text-primary' : 'text-black/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]'}`}
            aria-hidden
          />
        </button>
      </div>

      {pickerOpen && createPortal(
        <div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          role="presentation"
        >
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-sm border border-white/10 bg-bg-secondary p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.appearance.background.custom')}
          >
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <h3 className="mb-4 flex items-center gap-2 font-reaver text-lg font-semibold tracking-wide text-text-primary">
              <Pipette className="h-4 w-4 text-accent" aria-hidden />
              <Tx k="settings.appearance.background.customTitle" fallback="Custom background glow" />
            </h3>

            <div className="space-y-4">
              <div
                className="h-20 w-full rounded-sm border border-white/10"
                style={{ background: backgroundGradientPreviewCss(draft) }}
                aria-hidden
              />

              <SegmentedControl
                options={[
                  { value: 'from', label: t('settings.appearance.background.topLeft') },
                  { value: 'to', label: t('settings.appearance.background.bottomRight') },
                ]}
                value={corner}
                onChange={(value) => setCorner(value as 'from' | 'to')}
              />

              <HexColorPicker color={draft[corner]} onChange={updateDraft} style={{ width: '100%' }} />

              <div className="flex items-center gap-2">
                <span
                  className="block h-9 w-9 shrink-0 rounded-sm border border-white/10"
                  style={{ backgroundColor: draft[corner] }}
                  aria-hidden
                />
                <span className="font-mono text-xs text-text-secondary">#</span>
                <HexColorInput
                  color={draft[corner]}
                  onChange={updateDraft}
                  className="flex-1 rounded-sm border border-white/5 bg-bg-tertiary px-2 py-1.5 font-mono text-sm uppercase text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={cancel}>
                  <Tx k="common.actions.cancel" fallback="Cancel" />
                </Button>
                <Button variant="primary" size="sm" onClick={() => void commit()}>
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
