import { useTranslation } from 'react-i18next';
import { Languages, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { formatDateParts } from '../../../lib/dateFormat';
import { Card, SegmentedControl } from '../../common/ui';
import Tx from '../../translation/Tx';
import AccentColorPicker from '../AccentColorPicker';
import BackgroundGradientPicker from '../BackgroundGradientPicker';
import AppearanceArtSection from '../AppearanceArtSection';
import LanguageSelector from '../LanguageSelector';

type ColorScheme = 'system' | 'light' | 'dark';

// Everything that changes how the app looks and reads. The card is a single
// stacked list (accent, background, launcher chrome) rather than a header
// action plus a body, so every appearance control reads at the same level.
export default function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useAppStore();

  const handleColorSchemeChange = async (colorScheme: ColorScheme) => {
    if (settings && settings.colorScheme !== colorScheme) {
      await saveSettings({ ...settings, colorScheme });
    }
  };

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
      <Card title={<Tx k="settings.sections.appearance" fallback="Appearance" />} icon={Palette}>
        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-text-primary">
              <Tx k="settings.appearance.theme.title" fallback="Theme" />
            </h3>
            <p className="text-xs text-text-secondary">
              <Tx
                k="settings.appearance.theme.description"
                fallback="Choose how Grimoire looks. System follows your operating system setting."
              />
            </p>
          </div>

          <SegmentedControl<ColorScheme>
            options={[
              {
                value: 'system',
                label: (
                  <>
                    <Monitor className="h-3.5 w-3.5" aria-hidden />
                    {t('settings.appearance.theme.system')}
                  </>
                ),
              },
              {
                value: 'light',
                label: (
                  <>
                    <Sun className="h-3.5 w-3.5" aria-hidden />
                    {t('settings.appearance.theme.light')}
                  </>
                ),
              },
              {
                value: 'dark',
                label: (
                  <>
                    <Moon className="h-3.5 w-3.5" aria-hidden />
                    {t('settings.appearance.theme.dark')}
                  </>
                ),
              },
            ]}
            value={settings?.colorScheme ?? 'dark'}
            onChange={(value) => void handleColorSchemeChange(value)}
            label={t('settings.appearance.theme.title')}
          />
        </div>

        <div className="my-5 h-px bg-hl/5" />

        <AccentColorPicker />

        <div className="my-5 h-px bg-hl/5" />

        <BackgroundGradientPicker />

        <div className="my-5 h-px bg-hl/5" />

        <AppearanceArtSection />
      </Card>

      <Card title={<Tx k="settings.nav.language" fallback="Language & region" />} icon={Languages}>
        <div className="space-y-6">
          <LanguageSelector
            value={settings?.language ?? null}
            onChange={handleLanguageChange}
          />

          <div className="h-px bg-hl/5" />

          <div>
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
          </div>
        </div>
      </Card>
    </>
  );
}
