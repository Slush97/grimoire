import { useState } from 'react';
import { Layers, X, ExternalLink, Share2, Scissors, Check } from 'lucide-react';
import type { Mod } from '../types/mod';
import ModThumbnail from './ModThumbnail';
import { Button, Tag } from './common/ui';
import { formatRelativeDate } from '../lib/dates';

interface Props {
  mod: Mod;
  hideNsfw?: boolean;
  onClose: () => void;
  onUnmerge?: () => void;
}

/**
 * Read-only view of what a merged VPK contains. Lists every source mod with
 * its thumbnail, the priority/enabled state captured at merge time, and a
 * GameBanana link when one exists. Also surfaces the share code (with a copy
 * button) and an Unmerge shortcut.
 */
export default function MergedContentsModal({ mod, hideNsfw, onClose, onUnmerge }: Props) {
  const [copied, setCopied] = useState(false);
  const merged = mod.merged;
  // Render nothing if the prop is malformed rather than throwing; the parent
  // only opens this modal when `mod.merged` is truthy so this is defensive.
  if (!merged) return null;

  const sectionForGb = (section?: string): string => {
    const s = (section || 'Mod').toLowerCase();
    return s === 'sound' ? 'sounds' : 'mods';
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(merged.shareCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Silently no-op: surfacing a toast inside a child modal is overkill.
      // The button text resetting tells the user it didn't take.
    }
  };

  const createdLabel = formatRelativeDate(merged.createdAt) || merged.createdAt;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merged-contents-title"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-border rounded-xl w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3
            id="merged-contents-title"
            className="text-lg font-semibold text-text-primary flex items-center gap-2 min-w-0"
          >
            <Layers className="w-5 h-5 text-text-secondary flex-shrink-0" />
            <span className="truncate">{mod.name}</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-4">
            <div className="w-28 aspect-square flex-shrink-0 rounded-lg overflow-hidden border border-border bg-bg-tertiary">
              <ModThumbnail
                src={mod.thumbnailUrl}
                alt={mod.name}
                hideNsfw={hideNsfw}
                nsfw={mod.nsfw}
                mergedSources={merged.sources}
                className="w-full h-full"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Tag className="border-white/20 text-white/90" icon={Layers}>
                  Merged · {merged.sources.length}
                </Tag>
                <span className="text-text-secondary text-xs">Created {createdLabel}</span>
              </div>
              <div className="text-text-secondary text-xs font-mono truncate" title={mod.fileName}>
                {mod.fileName}
              </div>
              <p className="text-text-secondary text-xs leading-relaxed pt-1">
                Sources stay on disk in the disabled folder. Unmerge restores them; the
                share code captures the list for re-downloading from GameBanana on another
                machine.
              </p>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-text-secondary mb-1.5">
              Sources ({merged.sources.length})
            </div>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {merged.sources.map((src) => {
                const gbHref = src.gameBananaId
                  ? `https://gamebanana.com/${sectionForGb(src.section)}/${src.gameBananaId}`
                  : null;
                return (
                  <li
                    key={src.fileName}
                    className="flex items-center gap-3 px-2 py-2 rounded bg-bg-tertiary/50 border border-border/60"
                  >
                    <div className="w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-bg-tertiary">
                      <ModThumbnail
                        src={src.thumbnailUrl}
                        alt={src.modName}
                        hideNsfw={hideNsfw}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate" title={src.modName}>
                        {src.modName}
                      </div>
                      <div className="text-[11px] text-text-secondary font-mono truncate" title={src.fileName}>
                        {src.fileName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className="text-[10px] uppercase tracking-wide text-text-secondary tabular-nums"
                        title="Priority captured at merge time"
                      >
                        #{src.priorityAtMergeTime}
                      </span>
                      {!src.enabledAtMergeTime && (
                        <span
                          className="text-[10px] uppercase tracking-wide text-text-secondary/70 px-1.5 py-0.5 rounded border border-border"
                          title="This source was disabled when the merge happened"
                        >
                          off
                        </span>
                      )}
                      {gbHref ? (
                        <a
                          href={gbHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-text-secondary hover:text-accent transition-colors"
                          title="View on GameBanana"
                          aria-label={`View ${src.modName} on GameBanana`}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ) : (
                        <span
                          className="text-[10px] uppercase tracking-wide text-text-secondary/70 px-1.5 py-0.5 rounded border border-border"
                          title="Local mod — not in the share code"
                        >
                          local
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end p-4 border-t border-border">
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? Check : Share2}
            onClick={() => void handleCopy()}
          >
            {copied ? 'Copied' : 'Copy share code'}
          </Button>
          {onUnmerge && (
            <Button
              variant="secondary"
              size="sm"
              icon={Scissors}
              onClick={() => {
                onClose();
                onUnmerge();
              }}
            >
              Unmerge
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
