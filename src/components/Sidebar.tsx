import { useEffect, useState, useMemo, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Boxes,
  Compass,
  Vault,
  Target,
  ScrollText,
  Activity,
  Swords,
  BookMarked,
  Settings2,
  AlertTriangle,
  Download,
  Play,
  RotateCcw,
  Loader2,
  Menu,
} from 'lucide-react';
import {
  getConflicts,
  getVanillaStashStatus,
  launchModded,
  launchVanilla,
  onVanillaRestoreComplete,
  restoreVanillaStash,
  type VanillaStashStatus,
  type VanillaRestoreResult,
} from '../lib/api';

import { useAppStore } from '../stores/appStore';
import UpdateModal from './UpdateModal';

const COLLAPSED_KEY = 'grimoire:sidebar-collapsed';

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
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch { /* quota / private mode */ }
  }, [collapsed]);

  const refreshStashStatus = useCallback(async () => {
    try {
      setStashStatus(await getVanillaStashStatus());
    } catch {
      setStashStatus({ active: false });
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
      experimental?: 'crosshair' | 'stats';
      badge?: number;
      badgeTone?: BadgeTone;
    };
    const items: NavItem[] = [
      { to: '/', icon: Boxes, label: 'Installed', tooltip: 'Mods currently in your Deadlock addons folder.', badge: installedCount, badgeTone: 'muted' },
      { to: '/browse', icon: Compass, label: 'Browse', tooltip: 'Discover and download mods from GameBanana.' },
      { to: '/locker', icon: Vault, label: 'Locker', tooltip: 'Active cosmetic skins, organized by hero.' },
      { to: '/crosshair', icon: Target, label: 'Crosshair', tooltip: 'Custom crosshair editor.', experimental: 'crosshair' },
      { to: '/autoexec', icon: ScrollText, label: 'Autoexec', tooltip: 'Console commands that run at game launch.' },
      { to: '/stats', icon: Activity, label: 'Stats', tooltip: 'Match history and personal stats.', experimental: 'stats' },
      { to: '/conflicts', icon: Swords, label: 'Conflicts', tooltip: 'Mods that overwrite the same game files.', badge: conflictCount, badgeTone: 'warning' },
      { to: '/profiles', icon: BookMarked, label: 'Profiles', tooltip: 'Save and swap sets of enabled mods.' },
      { to: '/settings', icon: Settings2, label: 'Settings', tooltip: 'Configure game path, NSFW, and preferences.' },
    ];

    return items.filter((item) => {
      if (item.experimental === 'stats') return settings?.experimentalStats;
      if (item.experimental === 'crosshair') return settings?.experimentalCrosshair;
      return true;
    });
  }, [settings?.experimentalStats, settings?.experimentalCrosshair, conflictCount, installedCount]);

  const handleLaunchModded = async () => {
    if (launchPending) return;
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
    }
  };

  const handleLaunchVanilla = async () => {
    if (launchPending) return;
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
      <div
        className={`relative flex-shrink-0 border-b border-border ${
          collapsed ? 'px-2 pt-2 pb-2 flex items-center justify-center' : 'px-3 pt-3 pb-2 text-center'
        }`}
      >
        {!collapsed && (
          <span
            className="text-2xl text-accent block leading-none"
            style={{ fontFamily: "'IM Fell English', serif" }}
          >
            Grimoire
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
            collapsed ? '' : 'absolute top-1/2 right-2 -translate-y-1/2'
          }`}
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      <nav className={`flex-1 min-h-0 overflow-y-auto ${collapsed ? 'p-1.5' : 'p-2'}`}>
        <ul className="space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, tooltip, badge, badgeTone }) => (
            <li key={to}>
              <NavLink
                to={to}
                title={collapsed ? `${label}: ${tooltip}` : tooltip}
                className={({ isActive }) =>
                  `group relative flex items-center leading-5 rounded-md text-sm transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 border ${
                    collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-2.5'
                  } ${
                    isActive
                      ? 'border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary font-medium'
                      : 'border-transparent text-text-primary/80 font-medium hover:bg-accent/5 hover:border-accent/25 hover:text-text-primary'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className="w-5 h-5 flex-shrink-0 text-text-primary/70 group-hover:text-text-primary"
                      strokeWidth={isActive ? 2 : 1.75}
                    />
                    {!collapsed && <span className="flex-1">{label}</span>}
                    {badge !== undefined && badge > 0 && (
                      collapsed ? (
                        // In collapsed mode, only surface warning-tone badges
                        // (e.g. conflicts). The Installed count is informational,
                        // not a status alert, so it shouldn't crowd the rail.
                        badgeTone === 'warning' ? (
                          <span
                            aria-hidden
                            className="absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-bg-secondary bg-state-warning"
                          />
                        ) : null
                      ) : (
                        <span
                          className={`px-1.5 py-0.5 text-[11px] font-semibold tabular-nums rounded-full min-w-[20px] text-center leading-4 ${
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

      <div
        className={`flex-shrink-0 border-t border-border ${
          collapsed ? 'p-1.5 space-y-1.5' : 'p-3 space-y-2'
        }`}
      >
        {stashStatus.active && (
          collapsed ? (
            <button
              onClick={handleRestoreNow}
              disabled={restorePending}
              title={`Vanilla session active. ${stashStatus.modCount ?? 0} mod${stashStatus.modCount === 1 ? '' : 's'} stashed. Click to restore now.`}
              className="w-full flex items-center justify-center h-10 rounded-md border border-yellow-500/40 bg-yellow-500/10 text-yellow-200 hover:bg-yellow-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {restorePending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2 text-xs text-yellow-200 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 leading-tight">
                Vanilla: {stashStatus.modCount ?? 0} stashed
              </span>
              <button
                onClick={handleRestoreNow}
                disabled={restorePending}
                title="Restore stashed mods now"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-60 transition-colors cursor-pointer disabled:cursor-not-allowed font-medium"
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
        {toast && !collapsed && (
          <div
            className={`rounded-md px-2.5 py-1.5 text-xs leading-snug ${
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
          <button
            onClick={handleLaunchModded}
            disabled={!canLaunch || !!launchPending}
            title={
              !canLaunch
                ? 'Configure your Deadlock path in Settings first'
                : stashStatus.active
                  ? 'Restores stashed mods first, then launches Deadlock via Steam'
                  : 'Launch Deadlock with mods active'
            }
            className={`flex w-full items-center rounded-md border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary text-sm font-semibold tracking-wide transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-50 disabled:cursor-not-allowed ${
              collapsed ? 'justify-center h-10' : 'gap-3 h-10 px-3'
            }`}
          >
            {launchPending === 'modded' ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin flex-shrink-0" />
            ) : (
              <Play className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={2} />
            )}
            {!collapsed && <span className="flex-1 text-left">Launch Modded</span>}
          </button>

          <button
            onClick={handleLaunchVanilla}
            disabled={!canLaunch || !!launchPending || stashStatus.active}
            title={
              !canLaunch
                ? 'Configure your Deadlock path in Settings first'
                : stashStatus.active
                  ? 'A vanilla session is already active. Restore mods first.'
                  : 'Temporarily stash mods, launch Deadlock via Steam, then auto-restore after the game starts'
            }
            className={`flex w-full items-center rounded-md border border-transparent hover:border-accent/25 hover:bg-accent/5 text-text-secondary hover:text-text-primary text-sm font-medium tracking-wide transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed ${
              collapsed ? 'justify-center h-10' : 'gap-3 h-10 px-3'
            }`}
          >
            {launchPending === 'vanilla' ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin flex-shrink-0" />
            ) : (
              <Play className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={2} />
            )}
            {!collapsed && <span className="flex-1 text-left">Launch Vanilla</span>}
          </button>
        </div>

        {collapsed ? (
          updateAvailable && (
            <button
              onClick={() => setUpdateModalOpen(true)}
              title={`Update available. ${appVersion || 'Click to view'}.`}
              className="flex items-center justify-center w-full h-7 text-accent cursor-pointer hover:bg-bg-tertiary rounded-md transition-colors"
            >
              <Download className="w-3.5 h-3.5 animate-pulse" />
            </button>
          )
        ) : (
          <button
            onClick={() => {
              if (updateAvailable) setUpdateModalOpen(true);
              else navigate('/settings');
            }}
            className="flex items-center justify-center gap-2 w-full pt-1 text-xs text-text-secondary cursor-pointer hover:text-accent transition-colors"
            title={updateAvailable ? 'Update available. Click to view release notes.' : 'Open Settings'}
          >
            <span>{appVersion || 'v...'}</span>
            {updateAvailable && <Download className="w-3 h-3 text-accent animate-pulse" />}
          </button>
        )}
      </div>

      {updateModalOpen && <UpdateModal onClose={() => setUpdateModalOpen(false)} />}
    </aside>
  );
}
