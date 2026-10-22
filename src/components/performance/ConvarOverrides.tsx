import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Input } from '../common/forms';
import { Button, ToggleIndicator } from '../common/ui';
import type { PerformanceConvarPins, PerformanceConfigStatus } from '../../types/electron';

interface ConvarOverridesProps {
  /** Global pins, shared by every preset. Disabled pins keep their value. */
  overrides: PerformanceConvarPins;
  /** What each key currently holds in gameinfo.gi, when it is present there. */
  fileValues?: Record<string, string>;
  disabled?: boolean;
  onSet: (key: string, value: string) => Promise<PerformanceConfigStatus | null>;
  onToggle: (key: string, enabled: boolean) => Promise<PerformanceConfigStatus | null>;
  onRemove: (key: string) => Promise<PerformanceConfigStatus | null>;
}

const KEY_RE = /^[A-Za-z_][\w.]*$/;
// eslint-disable-next-line no-control-regex
const invalidValue = (value: string) => !value || value.includes('//') || /["\\{}\u0000-\u001f\u007f\u2028\u2029]/.test(value);

/**
 * Global convar pins, shared by every preset. Each row has its own on/off
 * toggle plus an edit button; disabling a pin keeps its value for later.
 */
export default function ConvarOverrides({
  overrides,
  fileValues,
  disabled,
  onSet,
  onToggle,
  onRemove,
}: ConvarOverridesProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const rows = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));
  const enabledCount = rows.filter(([, pin]) => pin.enabled).length;
  const busy = disabled || pending;

  const perform = async (action: () => Promise<PerformanceConfigStatus | null>) => {
    setPending(true);
    try {
      const result = await action();
      if (!result || result.state === 'error') {
        setError(result?.message ?? t('performance.overrides.failed'));
        return false;
      }
      setError(null);
      return true;
    } catch {
      setError(t('performance.overrides.failed'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const add = async () => {
    const convar = key.trim().replace(/^ConVars\//, '');
    if (!KEY_RE.test(convar)) {
      setError(t('performance.overrides.invalidKey'));
      return;
    }
    const pinned = value.trim();
    if (invalidValue(pinned)) {
      setError(t('performance.overrides.invalidValue'));
      return;
    }
    if (await perform(() => onSet(convar, pinned))) {
      setKey('');
      setValue('');
    }
  };

  const save = async (convar: string) => {
    const pinned = draft.trim();
    if (invalidValue(pinned)) {
      setError(t('performance.overrides.invalidValue'));
      return;
    }
    if (await perform(() => onSet(convar, pinned))) setEditing(null);
  };

  const remove = async (convar: string) => {
    if (await perform(() => onRemove(convar))) {
      if (editing === convar) setEditing(null);
    }
  };

  const toggle = async (convar: string, enabled: boolean) => {
    await perform(() => onToggle(convar, enabled));
  };

  return (
    <div className="border-t border-hl/5 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('performance.overrides.title')}</p>
          <p className="mt-0.5 text-xs text-text-secondary">{t('performance.overrides.description')}</p>
        </div>
        {rows.length > 0 && (
          <span className="text-xs text-text-secondary">
            {t('performance.overrides.count', { count: rows.length, enabled: enabledCount })}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-text-secondary">{t('performance.overrides.empty')}</p>
        )}
        {rows.map(([convar, pin]) => {
          const inFile = fileValues?.[convar];
          return (
            <div
              key={convar}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-border px-3 py-2"
            >
              <label
                className={`group inline-flex shrink-0 ${busy ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  role="switch"
                  className="peer sr-only"
                  checked={pin.enabled}
                  disabled={busy}
                  onChange={(e) => void toggle(convar, e.target.checked)}
                  aria-label={t('performance.overrides.toggle', { key: convar })}
                />
                <ToggleIndicator
                  checked={pin.enabled}
                  disabled={busy}
                  className="peer-focus-visible:ring-2 peer-focus-visible:ring-accent/70"
                />
              </label>
              <code
                className={`min-w-0 break-all font-mono text-xs ${
                  pin.enabled ? 'text-text-primary' : 'text-text-tertiary'
                }`}
              >
                {convar}
              </code>
              <span className="text-xs text-text-secondary">=</span>
              {editing === convar ? (
                <>
                  <div className="w-40">
                    <Input
                      inputSize="sm"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void save(convar);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="font-mono"
                      aria-label={t('performance.overrides.value')}
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus
                    />
                  </div>
                  <Button size="sm" type="button" onClick={() => void save(convar)} disabled={busy}>
                    {t('performance.overrides.save')}
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                  >
                    {t('performance.overrides.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <code
                    className={`font-mono text-xs ${
                      pin.enabled ? 'text-accent' : 'text-text-tertiary'
                    }`}
                  >
                    {pin.value}
                  </code>
                  {inFile !== undefined && inFile !== pin.value && (
                    <span className="text-xs text-text-secondary">
                      {t('performance.overrides.fileValue', { value: inFile })}
                    </span>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setEditing(convar);
                        setDraft(pin.value);
                      }}
                      disabled={busy}
                    >
                      {t('performance.overrides.change')}
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      icon={Trash2}
                      onClick={() => void remove(convar)}
                      disabled={busy}
                      title={t('performance.overrides.removeHint')}
                    >
                      {t('performance.overrides.remove')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex w-52 flex-col gap-1 text-xs text-text-secondary">
          {t('performance.overrides.key')}
          <Input
            inputSize="sm"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('performance.overrides.keyPlaceholder')}
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-xs text-text-secondary">
          {t('performance.overrides.value')}
          <Input
            inputSize="sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
            placeholder={t('performance.overrides.valuePlaceholder')}
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <Button size="sm" type="button" onClick={() => void add()} disabled={busy}>
          {t('performance.overrides.pin')}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-state-danger">{error}</p>}
    </div>
  );
}
