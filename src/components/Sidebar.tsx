import { useEffect, useState, useMemo, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Package,
  Search,
  Shield,
  AlertTriangle,
  Layers,
  Settings,
  Crosshair,
  Terminal,
  BarChart3,
  Download,
  Play,
  RotateCcw,
  Loader2,
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
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

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

  // Refresh the conflict badge whenever the mods list changes — which already
  // covers every install / toggle / delete / reorder. No periodic polling: the
  // old 10s setInterval re-ran a full VPK-directory parse for every enabled
  // mod, and in dev that repeatedly-opening-and-closing of file handles was
  // triggering a Windows system sound every tick.
  useEffect(() => {
    let cancelled = false;
    const loadConflicts = async () => {
      try {
        const conflicts = await getConflicts();
        if (!cancelled) setConflictCount(conflicts.length);
      } catch {
        if (!cancelled) setConflictCount(0);
      }
    };
    loadConflicts();
    return () => {
      cancelled = true;
    };
  }, [mods]);

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
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const navItems = useMemo(() => {
    type BadgeTone = 'muted' | 'warning';
    type NavItem = {
      to: string;
      icon: typeof Package;
      label: string;
      tooltip: string;
      experimental?: 'crosshair' | 'stats';
      badge?: number;
      badgeTone?: BadgeTone;
    };
    const items: NavItem[] = [
      { to: '/', icon: Package, label: 'Installed', tooltip: 'Mods currently in your Deadlock addons folder.', badge: installedCount, badgeTone: 'muted' },
      { to: '/browse', icon: Search, label: 'Browse', tooltip: 'Discover and download mods from GameBanana.' },
      { to: '/locker', icon: Shield, label: 'Locker', tooltip: "Saved mods you haven't installed yet." },
      { to: '/crosshair', icon: Crosshair, label: 'Crosshair', tooltip: 'Custom crosshair editor.', experimental: 'crosshair' },
      { to: '/autoexec', icon: Terminal, label: 'Autoexec', tooltip: 'Console commands that run at game launch.' },
      { to: '/stats', icon: BarChart3, label: 'Stats', tooltip: 'Match history and personal stats.', experimental: 'stats' },
      { to: '/conflicts', icon: AlertTriangle, label: 'Conflicts', tooltip: 'Mods that overwrite the same game files.', badge: conflictCount, badgeTone: 'warning' },
      { to: '/profiles', icon: Layers, label: 'Profiles', tooltip: 'Save and swap sets of enabled mods.' },
      { to: '/settings', icon: Settings, label: 'Settings', tooltip: 'Configure game path, NSFW, and preferences.' },
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
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 border-b border-border text-center flex-shrink-0">
        <span
          className="text-2xl text-accent block leading-none"
          style={{ fontFamily: "'IM Fell English', serif" }}
        >
          Grimoire
        </span>
        <span className="text-[10px] text-text-secondary tracking-[0.2em] uppercase mt-1 block">
          Mod Manager
        </span>
      </div>

      <nav className="flex-1 min-h-0 p-2 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, tooltip, badge, badgeTone }) => (
            <li key={to}>
              <NavLink
                to={to}
                title={tooltip}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-3 rounded-lg font-medium text-sm transition-colors ${
                    isActive
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-primary/70 hover:bg-bg-tertiary hover:text-text-primary'
                  }`
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="flex-1">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 text-xs font-medium rounded-full min-w-[20px] text-center ${
                      badgeTone === 'warning'
                        ? 'bg-state-warning text-black'
                        : 'bg-bg-tertiary text-text-secondary'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-shrink-0 border-t border-border p-3 space-y-2.5">
        {stashStatus.active && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2 text-xs text-yellow-200 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 leading-tight">
              Vanilla — {stashStatus.modCount ?? 0} stashed
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
        )}

        {toast && (
          <div
            className={`rounded-md px-2.5 py-1.5 text-xs leading-snug ${
              toast.kind === 'error'
                ? 'border border-red-500/40 bg-red-500/10 text-red-300'
                : 'border border-accent/40 bg-accent/10 text-accent'
            }`}
          >
            {toast.text}
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
            className="flex w-full items-center gap-3 h-11 px-3 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-sm font-semibold tracking-wide transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {launchPending === 'modded' ? (
              <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
            ) : (
              <Play className="w-5 h-5 flex-shrink-0" strokeWidth={2} />
            )}
            <span className="flex-1 text-left">Launch Modded</span>
          </button>

          <button
            onClick={handleLaunchVanilla}
            disabled={!canLaunch || !!launchPending || stashStatus.active}
            title={
              !canLaunch
                ? 'Configure your Deadlock path in Settings first'
                : stashStatus.active
                  ? 'A vanilla session is already active — restore mods first'
                  : 'Temporarily stash mods, launch Deadlock via Steam, then auto-restore after the game starts'
            }
            className="flex w-full items-center gap-3 h-11 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-tertiary text-sm font-medium tracking-wide transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {launchPending === 'vanilla' ? (
              <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
            ) : (
              <Play className="w-5 h-5 flex-shrink-0" strokeWidth={2} />
            )}
            <span className="flex-1 text-left">Launch Vanilla</span>
          </button>
        </div>

        <button
          onClick={() => {
            if (updateAvailable) setUpdateModalOpen(true);
            else navigate('/settings');
          }}
          className="flex items-center justify-center gap-2 w-full pt-1 text-xs text-text-secondary cursor-pointer hover:text-accent transition-colors"
          title={updateAvailable ? 'Update available — click to view release notes' : 'Open Settings'}
        >
          <span>{appVersion || 'v...'}</span>
          {updateAvailable && <Download className="w-3 h-3 text-accent animate-pulse" />}
        </button>
      </div>

      {updateModalOpen && <UpdateModal onClose={() => setUpdateModalOpen(false)} />}
    </aside>
  );
}
