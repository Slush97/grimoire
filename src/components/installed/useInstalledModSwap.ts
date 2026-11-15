import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';
import i18n from '../../i18n';
import { buildEntrySwapTargets, flattenEntries, isEntryEnabled, type ModEntry } from '../../lib/modEntries';
import type { InstalledTaxonomyContext } from '../../lib/installedCardTaxonomy';
import { isModLoadedInGame } from '../../lib/modLocks';
import { modRestoreKey } from '../../lib/soloRestore';
import { shakeElement } from '../../lib/shakeElement';
import { useStableCallback } from '../../lib/useStableCallback';
import type { Mod } from '../../types/mod';
import type { RequirementToggleSession } from '../../stores/requirementsStore';
import { installedVariantGroupKey } from '../../lib/localVariantEligibility';

interface PendingSwap {
  incomingEntryKey: string;
  outgoingEntryKey: string;
  outgoingKeys: string[];
}

/** Keep variant selection and its deferred outgoing loadout in one picker state. */
export function useInstalledModSwap(entries: readonly ModEntry[], taxonomy: InstalledTaxonomyContext) {
  const [picker, setPicker] = useState<{ groupId: string; anchorKey?: string; anchorId?: string; renamedAnchor?: string; swap?: PendingSwap } | null>(null);
  const inFlight = useRef(false);
  const swapTargets = useMemo(() => buildEntrySwapTargets(entries, taxonomy), [entries, taxonomy]);
  const setPickerGroupId = useStableCallback((groupId: string | null) => setPicker(groupId ? { groupId } : null));
  const pickerEntry = useMemo(() => {
    if (!picker) return undefined;
    const direct = entries.find(entry => entry.key === picker.groupId
      || flattenEntries([entry]).some(mod => installedVariantGroupKey(mod) === picker.groupId));
    if (direct) return direct;
    const matching = entries.filter(entry => flattenEntries([entry]).some(mod => modRestoreKey(mod) === picker.anchorKey));
    if (matching.length === 1) return matching[0];
    if (picker.renamedAnchor) {
      const renamed = entries.find(entry => flattenEntries([entry]).some(mod => mod.id === picker.anchorId
        && `nm:${mod.name}:${mod.size}` === picker.renamedAnchor));
      if (renamed) return renamed;
    }
    // A new gallery can stamp a hash on an unhashed file. Accept its existing
    // slot only while the old name/size identity agrees; recycled slots differ.
    return picker.anchorKey?.startsWith('nm:') ? entries.find(entry => flattenEntries([entry]).some(mod =>
      mod.id === picker.anchorId && `nm:${mod.name}:${mod.size}` === picker.anchorKey)) : undefined;
  }, [entries, picker]);
  // Follow a standalone file when adding artwork or variants gives it a group,
  // and retain the picker when deleting files leaves only one member.
  if (pickerEntry && picker) {
    const anchor = pickerEntry.kind === 'group' ? pickerEntry.primary : pickerEntry.mod;
    const groupId = installedVariantGroupKey(anchor) ?? pickerEntry.key;
    const anchorKey = modRestoreKey(anchor);
    const renamed = picker.renamedAnchor === `nm:${anchor.name}:${anchor.size}`;
    if (picker.groupId !== groupId || picker.anchorKey !== anchorKey || picker.anchorId !== anchor.id || renamed) {
      setPicker({ ...picker, groupId, anchorKey, anchorId: anchor.id, renamedAnchor: renamed ? undefined : picker.renamedAnchor });
    }
  }

  // An intentional rename can replace an unhashed name/size identity while
  // stamping its first hash. Accept only that expected transition.
  const renamePickerMod = useStableCallback(async (mod: Mod, name: string, rename: () => Promise<void>) => {
    setPicker(current => current ? { ...current, renamedAnchor: `nm:${name}:${mod.size}` } : null);
    try { await rename(); }
    catch (error) {
      setPicker(current => current ? { ...current, renamedAnchor: undefined } : null);
      throw error;
    }
  });

  const blocked = (swap: PendingSwap) => {
    const { mods, loadedGameModIds } = useAppStore.getState();
    return mods.some(mod => swap.outgoingKeys.includes(modRestoreKey(mod)) && isModLoadedInGame(mod, loadedGameModIds));
  };
  const feedback = (swap: PendingSwap) => {
    const keys = new Set([swap.incomingEntryKey, swap.outgoingEntryKey]);
    for (const card of document.querySelectorAll<HTMLElement>('[data-mod-entry-key]')) {
      if (keys.has(card.getAttribute('data-mod-entry-key') ?? '')) shakeElement(card);
    }
  };
  const refuse = (swap: PendingSwap, warn = true) => {
    if (warn) showToast(i18n.t('common.gameRunningWarning'), { tone: 'warning' });
    setPicker(null);
    requestAnimationFrame(() => feedback(swap));
  };
  const performSwap = async (replacement: Mod, swap: PendingSwap, session?: RequirementToggleSession) => {
    if (inFlight.current) return false;
    if (blocked(swap)) { refuse(swap); return false; }
    inFlight.current = true;
    try {
      const result = await useAppStore.getState().swapMods(modRestoreKey(replacement), swap.outgoingKeys, session);
      if (result === 'blocked') {
        refuse(swap, false);
      } else if (result === 'swapped') {
        // Later picker toggles are ordinary independent variant choices.
        setPicker(current => current ? { ...current, swap: undefined } : null);
      }
      return result === 'swapped';
    } finally { inFlight.current = false; }
  };

  const beginSwap = useStableCallback(async (incoming: ModEntry, outgoingEntryKey: string) => {
    if (inFlight.current) return;
    const replacement = entries.find(entry => entry.key === incoming.key);
    const outgoing = entries.find(entry => entry.key === outgoingEntryKey);
    if (!replacement || isEntryEnabled(replacement) || !outgoing
      || !swapTargets.get(replacement.key)?.some(target => target.key === outgoing.key)) return;
    const swap: PendingSwap = {
      incomingEntryKey: replacement.key,
      outgoingEntryKey: outgoing.key,
      outgoingKeys: flattenEntries([outgoing]).filter(mod => mod.enabled).map(modRestoreKey),
    };
    if (blocked(swap)) { refuse(swap); return; }
    if (replacement.kind === 'group') {
      setPicker({ groupId: replacement.groupKey, swap });
    } else {
      await performSwap(replacement.mod, swap);
    }
  });

  const toggleVariant = useStableCallback(async (variant: Mod, session?: RequirementToggleSession): Promise<boolean> => {
    if (picker?.swap && !variant.enabled) return performSwap(variant, picker.swap, session);
    return useAppStore.getState().toggleMod(variant.id, session);
  });

  return { pickerGroupId: picker?.groupId ?? null, pickerEntry, setPickerGroupId, renamePickerMod, swapTargets, beginSwap, toggleVariant };
}
