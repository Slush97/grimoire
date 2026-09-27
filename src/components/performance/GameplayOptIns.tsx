import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ToggleIndicator } from '../common/ui';
import type { PerformanceOptIn } from '../../types/electron';

interface GameplayOptInsProps {
  /** The chosen release's opt-in controls. Passed in rather than read off a
   *  preset, because these differ between releases of the same preset: rolling
   *  back must offer the toggles that release actually defines. */
  controls: PerformanceOptIn[];
  /** Creator convar keys currently included for this preset. */
  selected: string[];
  /** What each opt-in key is actually set to in gameinfo.gi right now, so a
   *  hand edit or a line left behind is visible instead of the preset value. */
  fileValues?: Record<string, string>;
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}

const GROUP_ORDER: PerformanceOptIn['group'][] = ['visibility', 'camera', 'devtools'];

/**
 * The gameplay/visibility convars a preset's author set, as one table per
 * group. Visibility and camera values follow the creator by default but stay
 * individually removable; developer/testing controls require explicit opt-in.
 */
export default function GameplayOptIns({
  controls,
  selected,
  fileValues,
  onChange,
  disabled,
}: GameplayOptInsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<PerformanceOptIn['group']>>(() => new Set(['visibility']));
  if (controls.length === 0) return null;

  const enabled = new Set(selected);
  const toggle = (key: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(key);
    else next.delete(key);
    onChange(controls.filter((c) => next.has(c.key)).map((c) => c.key));
  };
  const toggleGroup = (group: PerformanceOptIn['group']) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const groups = GROUP_ORDER.map((group) => ({
    group,
    controls: controls.filter((c) => c.group === group),
  })).filter((g) => g.controls.length > 0);

  return (
    <div>
      <p className="text-sm font-medium text-text-primary">
        {t('performance.optIn.title')}{' '}
        <span className="font-normal text-text-secondary">
          {t('performance.optIn.count', { count: controls.length, enabled: enabled.size })}
        </span>
      </p>
      <p className="mt-1 text-xs text-text-secondary">{t('performance.optIn.description')}</p>

      <div className="mt-3 space-y-2">
        {groups.map(({ group, controls }) => {
          const expanded = open.has(group);
          return (
            <div key={group} className="rounded-sm border border-border">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={expanded}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary transition-colors hover:bg-hl/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
                {t(`performance.optIn.group.${group}`)}
              </button>
              {expanded && (
                <table className="w-full border-t border-border text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-secondary">
                      <th className="px-3 py-2 font-normal">{t('performance.optIn.variable')}</th>
                      <th className="px-3 py-2 font-normal">{t('performance.optIn.value')}</th>
                      <th className="w-16 px-3 py-2">
                        <span className="sr-only">{t('performance.optIn.include')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {controls.map((control) => {
                      const on = enabled.has(control.key);
                      const inFile = fileValues?.[control.key];
                      return (
                        <tr key={control.key} className="border-t border-hl/5">
                          <td className="px-3 py-2 font-mono text-xs text-text-primary break-all">{control.key}</td>
                          <td className="px-3 py-2 text-xs text-text-secondary">
                            {inFile !== undefined && !on ? (
                              <span className="text-state-warning">{t('performance.optIn.stray', { value: inFile })}</span>
                            ) : inFile !== undefined && inFile !== control.value ? (
                              <>
                                <span className="font-mono text-text-primary">{inFile}</span>
                                <span className="block">{t('performance.optIn.authorValue', { value: control.value })}</span>
                              </>
                            ) : (
                              <span className="font-mono">{control.value}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <label
                              className={`group inline-flex ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                role="switch"
                                className="peer sr-only"
                                checked={on}
                                disabled={disabled}
                                onChange={(e) => toggle(control.key, e.target.checked)}
                                aria-label={control.key}
                              />
                              <ToggleIndicator
                                checked={on}
                                disabled={disabled}
                                className="peer-focus-visible:ring-2 peer-focus-visible:ring-accent/70"
                              />
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
