import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Download, X } from 'lucide-react';
import { Button } from './common/ui';
import UpdateModal from './UpdateModal';
import type { UpdateStatus } from '../types/electron';

// Dismissed for this session (until the app relaunches). Module-scoped, not
// React state, so navigating between pages doesn't resurrect a banner the user
// already waved off. A new launch reloads the module and the flag resets.
let appUpdateBannerDismissed = false;

/**
 * Global call-out for an available Grimoire app update (the Electron
 * auto-updater, not mod updates). Mounted once in Layout so it rides above
 * every page. The action opens the existing UpdateModal, which owns the
 * download / release-notes / install-and-restart flow.
 */
export default function AppUpdateBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [managed, setManaged] = useState(false);
  const [dismissed, setDismissed] = useState(appUpdateBannerDismissed);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // Package-manager installs (apt / AUR / snap / flatpak) own their own
    // updates and the auto-updater is disabled there, so never nag with a
    // banner; the user updates through their package manager.
    window.electronAPI.updater
      .getInstallSource()
      .then((src) => setManaged(src === 'managed'))
      .catch(() => {});
    window.electronAPI.updater.getStatus().then(setStatus).catch(() => {});
    return window.electronAPI.updater.onStatus(setStatus);
  }, []);

  const downloaded = !!status?.downloaded;
  const updateReady = !!status && (status.available || status.downloaded);
  const showBanner = updateReady && !managed && !dismissed;
  const version = status?.updateInfo?.version;

  return (
    <>
      {showBanner && (
        <div className="px-4 pt-3 sm:px-6">
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-3 overflow-hidden rounded-xl border border-accent/30 bg-accent/10 px-4 py-3"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent">
              <ArrowUpCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary">
                {downloaded
                  ? version
                    ? t('appUpdateBanner.readyToInstallVersion', { version })
                    : t('appUpdateBanner.readyToInstall')
                  : version
                    ? t('appUpdateBanner.updateAvailableVersion', { version })
                    : t('appUpdateBanner.updateAvailable')}
              </div>
              <div className="text-xs text-text-secondary">
                {downloaded
                  ? t('appUpdateBanner.restartToFinish')
                  : t('appUpdateBanner.newerVersionReady')}
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setModalOpen(true)}
              icon={Download}
              className="flex-shrink-0"
            >
              {downloaded ? t('appUpdateBanner.install') : t('appUpdateBanner.viewUpdate')}
            </Button>
            <button
              type="button"
              onClick={() => {
                appUpdateBannerDismissed = true;
                setDismissed(true);
              }}
              aria-label={t('appUpdateBanner.hideBannerUntilNextLaunch')}
              title={t('appUpdateBanner.hideUntilNextLaunch')}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {modalOpen && <UpdateModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
