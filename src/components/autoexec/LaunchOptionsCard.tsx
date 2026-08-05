import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Rocket, Save } from 'lucide-react';
import { getSettings, setSettings } from '../../lib/api';
import { Card, Button } from '../common/ui';
import { Input } from '../common/forms';
import Tx from '../translation/Tx';
import type { AppSettings } from '../../types/mod';
import type { SteamLaunchOptionsStatus } from '../../types/electron';

/**
 * Steam launch arguments.
 *
 * Separate from the autoexec editor it sits beside: these are process args
 * written into Steam's localconfig.vdf, not console commands in autoexec.cfg.
 * Self-contained so the page above it does not carry six pieces of state for a
 * concern it never reads.
 */
export default function LaunchOptionsCard() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<SteamLaunchOptionsStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    const load = async () => {
      const settings = await getSettings();
      setSaved(settings.steamLaunchOptions ?? '');
      setDraft(settings.steamLaunchOptions ?? '');
      try {
        setStatus(await window.electronAPI.getSteamLaunchOptionsStatus());
      } catch (err) {
        console.warn('Failed to read Steam launch options status:', err);
      }
    };
    load();
  }, []);

  const isDirty = saved !== null && saved !== draft;

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    setMessageTone(null);
    try {
      // Re-read settings immediately before writing: this card holds its value
      // from mount, and another surface (Settings, the welcome flow) may have
      // changed an unrelated field in the meantime. Spreading a stale snapshot
      // would silently roll that change back.
      const current: AppSettings = await getSettings();
      await setSettings({ ...current, steamLaunchOptions: draft });
      setSaved(draft);
      setMessage(t('autoexec.launchOptions.saved'));
      setMessageTone('success');
      try {
        setStatus(await window.electronAPI.getSteamLaunchOptionsStatus());
      } catch {
        // best-effort: the saved value is what matters, the VDF only changes on launch
      }
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage(t('autoexec.status.error', { error: String(err) }));
      setMessageTone('error');
    } finally {
      setIsSaving(false);
    }
  };

  const onDisk = status?.currentValue ?? '';
  const inSync = (saved ?? '') === onDisk;

  return (
    <Card
      className="shrink-0"
      contentClassName="p-4"
      title={<Tx k="autoexec.launchOptions.title" fallback="Launch Options" />}
      icon={Rocket}
      description={
        <Tx
          k="autoexec.launchOptions.description"
          fallback="Args passed to Deadlock when launched via Steam. Written into Steam's config right before grimoire launches the game."
        />
      }
    >
      <div className="space-y-2.5">
        <div className="flex gap-2">
          <Input
            inputSize="sm"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="-high -nojoy"
            aria-label={t('autoexec.launchOptions.title')}
            className="flex-1 font-mono"
          />
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            isLoading={isSaving}
            icon={Save}
          >
            <Tx k="common.actions.save" fallback="Save" />
          </Button>
        </div>

        {message && (
          <p
            role="status"
            aria-live="polite"
            className={`flex items-center gap-2 rounded-sm border p-2 text-xs ${
              messageTone === 'error'
                ? 'border-state-danger/20 bg-state-danger/10 text-state-danger'
                : 'border-state-success/20 bg-state-success/10 text-state-success'
            }`}
          >
            {messageTone === 'error' ? (
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Check className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {message}
          </p>
        )}

        {status && !status.available && (
          <p className="flex items-start gap-1.5 text-xs text-state-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <Tx
              k="autoexec.launchOptions.steamConfigMissing"
              fallback="Steam config not found. Launch Deadlock via Steam once, then come back."
            />
          </p>
        )}

        {status?.available && (
          <div className="space-y-2 border-t border-border/40 pt-2">
            {!inSync && (
              <>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="uppercase tracking-wide text-text-secondary">
                    <Tx k="autoexec.launchOptions.inSteamNow" fallback="In Steam now" />
                  </span>
                  <code className="min-w-0 truncate rounded-sm bg-bg-sunken px-1.5 py-0.5 font-mono text-text-primary/80">
                    {onDisk || t('common.emptyValue')}
                  </code>
                </div>
                {!isSaving && (
                  <p className="text-[11px] text-text-secondary/70">
                    <Tx
                      k="autoexec.launchOptions.savedWillOverwrite"
                      fallback="Your saved value will overwrite this on next grimoire launch."
                    />
                  </p>
                )}
              </>
            )}
            {status.steamRunning && (
              <p className="flex items-start gap-1.5 text-xs text-state-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <Tx
                  k="autoexec.launchOptions.steamRunning"
                  fallback="Steam is running. Close it before launching Deadlock via grimoire so the write isn't clobbered."
                />
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
