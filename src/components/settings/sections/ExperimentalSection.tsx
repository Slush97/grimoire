import { useState } from 'react';
import { Beaker, Copy, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../stores/appStore';
import { useDevModsStore } from '../../../stores/devModsStore';
import { createDevDeadlockPath } from '../../../lib/api';
import { Button, Card, ProgressBar, Toggle } from '../../common/ui';
import { ConfirmModal } from '../../common/PageComponents';
import Tx from '../../translation/Tx';
import type { AppSettings } from '../../../types/mod';

// Feature flags plus the dev-only dummy game directory. Both are "you asked
// for it" territory, so they live away from the everyday preferences.
export default function ExperimentalSection() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const copyPercent = useDevModsStore((s) => s.percent);
  const copyMods = useDevModsStore((s) => s.copy);
  const [isCreatingDevPath, setIsCreatingDevPath] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const isCopyingMods = copyPercent !== null;

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

  const handleCopyMods = () => {
    setCopyConfirmOpen(false);
    void copyMods();
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

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.experimentalCrosshair ?? false}
            onChange={(checked) => update({ experimentalCrosshair: checked })}
            label={<Tx k="settings.experimental.crosshairDesigner" fallback="Crosshair Designer" />}
            description={<Tx k="settings.experimental.crosshairDesignerDescription" fallback="Create custom crosshairs with a live preview." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.experimentalSocial ?? false}
            onChange={(checked) => update({ experimentalSocial: checked })}
            label={<Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />}
            description={<Tx k="settings.experimental.socialDescription" fallback="Sign in with Steam to publish profiles and browse uploads from other players in Discover." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.experimentalUnknownModMatching ?? false}
            onChange={(checked) => update({ experimentalUnknownModMatching: checked })}
            label={<Tx k="settings.experimental.fixUnknownMods" fallback="Fix Unknown Mods" />}
            description={<Tx k="settings.toggles.fixUnknown" fallback="Match unknown local VPKs against GameBanana to recover names and thumbnails. May hit rate limits on large libraries." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.experimentalVpkImprinting ?? false}
            onChange={(checked) => update({ experimentalVpkImprinting: checked })}
            label={<Tx k="settings.experimental.vpkImprint" fallback="Imprint installed mods" />}
            description={<Tx k="settings.toggles.vpkImprint" fallback="Give each newly installed mod a small identity imprint so an orphaned file can be recognized offline. Adds an Imprint installed mods button on the Installed page to imprint mods you already have." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.experimentalModSafety ?? false}
            onChange={(checked) => update({ experimentalModSafety: checked })}
            label={<Tx k="modSafety.manage" fallback="Mod safety" />}
            description={<Tx k="settings.toggles.modSafety" fallback="Check each mod for scripts and ask before enabling one that has them. Imported mods wait disabled until you review them. Added for a Deadlock bug that let HUD scripts read files on your computer. Valve has since fixed it, so you don't need this to stay safe." />}
          />

          <div className="h-px bg-hl/5" />

          <Toggle
            checked={settings?.experimentalDeadworksServers ?? false}
            onChange={(checked) => update({ experimentalDeadworksServers: checked })}
            label={<Tx k="settings.experimental.deadworksServers" fallback="Deadworks Servers" />}
            description={<Tx k="settings.toggles.deadworks" fallback="Add a Servers tab to browse and join Deadworks community servers. Required content downloads before connecting." />}
          />

          <div className="h-px bg-hl/5" />

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
          disabled={isCreatingDevPath || isCopyingMods}
          label={<Tx k="settings.preferences.developerMode" fallback="Developer Mode" />}
          description={<Tx k="settings.preferences.developerModeDescription" fallback="Use a dummy Deadlock directory for local testing without game files." />}
        />
        {settings?.devMode && settings?.devDeadlockPath && (
          <div className="mt-2 space-y-3">
            <div className="text-xs font-mono bg-black/30 p-2 rounded-sm text-text-secondary break-all">
              {settings.devDeadlockPath}
            </div>
            <div className="space-y-2">
              <div className="relative inline-flex">
                <Button
                  variant="secondary"
                  icon={isCopyingMods ? undefined : Copy}
                  disabled={!settings.deadlockPath || isCreatingDevPath || isCopyingMods}
                  aria-busy={isCopyingMods}
                  onClick={() => setCopyConfirmOpen(true)}
                >
                  {isCopyingMods && (
                    <span className="tabular-nums">{copyPercent}%</span>
                  )}
                  <span className="text-trim-cap">{t('settings.preferences.copyModsToDev')}</span>
                </Button>
                {isCopyingMods && (
                  <ProgressBar
                    value={copyPercent ?? 0}
                    max={100}
                    label={t('settings.preferences.copyModsToDev')}
                    className="pointer-events-none absolute inset-x-px bottom-px h-0.5! w-auto!"
                  />
                )}
              </div>
              <p className="text-xs text-text-secondary">
                {t('settings.preferences.copyModsToDevDescription')}
              </p>
            </div>
          </div>
        )}
      </Card>
      <ConfirmModal
        isOpen={copyConfirmOpen && !!settings?.devMode}
        onCancel={() => setCopyConfirmOpen(false)}
        onConfirm={handleCopyMods}
        title={t('settings.preferences.copyModsToDevConfirmTitle')}
        message={t('settings.preferences.copyModsToDevConfirmMessage')}
        confirmLabel={t('settings.preferences.copyModsToDev')}
      />
    </>
  );
}
