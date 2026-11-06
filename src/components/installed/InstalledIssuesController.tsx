import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useInstalledIssuesStore } from '../../stores/installedIssuesStore';
import { collectInstalledIssueGroups, installedIssueModsAtPath, installedIssuesScope } from '../../lib/installedIssues';
import { getActiveDeadlockPath } from '../../lib/appSettings';

/** Reuse findings already supplied by library scans; deeper review remains on demand. */
export function InstalledIssuesController() {
  const mods = useAppStore(state => state.mods);
  const loaded = useAppStore(state => state.modsLoaded);
  const settings = useAppStore(state => state.settings);
  const scope = installedIssuesScope(settings);
  const path = getActiveDeadlockPath(settings);
  const activeMods = useMemo(() => installedIssueModsAtPath(mods, path), [mods, path]);
  const groups = useMemo(() => collectInstalledIssueGroups(activeMods), [activeMods]);
  useEffect(() => {
    const store = useInstalledIssuesStore.getState();
    store.activate(scope);
    if (loaded && scope && (mods.length === 0 || activeMods.length > 0)) store.receive(scope, groups);
  }, [loaded, scope, groups, mods.length, activeMods.length]);
  return null;
}
