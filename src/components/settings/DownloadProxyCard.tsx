import { useEffect, useRef, useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GameBananaDownloadProxyConfig } from '../../types/electron';
import { Button, Card, Toggle } from '../common/ui';
import { FormField, Input } from '../common/forms';
import { showToast } from '../../stores/toastStore';

function comparableUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'socks5:') url.protocol = 'socks5h:';
    return url.href;
  } catch {
    return value.trim();
  }
}

export default function DownloadProxyCard({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<GameBananaDownloadProxyConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<GameBananaDownloadProxyConfig | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [downloadActive, setDownloadActive] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    window.electronAPI.getGameBananaDownloadProxy().then((value) => {
      if (active) { setConfig(value); setSavedConfig(value); }
    }).catch(() => {
      if (active) {
        setConfig({ enabled: false, url: '', hasCredentials: false });
        setLoadFailed(true);
      }
    });
    void window.electronAPI.getCurrentDownload().then((value) => {
      if (active) setDownloadActive(value !== null);
    }).catch(() => { if (active) setDownloadActive(true); });
    const unsubscribe = window.electronAPI.onDownloadQueueUpdated((value) => {
      if (active) setDownloadActive(value.currentDownload !== null);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const dirty = config !== null && (loadFailed || savedConfig === null ||
    config.enabled !== savedConfig.enabled || comparableUrl(config.url) !== comparableUrl(savedConfig.url));
  const canClear = loadFailed || !!savedConfig?.url || !!savedConfig?.hasCredentials;

  const save = async (clear = false) => {
    if (!config || submitting.current || downloadActive || (clear ? !canClear : !dirty)) return;
    submitting.current = true;
    setBusy(true);
    setSaved(false);
    try {
      const value = await window.electronAPI.setGameBananaDownloadProxy(
        clear ? { enabled: false, url: '' } : { enabled: config.enabled, url: config.url }
      );
      setConfig(value);
      setSavedConfig(value);
      setLoadFailed(false);
      onSaved();
      setSaved(true);
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      showToast(t('settings.downloadProxy.saveFailed', {
        error: detail,
      }), { tone: 'error' });
    } finally { submitting.current = false; setBusy(false); }
  };

  return (
    <Card
      title={t('settings.downloadProxy.title')}
      description={t('settings.downloadProxy.description')}
      accentEdge="none"
      action={config && <Toggle
        label={t('settings.downloadProxy.enable')}
        checked={config.enabled}
        disabled={busy || downloadActive}
        onChange={(enabled) => { setConfig({ ...config, enabled }); setSaved(false); }}
      />}
    >
      {config ? (
        <div className="space-y-4">
          <FormField label={t('settings.downloadProxy.url')}>
            <Input
              value={config.url}
              placeholder={t('settings.downloadProxy.placeholder')}
              disabled={busy || downloadActive}
              autoComplete="off"
              spellCheck={false}
              title={t('settings.downloadProxy.urlHint')}
              onChange={(event) => { setConfig({ ...config, url: event.target.value }); setSaved(false); }}
            />
          </FormField>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button size="sm" className="min-w-28" disabled={busy || downloadActive || !dirty || (config.enabled && !config.url.trim())} isLoading={busy} icon={saved ? Check : undefined} onClick={() => void save()}>
                {saved ? t('settings.downloadProxy.saved') : t('settings.downloadProxy.save')}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy || downloadActive || !canClear} onClick={() => void save(true)}>
                {t('settings.downloadProxy.clear')}
              </Button>
            </div>
            <span aria-hidden={!config.hasCredentials} className={`flex items-center gap-1.5 text-xs text-text-secondary ${config.hasCredentials ? '' : 'invisible'}`}>
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
              {t('settings.downloadProxy.credentialsSaved')}
            </span>
          </div>
          <span role="status" className="sr-only">{saved ? t('settings.downloadProxy.saved') : ''}</span>
          {downloadActive && <p className="text-xs text-text-secondary">{t('settings.downloadProxy.downloadActive')}</p>}
        </div>
      ) : <p className="text-sm text-text-secondary">{t('settings.downloadProxy.loading')}</p>}
      {loadFailed && <p role="alert" className="mt-4 text-sm text-state-danger">{t('settings.downloadProxy.loadFailed')}</p>}
    </Card>
  );
}
