import { useTranslation } from 'react-i18next';
import { Select, FormField } from '../common/forms';
import type { PerformancePresetSummary } from '../../types/electron';

interface PresetPickerProps {
  presets: PerformancePresetSummary[];
  selectedId: string;
  onSelect: (presetId: string) => void;
  disabled?: boolean;
}

/**
 * Preset selector. What the chosen preset actually is (tier, size, provenance)
 * is PresetSummary's job, so this stays a plain labelled control that can sit
 * next to the version picker in one row.
 */
export default function PresetPicker({
  presets,
  selectedId,
  onSelect,
  disabled,
}: PresetPickerProps) {
  const { t } = useTranslation();
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0];
  if (!selected) return null;

  return (
    <FormField label={t('performance.preset.label')}>
      <Select value={selected.id} disabled={disabled} onChange={(e) => onSelect(e.target.value)}>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
