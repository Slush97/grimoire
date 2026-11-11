import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { applyTheme } from '../../lib/applyTheme';
import { APP_THEMES, DEFAULT_THEME, type AppTheme } from '../../lib/theme';
import Tx from '../translation/Tx';

/**
 * Dark, OLED or light, as three miniature app windows. Each tile carries its
 * theme's class, so it is drawn with that theme's real tokens and the user's
 * accent: what the tile shows is what a click gives.
 */
export default function ThemePicker() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const current = settings?.theme ?? DEFAULT_THEME;

  const names: Record<AppTheme, string> = {
    dark: t('settings.appearance.theme.dark'),
    oled: t('settings.appearance.theme.oled'),
    light: t('settings.appearance.theme.light'),
  };

  const select = async (theme: AppTheme) => {
    if (!settings || theme === current) return;
    // Repaint on click; the store push in saveSettings lands a moment later.
    applyTheme(theme);
    await saveSettings({ ...settings, theme });
  };

  return (
    <div>
      <h3 id="settings-theme-title" className="mb-3 text-sm font-semibold text-text-primary">
        <Tx k="settings.appearance.theme.title" fallback="Theme" />
      </h3>
      <div role="radiogroup" aria-labelledby="settings-theme-title" className="flex flex-wrap gap-3">
        {APP_THEMES.map((theme) => {
          const active = theme === current;
          return (
            <button
              key={theme}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => void select(theme)}
              className="group flex cursor-pointer flex-col gap-1.5 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
            >
              <span
                className={`relative block h-16 w-28 overflow-hidden rounded-sm border transition-colors ${
                  active ? 'border-accent' : 'border-hl/15 group-hover:border-hl/40'
                }`}
              >
                <span className={`theme-${theme} absolute inset-0 flex bg-bg-primary`} aria-hidden>
                  <span className="flex w-7 flex-col gap-1 border-r border-border bg-bg-secondary px-1.5 py-2">
                    <span className="h-1 rounded-full bg-accent" />
                    <span className="h-1 rounded-full bg-text-tertiary/60" />
                    <span className="h-1 rounded-full bg-text-tertiary/60" />
                  </span>
                  <span className="flex flex-1 flex-col gap-1.5 p-2">
                    <span className="h-1.5 w-9 rounded-full bg-text-primary" />
                    <span className="flex flex-1 gap-1.5">
                      <span className="flex-1 rounded-sm border border-border bg-bg-secondary" />
                      <span className="flex-1 rounded-sm border border-border bg-bg-secondary" />
                    </span>
                  </span>
                </span>
                {active && (
                  <span className="absolute right-1 top-1 rounded-sm bg-accent p-0.5 text-accent-foreground">
                    <Check className="h-2.5 w-2.5" aria-hidden />
                  </span>
                )}
              </span>
              <span className={`text-xs font-medium ${active ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                {names[theme]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
