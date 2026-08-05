import { SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { Card, Toggle } from '../../common/ui';
import Tx from '../../translation/Tx';
import type { AppSettings } from '../../../types/mod';

// Day-to-day behaviour toggles: how mods install, how the Locker opens, and
// what Grimoire tells other apps about you.
export default function PreferencesSection() {
  const { settings, saveSettings } = useAppStore();

  const update = async (patch: Partial<AppSettings>) => {
    if (settings) {
      await saveSettings({ ...settings, ...patch });
    }
  };

  return (
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
          checked={settings?.discordRpcEnabled ?? false}
          onChange={(checked) => update({ discordRpcEnabled: checked })}
          label={<Tx k="settings.preferences.discordRpc" fallback="Discord Rich Presence" />}
          description={<Tx k="settings.toggles.discordRpc" fallback="Show your current Grimoire activity on your Discord profile. Talks only to your local Discord app and sends nothing to Grimoire." />}
        />
      </div>
    </Card>
  );
}
