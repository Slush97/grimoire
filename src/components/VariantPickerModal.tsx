import { useEffect, useRef, useState } from 'react';
import {
    X,
    Check,
    Trash2,
    Power,
    PowerOff,
    Info,
    Pencil,
    ChevronUp,
    ChevronDown,
    GripVertical,
    AlertTriangle,
} from 'lucide-react';
import type { Mod } from '../types/mod';
import { ArchivedTag, Button, Tag } from './common/ui';
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates';

type DropPosition = 'before' | 'after';

interface Props {
    /** Display name shared by the variants (use primary.name). */
    modName: string;
    variants: Mod[];
    /** Toggle a single variant's enabled state. Variants are independent. */
    onToggle: (target: Mod) => Promise<void> | void;
    /** Swap a variant with its picker-neighbor. */
    onMoveVariant: (target: Mod, direction: 'up' | 'down') => Promise<void> | void;
    /** Drag-drop reorder. Drops source before or after neighbor in load order. */
    onReorderVariantTo: (source: Mod, neighbor: Mod, position: DropPosition) => Promise<void> | void;
    /** Called when the user disables every currently-enabled variant. */
    onDisableAll: () => Promise<void> | void;
    /** Conflicts keyed by local mod id. Only in-group conflicts are passed in. */
    conflictsByVariantId?: Record<string, string[]>;
    /** Called when the user requests deletion of a single variant. */
    onDeleteVariant: (variant: Mod) => Promise<void> | void;
    /** Persist a user-given label for a variant. Empty string clears it. */
    onRenameVariant: (variant: Mod, label: string) => Promise<void> | void;
    /** Optional - open the GameBanana details modal for this mod. */
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
 * Variant picker for grouped mods. Shown when a card represents multiple
 * VPKs sharing a GameBanana mod id. Any combination can be enabled.
 */
export default function VariantPickerModal({
    modName,
    variants,
    onToggle,
    onMoveVariant,
    onReorderVariantTo,
    onDisableAll,
    conflictsByVariantId = {},
    onDeleteVariant,
    onRenameVariant,
    onOpenModDetails,
    onClose,
}: Props) {
    const [pending, setPending] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
    const handleDownRef = useRef(false);

    const resetDrag = () => {
        setDraggingId(null);
        setDropTargetId(null);
        setDropPosition(null);
        handleDownRef.current = false;
    };

    const orderedVariants = [
        ...variants.filter((v) => v.enabled),
        ...variants.filter((v) => !v.enabled),
    ];

    const isNoopDrop = (sourceId: string, targetId: string, position: DropPosition) => {
        if (sourceId === targetId) return true;
        const sourceIdx = orderedVariants.findIndex((v) => v.id === sourceId);
        const targetIdx = orderedVariants.findIndex((v) => v.id === targetId);
        if (sourceIdx === -1 || targetIdx === -1) return false;
        return position === 'before'
            ? sourceIdx === targetIdx - 1
            : sourceIdx === targetIdx + 1;
    };

    const editingId = editing?.id ?? null;
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    const enabledCount = variants.filter((v) => v.enabled).length;
    const anyActive = enabledCount > 0;

    const startRename = (v: Mod) => {
        setEditing({ id: v.id, draft: v.variantLabel ?? '' });
    };

    const cancelRename = () => setEditing(null);

    const commitRename = async (v: Mod) => {
        if (!editing || editing.id !== v.id || pending) return;
        const next = editing.draft.trim();
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
        } finally {
            setPending(null);
        }
    };

    const handleDelete = async (variant: Mod) => {
        if (pending || editing) return;
        setPending(`delete:${variant.id}`);
        try {
            await onDeleteVariant(variant);
        } finally {
            setPending(null);
        }
    };

    const move = async (variant: Mod, direction: 'up' | 'down') => {
        if (pending) return;
        setPending(`move:${variant.id}:${direction}`);
        try {
            await onMoveVariant(variant, direction);
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
                            {enabledCount} of {variants.length} files enabled
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
                    {orderedVariants.map((v, idx) => {
                        const isActive = v.enabled;
                        const isPending = pending === v.id;
                        const isDeletePending = pending === `delete:${v.id}`;
                        const isEditing = editing?.id === v.id;
                        const isRenamePending = pending === `rename:${v.id}`;
                        const prev = idx > 0 ? orderedVariants[idx - 1] : null;
                        const nextSibling = idx < orderedVariants.length - 1 ? orderedVariants[idx + 1] : null;
                        const canMoveUp = !!prev && prev.enabled === v.enabled;
                        const canMoveDown = !!nextSibling && nextSibling.enabled === v.enabled;
                        const showReorder = variants.length > 1;
                        const isMoveUpPending = pending === `move:${v.id}:up`;
                        const isMoveDownPending = pending === `move:${v.id}:down`;
                        const isDragging = draggingId === v.id;
                        const isDropTarget = dropTargetId === v.id;
                        const conflictDetails = conflictsByVariantId[v.id] ?? [];
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
                                draggable={showReorder && !isEditing && !pending}
                                onDragStart={(e) => {
                                    if (!handleDownRef.current) {
                                        e.preventDefault();
                                        return;
                                    }
                                    handleDownRef.current = false;
                                    e.dataTransfer.effectAllowed = 'move';
                                    try {
                                        e.dataTransfer.setData('text/plain', v.id);
                                    } catch {
                                        // Some drag implementations do not allow setting data.
                                    }
                                    setDraggingId(v.id);
                                }}
                                onDragOver={(e) => {
                                    if (!draggingId || draggingId === v.id) return;
                                    const source = variants.find((x) => x.id === draggingId);
                                    if (!source || source.enabled !== v.enabled) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const midY = rect.top + rect.height / 2;
                                    const pos: DropPosition = e.clientY < midY ? 'before' : 'after';
                                    setDropTargetId(v.id);
                                    setDropPosition(pos);
                                }}
                                onDragLeave={(e) => {
                                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                                    if (dropTargetId === v.id) {
                                        setDropTargetId(null);
                                        setDropPosition(null);
                                    }
                                }}
                                onDrop={async (e) => {
                                    e.preventDefault();
                                    const sourceId = draggingId;
                                    const pos = dropPosition;
                                    resetDrag();
                                    if (!sourceId || sourceId === v.id || !pos) return;
                                    if (isNoopDrop(sourceId, v.id, pos)) return;
                                    const source = variants.find((x) => x.id === sourceId);
                                    if (!source || source.enabled !== v.enabled) return;
                                    setPending(`move:${sourceId}:drag`);
                                    try {
                                        await onReorderVariantTo(source, v, pos);
                                    } finally {
                                        setPending(null);
                                    }
                                }}
                                onDragEnd={resetDrag}
                                className={`relative flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                    isActive
                                        ? 'border-accent/40 bg-accent/5'
                                        : 'border-border bg-bg-tertiary hover:bg-white/5'
                                } ${isDragging ? 'opacity-50' : ''}`}
                            >
                                {isDropTarget && dropPosition && (
                                    <span
                                        aria-hidden
                                        className={`absolute left-2 right-2 ${dropPosition === 'before' ? '-top-[3px]' : '-bottom-[3px]'} h-[3px] bg-accent pointer-events-none rounded-full`}
                                    />
                                )}
                                {showReorder && (
                                    <div
                                        onMouseDown={() => {
                                            handleDownRef.current = true;
                                        }}
                                        onMouseUp={() => {
                                            handleDownRef.current = false;
                                        }}
                                        className="flex-shrink-0 p-1 text-text-secondary hover:text-text-primary cursor-grab active:cursor-grabbing select-none"
                                        title="Drag to reorder"
                                        aria-label="Drag to reorder"
                                    >
                                        <GripVertical className="w-4 h-4" />
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => pick(v)}
                                    disabled={!!pending || isEditing}
                                    className="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default disabled:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                                    title={isActive ? 'Disable this file' : 'Enable this file'}
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
                                                    {v.isArchived && <ArchivedTag />}
                                                    {conflictDetails.length > 0 && (
                                                        <Tag
                                                            tone="warning"
                                                            icon={AlertTriangle}
                                                            title={conflictDetails.join(', ')}
                                                            className="flex-shrink-0"
                                                        >
                                                            Conflict
                                                        </Tag>
                                                    )}
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5 min-w-0">
                                                <span className="flex-shrink-0">{formatBytes(v.size)}</span>
                                                <span className="opacity-50 flex-shrink-0">-</span>
                                                <span className="flex-shrink-0">Slot #{v.priority}</span>
                                                <span className="opacity-50 flex-shrink-0">•</span>
                                                <span
                                                    className="flex-shrink-0 tabular-nums"
                                                    title={`Installed ${formatAbsoluteDate(v.installedAt)}`}
                                                >
                                                    {formatRelativeDate(v.installedAt)}
                                                </span>
                                                {showSecondaryFileName && !isEditing && (
                                                    <>
                                                        <span className="opacity-50 flex-shrink-0">-</span>
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
                                            aria-label="Save file name"
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
                                        {showReorder && (
                                            <div className="flex flex-col gap-0.5 flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => move(v, 'up')}
                                                    disabled={!!pending || !canMoveUp}
                                                    className="p-0.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                                                    title={canMoveUp ? 'Move up' : idx === 0 ? 'Already first in load order' : 'Adjacent file is in a different section'}
                                                    aria-label="Move file up in load order"
                                                >
                                                    {isMoveUpPending ? (
                                                        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                        <ChevronUp className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => move(v, 'down')}
                                                    disabled={!!pending || !canMoveDown}
                                                    className="p-0.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                                                    title={canMoveDown ? 'Move down' : idx === orderedVariants.length - 1 ? 'Already last in load order' : 'Adjacent file is in a different section'}
                                                    aria-label="Move file down in load order"
                                                >
                                                    {isMoveDownPending ? (
                                                        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                        <ChevronDown className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => startRename(v)}
                                            disabled={!!pending}
                                            className="flex-shrink-0 p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                                            title={v.variantLabel ? 'Rename file' : 'Give this file a name'}
                                            aria-label="Rename file"
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
                                    <span className="text-xs text-accent">Saving...</span>
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
                            disabled={!!pending || !!editing}
                            isLoading={pending === '__disable__'}
                        >
                            Disable all
                        </Button>
                    ) : (
                        <span className="text-xs text-text-secondary inline-flex items-center gap-1.5">
                            <Power className="w-3 h-3" />
                            No files enabled
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
