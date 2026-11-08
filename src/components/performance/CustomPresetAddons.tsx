import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PerformancePresetSummary } from '../../types/electron';
import { useAppStore } from '../../stores/appStore';
import { formatBytes } from '../../lib/formatBytes';
import { Button } from '../common/ui';
import PerformancePresetError from './PerformancePresetError';

interface Props {
  preset: PerformancePresetSummary;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<void>;
  onReview?: () => void;
}

export default function CustomPresetAddons({ preset, disabled, onBusy, onChanged, onReview }: Props) {
  const { t } = useTranslation();
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<string[]>([]);
  const [needsReview, setNeedsReview] = useState<string[]>([]);
  const [error, setError] = useState<{ path: string; error: unknown } | null>(null);
  const history = new Set([...(preset.custom!.importedAddons ?? []), ...imported]);
  const install = async (path: string) => {
    if (importing || disabled) return;
    setImporting(path); onBusy(true); setError(null);
    try {
      const result = await window.electronAPI.importPerformanceAddon(preset.id, path);
      const failure = result.results.find((entry) => !entry.ok);
      if (failure) throw new Error(failure.error);
      if (!result.results.length) throw new Error(t('performance.custom.errors.generic'));
      if (result.results.some((entry) => entry.needsReview)) setNeedsReview((before) => [...before, path]);
      setImported((before) => [...before, path]);
      await useAppStore.getState().loadMods({ force: true, afterCurrent: true });
      await onChanged();
    } catch (err) { setError({ path, error: err }); }
    finally { setImporting(null); onBusy(false); }
  };
  return <section className="space-y-3 border-t border-border pt-4">
    <h3 className="text-sm font-medium text-text-primary">{t('performance.custom.addons', { count: preset.custom!.addons.length })}</h3>
    <p className="text-xs text-text-secondary">{t('performance.custom.addonsDescription')}</p>
    <a href={preset.upstream.url} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline">{t('performance.custom.authorInstructions')}</a>
    <div className="divide-y divide-border">
      {preset.custom!.addons.map((addon) => {
        const parts = addon.path.split('/');
        const filename = parts.pop()!;
        return <div key={addon.path} className="space-y-2 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all font-mono text-xs text-text-primary">{filename}</p>
              {parts.length > 0 && <p className="mt-1 break-words text-xs text-text-secondary">{parts.join('/')}</p>}
              <p className="mt-1 text-xs text-text-secondary">{formatBytes(addon.size)}{history.has(addon.path) && <> · {t('performance.custom.previouslyImported')}</>}</p>
            </div>
            <Button variant="secondary" size="sm" disabled={disabled || !!importing} isLoading={importing === addon.path} onClick={() => void install(addon.path)}>
              {history.has(addon.path) ? t('performance.custom.importAgain') : t('performance.custom.importAddon')}
            </Button>
          </div>
          {error?.path === addon.path && <PerformancePresetError error={error.error} />}
          {needsReview.includes(addon.path) && <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-xs text-text-secondary">{t('performance.custom.addonNeedsReview')}</p>
            {onReview && <Button variant="secondary" size="sm" disabled={disabled || !!importing} onClick={onReview}>{t('performance.custom.reviewAddon')}</Button>}
          </div>}
        </div>;
      })}
    </div>
  </section>;
}
