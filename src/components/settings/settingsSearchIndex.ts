import type { TFunction } from 'i18next';

export interface SettingsSearchEntry {
  section: string;
  category: string;
  label: string;
  description: string;
  target: string;
}

// Labels and descriptions come from the controls' existing translation keys.
export function settingsSearchEntries(
  t: TFunction,
  { socialEnabled = false, modSafetyEnabled = false }: { socialEnabled?: boolean; modSafetyEnabled?: boolean } = {},
): SettingsSearchEntry[] {
  return [
    ...(socialEnabled ? [{ section: 'social', category: t('settings.sections.grimoireSocial'), label: t('settings.sections.grimoireSocial'), description: t('settings.experimental.socialDescription'), target: 'settings-social' }] : []),
    ...(modSafetyEnabled ? [{ section: 'mod-safety', category: t('modSafety.manage'), label: t('modSafety.manage'), description: t('settings.toggles.modSafety'), target: 'settings-mod-safety' }] : []),
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.sections.appearance'), description: '', target: 'settings-appearance-settings-sections-appearance-card' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.appearance.oled.title'), description: '', target: 'settings-appearance-settings-appearance-oled-title-toggle' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.nav.language'), description: '', target: 'settings-appearance-settings-nav-language-card' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.sections.experimentalFeatures'), description: '', target: 'settings-experimental-settings-sections-experimentalFeatures-card' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.experimental.statsDashboard'), description: t('settings.experimental.statsDashboardDescription'), target: 'settings-experimental-settings-experimental-statsDashboard-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.experimental.crosshairDesigner'), description: t('settings.experimental.crosshairDesignerDescription'), target: 'settings-experimental-settings-experimental-crosshairDesigner-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.sections.grimoireSocial'), description: t('settings.experimental.socialDescription'), target: 'settings-experimental-settings-sections-grimoireSocial-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.experimental.fixUnknownMods'), description: t('settings.toggles.fixUnknown'), target: 'settings-experimental-settings-experimental-fixUnknownMods-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.experimental.vpkImprint'), description: t('settings.toggles.vpkImprint'), target: 'settings-experimental-settings-experimental-vpkImprint-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('modSafety.manage'), description: t('settings.toggles.modSafety'), target: 'settings-experimental-modSafety-manage-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.experimental.deadworksServers'), description: t('settings.toggles.deadworks'), target: 'settings-experimental-settings-experimental-deadworksServers-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.experimental.foundry'), description: '', target: 'settings-experimental-settings-experimental-foundry-toggle' },
    { section: 'experimental', category: t('settings.sections.experimentalFeatures'), label: t('settings.preferences.developerMode'), description: t('settings.preferences.developerModeDescription'), target: 'settings-experimental-settings-preferences-developerMode-toggle' },
    { section: 'game', category: t('settings.nav.game'), label: t('settings.sections.gameConfiguration'), description: '', target: 'settings-game-settings-sections-gameConfiguration-card' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.sections.maintenance'), description: '', target: 'settings-maintenance-settings-sections-maintenance-card' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.sections.modDatabaseCache'), description: `${t('settings.cache.syncDatabase')}. ${t('settings.cache.wipeCache')}`, target: 'settings-maintenance-settings-sections-modDatabaseCache-card' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.sections.localPreviewCache'), description: t('settings.cache.previewDescription'), target: 'settings-maintenance-settings-sections-localPreviewCache-card' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.sections.preferences'), description: '', target: 'settings-preferences-settings-sections-preferences-card' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.expandLocker'), description: t('settings.toggles.expandLocker'), target: 'settings-preferences-settings-preferences-expandLocker-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.confirmProfileUpdate'), description: t('settings.toggles.confirmProfileUpdate'), target: 'settings-preferences-settings-preferences-confirmProfileUpdate-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.ignoreConflicts'), description: t('settings.toggles.ignoreConflicts'), target: 'settings-preferences-settings-preferences-ignoreConflicts-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.keepModBackups'), description: t('settings.toggles.keepModBackups'), target: 'settings-preferences-settings-preferences-keepModBackups-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.sections.installationAndUpdates'), description: '', target: 'settings-preferences-settings-sections-installationAndUpdates-card' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.switchVariants'), description: t('settings.toggles.switchVariants'), target: 'settings-preferences-settings-preferences-switchVariants-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.enableAfterDownload'), description: t('settings.toggles.enableAfterDownload'), target: 'settings-preferences-settings-preferences-enableAfterDownload-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.autoMatchRemainingFiles'), description: t('settings.toggles.autoMatchRemainingFiles'), target: 'settings-preferences-settings-preferences-autoMatchRemainingFiles-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.skipModReplacementConfirmation'), description: t('settings.toggles.skipModReplacementConfirmation'), target: 'settings-preferences-settings-preferences-skipModReplacementConfirmation-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.swapManualReplacementActions'), description: t('settings.toggles.swapManualReplacementActions'), target: 'settings-preferences-settings-preferences-swapManualReplacementActions-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.sections.integrations'), description: '', target: 'settings-preferences-settings-sections-integrations-card' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('forge.settings.toggleLabel'), description: '', target: 'settings-preferences-forge-settings-toggleLabel-toggle' },
    { section: 'preferences', category: t('settings.sections.preferences'), label: t('settings.preferences.discordRpc'), description: t('settings.toggles.discordRpc'), target: 'settings-preferences-settings-preferences-discordRpc-toggle' },
    { section: 'privacy', category: t('settings.nav.privacy'), label: t('settings.nav.privacy'), description: '', target: 'settings-privacy-settings-nav-privacy-card' },
    { section: 'privacy', category: t('settings.nav.privacy'), label: t('settings.preferences.contributeMatchData'), description: t('settings.toggles.contributeSalts'), target: 'settings-privacy-settings-preferences-contributeMatchData-toggle' },
    { section: 'privacy', category: t('settings.nav.privacy'), label: t('settings.sections.hiddenCreators'), description: t('hiddenCreators.description'), target: 'settings-privacy-settings-sections-hiddenCreators-card' },
    { section: 'privacy', category: t('settings.nav.privacy'), label: t('hiddenMods.title'), description: t('hiddenMods.description'), target: 'settings-privacy-hiddenMods-title-card' },
    { section: 'support', category: t('settings.sections.support'), label: t('settings.sections.support'), description: '', target: 'settings-support-settings-sections-support-card' },
    { section: 'updates', category: t('settings.sections.updates'), label: t('settings.sections.updates'), description: '', target: 'settings-updates-settings-sections-updates-card' },
    { section: 'updates', category: t('settings.sections.updates'), label: t('settings.updates.autoCheck'), description: t('settings.updates.autoCheckDescription'), target: 'settings-updates-settings-updates-autoCheck-toggle' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.appearance.launchButtons.combine'), description: '', target: 'settings-appearance-settings-appearance-launchButtons-combine-toggle' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.appearance.sidebar.transparent'), description: '', target: 'settings-appearance-settings-appearance-sidebar-transparent-toggle' },
    { section: 'game', category: t('settings.nav.game'), label: t('settings.gamePath.label'), description: t('settings.gamePath.selectHint'), target: 'settings-game-settings-sections-gameConfiguration-card' },
    { section: 'game', category: t('settings.nav.game'), label: t('settings.gameinfo.title'), description: t('settings.gameinfo.verifySteam'), target: 'settings-game-settings-sections-gameConfiguration-card' },
    { section: 'game', category: t('settings.nav.game'), label: t('settings.autoexec.title'), description: t('settings.autoexec.description'), target: 'settings-game-settings-sections-gameConfiguration-card' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.preferences.dateFormat'), description: t('settings.preferences.dateFormatDescription'), target: 'settings-date-format' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.appearance.background.title'), description: '', target: 'settings-background' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.maintenance.cleanupAddons'), description: t('settings.maintenance.cleanupDescription'), target: 'settings-maintenance-settings-sections-maintenance-card' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.setupWizard.title'), description: t('settings.setupWizard.description'), target: 'settings-maintenance-settings-sections-maintenance-card' },
    { section: 'privacy', category: t('settings.nav.privacy'), label: t('settings.privacy.nsfwContent'), description: t('settings.privacy.nsfwContentDescription'), target: 'settings-privacy-settings-nav-privacy-card' },
    { section: 'updates', category: t('settings.sections.updates'), label: t('settings.updates.channel'), description: t('settings.updates.nightlyDescription'), target: 'settings-updates-settings-sections-updates-card' },
    { section: 'performance', category: t('performance.title'), label: t('performance.title'), description: t('performance.description'), target: 'settings-performance' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.appearance.accent.title'), description: '', target: 'settings-accent' },
    { section: 'appearance', category: t('settings.sections.appearance'), label: t('settings.appearance.art.title'), description: t('settings.appearance.art.description'), target: 'settings-launcher-art' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.downloadServers.title'), description: '', target: 'settings-download-servers' },
    { section: 'maintenance', category: t('settings.sections.maintenance'), label: t('settings.downloadProxy.title'), description: t('settings.downloadProxy.description'), target: 'settings-download-proxy' },
  ];
}

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function searchSettings(entries: SettingsSearchEntry[], query: string): SettingsSearchEntry[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries
    .filter((entry) => {
      const text = normalize(`${entry.label} ${entry.description} ${entry.category}`);
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => {
      const score = (entry: SettingsSearchEntry) => words.filter((word) => normalize(entry.label).includes(word)).length;
      return score(b) - score(a);
    });
}
