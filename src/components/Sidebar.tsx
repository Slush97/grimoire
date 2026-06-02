import { useEffect, useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Boxes,
  Compass,
  Globe2,
  Vault,
  Target,
  ScrollText,
  Activity,
  Swords,
  BookMarked,
  Settings2,
  AlertTriangle,
  ArrowRight,
  Download,
  Play,
  Wand2,
  RotateCcw,
  Loader2,
  Menu,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  getConflicts,
  getGameRunningStatus,
  getVanillaStashStatus,
  launchModded,
  launchVanilla,
  onVanillaRestoreComplete,
  restoreVanillaStash,
  socialListProfiles,
  stopGame,
  type VanillaStashStatus,
  type VanillaRestoreResult,
} from '../lib/api';

import { getAssetPath } from '../lib/assetPath';
import { DEFAULT_SIDEBAR_HERO, getHeroFacePosition, getHeroRenderPath } from '../lib/lockerUtils';
import { useAppStore } from '../stores/appStore';
import UpdateModal from './UpdateModal';

const COLLAPSED_KEY = 'grimoire:sidebar-collapsed';
const LABEL_TRANSITION_MS = 260;
const DISCOVER_LAST_SEEN_KEY = 'grimoire:discover:last-seen-created-at';
const DISCOVER_BADGE_POLL_MS = 2 * 60 * 1000;
const PREVIEW_VOLUME_HIDE_DELAY_MS = 60 * 1000;
const GRIMOIRE_TITLE_ICON = getAssetPath('/grimoire-title-icon.svg');
const LAUNCH_MODDED_BG = getAssetPath('/locker/launch-modded-bg.webp');
const LAUNCH_VANILLA_BG = getAssetPath('/locker/launch-vanilla-bg.jpg');
const PREVIEW_VOLUME_BG = getAssetPath('/sidebar/preview-volume-bg.jpg');

function readCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === '1';
}

function readDiscoverLastSeen(): number | null {
  try {
    const raw = localStorage.getItem(DISCOVER_LAST_SEEN_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeDiscoverLastSeen(createdAt: number): void {
  try {
    localStorage.setItem(DISCOVER_LAST_SEEN_KEY, String(createdAt));
  } catch {
    /* quota / private mode */
  }
}

function writeSidebarWidthVariable(collapsed: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    '--grimoire-sidebar-width',
    collapsed ? '4rem' : '14rem'
  );
}

function newestCreatedAt(profiles: Array<{ created_at: number }>): number {
  return profiles.reduce((latest, profile) => Math.max(latest, profile.created_at), 0);
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function GrimoireTitleIcon() {
  return (
    <img
      src={GRIMOIRE_TITLE_ICON}
      alt=""
      aria-hidden
      draggable={false}
      className="h-6 w-6 flex-shrink-0 opacity-90"
    />
  );
}

function SidebarActiveBackdrop({
  heroSrc,
  heroPositionX,
}: {
  heroSrc: string | null;
  heroPositionX: number;
}) {
  if (heroSrc) {
    return (
      <span aria-hidden className="sidebar-active-backdrop pointer-events-none absolute inset-0">
        <img
          src={heroSrc}
          alt=""
          className="sidebar-active-backdrop__image h-full w-full object-cover opacity-75"
          style={{ objectPosition: `${heroPositionX}% 18%` }}
        />
        <span className="absolute inset-0 bg-gradient-to-r from-bg-primary/90 via-bg-primary/55 to-bg-primary/20" />
        <span className="absolute inset-0 bg-black/20" />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="sidebar-active-backdrop pointer-events-none absolute inset-0 bg-accent/10"
    >
      <span className="absolute inset-0 bg-gradient-to-r from-accent/20 via-accent/8 to-transparent" />
    </span>
  );
}

function LaunchButtonBackdrop({
  src,
  position = 'center',
  warm = false,
}: {
  src: string;
  position?: string;
  warm?: boolean;
}) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <img
        src={src}
        alt=""
        className={`h-full w-full object-cover opacity-65 transition-transform duration-300 group-hover:scale-[1.04] ${
          warm ? 'saturate-[0.95]' : 'saturate-[1.05]'
        }`}
        style={{ objectPosition: position }}
      />
      <span
        className={`absolute inset-0 ${
          warm
            ? 'bg-gradient-to-r from-bg-primary/85 via-bg-primary/55 to-amber-950/25'
            : 'bg-gradient-to-r from-bg-primary/82 via-bg-primary/50 to-emerald-950/20'
        }`}
      />
      <span className="absolute inset-0 bg-black/20" />
    </span>
  );
}

export default function Sidebar() {
  const { t } = useTranslation();
  const [conflictCount, setConflictCount] = useState(0);
  const [discoverNotificationCount, setDiscoverNotificationCount] = useState(0);
  const [appVersion, setAppVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const settings = useAppStore((state) => state.settings);
  const mods = useAppStore((state) => state.mods);
  const loadMods = useAppStore((state) => state.loadMods);
  const soundVolume = useAppStore((state) => state.soundVolume);
  const setSoundVolume = useAppStore((state) => state.setSoundVolume);
  const previewAudioPlaying = useAppStore((state) => state.previewAudioPlaying);
  const navigate = useNavigate();
  const location = useLocation();

  const installedCount = mods.length;

  const [stashStatus, setStashStatus] = useState<VanillaStashStatus>({ active: false });
  const [launchPending, setLaunchPending] = useState<'modded' | 'vanilla' | null>(null);
  const [gameRunning, setGameRunning] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  // Toasts can carry an optional action button (used for "Enable" after a
  // fresh download and "Re-enable" after a sibling auto-disable). The action
  // closes the toast when invoked.
  const [toast, setToast] = useState<{
    kind: 'info' | 'error';
    text: string;
    action?: { label: string; onClick: () => void | Promise<void> };
  } | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  // Persisted via localStorage so it survives reloads without round-tripping
  // through the main-process settings file. This is pure UI state.
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsedPreference);
  const [labelsVisible, setLabelsVisible] = useState<boolean>(() => !readCollapsedPreference());
  const [labelMounted, setLabelMounted] = useState<boolean>(() => !readCollapsedPreference());
  const [showPreviewVolume, setShowPreviewVolume] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);
  const previewVolumeHideTimerRef = useRef<number | null>(null);
  const labelFrameRef = useRef<number | null>(null);
  const navListRef = useRef<HTMLUListElement | null>(null);
  const navItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [activeNavMetrics, setActiveNavMetrics] = useState<{
    top: number;
    height: number;
  } | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (labelFrameRef.current !== null) {
      window.cancelAnimationFrame(labelFrameRef.current);
      labelFrameRef.current = null;
    }
  }, []);

  const clearPreviewVolumeHideTimer = useCallback(() => {
    if (previewVolumeHideTimerRef.current !== null) {
      window.clearTimeout(previewVolumeHideTimerRef.current);
      previewVolumeHideTimerRef.current = null;
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    clearCollapseTimer();
    if (collapsed) {
      writeSidebarWidthVariable(false);
      setCollapsed(false);
      setLabelMounted(true);
      setLabelsVisible(false);
      labelFrameRef.current = window.requestAnimationFrame(() => {
        labelFrameRef.current = window.requestAnimationFrame(() => {
          setLabelsVisible(true);
          labelFrameRef.current = null;
        });
      });
    } else {
      writeSidebarWidthVariable(true);
      setLabelMounted(true);
      setLabelsVisible(false);
      setCollapsed(true);
      collapseTimerRef.current = window.setTimeout(() => {
        setLabelMounted(false);
        collapseTimerRef.current = null;
      }, LABEL_TRANSITION_MS);
    }
  }, [clearCollapseTimer, collapsed]);

  useEffect(() => clearCollapseTimer, [clearCollapseTimer]);

  useEffect(() => {
    clearPreviewVolumeHideTimer();
    if (previewAudioPlaying) {
      setShowPreviewVolume(true);
      return clearPreviewVolumeHideTimer;
    }
    if (showPreviewVolume) {
      previewVolumeHideTimerRef.current = window.setTimeout(() => {
        setShowPreviewVolume(false);
        previewVolumeHideTimerRef.current = null;
      }, PREVIEW_VOLUME_HIDE_DELAY_MS);
    }
    return clearPreviewVolumeHideTimer;
  }, [clearPreviewVolumeHideTimer, previewAudioPlaying, showPreviewVolume]);

  const labelTransitionClass = `sidebar-collapsible-label ${
    labelsVisible ? 'sidebar-collapsible-label--visible' : 'sidebar-collapsible-label--hidden'
  }`;
  const titleTransitionClass = `sidebar-title-text ${
    labelsVisible ? 'sidebar-title-text--visible' : 'sidebar-title-text--hidden'
  }`;
  const navLabelClass = `flex-1 ${labelTransitionClass}`;
  const actionLabelClass = `flex-1 text-left ${labelTransitionClass}`;
  const actionIconClass = 'flex h-full w-10 flex-shrink-0 items-center justify-center';
  const configuredSidebarHero = settings?.sidebarHeroHighlight;
  const sidebarHeroHighlight =
    configuredSidebarHero === null || configuredSidebarHero === ''
      ? null
      : configuredSidebarHero ?? DEFAULT_SIDEBAR_HERO;
  const sidebarHeroHighlightSrc = sidebarHeroHighlight
    ? getHeroRenderPath(sidebarHeroHighlight)
    : null;
  const sidebarHeroHighlightX = sidebarHeroHighlight
    ? getHeroFacePosition(sidebarHeroHighlight)
    : 55;
  const settingsActive = location.pathname.startsWith('/settings');
  const discoverActive = location.pathname.startsWith('/discover');

  useLayoutEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch { /* quota / private mode */ }
    writeSidebarWidthVariable(collapsed);
  }, [collapsed]);

  const refreshStashStatus = useCallback(async () => {
    try {
      setStashStatus(await getVanillaStashStatus());
    } catch {
      setStashStatus({ active: false });
    }
  }, []);

  const refreshGameStatus = useCallback(async () => {
    try {
      setGameRunning((await getGameRunningStatus()).running);
    } catch {
      setGameRunning(false);
    }
  }, []);

  useEffect(() => {
    window.electronAPI.updater.getVersion().then(v => setAppVersion(`v${v}`)).catch(() => setAppVersion('v???'));
    window.electronAPI.updater.checkForUpdates().catch(() => { });
    window.electronAPI.updater.getStatus().then(status => {
      if (status) setUpdateAvailable(status.available || status.downloaded);
    });
    const unsub = window.electronAPI.updater.onStatus((status) => {
      setUpdateAvailable(status.available || status.downloaded);
    });
    return unsub;
  }, []);

  // Refresh the conflict badge whenever the mods list changes, which already
  // covers every install / toggle / delete / reorder. No periodic polling: the
  // old 10s setInterval re-ran a full VPK-directory parse for every enabled
  // mod, and in dev that repeatedly-opening-and-closing of file handles was
  // triggering a Windows system sound every tick.
  //
  // Also listens for `grimoire:conflicts-changed` (dispatched by the Conflicts
  // page after ignore/unignore). Those actions don't touch the mods list, so
  // without this the badge stayed stuck at the pre-ignore count until restart.
  const refreshConflictCount = useCallback(async () => {
    try {
      const conflicts = await getConflicts();
      setConflictCount(conflicts.length);
    } catch {
      setConflictCount(0);
    }
  }, []);

  const refreshDiscoverNotifications = useCallback(async () => {
    if (!settings?.experimentalSocial) {
      setDiscoverNotificationCount(0);
      return;
    }

    try {
      const res = await socialListProfiles({
        sort: 'new',
        hideNsfw: settings.hideNsfwPreviews ?? true,
        page: 1,
      });
      const newest = newestCreatedAt(res.profiles);
      if (!newest) {
        setDiscoverNotificationCount(0);
        return;
      }

      if (discoverActive) {
        writeDiscoverLastSeen(newest);
        setDiscoverNotificationCount(0);
        return;
      }

      const lastSeen = readDiscoverLastSeen();
      if (lastSeen === null) {
        writeDiscoverLastSeen(newest);
        setDiscoverNotificationCount(0);
        return;
      }

      setDiscoverNotificationCount(
        res.profiles.filter((profile) => profile.created_at > lastSeen).length
      );
    } catch {
      // Keep the previous badge value during transient social API failures.
    }
  }, [discoverActive, settings?.experimentalSocial, settings?.hideNsfwPreviews]);

  useEffect(() => {
    void refreshConflictCount();
  }, [mods, refreshConflictCount]);

  useEffect(() => {
    const handler = () => void refreshConflictCount();
    window.addEventListener('grimoire:conflicts-changed', handler);
    return () => window.removeEventListener('grimoire:conflicts-changed', handler);
  }, [refreshConflictCount]);

  useEffect(() => {
    if (discoverActive) setDiscoverNotificationCount(0);
  }, [discoverActive]);

  useEffect(() => {
    if (!settings?.experimentalSocial) {
      setDiscoverNotificationCount(0);
      return;
    }

    void refreshDiscoverNotifications();
    const interval = window.setInterval(refreshDiscoverNotifications, DISCOVER_BADGE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [refreshDiscoverNotifications, settings?.experimentalSocial]);

  useEffect(() => {
    refreshStashStatus();
    // Poll so the indicator disappears once the background restore finishes.
    const interval = setInterval(refreshStashStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStashStatus]);

  useEffect(() => {
    refreshGameStatus();
    // Mirrors the real Deadlock process, including game exits outside Grimoire.
    const interval = setInterval(refreshGameStatus, 3000);
    return () => clearInterval(interval);
  }, [refreshGameStatus]);

  useEffect(() => {
    const unsub = onVanillaRestoreComplete((result: VanillaRestoreResult) => {
      if (result.failed.length > 0) {
        setToast({
          kind: 'error',
          text: t('sidebar.toast.restoreFailedRetry', { count: result.failed.length }),
        });
      } else if (result.restored > 0) {
        setToast({
          kind: 'info',
          text: t('sidebar.toast.restoredAfterVanilla', { count: result.restored }),
        });
      }
      refreshStashStatus();
      loadMods();
    });
    return unsub;
  }, [refreshStashStatus, loadMods, t]);

  useEffect(() => {
    if (!toast) return;
    // Stickier when there's an action so the user has time to actually
    // notice and tap it.
    const lifetime = toast.action ? 10000 : 6000;
    const t = setTimeout(() => setToast(null), lifetime);
    return () => clearTimeout(t);
  }, [toast]);

  // Surface auto-disabled sibling variants. The download backend silently
  // moves older variants of the same GB mod into disabled/ on re-download; this
  // toast tells the user what happened so it doesn't look like data loss.
  useEffect(() => {
    const unsub = window.electronAPI.onModsAutoDisabled((data) => {
      if (!data.disabled.length) return;
      const names = data.disabled.map((m) => m.name);
      const head = names.slice(0, 2).join(', ');
      const tail = names.length > 2 ? t('sidebar.toast.andMore', { count: names.length - 2 }) : '';
      setToast({
        kind: 'info',
        text: t('sidebar.toast.disabledVariants', { count: names.length, names: `${head}${tail}` }),
        action: {
          label: t('common.view'),
          onClick: () => navigate('/'),
        },
      });
      loadMods();
    });
    return unsub;
  }, [loadMods, navigate, t]);

  const navItems = useMemo(() => {
    type BadgeTone = 'muted' | 'warning' | 'info';
    type NavItem = {
      to: string;
      icon: typeof Boxes;
      label: string;
      tooltip: string;
      experimental?: 'crosshair' | 'stats' | 'social';
      tone?: 'test';
      badge?: number;
      badgeTone?: BadgeTone;
    };
    const items: NavItem[] = [
      { to: '/', icon: Boxes, label: t('nav.installed'), tooltip: t('sidebar.tooltip.installed'), badge: installedCount, badgeTone: 'muted' },
      { to: '/browse', icon: Compass, label: t('nav.browse'), tooltip: t('sidebar.tooltip.browse') },
      {
        to: '/discover',
        icon: Globe2,
        label: t('nav.discover'),
        tooltip: discoverNotificationCount > 0
          ? t('sidebar.tooltip.discoverNew', { count: discoverNotificationCount })
          : t('sidebar.tooltip.discover'),
        experimental: 'social',
        badge: discoverNotificationCount,
        badgeTone: 'info',
      },
      { to: '/locker', icon: Vault, label: t('nav.locker'), tooltip: t('sidebar.tooltip.locker') },
      { to: '/crosshair', icon: Target, label: t('nav.crosshair'), tooltip: t('sidebar.tooltip.crosshair'), experimental: 'crosshair' },
      { to: '/autoexec', icon: ScrollText, label: t('nav.autoexec'), tooltip: t('sidebar.tooltip.autoexec') },
      { to: '/stats', icon: Activity, label: t('nav.stats'), tooltip: t('sidebar.tooltip.stats'), experimental: 'stats' },
      { to: '/conflicts', icon: Swords, label: t('nav.conflicts'), tooltip: t('sidebar.tooltip.conflicts'), badge: conflictCount, badgeTone: 'warning' },
      { to: '/profiles', icon: BookMarked, label: t('nav.profiles'), tooltip: t('sidebar.tooltip.profiles') },
    ];

    return items.filter((item) => {
      if (item.experimental === 'stats') return settings?.experimentalStats;
      if (item.experimental === 'crosshair') return settings?.experimentalCrosshair;
      if (item.experimental === 'social') return settings?.experimentalSocial;
      return true;
    });
  }, [t, settings?.experimentalStats, settings?.experimentalCrosshair, settings?.experimentalSocial, conflictCount, discoverNotificationCount, installedCount]);

  const activeNavIndex = useMemo(
    () =>
      navItems.findIndex(({ to }) =>
        to === '/'
          ? location.pathname === '/'
          : location.pathname === to || location.pathname.startsWith(`${to}/`)
      ),
    [location.pathname, navItems]
  );
  const activeNavTone = activeNavIndex >= 0 ? navItems[activeNavIndex]?.tone : undefined;

  const measureActiveNavItem = useCallback(() => {
    const list = navListRef.current;
    const item = activeNavIndex >= 0 ? navItemRefs.current[activeNavIndex] : null;

    if (!list || !item) {
      setActiveNavMetrics(null);
      return;
    }

    const next = {
      top: item.offsetTop,
      height: item.offsetHeight,
    };

    setActiveNavMetrics((prev) =>
      prev && prev.top === next.top && prev.height === next.height ? prev : next
    );
  }, [activeNavIndex]);

  useLayoutEffect(() => {
    measureActiveNavItem();
  }, [measureActiveNavItem, navItems.length, collapsed]);

  useEffect(() => {
    const list = navListRef.current;
    const item = activeNavIndex >= 0 ? navItemRefs.current[activeNavIndex] : null;
    if (!list || !item || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measureActiveNavItem);
    observer.observe(list);
    observer.observe(item);
    window.addEventListener('resize', measureActiveNavItem);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureActiveNavItem);
    };
  }, [activeNavIndex, measureActiveNavItem]);

  const handleLaunchModded = async () => {
    if (launchPending || stopPending) return;
    setLaunchPending('modded');
    setToast(null);
    try {
      await launchModded();
      if (stashStatus.active) {
        // Modded path did an auto-restore as part of the launch.
        loadMods();
      }
    } catch (err) {
      setToast({ kind: 'error', text: String(err).replace(/^Error:\s*/, '') });
    } finally {
      setLaunchPending(null);
      refreshStashStatus();
      refreshGameStatus();
    }
  };

  const handleLaunchVanilla = async () => {
    if (launchPending || stopPending) return;
    setLaunchPending('vanilla');
    setToast(null);
    try {
      await launchVanilla();
      refreshStashStatus();
      loadMods();
    } catch (err) {
      setToast({ kind: 'error', text: String(err).replace(/^Error:\s*/, '') });
    } finally {
      setLaunchPending(null);
      refreshGameStatus();
    }
  };

  const handleStopGame = async () => {
    if (stopPending) return;
    setStopPending(true);
    setToast(null);
    try {
      const result = await stopGame();
      const restoreResult = result.restoreResult;
      if (restoreResult?.failed.length) {
        setToast({
          kind: 'error',
          text: t('sidebar.toast.stoppedRestoreFailed', { count: restoreResult.failed.length }),
        });
      } else {
        const restored = restoreResult?.restored ?? 0;
        const restoreText = restored > 0
          ? ` ${t('sidebar.toast.restoredStashed', { count: restored })}`
          : '';
        const base = result.wasRunning ? t('sidebar.toast.stopped') : t('sidebar.toast.notRunning');
        setToast({
          kind: 'info',
          text: `${base}${restoreText}`,
        });
      }
      if (restoreResult) {
        loadMods();
      }
    } catch (err) {
      setToast({ kind: 'error', text: String(err).replace(/^Error:\s*/, '') });
    } finally {
      setStopPending(false);
      refreshGameStatus();
      refreshStashStatus();
    }
  };

  const handleRestoreNow = async () => {
    if (restorePending) return;
    setRestorePending(true);
    setToast(null);
    try {
      const result = await restoreVanillaStash();
      if (result.failed.length > 0) {
        setToast({
          kind: 'error',
          text: t('sidebar.toast.restoreFailedRunning', { count: result.failed.length }),
        });
      } else {
        setToast({
          kind: 'info',
          text: t('sidebar.toast.restored', { count: result.restored }),
        });
      }
    } catch (err) {
      setToast({ kind: 'error', text: String(err).replace(/^Error:\s*/, '') });
    } finally {
      setRestorePending(false);
      refreshStashStatus();
      loadMods();
    }
  };

  const canLaunch = !!settings?.deadlockPath || !!settings?.devDeadlockPath;

  return (
    <aside
      data-collapsed={collapsed}
      className="grimoire-sidebar bg-bg-secondary border-r border-border flex flex-col h-full min-h-0 shrink-0 overflow-hidden"
    >
      <div className="relative flex h-11 flex-shrink-0 items-center overflow-hidden border-b border-border px-3">
        {labelMounted && (
          <div
            className={`sidebar-title-shell pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center ${
              collapsed ? 'right-[46px]' : 'right-9'
            }`}
          >
            <span
              className={`flex items-center gap-1.5 text-2xl text-text-primary/85 leading-none ${titleTransitionClass}`}
              style={{ fontFamily: "'IM Fell English', serif" }}
              aria-hidden={!labelsVisible}
            >
              <GrimoireTitleIcon />
              Grimoire
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
          aria-label={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
          className={`sidebar-collapse-toggle absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
            collapsed ? 'right-[18px]' : 'right-2'
          }`}
        >
          {collapsed ? (
            <GrimoireTitleIcon />
          ) : (
            <Menu className="w-4 h-4" strokeWidth={1.9} />
          )}
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto p-2">
        <div className="relative">
          {activeNavIndex >= 0 && activeNavMetrics && activeNavTone !== 'test' && (
            <div
              aria-hidden
              className="sidebar-active-indicator pointer-events-none absolute left-0 right-0 z-0 overflow-hidden rounded-sm"
              style={{
                height: activeNavMetrics.height,
                transform: `translate3d(0, ${activeNavMetrics.top}px, 0)`,
              }}
            >
              <SidebarActiveBackdrop
                heroSrc={sidebarHeroHighlightSrc}
                heroPositionX={sidebarHeroHighlightX}
              />
            </div>
          )}
          <ul ref={navListRef} className="relative z-10 space-y-0.5">
            {navItems.map(({ to, icon: Icon, label, tooltip, tone, badge, badgeTone }, index) => (
              <li
                key={to}
                ref={(node) => {
                  navItemRefs.current[index] = node;
                }}
              >
                <NavLink
                  to={to}
                  title={collapsed ? `${label}: ${tooltip}` : tooltip}
                  className={({ isActive }) =>
                    `group relative flex items-center h-10 overflow-hidden leading-5 rounded-sm text-sm transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 border ${
                      collapsed ? '' : 'pr-3'
                    } ${
                      tone === 'test'
                        ? isActive
                          ? 'border-red-400/80 bg-red-500/25 text-red-100 font-bold hover:bg-red-500/30'
                          : 'border-red-500/45 bg-red-500/10 text-red-200 font-bold hover:border-red-400/75 hover:bg-red-500/20 hover:text-red-100'
                        : isActive
                        ? sidebarHeroHighlightSrc
                          ? 'border-white/15 text-text-primary font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
                          : 'border-accent/40 text-text-primary font-medium hover:border-accent/60'
                        : 'border-transparent text-text-primary/80 font-medium hover:bg-accent/5 hover:border-accent/25 hover:text-text-primary'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className="relative z-10 flex h-full w-[46px] flex-shrink-0 items-center justify-center">
                        <Icon
                          className={`w-5 h-5 flex-shrink-0 ${
                            tone === 'test' ? 'text-red-200 group-hover:text-red-100' : 'text-text-primary/70 group-hover:text-text-primary'
                          }`}
                          strokeWidth={isActive ? 2 : 1.75}
                        />
                      </span>
                      {labelMounted && (
                        <span className={`relative z-10 ${navLabelClass}`} aria-hidden={!labelsVisible}>
                          {label}
                        </span>
                      )}
                      {badge !== undefined && badge > 0 && (
                        collapsed ? (
                          // In collapsed mode, only surface action/status badges.
                          // The Installed count is informational, so it shouldn't
                          // crowd the rail.
                          badgeTone !== 'muted' ? (
                            <span
                              aria-hidden
                              className={`absolute top-1 right-1 w-2 h-2 rounded-sm ring-2 ring-bg-secondary ${
                                badgeTone === 'warning' ? 'bg-state-warning' : 'bg-accent'
                              }`}
                            />
                          ) : null
                        ) : (
                          <span
                            className={`inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-sm px-1 text-[11px] font-semibold tabular-nums leading-none transition-opacity duration-150 ${
                              labelsVisible ? 'opacity-100' : 'opacity-0'
                            } relative z-10 ${
                              badgeTone === 'warning'
                                ? 'bg-state-warning/90 text-black'
                                : badgeTone === 'info'
                                  ? 'border border-accent/60 bg-accent/15 text-accent'
                                  : 'border border-text-primary/50 text-text-primary/80'
                            }`}
                          >
                            {formatBadgeCount(badge)}
                          </span>
                        )
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="flex-shrink-0 border-t border-border p-3 space-y-2">
        {stashStatus.active && (
          collapsed ? (
            <button
              onClick={handleRestoreNow}
              disabled={restorePending}
              title={t('sidebar.vanilla.collapsedTitle', { count: stashStatus.modCount ?? 0 })}
              className="w-full flex items-center justify-center h-10 rounded-sm border border-yellow-500/40 bg-yellow-500/10 text-yellow-200 hover:bg-yellow-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {restorePending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="rounded-sm border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2 text-xs text-yellow-200 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 leading-tight">
                {t('sidebar.vanilla.stashed', { count: stashStatus.modCount ?? 0 })}
              </span>
              <button
                onClick={handleRestoreNow}
                disabled={restorePending}
                title={t('sidebar.vanilla.restoreNowTitle')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-60 transition-colors cursor-pointer disabled:cursor-not-allowed font-medium"
              >
                {restorePending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                {t('sidebar.vanilla.restore')}
              </button>
            </div>
          )
        )}

        {/* Toasts need horizontal room to read, so suppress in collapsed mode. */}
        {toast && labelMounted && (
          <div
            className={`rounded-sm px-2.5 py-1.5 text-xs leading-snug ${
              toast.kind === 'error'
                ? 'border border-red-500/40 bg-red-500/10 text-red-300'
                : 'border border-accent/40 bg-accent/10 text-accent'
            }`}
          >
            <div>{toast.text}</div>
            {toast.action && (
              <button
                type="button"
                onClick={async () => {
                  const action = toast.action;
                  if (!action) return;
                  // Dismiss immediately so a slow handler doesn't leave a
                  // stale toast on screen.
                  setToast(null);
                  try {
                    await action.onClick();
                  } catch (err) {
                    console.warn('[Sidebar] toast action failed:', err);
                  }
                }}
                className={`mt-1.5 text-xs font-medium underline-offset-2 hover:underline cursor-pointer ${
                  toast.kind === 'error' ? 'text-red-200' : 'text-accent-hover'
                }`}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        <div className="space-y-1">
          {showPreviewVolume && (collapsed ? (
            <button
              type="button"
              onClick={() => setSoundVolume(soundVolume > 0 ? 0 : 0.7)}
              title={`Preview volume: ${Math.round(soundVolume * 100)}%`}
              aria-label={`Preview volume: ${Math.round(soundVolume * 100)}%`}
              className="group relative flex h-8 w-full items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-bg-tertiary text-text-primary/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-accent/35 hover:text-text-primary cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 animate-fade-in"
            >
              <LaunchButtonBackdrop src={PREVIEW_VOLUME_BG} position="center 43%" />
              {soundVolume > 0 ? (
                <Volume2 className="relative z-10 h-4 w-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />
              ) : (
                <VolumeX className="relative z-10 h-4 w-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />
              )}
            </button>
          ) : (
            <div className="group relative flex h-10 w-full items-center overflow-hidden rounded-sm border border-white/10 bg-bg-tertiary text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] animate-fade-in">
              <LaunchButtonBackdrop src={PREVIEW_VOLUME_BG} position="center 43%" />
              <button
                type="button"
                onClick={() => setSoundVolume(soundVolume > 0 ? 0 : 0.7)}
                title={soundVolume > 0 ? 'Mute preview volume' : 'Unmute preview volume'}
                aria-label={soundVolume > 0 ? 'Mute preview volume' : 'Unmute preview volume'}
                className="relative z-10 flex h-full w-10 flex-shrink-0 items-center justify-center text-text-primary/85 transition-colors hover:text-text-primary cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {soundVolume > 0 ? (
                  <Volume2 className="h-4 w-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />
                ) : (
                  <VolumeX className="h-4 w-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(soundVolume * 100)}
                onChange={(e) => setSoundVolume(parseInt(e.target.value, 10) / 100)}
                title={`Preview volume: ${Math.round(soundVolume * 100)}%`}
                aria-label="Preview volume"
                className="relative z-10 mr-3 h-1.5 min-w-0 flex-1 cursor-pointer accent-accent"
              />
            </div>
          ))}

          {gameRunning || stopPending ? (
            <button
              onClick={handleStopGame}
              disabled={stopPending || !!launchPending}
              title={t('sidebar.launch.stopTitle')}
              className={`flex w-full items-center overflow-hidden rounded-sm bg-red-500/10 text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/20 hover:ring-red-500/50 text-sm font-semibold tracking-wide transition-colors duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                collapsed ? 'h-10' : 'h-11'
              }`}
            >
              <span className={actionIconClass}>
                {stopPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Square className="w-5 h-5" strokeWidth={2} />
                )}
              </span>
              {labelMounted && (
                <span className={actionLabelClass} aria-hidden={!labelsVisible}>
                  {t('sidebar.stopGame')}
                </span>
              )}
            </button>
          ) : (
            <>
          <button
            onClick={handleLaunchModded}
            disabled={!canLaunch || !!launchPending || stopPending}
            title={
              !canLaunch
                ? t('sidebar.launch.noPath')
                : stashStatus.active
                  ? t('sidebar.launch.moddedStash')
                  : t('sidebar.launch.moddedDefault')
            }
            className="group relative flex w-full h-10 items-center overflow-hidden rounded-sm bg-bg-tertiary text-text-primary ring-1 ring-white/10 hover:ring-white/25 text-sm font-semibold tracking-wide transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-white/35 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LaunchButtonBackdrop src={LAUNCH_MODDED_BG} position="center 45%" />
            <span className={`relative z-10 ${actionIconClass}`}>
              {launchPending === 'modded' ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin" />
              ) : (
                <Wand2 className="w-[18px] h-[18px]" strokeWidth={2} />
              )}
            </span>
            {labelMounted && (
              <span className={`relative z-10 drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)] ${actionLabelClass}`} aria-hidden={!labelsVisible}>
                {t('sidebar.launchModded')}
              </span>
            )}
          </button>

          <button
            onClick={handleLaunchVanilla}
            disabled={!canLaunch || !!launchPending || stopPending || stashStatus.active}
            title={
              !canLaunch
                ? t('sidebar.launch.noPath')
                : stashStatus.active
                  ? t('sidebar.launch.vanillaStash')
                  : t('sidebar.launch.vanillaDefault')
            }
            className="group relative flex w-full h-8 items-center overflow-hidden rounded-sm text-text-primary/85 ring-1 ring-white/10 hover:text-text-primary hover:ring-amber-400/35 text-xs font-medium tracking-wide transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <LaunchButtonBackdrop src={LAUNCH_VANILLA_BG} position="center 48%" warm />
            <span className={`relative z-10 ${actionIconClass}`}>
              {launchPending === 'vanilla' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" strokeWidth={2} />
              )}
            </span>
            {labelMounted && (
              <span className={`relative z-10 drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)] ${actionLabelClass}`} aria-hidden={!labelsVisible}>
                {t('sidebar.launchVanilla')}
              </span>
            )}
          </button>
            </>
          )}
        </div>

        {/* Update flag: kept separate from the Settings button so it reads as an
            unmistakable "act now" row. Only mounted when an update is actually
            available. Wears the same `update-stripes` texture as Installed cards
            with a pending update: a neutral surface under animated white diagonal
            stripes, so the two read as the same "needs update" language without
            leaning on the (user-configurable) accent color. */}
        {updateAvailable && (
          <button
            type="button"
            onClick={() => setUpdateModalOpen(true)}
            title={t('sidebar.updateAvailableTitle')}
            className="group update-stripes flex w-full h-10 items-center overflow-hidden rounded-sm border border-white/[0.08] bg-bg-tertiary text-text-primary hover:bg-bg-secondary hover:border-white/[0.14] text-sm font-semibold tracking-wide transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <span className={actionIconClass}>
              <Download className="w-[18px] h-[18px]" strokeWidth={2} />
            </span>
            {labelMounted && (
              <span className={actionLabelClass} aria-hidden={!labelsVisible}>
                {t('sidebar.updateAvailable')}
              </span>
            )}
            {labelMounted && (
              <span
                className={`flex h-full w-10 flex-shrink-0 items-center justify-center transition-opacity duration-200 ${
                  labelsVisible ? 'opacity-100' : 'opacity-0'
                }`}
                aria-hidden={!labelsVisible}
              >
                <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
            )}
          </button>
        )}

        {/* Settings shortcut + version. A bordered button (not muted text) so it
            reads as a real control; the app version sits on the trailing edge.
            Always visible, including collapsed (gear only), since it's now the
            bottom rail's anchor rather than an afterthought. */}
        <button
          type="button"
          onClick={() => navigate('/settings')}
          title={t('sidebar.openSettings')}
          aria-current={settingsActive ? 'page' : undefined}
          className={`group relative flex w-full h-10 items-center overflow-hidden rounded-sm border text-sm transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
            settingsActive
              ? sidebarHeroHighlightSrc
                ? 'border-white/15 bg-bg-tertiary text-text-primary font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
                : 'border-accent/40 bg-bg-tertiary text-text-primary font-semibold hover:border-accent/60'
              : 'border-border bg-bg-tertiary/30 text-text-secondary hover:bg-accent/5 hover:border-accent/30 hover:text-text-primary'
          }`}
        >
          {settingsActive && (
            <SidebarActiveBackdrop
              heroSrc={sidebarHeroHighlightSrc}
              heroPositionX={sidebarHeroHighlightX}
            />
          )}
          <span className={`relative z-10 ${actionIconClass}`}>
            <Settings2 className="w-[18px] h-[18px]" strokeWidth={settingsActive ? 2 : 1.75} />
          </span>
          {labelMounted && (
            <span className={`relative z-10 font-medium ${actionLabelClass}`} aria-hidden={!labelsVisible}>
              {t('nav.settings')}
            </span>
          )}
          {labelMounted && (
            <span
              className={`relative z-10 flex h-full flex-shrink-0 items-center pr-3 text-[11px] tabular-nums transition-opacity duration-200 ${
                labelsVisible ? 'opacity-100' : 'opacity-0'
              } ${settingsActive ? 'text-text-primary/70' : 'text-text-secondary/70'}`}
              aria-hidden={!labelsVisible}
            >
              {appVersion || 'v...'}
            </span>
          )}
        </button>
      </div>

      {updateModalOpen && <UpdateModal onClose={() => setUpdateModalOpen(false)} />}
    </aside>
  );
}
