import { useEffect } from 'react';
import type { Mod } from '../../types/mod';
import { modRequirementRefs, requirementKey } from '../../lib/modRequirements';
import { useRequirementsStore } from '../../stores/requirementsStore';

export function useInstalledRequirements(mods: readonly Mod[]) {
  const key = JSON.stringify([...new Map(mods.flatMap(modRequirementRefs).map(t => [requirementKey(t), t])).values()]);
  useEffect(() => {
    const targets: ReturnType<typeof modRequirementRefs> = JSON.parse(key);
    void useRequirementsStore.getState().load(targets);
  }, [key]);
}
