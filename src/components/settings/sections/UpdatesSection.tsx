import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { ArrowDownCircle, Download, RefreshCw, Sparkles } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Badge, Button, Card, ModalHeader, SegmentedControl } from '../../common/ui';
import { Modal, ModalBody, ModalFooter } from '../../common/Modal';
import Tx from '../../translation/Tx';
import { useAppStore } from '../../../stores/appStore';
import type { UpdateStatus } from '../../../types/electron';
import type { UpdateChannel } from '../../../types/mod';

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
  const { t } = useTranslation();
  const settings = useAppStore(state => state.settings);
  const channel = settings?.updateChannel ?? 'stable';
  const [changingChannel, setChangingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const changelogTitleId = useId();
  const closeChangelog = useCallback(() => setShowChangelog(false), []);
  const [installSource, setInstallSource] = useState<'managed' | 'appimage' | 'standard' | 'manual'>('standard');
  // See UpdateModal: 'managed' defers to the package manager, 'manual' (ad-hoc
  // signed macOS) can check but cannot apply an update in place.
  const canSelfInstall = installSource !== 'managed' && installSource !== 'manual';

  // Derived, not state: a check in flight sets `checking`, so this falls back
  // to false on its own while one runs.
  const upToDate = !!updateStatus?.checked && !updateStatus.checking && !updateStatus.available && !updateStatus.error;
  const updateError = channel === 'nightly' && ['ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'].includes(updateStatus?.errorCode ?? '')
    ? t('settings.updates.nightlyUnavailable')
    : updateStatus?.error;

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

  const handleChannelChange = async (nextChannel: UpdateChannel) => {
    if (nextChannel === channel) return;
    setChangingChannel(true);
    setChannelError(null);
    setShowChangelog(false);
    try {
      const nextSettings = await window.electronAPI.updater.setChannel(nextChannel);
      useAppStore.setState({ settings: nextSettings });
      await handleCheckForUpdates();
    } catch (err) {
      setChannelError(t('settings.updates.channelChangeFailed', { error: String(err) }));
    } finally {
      setChangingChannel(false);
    }
  };

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
          {installSource !== 'managed' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium"><Tx k="settings.updates.channel" fallback="Update channel" /></span>
                <SegmentedControl<UpdateChannel>
                  label={t('settings.updates.channel')}
                  value={channel}
                  options={[
                    { value: 'stable', label: <Tx k="settings.updates.stable" fallback="Stable" /> },
                    { value: 'nightly', label: <Tx k="settings.updates.nightly" fallback="Nightly" /> },
                  ]}
                  onChange={next => { void handleChannelChange(next); }}
                  disabled={!settings || changingChannel || updateStatus?.checking || updateStatus?.downloading}
                />
              </div>
              <p className="text-xs text-text-secondary">
                {channel === 'nightly'
                  ? <Tx k="settings.updates.nightlyDescription" fallback="Get fixes as soon as they land. Nightly builds may have bugs. You can switch back to Stable at any time." />
                  : <Tx k="settings.updates.stableDescription" fallback="Recommended for everyday use. Receive official releases." />}
              </p>
              {channel === 'stable' && appVersion.includes('-nightly.') && (
                <p className="text-xs text-text-secondary"><Tx k="settings.updates.returnToStable" fallback="You're running a nightly build. Download and install the offered stable release to return to Stable, even if its version is older." /></p>
              )}
              {channelError && <p role="alert" className="text-xs text-state-danger">{channelError}</p>}
            </div>
          )}
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
              {updateError && (
                <span role="alert" className="text-xs text-state-danger basis-full">{updateError}</span>
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
                  disabled={changingChannel}
                  icon={ArrowDownCircle}
                >
                  <Tx k="settings.updates.installRestart" fallback="Install & Restart" />
                </Button>
              ) : canSelfInstall && updateStatus?.available && !updateStatus.downloading ? (
                <Button
                  onClick={handleDownloadUpdate}
                  disabled={changingChannel}
                  icon={Download}
                >
                  <Tx k="settings.updates.downloadUpdate" fallback="Download Update" />
                </Button>
              ) : (
                <Button
                  onClick={handleCheckForUpdates}
                  disabled={changingChannel || updateStatus?.checking || updateStatus?.downloading}
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
            <div className="rounded-lg bg-bg-tertiary border border-hl/10 p-3 text-sm text-text-secondary space-y-2">
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
            <div className="rounded-lg bg-bg-tertiary border border-hl/10 p-3 text-sm text-text-secondary space-y-2">
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
                href={updateStatus?.updateInfo ? releaseTagUrl(updateStatus.updateInfo.version) : channel === 'nightly' ? GITHUB_RELEASES_URL : `${GITHUB_RELEASES_URL}/latest`}
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

      {showChangelog && updateStatus?.updateInfo && (
        <Modal onClose={closeChangelog} labelledBy={changelogTitleId} size="lg">
          <ModalHeader
            titleId={changelogTitleId}
            title={
              <>
                <Tx k="settings.updates.whatsNewIn" fallback="What's New in" />{' '}
                <ReleaseVersionLink version={updateStatus.updateInfo.version} />
              </>
            }
            subtitle={updateStatus.updateInfo.releaseDate && (
              <Tx
                k="settings.updates.released"
                values={{ date: new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString() }}
                fallback={`Released ${new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString()}`}
              />
            )}
            onClose={closeChangelog}
          />
          <ModalBody>
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
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeChangelog} variant="secondary">
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
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
