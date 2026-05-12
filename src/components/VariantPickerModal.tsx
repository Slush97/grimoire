import { useEffect, useRef, useState } from 'react';
import { X, Check, Trash2, Power, PowerOff, Info, Pencil } from 'lucide-react';
import type { Mod } from '../types/mod';
import { Button } from './common/ui';

interface Props {
    /** Display name shared by the variants (use primary.name). */
    modName: string;
    variants: Mod[];
    /** Toggle a single variant's enabled state. Variants are independent —
     *  multiple can be active at once (e.g. a model VPK + its voice-lines
     *  addon from the same mod page). */
    onToggle: (target: Mod) => Promise<void> | void;
    /** Called when the user disables every currently-enabled variant. */
    onDisableAll: () => Promise<void> | void;
    /** Called when the user requests deletion of a single variant. */
    onDeleteVariant: (variant: Mod) => Promise<void> | void;
    /** Persist a user-given label for a variant. Empty string clears it. */
    onRenameVariant: (variant: Mod, label: string) => Promise<void> | void;
    /** Optional — open the GameBanana details modal for this mod. When set,
     *  a small "Mod page" link appears in the header. Not provided when the
     *  group has no GB id (shouldn't happen since groups require one). */
    onOpenModDetails?: () => void;
    onClose: () => void;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Variant picker for grouped mods. Shown when the user clicks an Installed
 * card that represents multiple VPKs sharing a GameBanana mod id. Variants
 * are independent — the user can enable any combination. Examples:
 *   • Dallas PAYDAY ships a model VPK and a voice-lines VPK from one archive;
 *     users want both on.
 *   • A mod page with separate red/blue uploads: enable both if they don't
 *     conflict, or just one if they do.
 *
 * Per-variant Delete lives here (rather than the card) so the card-level
 * Delete can keep its simple "remove this whole mod" meaning without
 * ambiguity about which file would be removed.
 */
export default function VariantPickerModal({
    modName,
    variants,
    onToggle,
    onDisableAll,
    onDeleteVariant,
    onRenameVariant,
    onOpenModDetails,
    onClose,
}: Props) {
    const [pending, setPending] = useState<string | null>(null);
    // Per-row rename state. Holds the variant id being edited plus the
    // working draft text; null when no row is in edit mode.
    const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);

    // Focus + select when the editing target changes (entering edit mode
    // for a new row). Driven by the id alone so we don't re-focus on every
    // keystroke as the draft updates.
    const editingId = editing?.id ?? null;
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    const anyActive = variants.some((v) => v.enabled);

    const startRename = (v: Mod) => {
        setEditing({ id: v.id, draft: v.variantLabel ?? '' });
    };

    const cancelRename = () => setEditing(null);

    const commitRename = async (v: Mod) => {
        if (!editing || editing.id !== v.id || pending) return;
        const next = editing.draft.trim();
        // No-op when the value hasn't changed (avoids a needless write).
        if (next === (v.variantLabel ?? '')) {
            setEditing(null);
            return;
        }
        setPending(`rename:${v.id}`);
        try {
            await onRenameVariant(v, next);
            setEditing(null);
        } finally {
            setPending(null);
        }
    };

    const pick = async (target: Mod) => {
        if (pending) return;
        // Toggle this one variant's enabled state. Don't close the modal —
        // users typically want to flip several before stepping back out.
        setPending(target.id);
        try {
            await onToggle(target);
        } finally {
            setPending(null);
        }
    };

    const disableActive = async () => {
        if (pending || !anyActive) return;
        setPending('__disable__');
        try {
            await onDisableAll();
            onClose();
        } finally {
            setPending(null);
        }
    };

    const handleDelete = async (variant: Mod) => {
        if (pending) return;
        setPending(`delete:${variant.id}`);
        try {
            await onDeleteVariant(variant);
        } finally {
            setPending(null);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="variant-picker-title"
            onClick={onClose}
        >
            <div
                className="bg-bg-secondary border border-border rounded-xl w-full max-w-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-5 border-b border-border gap-3">
                    <div className="min-w-0">
                        <h3 id="variant-picker-title" className="text-lg font-semibold text-text-primary truncate">
                            {modName}
                        </h3>
                        <p className="text-xs text-text-secondary mt-0.5">
                            {variants.length} variants — toggle any combination on or off
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {onOpenModDetails && (
                            <button
                                onClick={onOpenModDetails}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded cursor-pointer transition-colors"
                                title="Open the GameBanana mod page"
                            >
                                <Info className="w-3.5 h-3.5" />
                                Mod page
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-3 max-h-[60vh] overflow-y-auto space-y-1.5">
                    {variants.map((v) => {
                        const isActive = v.enabled;
                        const isPending = pending === v.id;
                        const isDeletePending = pending === `delete:${v.id}`;
                        const isEditing = editing?.id === v.id;
                        const isRenamePending = pending === `rename:${v.id}`;
                        // Title precedence: user rename wins, else the
                        // GameBanana file header the author set (e.g. "Gold
                        // w/ alt candle"), else the original GB filename
                        // stem (covers mods whose author left descriptions
                        // empty — far more useful than pak04_dir.vpk), else
                        // the local VPK filename. Show the local filename as
                        // a secondary line whenever we used a friendlier
                        // label up top so the underlying file is still
                        // discoverable.
                        const primaryTitle =
                            v.variantLabel ??
                            v.fileDescription ??
                            v.sourceFileName ??
                            v.fileName;
                        const showSecondaryFileName =
                            !!v.variantLabel || !!v.fileDescription || !!v.sourceFileName;
                        return (
                            <div
                                key={v.id}
                                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                    isActive
                                        ? 'border-accent/40 bg-accent/5'
                                        : 'border-border bg-bg-tertiary hover:bg-white/5'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => pick(v)}
                                    disabled={!!pending || isEditing}
                                    className="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default disabled:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                                    title={isActive ? 'Disable this variant' : 'Enable this variant'}
                                    aria-pressed={isActive}
                                >
                                    <div className="flex items-center gap-3">
                                        <span
                                            className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
                                                isActive ? 'border-accent bg-accent' : 'border-border bg-bg-secondary'
                                            }`}
                                            aria-hidden
                                        >
                                            {isActive && <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            {isEditing ? (
                                                <input
                                                    ref={editInputRef}
                                                    type="text"
                                                    value={editing.draft}
                                                    onChange={(e) => setEditing({ id: v.id, draft: e.target.value })}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => {
                                                        e.stopPropagation();
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            void commitRename(v);
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelRename();
                                                        }
                                                    }}
                                                    placeholder="e.g. Red preset"
                                                    maxLength={80}
                                                    className="w-full bg-bg-secondary border border-accent/50 rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                                                />
                                            ) : (
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span
                                                        className={`truncate ${showSecondaryFileName ? 'text-sm text-text-primary font-medium' : 'font-mono text-sm text-text-primary'}`}
                                                        title={primaryTitle}
                                                    >
                                                        {primaryTitle}
                                                    </span>
                                                    {isActive && (
                                                        <span className="text-[10px] uppercase tracking-wide bg-accent/20 text-accent rounded px-1.5 py-0.5 flex-shrink-0">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5 min-w-0">
                                                <span className="flex-shrink-0">{formatBytes(v.size)}</span>
                                                <span className="opacity-50 flex-shrink-0">•</span>
                                                <span className="flex-shrink-0">Slot #{v.priority}</span>
                                                {showSecondaryFileName && !isEditing && (
                                                    <>
                                                        <span className="opacity-50 flex-shrink-0">•</span>
                                                        <span className="font-mono truncate opacity-70" title={v.fileName}>
                                                            {v.fileName}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                {isEditing ? (
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => commitRename(v)}
                                            disabled={!!pending}
                                            className="p-1.5 text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:opacity-50"
                                            title="Save"
                                            aria-label="Save variant name"
                                        >
                                            {isRenamePending ? (
                                                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <Check className="w-4 h-4" />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={cancelRename}
                                            disabled={!!pending}
                                            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-white/5 rounded transition-colors cursor-pointer disabled:opacity-50"
                                            title="Cancel"
                                            aria-label="Cancel rename"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => startRename(v)}
                                            disabled={!!pending}
                                            className="flex-shrink-0 p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                                            title={v.variantLabel ? 'Rename variant' : 'Give this variant a name'}
                                            aria-label="Rename variant"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(v)}
                                            disabled={!!pending}
                                            className="flex-shrink-0 p-1.5 text-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                                            title={`Delete ${primaryTitle}`}
                                            aria-label={`Delete ${primaryTitle}`}
                                        >
                                            {isDeletePending ? (
                                                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <Trash2 className="w-4 h-4" />
                                            )}
                                        </button>
                                    </>
                                )}
                                {isPending && (
                                    <span className="text-xs text-accent">Toggling…</span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="flex items-center justify-between gap-3 p-5 border-t border-border">
                    {anyActive ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={PowerOff}
                            onClick={disableActive}
                            disabled={!!pending}
                            isLoading={pending === '__disable__'}
                        >
                            Disable all
                        </Button>
                    ) : (
                        <span className="text-xs text-text-secondary inline-flex items-center gap-1.5">
                            <Power className="w-3 h-3" />
                            No variants active — toggle any to enable
                        </span>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        Done
                    </Button>
                </div>
            </div>
        </div>
    );
}
