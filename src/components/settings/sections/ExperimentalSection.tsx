import { useState } from 'react';
import { Beaker, Wrench } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { createDevDeadlockPath } from '../../../lib/api';
import { Card, Toggle } from '../../common/ui';
import Tx from '../../translation/Tx';
import type { AppSettings } from '../../../types/mod';

// Feature flags plus the dev-only dummy game directory. Both are "you asked
// for it" territory, so they live away from the everyday preferences.
export default function ExperimentalSection() {
  const { settings, saveSettings } = useAppStore();
  const [isCreatingDevPath, setIsCreatingDevPath] = useState(false);

  const update = async (patch: Partial<AppSettings>) => {
    if (settings) {
      await saveSettings({ ...settings, ...patch });
    }
  };

  const handleDevModeChange = async (checked: boolean) => {
    if (!settings) return;
    if (checked) {
      setIsCreatingDevPath(true);
      try {
        const devPath = await createDevDeadlockPath();
        await saveSettings({
          ...settings,
          devMode: true,
          devDeadlockPath: devPath,
        });
      } finally {
        setIsCreatingDevPath(false);
      }
    } else {
      await saveSettings({ ...settings, devMode: false });
    }
  };

  return (
    <>
      <Card title={<Tx k="settings.sections.experimentalFeatures" fallback="Experimental Features" />} icon={Beaker}>
        <div className="space-y-6">
          <p className="text-xs text-text-secondary -mt-2">
            <Tx
              k="settings.experimental.description"
              fallback="These features are still in development and may be incomplete or buggy."
            />
          </p>

          <Toggle
            checked={settings?.experimentalStats ?? false}
            onChange={(checked) => update({ experimentalStats: checked })}
            label={<Tx k="settings.experimental.statsDashboard" fallback="Stats Dashboard" />}
            description={<Tx k="settings.experimental.statsDashboardDescription" fallback="Track your performance with data from the Deadlock Stats API." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalCrosshair ?? false}
            onChange={(checked) => update({ experimentalCrosshair: checked })}
            label={<Tx k="settings.experimental.crosshairDesigner" fallback="Crosshair Designer" />}
            description={<Tx k="settings.experimental.crosshairDesignerDescription" fallback="Create custom crosshairs with a live preview." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalSocial ?? false}
            onChange={(checked) => update({ experimentalSocial: checked })}
            label={<Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />}
            description={<Tx k="settings.experimental.socialDescription" fallback="Sign in with Steam to publish profiles and browse uploads from other players in Discover." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalUnknownModMatching ?? false}
            onChange={(checked) => update({ experimentalUnknownModMatching: checked })}
            label={<Tx k="settings.experimental.fixUnknownMods" fallback="Fix Unknown Mods" />}
            description={<Tx k="settings.toggles.fixUnknown" fallback="Match unknown local VPKs against GameBanana to recover names and thumbnails. May hit rate limits on large libraries." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalVpkImprinting ?? false}
            onChange={(checked) => update({ experimentalVpkImprinting: checked })}
            label={<Tx k="settings.experimental.vpkImprint" fallback="Imprint installed mods" />}
            description={<Tx k="settings.toggles.vpkImprint" fallback="Give each newly installed mod a small identity imprint so an orphaned file can be recognized offline. Adds an Imprint installed mods button on the Installed page to imprint mods you already have." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalDeadworksServers ?? false}
            onChange={(checked) => update({ experimentalDeadworksServers: checked })}
            label={<Tx k="settings.experimental.deadworksServers" fallback="Deadworks Servers" />}
            description={<Tx k="settings.toggles.deadworks" fallback="Add a Servers tab to browse and join Deadworks community servers. Required content downloads before connecting." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalPerformanceConfig ?? false}
            onChange={(checked) => update({ experimentalPerformanceConfig: checked })}
            label={<Tx k="settings.experimental.performanceConfig" fallback="Performance Config" />}
            description={<Tx k="settings.toggles.performanceConfig" fallback="One-click fps boost using Sqooky's community preset. Mods keep working. Remove any time." />}
          />

          <div className="h-px bg-white/5" />

          <Toggle
            checked={settings?.experimentalFoundry ?? false}
            onChange={(checked) => update({ experimentalFoundry: checked })}
            label={<Tx k="settings.experimental.foundry" fallback="Door Stuck" />}
          />
        </div>
      </Card>

      <Card title={<Tx k="settings.preferences.developerMode" fallback="Developer Mode" />} icon={Wrench}>
        <Toggle
          checked={settings?.devMode ?? false}
          onChange={handleDevModeChange}
          disabled={isCreatingDevPath}
          label={<Tx k="settings.preferences.developerMode" fallback="Developer Mode" />}
          description={<Tx k="settings.preferences.developerModeDescription" fallback="Use a dummy Deadlock directory for local testing without game files." />}
        />
        {settings?.devMode && settings?.devDeadlockPath && (
          <div className="mt-2 text-xs font-mono bg-black/30 p-2 rounded-sm text-text-secondary break-all">
            {settings.devDeadlockPath}
          </div>
        )}
      </Card>
    </>
  );
}
