import { FilterItem, FilterDivider } from '../../common/FilteredContent';
import { Languages, Palette } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { formatDateParts } from '../../../lib/dateFormat';
import { Card, Toggle } from '../../common/ui';
import Tx from '../../translation/Tx';
import AccentColorPicker from '../AccentColorPicker';
import BackgroundGradientPicker from '../BackgroundGradientPicker';
import AppearanceArtSection from '../AppearanceArtSection';
import LanguageSelector from '../LanguageSelector';

// Everything that changes how the app looks and reads. The card is a single
// stacked list (accent, background, launcher chrome) rather than a header
// action plus a body, so every appearance control reads at the same level.
export default function AppearanceSection() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);

  const handleDateFormatChange = async (format: 'MM/DD/YYYY' | 'DD/MM/YYYY') => {
    if (settings && settings.dateFormat !== format) {
      await saveSettings({ ...settings, dateFormat: format });
    }
  };

  const handleLanguageChange = async (language: string | null) => {
    if (settings && (settings.language ?? null) !== language) {
      await saveSettings({ ...settings, language });
    }
  };

  return (
    <>
      <Card id="settings-appearance-settings-sections-appearance-card" title={<Tx k="settings.sections.appearance" fallback="Appearance" />} icon={Palette}>
        <Toggle id="settings-appearance-settings-appearance-oled-title-toggle"
          checked={settings?.oledMode ?? false}
          onChange={(checked) => settings && void saveSettings({ ...settings, oledMode: checked })}
          label={<Tx k="settings.appearance.oled.title" fallback="OLED mode" />}
        />

        <FilterDivider className="my-5 h-px bg-hl/5" />

        <Toggle id="settings-elastic-overscroll"
          checked={settings?.elasticOverscroll ?? true}
          onChange={(checked) => settings && void saveSettings({ ...settings, elasticOverscroll: checked })}
          label={<Tx k="settings.appearance.scrollBounce.title" fallback="Scroll bounce" />}
          description={<Tx k="settings.appearance.scrollBounce.description" fallback="Bounce the page when scrolling past the top or bottom." />}
        />

        <FilterDivider className="my-5 h-px bg-hl/5" />

        <FilterItem id="settings-accent"><AccentColorPicker /></FilterItem>

        <FilterDivider className="my-5 h-px bg-hl/5" />

        <FilterItem id="settings-background"><BackgroundGradientPicker /></FilterItem>

        <FilterDivider className="my-5 h-px bg-hl/5" />

        <AppearanceArtSection />
      </Card>

      <Card id="settings-appearance-settings-nav-language-card" title={<Tx k="settings.nav.language" fallback="Language & region" />} icon={Languages}>
        <div className="space-y-6">
          <FilterItem id="settings-language">
            <LanguageSelector
              value={settings?.language ?? null}
              onChange={handleLanguageChange}
            />
          </FilterItem>

          <FilterDivider className="h-px bg-hl/5" />

          <FilterItem id="settings-date-format">
            <label className="text-sm font-medium text-text-primary block">
              <Tx k="settings.preferences.dateFormat" fallback="Date Format" />
            </label>
            <p className="text-xs text-text-secondary mt-0.5 mb-2">
              <Tx
                k="settings.preferences.dateFormatDescription"
                fallback="How upload and update dates are shown on mods and files."
              />
            </p>
            <div className="inline-flex rounded-md border border-hl/10 overflow-hidden">
              {(['MM/DD/YYYY', 'DD/MM/YYYY'] as const).map((fmt, i) => {
                const active = (settings?.dateFormat ?? 'MM/DD/YYYY') === fmt;
                return (
                  <button
                    key={fmt}
                    onClick={() => handleDateFormatChange(fmt)}
                    className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                      i > 0 ? 'border-l border-hl/10' : ''
                    } ${
                      active
                        ? 'bg-accent/20 text-text-primary'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-hl/5'
                    }`}
                  >
                    {fmt}
                    <span className="ml-2 text-xs text-text-tertiary">{formatDateParts(new Date(), fmt)}</span>
                  </button>
                );
              })}
            </div>
          </FilterItem>
        </div>
      </Card>
    </>
  );
}
