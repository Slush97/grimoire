import { useEffect, useState } from 'react';
import { Download, SlidersHorizontal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../stores/appStore';
import { Card, Toggle } from '../../common/ui';
import Tx from '../../translation/Tx';
import type { AppSettings } from '../../../types/mod';
import type { ForgeBridgeStatus } from '../../../types/electron';

// General preferences, mod installation and updates, and external integrations.
export default function PreferencesSection() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const { t } = useTranslation();
  const [forgeStatus, setForgeStatus] = useState<ForgeBridgeStatus | null>(null);

  const update = async (patch: Partial<AppSettings>) => {
    if (settings) {
      await saveSettings({ ...settings, ...patch });
    }
  };

  // Reflect whether the bridge actually came up. The port is picked at bind
  // time from a small range, so showing it is the only way a user can tell
  // which one to expect, and it confirms the toggle really took effect.
  const forgeEnabled = settings?.forgeLocalInstallEnabled ?? false;
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.getForgeBridgeStatus().then((status) => {
      if (!cancelled) setForgeStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [forgeEnabled]);

  return (
    <>
      <Card title={<Tx k="settings.sections.preferences" fallback="Preferences" />} icon={SlidersHorizontal}>
        <div className="space-y-6">
          <Toggle
            checked={settings?.lockerCardsExpandedByDefault ?? false}
            onChange={(checked) => update({ lockerCardsExpandedByDefault: checked })}
            label={<Tx k="settings.preferences.expandLocker" fallback="Expand Locker cards by default" />}
            description={<Tx k="settings.toggles.expandLocker" fallback="Start Locker list view with hero cards expanded." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.confirmProfileUpdate ?? true}
            onChange={(checked) => update({ confirmProfileUpdate: checked })}
            label={<Tx k="settings.preferences.confirmProfileUpdate" fallback="Confirm before updating a profile" />}
            description={<Tx k="settings.toggles.confirmProfileUpdate" fallback="Confirm before overwriting a profile's saved mods. Off overwrites immediately." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.ignoreConflictsByDefault ?? false}
            onChange={(checked) => update({ ignoreConflictsByDefault: checked })}
            label={<Tx k="settings.preferences.ignoreConflicts" fallback="Ignore conflicts by default" />}
            description={<Tx k="settings.toggles.ignoreConflicts" fallback="Hide all conflicts from the Conflicts page. Off shows them." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.keepModBackups ?? false}
            onChange={(checked) => update({ keepModBackups: checked })}
            label={<Tx k="settings.preferences.keepModBackups" fallback="Keep removed mod files for 24 hours" />}
            description={<Tx k="settings.toggles.keepModBackups" fallback="Back up updated, replaced, and deleted mod files. Restore them as disabled files from a mod's Backups menu. Backups older than 24 hours are removed at startup. Turning this off stops new backups." />}
          />
        </div>
      </Card>

      <Card title={t('settings.sections.installationAndUpdates')} icon={Download}>
        <div className="space-y-6">
          <Toggle
            checked={settings?.autoDisableSiblingVariants ?? true}
            onChange={(checked) => update({ autoDisableSiblingVariants: checked })}
            label={<Tx k="settings.preferences.switchVariants" fallback="Switch variants instead of stacking them" />}
            description={<Tx k="settings.toggles.switchVariants" fallback="Installing a new variant disables the old one. Off keeps both active. Updates always replace the old file." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.autoEnableDownloads ?? false}
            onChange={(checked) => update({ autoEnableDownloads: checked })}
            label={<Tx k="settings.preferences.enableAfterDownload" fallback="Enable mods after download" />}
            description={<Tx k="settings.toggles.enableAfterDownload" fallback="Enable mods as soon as they finish downloading. Stays disabled if no slot is free." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.autoMatchRemainingFiles ?? true}
            onChange={(checked) => update({ autoMatchRemainingFiles: checked })}
            label={<Tx k="settings.preferences.autoMatchRemainingFiles" fallback="Match remaining update files automatically" />}
            description={<Tx k="settings.toggles.autoMatchRemainingFiles" fallback="After matching names and descriptions, pair one unmatched installed file with one remaining new upload. This can replace a different variant. Turn off to choose these replacements yourself." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.skipModReplacementConfirmation ?? false}
            onChange={(checked) => update({ skipModReplacementConfirmation: checked })}
            label={t('settings.preferences.skipModReplacementConfirmation')}
            description={t('settings.toggles.skipModReplacementConfirmation')}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.swapManualReplacementActions ?? true}
            onChange={(checked) => update({ swapManualReplacementActions: checked })}
            label={t('settings.preferences.swapManualReplacementActions')}
            description={t('settings.toggles.swapManualReplacementActions')}
          />
        </div>
      </Card>

      <Card title={t('settings.sections.integrations')} icon={Wrench}>
        <div className="space-y-6">
          <Toggle
            checked={forgeEnabled}
            onChange={(checked) => update({ forgeLocalInstallEnabled: checked })}
            label={<Tx k="forge.settings.toggleLabel" fallback="Allow DeadlockForge 1-click installs" />}
            description={
              <span>
                <Tx
                  k="forge.settings.description"
                  fallback="Let deadlockforge.net send freshly forged mods straight to Grimoire, so you do not have to download and move the file yourself. Grimoire listens only on your own machine, accepts requests only from deadlockforge.net, and always asks before installing anything."
                />
                {forgeEnabled && forgeStatus && (
                  <span className="mt-1 block font-mono text-xs opacity-70">
                    {forgeStatus.listening && forgeStatus.port !== null
                      ? t('forge.settings.listening', { port: forgeStatus.port })
                      : t('forge.settings.notListening')}
                  </span>
                )}
              </span>
            }
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.discordRpcEnabled ?? false}
            onChange={(checked) => update({ discordRpcEnabled: checked })}
            label={<Tx k="settings.preferences.discordRpc" fallback="Discord Rich Presence" />}
            description={<Tx k="settings.toggles.discordRpc" fallback="Show your current Grimoire activity on your Discord profile. Talks only to your local Discord app and sends nothing to Grimoire." />}
          />
        </div>
      </Card>
    </>
  );
}
