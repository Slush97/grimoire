import { Zap, Globe, Layout, Map, Users, MousePointer2, type LucideIcon } from 'lucide-react';

// Curated Deadlock autoexec commands, grouped by what the player is trying to
// achieve. Every user-facing string is a catalog key with an English fallback:
// the command itself is never translated, only its name and description.

export interface PresetCommand {
    command: string;
    nameKey: string;
    nameFallback: string;
    descriptionKey: string;
    descriptionFallback: string;
}

export interface PresetCategory {
    categoryKey: string;
    categoryFallback: string;
    icon: LucideIcon;
    commands: PresetCommand[];
}

export const COMMAND_PRESETS: PresetCategory[] = [
    {
        categoryKey: 'autoexec.presets.performance.category',
        categoryFallback: 'Performance',
        icon: Zap,
        commands: [
            { nameKey: 'autoexec.presets.performance.uncapFps.name', nameFallback: 'Uncap FPS', command: 'fps_max 0', descriptionKey: 'autoexec.presets.performance.uncapFps.description', descriptionFallback: 'Remove framerate limit' },
            { nameKey: 'autoexec.presets.performance.capFps144.name', nameFallback: 'Cap FPS 144', command: 'fps_max 144', descriptionKey: 'autoexec.presets.performance.capFps144.description', descriptionFallback: 'Cap to 144 FPS' },
            { nameKey: 'autoexec.presets.performance.capFps240.name', nameFallback: 'Cap FPS 240', command: 'fps_max 240', descriptionKey: 'autoexec.presets.performance.capFps240.description', descriptionFallback: 'Cap to 240 FPS' },
            { nameKey: 'autoexec.presets.performance.lowLatencyNvidia.name', nameFallback: 'Low Latency (Nvidia)', command: 'r_low_latency 2', descriptionKey: 'autoexec.presets.performance.lowLatencyNvidia.description', descriptionFallback: 'Enable Nvidia Reflex low latency' },
            { nameKey: 'autoexec.presets.performance.engineLowLatency.name', nameFallback: 'Engine Low Latency', command: 'engine_low_latency_sleep_after_client_tick true', descriptionKey: 'autoexec.presets.performance.engineLowLatency.description', descriptionFallback: 'Reduce input lag' },
        ],
    },
    {
        categoryKey: 'autoexec.presets.network.category',
        categoryFallback: 'Network',
        icon: Globe,
        commands: [
            { nameKey: 'autoexec.presets.network.maxNetworkRate.name', nameFallback: 'Max Network Rate', command: 'rate 1000000', descriptionKey: 'autoexec.presets.network.maxNetworkRate.description', descriptionFallback: 'Maximum network update rate' },
        ],
    },
    {
        categoryKey: 'autoexec.presets.hud.category',
        categoryFallback: 'HUD & UI',
        icon: Layout,
        commands: [
            { nameKey: 'autoexec.presets.hud.newHealthBars.name', nameFallback: 'New Health Bars', command: 'citadel_unit_status_use_new true', descriptionKey: 'autoexec.presets.hud.newHealthBars.description', descriptionFallback: 'Enable new-style health bars' },
            { nameKey: 'autoexec.presets.hud.hideHud.name', nameFallback: 'Hide HUD', command: 'citadel_hud_visible false', descriptionKey: 'autoexec.presets.hud.hideHud.description', descriptionFallback: 'Hide the entire HUD' },
            { nameKey: 'autoexec.presets.hud.showHud.name', nameFallback: 'Show HUD', command: 'citadel_hud_visible true', descriptionKey: 'autoexec.presets.hud.showHud.description', descriptionFallback: 'Show the HUD' },
            { nameKey: 'autoexec.presets.hud.disablePostMatchSurvey.name', nameFallback: 'Disable Post-Match Survey', command: 'deadlock_post_match_survey_disabled true', descriptionKey: 'autoexec.presets.hud.disablePostMatchSurvey.description', descriptionFallback: 'Skip the survey after matches' },
            { nameKey: 'autoexec.presets.hud.offscreenDamageIndicator.name', nameFallback: 'Offscreen Damage Indicators', command: 'citadel_damage_offscreen_indicator_disabled false', descriptionKey: 'autoexec.presets.hud.offscreenDamageIndicator.description', descriptionFallback: 'Show minion indicators through walls when a teammate sees a droid' },
        ],
    },
    {
        categoryKey: 'autoexec.presets.minimap.category',
        categoryFallback: 'Minimap',
        icon: Map,
        commands: [
            { nameKey: 'autoexec.presets.minimap.fasterMinimap.name', nameFallback: 'Faster Minimap', command: 'minimap_update_rate_hz 60', descriptionKey: 'autoexec.presets.minimap.fasterMinimap.description', descriptionFallback: 'Update minimap at 60Hz' },
            { nameKey: 'autoexec.presets.minimap.largerClickRadius.name', nameFallback: 'Larger Click Radius', command: 'citadel_minimap_unit_click_radius 200', descriptionKey: 'autoexec.presets.minimap.largerClickRadius.description', descriptionFallback: 'Easier to click units on minimap' },
            { nameKey: 'autoexec.presets.minimap.largerPlayerIcons.name', nameFallback: 'Larger Player Icons', command: 'citadel_minimap_player_width 6.5', descriptionKey: 'autoexec.presets.minimap.largerPlayerIcons.description', descriptionFallback: 'Bigger player icons on minimap' },
            { nameKey: 'autoexec.presets.minimap.largerLocalPlayerIcon.name', nameFallback: 'Larger Local Player Icon', command: 'citadel_minimap_local_player_width 10.0', descriptionKey: 'autoexec.presets.minimap.largerLocalPlayerIcon.description', descriptionFallback: 'Make your own minimap icon larger' },
            { nameKey: 'autoexec.presets.minimap.thickerZiplines.name', nameFallback: 'Thicker Ziplines', command: 'citadel_minimap_zip_line_thickness 2', descriptionKey: 'autoexec.presets.minimap.thickerZiplines.description', descriptionFallback: 'More visible ziplines' },
        ],
    },
    {
        categoryKey: 'autoexec.presets.matchmaking.category',
        categoryFallback: 'Matchmaking',
        icon: Users,
        commands: [
            { nameKey: 'autoexec.presets.matchmaking.soloQueueOnly.name', nameFallback: 'Solo Queue Only', command: 'mm_prefer_solo_only 1', descriptionKey: 'autoexec.presets.matchmaking.soloQueueOnly.description', descriptionFallback: 'Prefer matches with solo players' },
            { nameKey: 'autoexec.presets.matchmaking.naRegion.name', nameFallback: 'NA Region', command: 'citadel_region_override 0', descriptionKey: 'autoexec.presets.matchmaking.naRegion.description', descriptionFallback: 'Force North America servers' },
            { nameKey: 'autoexec.presets.matchmaking.euRegion.name', nameFallback: 'EU Region', command: 'citadel_region_override 1', descriptionKey: 'autoexec.presets.matchmaking.euRegion.description', descriptionFallback: 'Force Europe servers' },
            { nameKey: 'autoexec.presets.matchmaking.asiaRegion.name', nameFallback: 'Asia Region', command: 'citadel_region_override 2', descriptionKey: 'autoexec.presets.matchmaking.asiaRegion.description', descriptionFallback: 'Force Asia servers' },
            { nameKey: 'autoexec.presets.matchmaking.autoRegion.name', nameFallback: 'Auto Region', command: 'citadel_region_override -1', descriptionKey: 'autoexec.presets.matchmaking.autoRegion.description', descriptionFallback: 'Automatic region selection' },
        ],
    },
    {
        categoryKey: 'autoexec.presets.mouse.category',
        categoryFallback: 'Mouse & Sensitivity',
        icon: MousePointer2,
        commands: [
            { nameKey: 'autoexec.presets.mouse.adsSensitivity.name', nameFallback: '1:1 ADS Sensitivity', command: 'zoom_sensitivity_ratio 0.818933027098955175', descriptionKey: 'autoexec.presets.mouse.adsSensitivity.description', descriptionFallback: 'Match ADS to hip-fire sensitivity' },
        ],
    },
];

/** Every preset command in one flat list, for "is this a known preset" lookups. */
export const PRESET_COMMAND_COUNT = COMMAND_PRESETS.reduce((n, c) => n + c.commands.length, 0);
