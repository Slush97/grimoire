import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './common/ui';
import { showToast } from '../stores/toastStore';
import { useGameinfoStore } from '../stores/gameinfoStore';

// App-wide warning when gameinfo.gi no longer loads mods, mentioning the
// performance config when the same reset removed it. Worded for players: the
// technical detail from the main process is kept as a tooltip for bug reports.
export default function GameinfoBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gameinfo, perfWiped, fixing, recheck, fix } = useGameinfoStore();
  // Keyed on the text so a different problem still surfaces after hiding one.
  const [dismissed, setDismissed] = useState<string | null>(null);

  // A game update can land while Grimoire is open; the file check is cheap.
  useEffect(() => {
    const onFocus = () => void recheck();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheck]);

  const reason = gameinfo && !gameinfo.configured ? gameinfo.reason : null;
  const text =
    reason === 'mods-not-loaded'
      ? t(perfWiped ? 'layout.gameinfo.modsAndPerfOff' : 'layout.gameinfo.modsOff')
      : reason === 'boot-paths-missing'
        ? t('layout.gameinfo.bootPathsOff')
        : reason === 'language-paths-missing'
        ? t('layout.gameinfo.languageOff')
        : reason === 'not-found'
          ? t('layout.gameinfo.notFound')
          : reason === 'unrepairable'
            ? t('layout.gameinfo.unrepairable')
            : reason === 'error'
              ? t('layout.gameinfo.error')
              : null;
  const canFix = reason !== 'not-found' && reason !== 'error';

  if (!text || text === dismissed) return null;

  const onFix = async () => {
    const { perfRestored, perfError } = await fix();
    if (perfRestored) showToast(t('layout.perfRestored'), { tone: 'success' });
    if (perfError) showToast(perfError, { tone: 'error' });
  };

  return (
    <div className="sticky top-0 z-40 border-b border-state-warning/30 bg-bg-secondary">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-state-warning" aria-hidden="true" />
        <p className="flex-1 text-sm text-text-primary" title={gameinfo?.configured ? undefined : gameinfo?.message}>
          {text}
        </p>
        <div className="flex items-center gap-2">
          {canFix && (
            <Button variant="warning" size="sm" onClick={() => void onFix()} isLoading={fixing}>
              {t('layout.fixNow')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>
            {t('layout.openSettings')}
          </Button>
          <button
            type="button"
            onClick={() => setDismissed(text)}
            aria-label={t('layout.hideGameinfoBanner')}
            title={t('layout.hideGameinfoBannerShort')}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-hl/10 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
