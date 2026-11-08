import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownSelect, FormField, Input } from '../common/forms';
import { ModalBody, ModalFooter } from '../common/Modal';
import { Button } from '../common/ui';
import type { PerformancePresetSummary } from '../../types/electron';
import type { CustomPerformanceToggle } from '../../types/performanceCustom';
import PerformancePresetError from './PerformancePresetError';

interface Props {
  preset: PerformancePresetSummary;
  busy: boolean;
  error: unknown;
  onSave: (toggles: CustomPerformanceToggle[]) => void;
  onCancel: () => void;
}

export default function CustomPresetToggleEditor({ preset, busy, error, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const formId = useId();
  const [toggles, setToggles] = useState(() => preset.custom!.toggles.map((toggle, rowId) => ({ ...toggle, rowId })));
  const nextRowId = useRef(toggles.length);
  const schema = toggles.map(({ key, label }) => ({ key, label }));
  const available = preset.custom!.availableConvars;
  const dirty = JSON.stringify(schema) !== JSON.stringify(preset.custom!.toggles);
  const valid = toggles.every((toggle) => toggle.label.trim()) && new Set(toggles.map((toggle) => toggle.key)).size === toggles.length;
  return <>
    <ModalBody className="space-y-4">
      <p className="text-sm text-text-secondary">{t('performance.custom.schemaDescription')}</p>
      <form id={formId} className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (valid && dirty && !busy) onSave(schema); }}>
        {toggles.map((toggle, index) => <div key={toggle.rowId} className="space-y-2 border-b border-border pb-4">
          <p className="text-sm text-text-secondary">{t('performance.custom.convar')}</p>
          <DropdownSelect value={toggle.key} disabled={busy} ariaLabel={t('performance.custom.convar')}
            options={available.filter((entry) => entry.key === toggle.key || !toggles.some((other) => other.key === entry.key))
              .map((entry) => ({ value: entry.key, label: `${entry.key} = ${entry.value}` }))}
            search={{ ariaLabel: t('performance.custom.searchSettings'), placeholder: t('performance.custom.searchSettings'),
              getEmptyMessage: () => t('performance.custom.noMatchingSettings'), clearLabel: t('common.actions.clear') }}
            onChange={(key) => setToggles(toggles.map((entry, i) => i === index ? { ...entry, key } : entry))} />
          <div className="flex items-end gap-2">
            <FormField label={t('performance.custom.toggleLabel')} hint={!toggle.label.trim() ? t('performance.custom.labelRequired') : undefined} className="min-w-0 flex-1">
              <Input value={toggle.label} placeholder={t('performance.custom.labelExample')} maxLength={100} disabled={busy}
                onChange={(event) => setToggles(toggles.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} />
            </FormField>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setToggles(toggles.filter((_, i) => i !== index))}>{t('common.actions.remove')}</Button>
          </div>
        </div>)}
        {!available.length && <p className="text-sm text-text-secondary">{t('performance.custom.noOptionalSettings')}</p>}
        <Button type="button" variant="secondary" disabled={busy || toggles.length >= Math.min(100, available.length)} onClick={() => {
          const next = available.find((entry) => !toggles.some((toggle) => toggle.key === entry.key));
          if (next) setToggles([...toggles, { key: next.key, label: '', rowId: nextRowId.current++ }]);
        }}>{t('performance.custom.addToggle')}</Button>
        {error !== null && <PerformancePresetError error={error} />}
      </form>
    </ModalBody>
    <ModalFooter>
      <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>{t('common.actions.cancel')}</Button>
      <Button type="submit" form={formId} disabled={!valid || !dirty} isLoading={busy}>{t('common.actions.save')}</Button>
    </ModalFooter>
  </>;
}
