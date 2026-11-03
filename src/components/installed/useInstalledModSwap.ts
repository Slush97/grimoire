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

interface PendingSwap {
  incomingEntryKey: string;
  outgoingEntryKey: string;
  outgoingKeys: string[];
}

/** Keep variant selection and its deferred outgoing loadout in one picker state. */
export function useInstalledModSwap(entries: readonly ModEntry[], taxonomy: InstalledTaxonomyContext) {
  const [picker, setPicker] = useState<{ groupId: string; swap?: PendingSwap } | null>(null);
  const inFlight = useRef(false);
  const swapTargets = useMemo(() => buildEntrySwapTargets(entries, taxonomy), [entries, taxonomy]);
  const setPickerGroupId = useStableCallback((groupId: string | null) => setPicker(groupId ? { groupId } : null));

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
  const performSwap = async (replacement: Mod, swap: PendingSwap) => {
    if (inFlight.current) return false;
    if (blocked(swap)) { refuse(swap); return false; }
    inFlight.current = true;
    try {
      const result = await useAppStore.getState().swapMods(modRestoreKey(replacement), swap.outgoingKeys);
      if (result === 'blocked') {
        refuse(swap, false);
      } else if (result === 'swapped') {
        // Later picker toggles are ordinary independent variant choices.
        setPicker(current => current ? { groupId: current.groupId } : null);
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

  const toggleVariant = useStableCallback(async (variant: Mod): Promise<boolean> => {
    if (picker?.swap && !variant.enabled) return performSwap(variant, picker.swap);
    return useAppStore.getState().toggleMod(variant.id);
  });

  return { pickerGroupId: picker?.groupId ?? null, setPickerGroupId, swapTargets, beginSwap, toggleVariant };
}
