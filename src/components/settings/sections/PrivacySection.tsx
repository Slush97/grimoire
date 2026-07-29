import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff, Shield } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { shouldBlurNsfw } from '../../../lib/appSettings';
import { showToast } from '../../../stores/toastStore';
import { Badge, Button, Card, Toggle } from '../../common/ui';
import Tx from '../../translation/Tx';
import { HiddenCreatorsManager, HiddenCreatorsModal } from '../../HiddenCreatorsManager';
import type { SaltIngestStatus } from '../../../types/electron';
import type { HiddenCreator } from '../../../types/mod';

// What Grimoire shows you and what it shares on your behalf.
export default function PrivacySection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useAppStore();
  const [hiddenCreatorsOpen, setHiddenCreatorsOpen] = useState(false);
  const [saltIngestStatus, setSaltIngestStatus] = useState<SaltIngestStatus | null>(null);

  const refreshSaltIngestStatus = useCallback(async () => {
    try {
      setSaltIngestStatus(await window.electronAPI.saltIngest.getStatus());
    } catch {
      // The status line is cosmetic; the toggle stays usable without it.
    }
  }, []);

  useEffect(() => {
    if (!settings?.contributeMatchSalts) return;
    let cancelled = false;
    window.electronAPI.saltIngest
      .getStatus()
      .then((status) => {
        if (!cancelled) setSaltIngestStatus(status);
      })
      .catch(() => {
        // The status line is cosmetic; the toggle stays usable without it.
      });
    return () => {
      cancelled = true;
    };
  }, [settings?.contributeMatchSalts]);

  const handleContributeMatchSaltsChange = async (checked: boolean) => {
    if (!settings) return;
    await saveSettings({ ...settings, contributeMatchSalts: checked });
    await window.electronAPI.saltIngest.setEnabled(checked);
    if (checked) {
      // The first scan usually finishes within a couple seconds; pick up its
      // counters once it has.
      setTimeout(() => void refreshSaltIngestStatus(), 3000);
    }
  };

  const handleShowCreator = async (creator: HiddenCreator) => {
    if (!settings) return;
    await saveSettings({
      ...settings,
      hiddenCreators: (settings.hiddenCreators ?? []).filter((entry) => entry.id !== creator.id),
    });
    showToast(t('hiddenCreators.shownToast', { name: creator.name }), { tone: 'success' });
  };

  const hiddenCreators = settings?.hiddenCreators ?? [];

  return (
    <>
      <Card title={<Tx k="settings.nav.privacy" fallback="Privacy & Content" />} icon={Shield}>
        <div className="space-y-6">
          <Toggle
            checked={shouldBlurNsfw(settings)}
            onChange={(checked) => settings && saveSettings({ ...settings, installedHideNsfwPreviews: checked })}
            label={<Tx k="settings.preferences.hideNsfw" fallback="Hide NSFW Content" />}
            description={<Tx k="settings.preferences.hideNsfwDescription" fallback="Blur thumbnail images for mods marked as NSFW." />}
          />

          <div className="h-px bg-white/5" />

          <div>
            <Toggle
              checked={settings?.contributeMatchSalts ?? false}
              onChange={handleContributeMatchSaltsChange}
              label={<Tx k="settings.preferences.contributeMatchData" fallback="Contribute match data to deadlock-api.com" />}
              description={<Tx k="settings.toggles.contributeSalts" fallback="Share the replay keys Steam already caches for matches you view in-game. Sends only the match id, server cluster, and two download keys: no account id, no username, nothing about you or your mods." />}
            />
            {settings?.contributeMatchSalts && saltIngestStatus && (
              <div className="mt-2 text-xs text-text-secondary">
                {saltIngestStatus.totalSubmitted > 0
                  ? t('settings.preferences.saltsContributed', { count: saltIngestStatus.totalSubmitted })
                  : t('settings.preferences.noSaltsYet')}
                {saltIngestStatus.lastError ? ` ${t('settings.preferences.lastSaltAttemptFailed', { error: saltIngestStatus.lastError })}` : ''}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        title={<Tx k="settings.sections.hiddenCreators" fallback="Hidden creators" />}
        description={<Tx k="hiddenCreators.description" fallback="Hide uploads from selected GameBanana creators in Browse. Installed mods remain visible." />}
        icon={EyeOff}
        action={
          <div className="flex items-center gap-2">
            <Badge>{hiddenCreators.length}</Badge>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={EyeOff}
              onClick={() => setHiddenCreatorsOpen(true)}
            >
              <Tx k="hiddenCreators.manage" fallback="Manage hidden creators" />
            </Button>
          </div>
        }
      >
        {hiddenCreators.length > 0 ? (
          <HiddenCreatorsManager creators={hiddenCreators} onRemove={handleShowCreator} />
        ) : (
          <p className="text-xs text-text-secondary">
            <Tx k="settings.privacy.noHiddenCreators" fallback="No creators are hidden right now." />
          </p>
        )}
      </Card>

      <HiddenCreatorsModal
        open={hiddenCreatorsOpen}
        onClose={() => setHiddenCreatorsOpen(false)}
        creators={hiddenCreators}
        onRemove={handleShowCreator}
      />
    </>
  );
}
