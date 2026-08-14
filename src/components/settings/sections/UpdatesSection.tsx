import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import { ArrowDownCircle, Download, RefreshCw, Sparkles, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Badge, Button, Card } from '../../common/ui';
import Tx from '../../translation/Tx';

// GitHub Releases is the source of truth for changelogs. When we have local
// release notes (an update is pending) we show them in-app; otherwise we link
// out to the release page so users can read "what's new" even when up to date.
const GITHUB_RELEASES_URL = 'https://github.com/Slush97/grimoire/releases';
const releaseTagUrl = (version?: string | null) =>
  version ? `${GITHUB_RELEASES_URL}/tag/v${version}` : GITHUB_RELEASES_URL;

// A version number that links to its GitHub release notes. Renders nothing when
// there's no version to point at.
function ReleaseVersionLink({ version, className = '' }: { version?: string | null; className?: string }) {
  const { t } = useTranslation();
  if (!version) return null;
  return (
    <a
      href={releaseTagUrl(version)}
      target="_blank"
      rel="noopener noreferrer"
      title={t('settings.updates.releaseNotesTitle', { version })}
      className={`underline decoration-dotted underline-offset-2 transition-colors hover:text-accent ${className}`}
    >
      v{version}
    </a>
  );
}

export default function UpdatesSection() {
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<{
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: {
      version: string;
      releaseDate?: string;
      releaseNotes?: string | { version: string; note: string | null }[] | null;
    } | null;
  } | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [installSource, setInstallSource] = useState<'managed' | 'appimage' | 'standard' | 'manual'>('standard');
  // See UpdateModal: 'managed' defers to the package manager, 'manual' (ad-hoc
  // signed macOS) can check but cannot apply an update in place.
  const canSelfInstall = installSource !== 'managed' && installSource !== 'manual';

  // Derived, not state: a check in flight sets `checking`, so this falls back
  // to false on its own while one runs.
  const upToDate = !!updateStatus && !updateStatus.checking && !updateStatus.available && !updateStatus.error;

  useEffect(() => {
    window.electronAPI.updater.getVersion().then(setAppVersion);
    window.electronAPI.updater.getStatus().then(setUpdateStatus);
    window.electronAPI.updater.getInstallSource().then(setInstallSource);
    const unsub = window.electronAPI.updater.onStatus(setUpdateStatus);
    return unsub;
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    try {
      await window.electronAPI.updater.checkForUpdates();
    } catch (err) {
      console.error('Update check failed:', err);
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    try {
      await window.electronAPI.updater.downloadUpdate();
    } catch (err) {
      console.error('Update download failed:', err);
    }
  }, []);

  const handleInstallUpdate = useCallback(() => {
    window.electronAPI.updater.installUpdate();
  }, []);

  // "What's New" entry point that works in every state. If an update is pending
  // we have its release notes locally, so open the in-app changelog. Otherwise
  // (up to date, or a package-managed install) send users to this build's
  // GitHub release page so they can always read the notes.
  const handleViewWhatsNew = useCallback(() => {
    if (updateStatus?.updateInfo?.releaseNotes) {
      setShowChangelog(true);
    } else {
      window.open(releaseTagUrl(appVersion), '_blank', 'noopener,noreferrer');
    }
  }, [updateStatus, appVersion]);

  return (
    <>
      <Card title={<Tx k="settings.sections.updates" fallback="Updates" />} icon={Download}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  <Tx k="settings.updates.currentVersion" fallback="Current Version" />
                </span>
                <Badge variant="info">v{appVersion || '...'}</Badge>
              </div>
              {updateStatus?.available && !updateStatus.downloaded && (
                <span className="text-xs text-accent">
                  <ReleaseVersionLink version={updateStatus.updateInfo?.version} />{' '}
                  <Tx k="settings.updates.available" fallback="available!" />
                </span>
              )}
              {updateStatus?.downloaded && (
                <span className="text-xs text-green-400 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  <ReleaseVersionLink version={updateStatus.updateInfo?.version} />{' '}
                  <Tx k="settings.updates.readyToInstall" fallback="ready to install" />
                </span>
              )}
              {upToDate && !updateStatus?.available && !updateStatus?.checking && (
                <span className="text-xs text-green-400">
                  <Tx k="settings.updates.upToDate" fallback="✓ You're up to date!" />
                </span>
              )}
              {updateStatus?.error && (
                <span className="text-xs text-state-danger basis-full">{updateStatus.error}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Always present so release notes are reachable in any state,
                  including when up to date or on a package-managed install. */}
              <Button
                onClick={handleViewWhatsNew}
                variant="secondary"
                icon={Sparkles}
              >
                <Tx k="settings.updates.whatsNew" fallback="What's New" />
              </Button>
              {installSource === 'managed' ? null : canSelfInstall && updateStatus?.downloaded ? (
                <Button
                  onClick={handleInstallUpdate}
                  icon={ArrowDownCircle}
                >
                  <Tx k="settings.updates.installRestart" fallback="Install & Restart" />
                </Button>
              ) : canSelfInstall && updateStatus?.available && !updateStatus.downloading ? (
                <Button
                  onClick={handleDownloadUpdate}
                  icon={Download}
                >
                  <Tx k="settings.updates.downloadUpdate" fallback="Download Update" />
                </Button>
              ) : (
                <Button
                  onClick={handleCheckForUpdates}
                  disabled={updateStatus?.checking || updateStatus?.downloading}
                  isLoading={updateStatus?.checking}
                  variant="secondary"
                  icon={RefreshCw}
                >
                  {updateStatus?.checking ? (
                    <Tx k="common.status.checking" fallback="Checking..." />
                  ) : (
                    <Tx k="settings.updates.checkForUpdates" fallback="Check for Updates" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {installSource === 'managed' && (
            <div className="rounded-lg bg-bg-tertiary border border-white/10 p-3 text-sm text-text-secondary space-y-2">
              <p className="text-text-primary font-medium">
                <Tx k="settings.updates.managed" fallback="Updates are managed by your package manager." />
              </p>
              <p>
                <Trans
                  i18nKey="settings.updates.managedInstructions"
                  components={{
                    arch: <code className="font-mono text-text-primary" />,
                    apt: <code className="font-mono text-text-primary" />,
                  }}
                />
              </p>
              <p>
                <Trans
                  i18nKey="settings.updates.installedDeb"
                  components={{
                    deb: <code className="font-mono text-text-primary" />,
                    url: <code className="font-mono text-text-primary" />,
                  }}
                />
              </p>
            </div>
          )}

          {installSource === 'manual' && (
            <div className="rounded-lg bg-bg-tertiary border border-white/10 p-3 text-sm text-text-secondary space-y-2">
              <p className="text-text-primary font-medium">
                <Tx k="settings.updates.manual" fallback="Updates have to be downloaded manually." />
              </p>
              <p>
                <Tx
                  k="settings.updates.manualUnsignedExplanation"
                  fallback="The macOS build is ad-hoc signed rather than notarized, so macOS will not let Grimoire replace itself in place. Grimoire can still tell you when a new version is out."
                />
              </p>
              <a
                href="https://github.com/Slush97/grimoire/releases/latest"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block font-mono text-text-primary underline underline-offset-2 hover:text-accent transition-colors"
              >
                <Tx k="settings.updates.manualDownloadLink" fallback="Download the latest release" />
              </a>
            </div>
          )}

          {updateStatus?.downloading && (
            <div className="animate-fade-in">
              <div className="flex justify-between text-xs text-text-secondary mb-1">
                <span><Tx k="settings.updates.downloading" fallback="Downloading update..." /></span>
                <span>{Math.round(updateStatus.progress)}%</span>
              </div>
              <div className="w-full bg-bg-tertiary rounded-sm h-1.5 overflow-hidden">
                <div
                  className="bg-accent h-full rounded-sm transition-all duration-300 ease-out"
                  style={{ width: `${updateStatus.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Changelog modal. Portaled to body like every other overlay in the app:
          the shell it would otherwise render inside is its own stacking context,
          which would sink a plain z-50 below the fixed status indicators. */}
      {showChangelog && updateStatus?.updateInfo && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-bg-secondary border border-white/10 rounded-sm w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-fade-in relative">
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">
                  <Tx k="settings.updates.whatsNewIn" fallback="What's New in" />{' '}
                  <ReleaseVersionLink version={updateStatus.updateInfo.version} />
                </h2>
                {updateStatus.updateInfo.releaseDate && (
                  <p className="text-sm text-text-secondary mt-1">
                    <Tx
                      k="settings.updates.released"
                      values={{ date: new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString() }}
                      fallback={`Released ${new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString()}`}
                    />
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowChangelog(false)}
                className="p-2 rounded-sm hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              {typeof updateStatus.updateInfo.releaseNotes === 'string' ? (
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(updateStatus.updateInfo.releaseNotes) }}
                />
              ) : Array.isArray(updateStatus.updateInfo.releaseNotes) ? (
                <div className="space-y-4">
                  {updateStatus.updateInfo.releaseNotes.map((note, idx) => (
                    <div key={idx}>
                      <h3 className="font-semibold text-accent">
                        <ReleaseVersionLink version={note.version} />
                      </h3>
                      {note.note && (
                        <div
                          className="prose prose-invert prose-sm max-w-none mt-1"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.note) }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-text-secondary">
                  <Tx k="settings.updates.noReleaseNotes" fallback="No release notes available." />
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-white/10">
              <Button
                onClick={() => setShowChangelog(false)}
                variant="secondary"
              >
                <Tx k="common.actions.close" fallback="Close" />
              </Button>
              <Button
                onClick={() => {
                  setShowChangelog(false);
                  handleDownloadUpdate();
                }}
                icon={Download}
              >
                <Tx k="settings.updates.downloadUpdate" fallback="Download Update" />
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
