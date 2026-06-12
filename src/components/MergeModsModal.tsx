import { useMemo, useState } from 'react';
import { Layers, X, AlertTriangle, Info } from 'lucide-react';
import type { Mod } from '../types/mod';
import ModThumbnail from './ModThumbnail';
import { Button } from './common/ui';
import { Modal } from './common/Modal';

interface Props {
  sources: Mod[];
  hideNsfw?: boolean;
  onCancel: () => void;
  onConfirm: (args: { modIds: string[]; name: string; strict: boolean }) => Promise<void>;
}

/**
 * Confirmation modal for combining multiple installed mods into a single
 * merged VPK. Sources that share a GameBanana submission (color variants,
 * preset versions, etc.) collapse into a variant picker: exactly one
 * variant per group enters the merge, because variants of the same mod
 * occupy the same in-game file paths and would just override each other.
 *
 * The merger itself orders inputs by priority so the highest-priority source
 * (the lowest pakNN) wins on collisions, matching Deadlock's lower-pakNN-wins
 * behavior.
 *
 * No thumbnail upload here. Users can override the merged mod's thumbnail
 * from the mod details modal after the fact if they want to.
 */
export default function MergeModsModal({ sources, hideNsfw, onCancel, onConfirm }: Props) {
  const groups = useMemo(() => buildSourceGroups(sources), [sources]);

  // Picks: one chosen variant id per multi-variant group. Singles + single-
  // variant groups have no picker (they're always-on).
  const [picks, setPicks] = useState<Record<string, string>>(() => initialPicks(groups));

  const effectiveSources = useMemo(
    () => resolveEffectiveSources(groups, picks),
    [groups, picks]
  );

  const [name, setName] = useState<string>(() => suggestMergeName(effectiveSources));
  // Pin the name the user has actually typed so changing variants below
  // doesn't clobber their edit. An empty trimmed value means "regenerate
  // from the effective list" as variants change.
  const [nameTouched, setNameTouched] = useState(false);

  const liveName = nameTouched ? name : suggestMergeName(effectiveSources);

  const [strict, setStrict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collageSources = effectiveSources.map((src) => ({
    fileName: src.fileName,
    modName: src.name,
    thumbnailUrl: src.thumbnailUrl,
    enabledAtMergeTime: src.enabled,
    priorityAtMergeTime: src.priority,
  }));

  const localSourceCount = effectiveSources.filter(
    (s) => !s.gameBananaId || !s.gameBananaFileId
  ).length;

  const canSubmit = !!liveName.trim() && !submitting && effectiveSources.length >= 2;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        modIds: effectiveSources.map((s) => s.id),
        name: liveName.trim(),
        strict,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onCancel} labelledBy="merge-mods-title" size="none" panelClassName="max-w-xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 id="merge-mods-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Merge {effectiveSources.length} mods
          </h3>
          <button
            onClick={onCancel}
            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-4">
            <div className="w-32 aspect-square flex-shrink-0 rounded-lg overflow-hidden border border-border bg-bg-tertiary">
              <ModThumbnail
                alt="Merged mod thumbnail preview"
                mergedSources={collageSources}
                hideNsfw={hideNsfw}
                className="w-full h-full"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label htmlFor="merge-name" className="block text-sm font-medium text-text-primary mb-1.5">
                Merged mod name <span className="text-red-400">*</span>
              </label>
              <input
                id="merge-name"
                type="text"
                value={liveName}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder="My combined pack"
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
                autoFocus
              />
              <p className="mt-2 text-xs text-text-secondary">
                The originals stay on disk in the disabled folder so you can unmerge later.
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs uppercase tracking-wide text-text-secondary">
                Sources ({effectiveSources.length})
              </div>
              {groups.some((g) => g.kind === 'variants') && (
                <div className="text-xs text-text-secondary">
                  Pick one variant per mod
                </div>
              )}
            </div>
            <ul className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {groups.map((group) =>
                group.kind === 'single' ? (
                  <li
                    key={group.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-tertiary/60 text-sm"
                  >
                    <span className="font-mono text-[11px] text-text-secondary tabular-nums w-6 text-right">
                      {String(group.mod.priority).padStart(2, '0')}
                    </span>
                    <span className="text-text-primary truncate" title={group.mod.name}>{group.mod.name}</span>
                    {!group.mod.gameBananaId && (
                      <span
                        className="ml-auto text-[10px] uppercase tracking-wide text-text-secondary/80 px-1.5 py-0.5 rounded border border-border"
                        title="Local mod: not in the unroll share code"
                      >
                        local
                      </span>
                    )}
                  </li>
                ) : (
                  <li key={group.key} className="rounded border border-border bg-bg-tertiary/40 p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Layers className="w-3.5 h-3.5 text-text-secondary" />
                      <span className="text-sm text-text-primary truncate" title={group.modName}>
                        {group.modName}
                      </span>
                      <span className="ml-auto text-[10px] text-text-secondary uppercase tracking-wide">
                        {group.variants.length} variants
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.variants.map((variant) => {
                        const id = picks[group.key];
                        const isPicked = id === variant.id;
                        return (
                          <label
                            key={variant.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
                              isPicked
                                ? 'bg-accent/10 border border-accent/40 text-text-primary'
                                : 'border border-transparent text-text-secondary hover:bg-white/5 hover:text-text-primary'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`variant-${group.key}`}
                              checked={isPicked}
                              onChange={() => setPicks((prev) => ({ ...prev, [group.key]: variant.id }))}
                              className="w-3.5 h-3.5 accent-accent cursor-pointer"
                            />
                            <span className="font-mono text-[11px] text-text-secondary tabular-nums w-6 text-right">
                              {String(variant.priority).padStart(2, '0')}
                            </span>
                            <span className="truncate" title={variantLabelOf(variant)}>{variantLabelOf(variant)}</span>
                            {variant.enabled && (
                              <span className="ml-auto text-[10px] text-accent uppercase tracking-wide">enabled</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                )
              )}
            </ul>
          </div>

          {localSourceCount > 0 && (
            <div className="flex items-start gap-2 text-xs text-text-secondary bg-amber-500/5 border border-amber-500/30 rounded-lg p-2.5">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-text-primary font-medium">
                  {localSourceCount} local mod{localSourceCount === 1 ? '' : 's'} included
                </div>
                Local mods (no GameBanana ID) merge fine but aren&apos;t included in the share code.
                If you delete the disabled originals, those won&apos;t be recoverable on unmerge.
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-accent cursor-pointer flex-shrink-0"
            />
            <span>
              Strict mode
              <span className="block text-xs text-text-secondary mt-0.5">
                Abort if two mods touch the same file path. Off by default (higher-priority mod wins).
              </span>
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-border">
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            icon={Layers}
          >
            {submitting ? 'Merging…' : 'Merge'}
          </Button>
        </div>
    </Modal>
  );
}

type SourceGroup =
  | { kind: 'single'; mod: Mod; key: string }
  | {
      kind: 'variants';
      gameBananaId: number;
      modName: string;
      variants: Mod[];
      key: string;
    };

/**
 * Group sources by GameBanana submission id so variants of the same mod
 * collapse into one pick. Local mods (no gameBananaId) and singleton GB mods
 * stay as `single` entries: there's nothing to pick.
 */
function buildSourceGroups(sources: Mod[]): SourceGroup[] {
  const byGb = new Map<number, Mod[]>();
  const singles: Mod[] = [];
  for (const m of sources) {
    if (typeof m.gameBananaId === 'number' && m.gameBananaId > 0) {
      const arr = byGb.get(m.gameBananaId) ?? [];
      arr.push(m);
      byGb.set(m.gameBananaId, arr);
    } else {
      singles.push(m);
    }
  }
  for (const [gb, variants] of Array.from(byGb.entries())) {
    if (variants.length === 1) {
      singles.push(variants[0]);
      byGb.delete(gb);
    }
  }

  const groups: SourceGroup[] = [];
  for (const m of singles) {
    groups.push({ kind: 'single', mod: m, key: `single:${m.id}` });
  }
  for (const [gameBananaId, variants] of byGb) {
    variants.sort((a, b) => a.priority - b.priority);
    groups.push({
      kind: 'variants',
      gameBananaId,
      // Use the first variant's display name: they all came from the same
      // GameBanana submission so the mod name is identical.
      modName: variants[0].name,
      variants,
      key: `gb:${gameBananaId}`,
    });
  }
  // Sort groups so the rendered order is stable across re-renders. Use the
  // primary variant's priority for groups, the mod's priority for singles.
  groups.sort((a, b) => primaryPriority(a) - primaryPriority(b));
  return groups;
}

function primaryPriority(group: SourceGroup): number {
  if (group.kind === 'single') return group.mod.priority;
  // First enabled variant wins, else first by priority.
  const firstEnabled = group.variants.find((v) => v.enabled);
  return (firstEnabled ?? group.variants[0]).priority;
}

/** Pick the most reasonable default variant for each multi-variant group:
 *  the first enabled variant if any, else the first by priority. */
function initialPicks(groups: SourceGroup[]): Record<string, string> {
  const picks: Record<string, string> = {};
  for (const g of groups) {
    if (g.kind !== 'variants') continue;
    const defaultVariant = g.variants.find((v) => v.enabled) ?? g.variants[0];
    picks[g.key] = defaultVariant.id;
  }
  return picks;
}

function resolveEffectiveSources(groups: SourceGroup[], picks: Record<string, string>): Mod[] {
  const out: Mod[] = [];
  for (const g of groups) {
    if (g.kind === 'single') {
      out.push(g.mod);
    } else {
      const pickedId = picks[g.key];
      const picked = g.variants.find((v) => v.id === pickedId) ?? g.variants[0];
      out.push(picked);
    }
  }
  return out;
}

function variantLabelOf(mod: Mod): string {
  return mod.variantLabel || mod.fileDescription || mod.sourceFileName || mod.fileName;
}

function suggestMergeName(sources: Mod[]): string {
  if (sources.length === 0) return '';
  const first = sources[0].name;
  if (sources.length === 1) return first;
  if (sources.length === 2) return `${first} + ${sources[1].name}`;
  return `${first} + ${sources.length - 1} more`;
}
