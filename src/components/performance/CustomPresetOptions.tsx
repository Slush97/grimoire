import { useTranslation } from 'react-i18next';
import type { PerformancePresetSummary } from '../../types/electron';
import { Button, Toggle } from '../common/ui';

interface Props {
  preset: PerformancePresetSummary;
  selected: string[];
  disabled: boolean;
  onChange: (keys: string[]) => void;
  onEdit: () => void;
}

export default function CustomPresetOptions({ preset, selected, disabled, onChange, onEdit }: Props) {
  const { t } = useTranslation();
  const custom = preset.custom!;
  return <div className="space-y-3 border-t border-border px-5 py-4">
    {custom.toggles.map((toggle) => <Toggle key={toggle.key} label={toggle.label} checked={selected.includes(toggle.key)} disabled={disabled}
      onChange={(on) => onChange(on ? [...selected, toggle.key] : selected.filter((key) => key !== toggle.key))} />)}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 break-words text-xs text-text-secondary">{t('performance.custom.savedFrom', { repo: preset.upstream.repo })}</p>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={onEdit}>{t('performance.custom.details')}</Button>
    </div>
    {custom.addons.length > 0 && <p className="text-xs text-text-secondary">{t('performance.custom.addonsInDetails', { count: custom.addons.length })}</p>}
  </div>;
}
