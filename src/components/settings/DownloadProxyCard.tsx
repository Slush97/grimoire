import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameBananaDownloadProxyConfig } from '../../types/electron';
import { Button, Card, Toggle } from '../common/ui';
import { FormField, Input } from '../common/forms';

export default function DownloadProxyCard({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<GameBananaDownloadProxyConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadActive, setDownloadActive] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    window.electronAPI.getGameBananaDownloadProxy().then((value) => {
      if (active) setConfig(value);
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

  const save = async (clear = false) => {
    if (!config) return;
    setBusy(true);
    setFeedback(null);
    try {
      const value = await window.electronAPI.setGameBananaDownloadProxy(
        clear ? { enabled: false, url: '' } : { enabled: config.enabled, url: config.url }
      );
      setConfig(value);
      setLoadFailed(false);
      onSaved();
      setFeedback({ error: false, message: t('settings.downloadProxy.saved') });
    } catch (error) {
      setFeedback({ error: true, message: t('settings.downloadProxy.saveFailed', {
        error: error instanceof Error ? error.message : String(error),
      }) });
    } finally { setBusy(false); }
  };

  return (
    <Card title={t('settings.downloadProxy.title')} description={t('settings.downloadProxy.description')}>
      {config ? (
        <div className="space-y-4">
          <Toggle
            label={t('settings.downloadProxy.enable')}
            checked={config.enabled}
            disabled={busy || downloadActive}
            onChange={(enabled) => { setConfig({ ...config, enabled }); setFeedback(null); }}
          />
          <FormField label={t('settings.downloadProxy.url')} hint={t('settings.downloadProxy.urlHint')}>
            <Input
              value={config.url}
              placeholder={t('settings.downloadProxy.placeholder')}
              disabled={busy || downloadActive}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => { setConfig({ ...config, url: event.target.value }); setFeedback(null); }}
            />
          </FormField>
          {config.hasCredentials && <p className="text-xs text-text-secondary">{t('settings.downloadProxy.credentialsSaved')}</p>}
          {downloadActive && <p className="text-xs text-text-secondary">{t('settings.downloadProxy.downloadActive')}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || downloadActive} isLoading={busy} onClick={() => void save()}>
              {t('settings.downloadProxy.save')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy || downloadActive} onClick={() => void save(true)}>
              {t('settings.downloadProxy.clear')}
            </Button>
          </div>
        </div>
      ) : <p className="text-sm text-text-secondary">{t('settings.downloadProxy.loading')}</p>}
      {loadFailed && <p role="alert" className="mt-4 text-sm text-state-danger">{t('settings.downloadProxy.loadFailed')}</p>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`mt-4 text-sm ${feedback.error ? 'text-state-danger' : 'text-text-secondary'}`}>{feedback.message}</p>}
    </Card>
  );
}
