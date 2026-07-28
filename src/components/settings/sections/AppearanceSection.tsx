import { Languages, Palette } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { formatDateParts } from '../../../lib/dateFormat';
import { Card } from '../../common/ui';
import Tx from '../../translation/Tx';
import AccentColorPicker from '../AccentColorPicker';
import BackgroundGradientPicker from '../BackgroundGradientPicker';
import AppearanceArtSection from '../AppearanceArtSection';
import LanguageSelector from '../LanguageSelector';

// Everything that changes how the app looks and reads. The card is a single
// stacked list (accent, background, launcher chrome) rather than a header
// action plus a body, so every appearance control reads at the same level.
export default function AppearanceSection() {
  const { settings, saveSettings } = useAppStore();

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
        <AccentColorPicker />

        <div className="my-5 h-px bg-white/5" />

        <BackgroundGradientPicker />

        <div className="my-5 h-px bg-white/5" />

        <AppearanceArtSection />
      </Card>

      <Card title={<Tx k="settings.nav.language" fallback="Language & region" />} icon={Languages}>
        <div className="space-y-6">
          <LanguageSelector
            value={settings?.language ?? null}
            onChange={handleLanguageChange}
          />

          <div className="h-px bg-white/5" />

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
            <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
              {(['MM/DD/YYYY', 'DD/MM/YYYY'] as const).map((fmt, i) => {
                const active = (settings?.dateFormat ?? 'MM/DD/YYYY') === fmt;
                return (
                  <button
                    key={fmt}
                    onClick={() => handleDateFormatChange(fmt)}
                    className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                      i > 0 ? 'border-l border-white/10' : ''
                    } ${
                      active
                        ? 'bg-accent/20 text-text-primary'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-white/5'
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
