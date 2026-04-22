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

export default function Sidebar() {
  const [conflictCount, setConflictCount] = useState(0);
  const [appVersion, setAppVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const settings = useAppStore((state) => state.settings);
  const loadMods = useAppStore((state) => state.loadMods);
  const navigate = useNavigate();

  const [stashStatus, setStashStatus] = useState<VanillaStashStatus>({ active: false });
  const [launchPending, setLaunchPending] = useState<'modded' | 'vanilla' | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

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

  useEffect(() => {
    const loadConflicts = async () => {
      try {
        const conflicts = await getConflicts();
        setConflictCount(conflicts.length);
      } catch {
        setConflictCount(0);
      }
    };
    loadConflicts();
    const interval = setInterval(loadConflicts, 10000);
    return () => clearInterval(interval);
  }, []);

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
    const items = [
      { to: '/', icon: Package, label: 'Installed' },
      { to: '/browse', icon: Search, label: 'Browse' },
      { to: '/locker', icon: Shield, label: 'Locker' },
      { to: '/crosshair', icon: Crosshair, label: 'Crosshair', experimental: 'crosshair' as const },
      { to: '/autoexec', icon: Terminal, label: 'Autoexec' },
      { to: '/stats', icon: BarChart3, label: 'Stats', experimental: 'stats' as const },
      { to: '/conflicts', icon: AlertTriangle, label: 'Conflicts', badge: conflictCount },
      { to: '/profiles', icon: Layers, label: 'Profiles' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ];

    return items.filter((item) => {
      if (item.experimental === 'stats') return settings?.experimentalStats;
      if (item.experimental === 'crosshair') return settings?.experimentalCrosshair;
      return true;
    });
  }, [settings?.experimentalStats, settings?.experimentalCrosshair, conflictCount]);

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
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      <div className="px-3 pt-4 pb-3 border-b border-border text-center">
        <span
          className="text-4xl text-accent block leading-none"
          style={{ fontFamily: "'IM Fell English', serif" }}
        >
          Grimoire
        </span>
        <span className="text-xs text-text-secondary tracking-widest uppercase mt-1 block">
          Mod Manager
        </span>
      </div>

      <nav className="flex-1 p-2 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="flex-1">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500 text-black rounded-full min-w-[20px] text-center">
                    {badge}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border p-3 space-y-2.5">
        {stashStatus.active && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2 text-[11px] text-yellow-200 flex items-center gap-2">
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
            className={`rounded-md px-2.5 py-1.5 text-[11px] leading-snug ${
              toast.kind === 'error'
                ? 'border border-red-500/40 bg-red-500/10 text-red-300'
                : 'border border-accent/40 bg-accent/10 text-accent'
            }`}
          >
            {toast.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-1.5">
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
            className="flex items-center justify-center gap-2 h-10 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {launchPending === 'modded' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            Launch Modded
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
            className="flex items-center justify-center gap-2 h-9 rounded-lg bg-bg-tertiary hover:bg-white/10 text-text-secondary hover:text-text-primary border border-white/5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {launchPending === 'vanilla' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Launch Vanilla
          </button>
        </div>

        <button
          onClick={() => updateAvailable && navigate('/settings')}
          className={`flex items-center justify-center gap-2 w-full pt-1 text-[11px] text-text-secondary ${
            updateAvailable ? 'cursor-pointer hover:text-accent transition-colors' : 'cursor-default'
          }`}
          title={updateAvailable ? 'Update available! Click to view' : ''}
        >
          <span>{appVersion || 'v...'}</span>
          {updateAvailable && <Download className="w-3 h-3 text-accent animate-pulse" />}
        </button>
      </div>
    </aside>
  );
}
