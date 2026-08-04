import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Eye } from 'lucide-react';
import { Toggle } from '../common/ui';
import type { PerformanceOptIn } from '../../types/electron';

interface GameplayOptInsProps {
  /** The chosen release's opt-in controls. Passed in rather than read off a
   *  preset, because these differ between releases of the same preset: rolling
   *  back must offer the toggles that release actually defines. */
  controls: PerformanceOptIn[];
  /** Creator convar keys currently included for this preset. */
  selected: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}

const GROUP_ORDER: PerformanceOptIn['group'][] = ['visibility', 'camera', 'devtools'];

/**
 * The gameplay/visibility convars a preset's author set. Visibility and camera
 * values follow the creator by default but stay individually removable;
 * developer/testing controls require explicit opt-in.
 *
 * These are separated from the generated performance body so the user can see
 * and customize them instead of receiving an opaque all-or-nothing preset.
 */
export default function GameplayOptIns({
  controls,
  selected,
  onChange,
  disabled,
}: GameplayOptInsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (controls.length === 0) return null;

  const enabled = new Set(selected);
  const toggle = (key: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(key);
    else next.delete(key);
    onChange(controls.filter((c) => next.has(c.key)).map((c) => c.key));
  };

  const groups = GROUP_ORDER.map((group) => ({
    group,
    controls: controls.filter((c) => c.group === group),
  })).filter((g) => g.controls.length > 0);

  return (
    <div className="rounded-sm border border-white/5 bg-bg-tertiary/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium text-text-primary">
            {t('performance.optIn.title')}
          </span>
          <span className="text-xs text-text-secondary">
            {t('performance.optIn.count', {
              count: controls.length,
              enabled: enabled.size,
            })}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3">
          <p className="text-xs text-text-secondary">{t('performance.optIn.description')}</p>
          {groups.map(({ group, controls }) => (
            <div key={group} className="space-y-2">
              <p className="text-xs font-medium text-text-primary">
                {t(`performance.optIn.group.${group}`)}
              </p>
              {controls.map((control) => (
                <Toggle
                  key={control.key}
                  checked={enabled.has(control.key)}
                  onChange={(on) => toggle(control.key, on)}
                  disabled={disabled}
                  label={<span className="font-mono text-xs">{control.key}</span>}
                  description={t('performance.optIn.presetValue', { value: control.value })}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
