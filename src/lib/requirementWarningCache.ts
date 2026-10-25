import type { ModRequirementSnapshot } from '../types/gamebanana';
import type { Mod } from '../types/mod';
import { matchRequirement, modRequirementRefs, requirementKey, skinRequirementSource, type RequirementMod, type RequirementRef } from './modRequirements';
import { requirementOrderIssues, type RequirementFileLists } from './requirementLoadOrder';

type Snapshots = Readonly<Record<string, ModRequirementSnapshot>>;
export interface RequirementWarningAssessment {
  source: RequirementRef;
  label: 'missing' | 'disabled' | 'orderWarning' | 'review' | 'title';
  warning: boolean;
}
interface SourceAssessment {
  snapshot: ModRequirementSnapshot | undefined;
  source: RequirementRef;
  loaded: boolean;
  required: boolean;
  missing: boolean;
  disabled: boolean;
  issues: boolean;
  orderWarnings: ReadonlySet<string>;
}
interface LibraryCache {
  id: number;
  snapshots: Snapshots;
  files: RequirementFileLists;
  revision: number;
  sources: Map<string, SourceAssessment>;
}

/** Keep assessments across virtual card remounts. Weak keys release retired
 * inventories and mods; each inventory retains only its latest store maps. */
export function createRequirementWarningCache() {
  let nextLibraryId = 0;
  const libraries = new WeakMap<readonly Mod[], LibraryCache>();
  const cards = new WeakMap<RequirementMod, {
    refs: RequirementRef[];
    libraryId?: number;
    revision?: number;
    result: RequirementWarningAssessment | null;
  }>();
  return (mod: RequirementMod, mods: readonly Mod[], snapshots: Snapshots, files: RequirementFileLists): RequirementWarningAssessment | null => {
    let library = libraries.get(mods);
    if (!library) {
      library = { id: ++nextLibraryId, snapshots, files, revision: 0, sources: new Map() };
      libraries.set(mods, library);
    } else if (library.snapshots !== snapshots || library.files !== files) {
      if (library.files !== files) library.sources.clear();
      library.snapshots = snapshots;
      library.files = files;
      library.revision++;
    }
    let card = cards.get(mod);
    if (!card) {
      card = { refs: [...(mod.skinEdit?.sources.length ? [{ localModId: mod.id }] : []), ...modRequirementRefs(mod)], result: null };
      cards.set(mod, card);
    }
    if (card.libraryId === library.id && card.revision === library.revision) return card.result;
    const sources = card.refs.map(source => {
      const key = requirementKey(source);
      const cached = library.sources.get(key);
      const snapshot = 'localModId' in source ? cached?.snapshot ?? skinRequirementSource(mod, mods)?.requirements : snapshots[key];
      // checkedAt updates extend freshness without changing the assessment.
      if (cached && (cached.snapshot === snapshot || (
        cached.snapshot?.status === snapshot?.status && (snapshot?.status !== 'loaded' || (
          cached.snapshot?.status === 'loaded' && cached.snapshot.items === snapshot.items
        ))
      ))) return cached;
      const loaded = snapshot?.status === 'loaded';
      let required = false, missing = false, disabled = false, issues = false;
      if (loaded) for (const item of snapshot.items) {
        required ||= item.importance === 'required';
        const { state } = matchRequirement(item, mods);
        missing ||= state === 'missing';
        disabled ||= state === 'disabled';
        issues ||= state === 'missing' || state === 'disabled' || state === 'manual';
      }
      const result: SourceAssessment = {
        source, snapshot, loaded, required, missing, disabled, issues,
        orderWarnings: new Set(requirementOrderIssues(source, snapshot, mods, files).map(issue => issue.overlay.id)),
      };
      library.sources.set(key, result);
      return result;
    });
    const orderSource = sources.find(source => source.orderWarnings.has(mod.id));
    const source = sources.find(source => 'localModId' in source.source) ??
      (mod.enabled ? sources.find(source => source.issues) : undefined) ?? orderSource ?? sources.find(source => source.loaded && source.required);
    const issues = !!mod.enabled && !!source?.issues;
    const next: RequirementWarningAssessment | null = source?.loaded ? {
      source: source.source,
      label: issues && source.missing ? 'missing' : issues && source.disabled ? 'disabled' : orderSource ? 'orderWarning' : issues ? 'review' : 'title',
      warning: issues || !!orderSource,
    } : null;
    const previous = card.result;
    if (!(previous && next && requirementKey(previous.source) === requirementKey(next.source) && previous.label === next.label && previous.warning === next.warning)) card.result = next;
    card.libraryId = library.id;
    card.revision = library.revision;
    return card.result;
  };
}

export const requirementWarningAssessment = createRequirementWarningCache();
