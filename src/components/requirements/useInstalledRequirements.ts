import { useEffect, useMemo } from 'react';
import type { Mod } from '../../types/mod';
import { modRequirementRefs, requirementKey } from '../../lib/modRequirements';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { requirementOrderCandidates } from '../../lib/requirementLoadOrder';

export function useInstalledRequirements(mods: readonly Mod[]) {
  const snapshots = useRequirementsStore(state => state.snapshots);
  const candidates = useMemo(() => requirementOrderCandidates(mods, snapshots), [mods, snapshots]);
  useEffect(() => { void useRequirementOrderStore.getState().load(candidates); }, [candidates]);
  const key = useMemo(() => JSON.stringify([...new Map(mods.flatMap(modRequirementRefs).map(t => [requirementKey(t), t])).values()]), [mods]);
  useEffect(() => {
    const targets: ReturnType<typeof modRequirementRefs> = JSON.parse(key);
    void useRequirementsStore.getState().load(targets);
  }, [key]);
}
