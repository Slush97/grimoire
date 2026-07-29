import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Beaker,
  Download,
  Globe,
  HardDrive,
  LifeBuoy,
  Palette,
  Shield,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { Card } from '../components/common/ui';
import { PageHeader, PageLayout, LoadingState } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';
import KofiSupportButton from '../components/KofiSupportButton';
import SocialAccountSection from '../components/social/SocialAccountSection';
import SettingsNav, { type SettingsNavGroup } from '../components/settings/SettingsNav';
import GameSection from '../components/settings/sections/GameSection';
import UpdatesSection from '../components/settings/sections/UpdatesSection';
import AppearanceSection from '../components/settings/sections/AppearanceSection';
import PreferencesSection from '../components/settings/sections/PreferencesSection';
import PrivacySection from '../components/settings/sections/PrivacySection';
import ExperimentalSection from '../components/settings/sections/ExperimentalSection';
import MaintenanceSection from '../components/settings/sections/MaintenanceSection';
import SupportSection from '../components/settings/sections/SupportSection';

type SectionId =
  | 'game'
  | 'appearance'
  | 'preferences'
  | 'privacy'
  | 'social'
  | 'updates'
  | 'experimental'
  | 'maintenance'
  | 'support';

// Settings is a lot of surface for one scroll, so the page is a nav + one
// pane: pick a category on the left, see only that category's cards on the
// right. Each section owns its own state and IPC calls, which keeps this file
// down to routing between them.
export default function Settings() {
  const { t } = useTranslation();
  const { settings, settingsLoading, loadSettings } = useAppStore();
  const [activeSection, setActiveSection] = useState<SectionId>('game');

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const socialEnabled = settings?.experimentalSocial ?? false;

  const navGroups = useMemo<SettingsNavGroup[]>(() => [
    {
      id: 'game',
      label: <Tx k="settings.nav.groups.game" fallback="Game" />,
      items: [
        { id: 'game', label: <Tx k="settings.nav.game" fallback="Game setup" />, icon: HardDrive },
      ],
    },
    {
      id: 'application',
      label: <Tx k="settings.nav.groups.application" fallback="Application" />,
      items: [
        { id: 'appearance', label: <Tx k="settings.sections.appearance" fallback="Appearance" />, icon: Palette },
        { id: 'preferences', label: <Tx k="settings.sections.preferences" fallback="Preferences" />, icon: SlidersHorizontal },
        { id: 'privacy', label: <Tx k="settings.nav.privacy" fallback="Privacy & Content" />, icon: Shield },
        ...(socialEnabled
          ? [{ id: 'social', label: <Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />, icon: Globe }]
          : []),
        { id: 'updates', label: <Tx k="settings.sections.updates" fallback="Updates" />, icon: Download },
      ],
    },
    {
      id: 'advanced',
      label: <Tx k="settings.nav.groups.advanced" fallback="Advanced" />,
      items: [
        { id: 'experimental', label: <Tx k="settings.sections.experimentalFeatures" fallback="Experimental Features" />, icon: Beaker },
        { id: 'maintenance', label: <Tx k="settings.sections.maintenance" fallback="Maintenance" />, icon: Wrench },
        { id: 'support', label: <Tx k="settings.sections.support" fallback="Support" />, icon: LifeBuoy },
      ],
    },
  ], [socialEnabled]);

  // Turning the social flag back off while its pane is open would otherwise
  // leave the page on a section that has no nav entry.
  const section: SectionId = activeSection === 'social' && !socialEnabled ? 'preferences' : activeSection;

  if (settingsLoading && !settings) {
    return <LoadingState />;
  }

  return (
    <PageLayout maxWidth="7xl">
      <PageHeader
        title={<Tx k="nav.settings" fallback="Settings" />}
        description={<Tx k="settings.header.description" fallback="Game paths, preferences, and maintenance" />}
        action={<KofiSupportButton />}
      />

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <SettingsNav
          groups={navGroups}
          active={section}
          onSelect={(id) => setActiveSection(id as SectionId)}
          label={t('settings.nav.label')}
        />

        <div className="min-w-0 flex-1 space-y-6">
          {section === 'game' && <GameSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'preferences' && <PreferencesSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'social' && socialEnabled && (
            <Card title={<Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />} icon={Globe}>
              <SocialAccountSection />
            </Card>
          )}
          {section === 'updates' && <UpdatesSection />}
          {section === 'experimental' && <ExperimentalSection />}
          {section === 'maintenance' && <MaintenanceSection />}
          {section === 'support' && <SupportSection />}
        </div>
      </div>
    </PageLayout>
  );
}
