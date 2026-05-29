import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import {
  getConflicts,
  getGameRunningStatus,
  getVanillaStashStatus,
  launchModded,
  launchVanilla,
  onVanillaRestoreComplete,
  restoreVanillaStash,
  stopGame,
  type VanillaStashStatus,
  type VanillaRestoreResult,
} from '../lib/api';

import { useAppStore } from '../stores/appStore';
import UpdateModal from './UpdateModal';

const COLLAPSED_KEY = 'grimoire:sidebar-collapsed';
const LABEL_TRANSITION_MS = 200;

function readCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === '1';
}

export default function Sidebar() {
  const [conflictCount, setConflictCount] = useState(0);
  const [appVersion, setAppVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const settings = useAppStore((state) => state.settings);
  const mods = useAppStore((state) => state.mods);
  const loadMods = useAppStore((state) => state.loadMods);
  const navigate = useNavigate();

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
  const collapseTimerRef = useRef<number | null>(null);
  const labelFrameRef = useRef<number | null>(null);

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

  const toggleCollapsed = useCallback(() => {
    clearCollapseTimer();
    if (collapsed) {
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

  const labelTransitionClass = `overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-200 ease-out ${
    labelsVisible ? 'opacity-100 max-w-40' : 'opacity-0 max-w-0'
  }`;
  const titleTransitionClass = `whitespace-nowrap transition-opacity duration-200 ease-out ${
    labelsVisible ? 'opacity-100' : 'opacity-0'
  }`;
  const navLabelClass = `flex-1 ${labelTransitionClass}`;
  const actionLabelClass = `flex-1 text-left ${labelTransitionClass}`;
  const actionIconClass = 'flex h-full w-10 flex-shrink-0 items-center justify-center';

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch { /* quota / private mode */ }
    document.documentElement.style.setProperty(
      '--grimoire-sidebar-width',
      collapsed ? '4rem' : '14rem'
    );
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

  useEffect(() => {
    void refreshConflictCount();
  }, [mods, refreshConflictCount]);

  useEffect(() => {
    const handler = () => void refreshConflictCount();
    window.addEventListener('grimoire:conflicts-changed', handler);
    return () => window.removeEventListener('grimoire:conflicts-changed', handler);
  }, [refreshConflictCount]);

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
          text: `Couldn't restore ${result.failed.length} mod(s). Make sure Deadlock is closed, then retry.`,
        });
      } else if (result.restored > 0) {
        setToast({
          kind: 'info',
          text: `Restored ${result.restored} mod${result.restored === 1 ? '' : 's'} after vanilla launch.`,
        });
      }
      refreshStashStatus();
      loadMods();
    });
    return unsub;
  }, [refreshStashStatus, loadMods]);

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
      const tail = names.length > 2 ? ` and ${names.length - 2} more` : '';
      setToast({
        kind: 'info',
        text: `Disabled older variant${names.length === 1 ? '' : 's'}: ${head}${tail}.`,
        action: {
          label: 'View',
          onClick: () => navigate('/'),
        },
      });
      loadMods();
    });
    return unsub;
  }, [loadMods, navigate]);

  const navItems = useMemo(() => {
    type BadgeTone = 'muted' | 'warning';
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
      { to: '/', icon: Boxes, label: 'Installed', tooltip: 'Mods currently in your Deadlock addons folder.', badge: installedCount, badgeTone: 'muted' },
      { to: '/browse', icon: Compass, label: 'Browse', tooltip: 'Discover and download mods from GameBanana.' },
      { to: '/discover', icon: Globe2, label: 'Discover', tooltip: 'Browse and import profiles published by other Grimoire users.', experimental: 'social' },
      { to: '/locker', icon: Vault, label: 'Locker', tooltip: 'Active cosmetic skins, organized by hero.' },
      { to: '/crosshair', icon: Target, label: 'Crosshair', tooltip: 'Custom crosshair editor.', experimental: 'crosshair' },
      { to: '/autoexec', icon: ScrollText, label: 'Autoexec', tooltip: 'Console commands that run at game launch.' },
      { to: '/stats', icon: Activity, label: 'Stats', tooltip: 'Match history and personal stats.', experimental: 'stats' },
      { to: '/conflicts', icon: Swords, label: 'Conflicts', tooltip: 'Mods that overwrite the same game files.', badge: conflictCount, badgeTone: 'warning' },
      { to: '/profiles', icon: BookMarked, label: 'Profiles', tooltip: 'Save and swap sets of enabled mods.' },
    ];

    return items.filter((item) => {
      if (item.experimental === 'stats') return settings?.experimentalStats;
      if (item.experimental === 'crosshair') return settings?.experimentalCrosshair;
      if (item.experimental === 'social') return settings?.experimentalSocial;
      return true;
    });
  }, [settings?.experimentalStats, settings?.experimentalCrosshair, settings?.experimentalSocial, conflictCount, installedCount]);

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
          text: `Stopped Deadlock, but couldn't restore ${restoreResult.failed.length} mod${restoreResult.failed.length === 1 ? '' : 's'}.`,
        });
      } else {
        const restored = restoreResult?.restored ?? 0;
        const restoreText = restored > 0
          ? ` Restored ${restored} stashed mod${restored === 1 ? '' : 's'}.`
          : '';
        setToast({
          kind: 'info',
          text: result.wasRunning ? `Stopped Deadlock.${restoreText}` : `Deadlock was not running.${restoreText}`,
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
          text: `Couldn't restore ${result.failed.length} mod(s). Is Deadlock still running?`,
        });
      } else {
        setToast({
          kind: 'info',
          text: `Restored ${result.restored} mod${result.restored === 1 ? '' : 's'}.`,
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
      className={`${collapsed ? 'w-16' : 'w-56'} bg-bg-secondary border-r border-border flex flex-col h-full min-h-0 transition-[width] duration-200 ease-out`}
    >
      <div className="relative flex h-11 flex-shrink-0 items-center justify-center overflow-hidden border-b border-border px-3">
        {labelMounted && (
          <span
            className={`text-2xl text-accent block leading-none ${titleTransitionClass}`}
            style={{ fontFamily: "'IM Fell English', serif" }}
            aria-hidden={!labelsVisible}
          >
            Grimoire
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-[right,color,background-color] duration-200 ease-out cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
            collapsed ? 'right-[18px]' : 'right-2'
          }`}
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, tooltip, tone, badge, badgeTone }) => (
            <li key={to}>
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
                      ? 'border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary font-medium'
                      : 'border-transparent text-text-primary/80 font-medium hover:bg-accent/5 hover:border-accent/25 hover:text-text-primary'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex h-full w-[46px] flex-shrink-0 items-center justify-center">
                      <Icon
                        className={`w-5 h-5 flex-shrink-0 ${
                          tone === 'test' ? 'text-red-200 group-hover:text-red-100' : 'text-text-primary/70 group-hover:text-text-primary'
                        }`}
                        strokeWidth={isActive ? 2 : 1.75}
                      />
                    </span>
                    {labelMounted && (
                      <span className={navLabelClass} aria-hidden={!labelsVisible}>
                        {label}
                      </span>
                    )}
                    {badge !== undefined && badge > 0 && (
                      collapsed ? (
                        // In collapsed mode, only surface warning-tone badges
                        // (e.g. conflicts). The Installed count is informational,
                        // not a status alert, so it shouldn't crowd the rail.
                        badgeTone === 'warning' ? (
                          <span
                            aria-hidden
                            className="absolute top-1 right-1 w-2 h-2 rounded-sm ring-2 ring-bg-secondary bg-state-warning"
                          />
                        ) : null
                      ) : (
                        <span
                          className={`inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-sm px-1 text-[11px] font-semibold tabular-nums leading-none transition-opacity duration-150 ${
                            labelsVisible ? 'opacity-100' : 'opacity-0'
                          } ${
                            badgeTone === 'warning'
                              ? 'bg-state-warning/90 text-black'
                              : 'border border-text-primary/50 text-text-primary/80'
                          }`}
                        >
                          {badge}
                        </span>
                      )
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-shrink-0 border-t border-border p-3 space-y-2">
        {stashStatus.active && (
          collapsed ? (
            <button
              onClick={handleRestoreNow}
              disabled={restorePending}
              title={`Vanilla session active. ${stashStatus.modCount ?? 0} mod${stashStatus.modCount === 1 ? '' : 's'} stashed. Click to restore now.`}
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
                Vanilla: {stashStatus.modCount ?? 0} stashed
              </span>
              <button
                onClick={handleRestoreNow}
                disabled={restorePending}
                title="Restore stashed mods now"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-60 transition-colors cursor-pointer disabled:cursor-not-allowed font-medium"
              >
                {restorePending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                Restore
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
          {gameRunning || stopPending ? (
            <button
              onClick={handleStopGame}
              disabled={stopPending || !!launchPending}
              title="Stop the running Deadlock process"
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
                  Stop Game
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
                ? 'Configure your Deadlock path in Settings first'
                : stashStatus.active
                  ? 'Restores stashed mods first, then launches Deadlock via Steam'
                  : 'Launch Deadlock with mods active'
            }
            className="flex w-full h-10 items-center overflow-hidden rounded-sm bg-accent/10 text-text-primary ring-1 ring-accent/40 hover:bg-accent/20 hover:ring-accent/60 text-sm font-semibold tracking-wide transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={actionIconClass}>
              {launchPending === 'modded' ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin" />
              ) : (
                <Wand2 className="w-[18px] h-[18px]" strokeWidth={2} />
              )}
            </span>
            {labelMounted && (
              <span className={actionLabelClass} aria-hidden={!labelsVisible}>
                Launch Modded
              </span>
            )}
          </button>

          <button
            onClick={handleLaunchVanilla}
            disabled={!canLaunch || !!launchPending || stopPending || stashStatus.active}
            title={
              !canLaunch
                ? 'Configure your Deadlock path in Settings first'
                : stashStatus.active
                  ? 'A vanilla session is already active. Restore mods first.'
                  : 'Temporarily stash mods, launch Deadlock via Steam, then auto-restore after the game starts'
            }
            className="flex w-full h-10 items-center overflow-hidden rounded-sm text-text-secondary ring-1 ring-transparent hover:bg-accent/5 hover:text-text-primary hover:ring-accent/25 text-sm font-medium tracking-wide transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className={actionIconClass}>
              {launchPending === 'vanilla' ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin" />
              ) : (
                <Play className="w-[18px] h-[18px]" strokeWidth={2} />
              )}
            </span>
            {labelMounted && (
              <span className={actionLabelClass} aria-hidden={!labelsVisible}>
                Launch Vanilla
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
            title="Update available. Click to view release notes."
            className="group update-stripes flex w-full h-10 items-center overflow-hidden rounded-sm border border-white/[0.08] bg-bg-tertiary text-text-primary hover:bg-bg-secondary hover:border-white/[0.14] text-sm font-semibold tracking-wide transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <span className={actionIconClass}>
              <Download className="w-[18px] h-[18px]" strokeWidth={2} />
            </span>
            {labelMounted && (
              <span className={actionLabelClass} aria-hidden={!labelsVisible}>
                Update available
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
          title="Open Settings"
          className="flex w-full h-10 items-center overflow-hidden rounded-sm border border-border bg-bg-tertiary/30 text-text-secondary hover:bg-accent/5 hover:border-accent/30 hover:text-text-primary text-sm transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          <span className={actionIconClass}>
            <Settings2 className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </span>
          {labelMounted && (
            <span className={`font-medium ${actionLabelClass}`} aria-hidden={!labelsVisible}>
              Settings
            </span>
          )}
          {labelMounted && (
            <span
              className={`flex h-full flex-shrink-0 items-center pr-3 text-[11px] tabular-nums text-text-secondary/70 transition-opacity duration-200 ${
                labelsVisible ? 'opacity-100' : 'opacity-0'
              }`}
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
