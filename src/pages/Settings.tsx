import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Beaker,
  Download,
  Gauge,
  Globe,
  HardDrive,
  LifeBuoy,
  Palette,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { Card } from '../components/common/ui';
import { PageHeader, PageLayout, LoadingState } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';
import KofiSupportButton from '../components/KofiSupportButton';
import SocialAccountSection from '../components/social/SocialAccountSection';
import SettingsSearch from '../components/settings/SettingsSearch';
import type { SettingsSearchEntry } from '../components/settings/settingsSearchIndex';
import SettingsNav, { type SettingsNavGroup } from '../components/settings/SettingsNav';
import GameSection from '../components/settings/sections/GameSection';
import UpdatesSection from '../components/settings/sections/UpdatesSection';
import AppearanceSection from '../components/settings/sections/AppearanceSection';
import PreferencesSection from '../components/settings/sections/PreferencesSection';
import PrivacySection from '../components/settings/sections/PrivacySection';
import ExperimentalSection from '../components/settings/sections/ExperimentalSection';
import MaintenanceSection from '../components/settings/sections/MaintenanceSection';
import SupportSection from '../components/settings/sections/SupportSection';
import PerformanceConfigCard from '../components/performance/PerformanceConfigCard';
import { ModSafetySection } from '../components/ModSafety';

const SECTION_IDS = [
  'game',
  'performance',
  'appearance',
  'preferences',
  'privacy',
  'mod-safety',
  'social',
  'updates',
  'experimental',
  'maintenance',
  'support',
] as const;
type SectionId = (typeof SECTION_IDS)[number];

// Settings is a lot of surface for one scroll, so the page is a nav + one
// pane: pick a category on the left, see only that category's cards on the
// right. Each section owns its own state and IPC calls, which keeps this file
// down to routing between them.
export default function Settings() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const settingsLoading = useAppStore((s) => s.settingsLoading);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const targetId = searchParams.get('setting');
  const searching = query.trim().length > 0;

  const openSearchResult = (entry: SettingsSearchEntry) => {
    setQuery('');
    navigate(`/settings/${entry.section}?setting=${encodeURIComponent(entry.target)}`);
  };
  // The section lives in the URL so other pages can link straight to one (/settings/mod-safety).
  const { section: sectionParam } = useParams();
  const activeSection: SectionId = SECTION_IDS.find((id) => id === sectionParam) ?? 'game';

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const socialEnabled = settings?.experimentalSocial ?? false;
  const modSafetyEnabled = settings?.experimentalModSafety ?? false;

  const navGroups = useMemo<SettingsNavGroup[]>(() => [
    {
      id: 'game',
      label: <Tx k="settings.nav.groups.game" fallback="Game" />,
      items: [
        { id: 'game', label: <Tx k="settings.nav.game" fallback="Game setup" />, icon: HardDrive },
        { id: 'performance', label: <Tx k="performance.title" fallback="Performance" />, icon: Gauge },
      ],
    },
    {
      id: 'application',
      label: <Tx k="settings.nav.groups.application" fallback="Application" />,
      items: [
        { id: 'appearance', label: <Tx k="settings.sections.appearance" fallback="Appearance" />, icon: Palette },
        { id: 'preferences', label: <Tx k="settings.sections.preferences" fallback="Preferences" />, icon: SlidersHorizontal },
        { id: 'privacy', label: <Tx k="settings.nav.privacy" fallback="Privacy & Content" />, icon: Shield },
        ...(modSafetyEnabled
          ? [{ id: 'mod-safety', label: <Tx k="modSafety.manage" fallback="Mod safety" />, icon: ShieldCheck }]
          : []),
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
  ], [socialEnabled, modSafetyEnabled]);

  // Turning a flag back off while its pane is open would otherwise leave the
  // page on a section that has no nav entry.
  const section: SectionId =
    (activeSection === 'social' && !socialEnabled) || (activeSection === 'mod-safety' && !modSafetyEnabled)
      ? 'preferences'
      : activeSection;

  useEffect(() => {
    if (searching || !targetId || settingsLoading) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.tabIndex = -1;
    target.setAttribute('data-settings-highlight', '');
    const control = target.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled)');
    (control ?? target).focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    const timeout = window.setTimeout(() => target.removeAttribute('data-settings-highlight'), 3000);
    return () => {
      window.clearTimeout(timeout);
      target.removeAttribute('data-settings-highlight');
      target.removeAttribute('tabindex');
    };
  }, [targetId, section, searching, settingsLoading]);

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

      <SettingsSearch
        query={query}
        socialEnabled={socialEnabled}
        modSafetyEnabled={modSafetyEnabled}
        onQueryChange={(value) => {
          setQuery(value);
          if (targetId) navigate(`/settings/${section}`, { replace: true });
        }}
        onSelect={openSearchResult}
      >
        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <SettingsNav
            groups={navGroups}
            active={section}
            onSelect={(id) => { setQuery(''); navigate(`/settings/${id}`, { replace: true }); }}
            label={t('settings.nav.label')}
          />

          <div className="min-w-0 flex-1 space-y-6">
            {section === 'game' && <GameSection />}
            {section === 'performance' && <div id="settings-performance"><PerformanceConfigCard /></div>}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'preferences' && <PreferencesSection />}
            {section === 'privacy' && <PrivacySection />}
            {section === 'mod-safety' && <div id="settings-mod-safety"><ModSafetySection /></div>}
            {section === 'social' && socialEnabled && (
              <Card id="settings-social" title={<Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />} icon={Globe}>
                <SocialAccountSection />
              </Card>
            )}
            {section === 'updates' && <UpdatesSection />}
            {section === 'experimental' && <ExperimentalSection />}
            {section === 'maintenance' && <MaintenanceSection />}
            {section === 'support' && <SupportSection />}
          </div>
        </div>
      </SettingsSearch>
    </PageLayout>
  );
}
