import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
    AlertTriangle,
    Download,
} from 'lucide-react';
import type { Mod } from '../types/mod';
import { ArchivedTag, Button, CheckboxMark, Tag } from './common/ui';
import { Input } from './common/forms';
import { Modal } from './common/Modal';
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates';
import { formatBytes } from '../lib/formatBytes';

type DropPosition = 'before' | 'after';
type VariantSection = 'enabled' | 'disabled';
type VariantDraftOrder = { section: VariantSection; ids: string[] } | null;

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
    /** Local mod ids that have a newer version available on GameBanana.
     *  Drives the per-row "Update" stamp and the group-level Update button. */
    variantsWithUpdate?: Set<string>;
    /** Trigger an in-place update for every flagged variant in this group.
     *  Omitted when nothing in the group has an update. */
    onUpdateGroup?: () => void | Promise<void>;
    /** True while an update run is in progress (shared with the page-level
     *  Update-all button) so this modal mirrors the same disabled/progress UX. */
    isUpdating?: boolean;
    updateProgress?: { done: number; total: number } | null;
    onClose: () => void;
}

function orderVariantsByIds(variants: Mod[], ids: string[]): Mod[] {
    if (variants.length !== ids.length) return variants;
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const ordered = ids.map((id) => byId.get(id)).filter((variant): variant is Mod => Boolean(variant));
    return ordered.length === variants.length ? ordered : variants;
}

function SortableVariantRow({
    id,
    disabled,
    children,
}: {
    id: string;
    disabled: boolean;
    children: ReactNode;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled });

    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.32 : undefined,
        position: 'relative',
        zIndex: isDragging ? 1 : undefined,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
        >
            {children}
        </div>
    );
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
    variantsWithUpdate,
    onUpdateGroup,
    isUpdating = false,
    updateProgress = null,
    onClose,
}: Props) {
    const { t } = useTranslation();
    const [pending, setPending] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [draggingSection, setDraggingSection] = useState<VariantSection | null>(null);
    const [dragDraftOrder, setDragDraftOrder] = useState<VariantDraftOrder>(null);
    const sortableSensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const resetDrag = () => {
        setDraggingId(null);
        setDraggingSection(null);
        setDragDraftOrder(null);
    };

    const variantsForSection = (section: VariantSection) => {
        const sectionVariants = variants.filter((v) => v.enabled === (section === 'enabled'));
        return dragDraftOrder?.section === section
            ? orderVariantsByIds(sectionVariants, dragDraftOrder.ids)
            : sectionVariants;
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

    const handleSortableDragStart = ({ active }: DragStartEvent, section: VariantSection) => {
        setDraggingId(String(active.id));
        setDraggingSection(section);
    };

    const handleSortableDragEnd = async ({ active, over }: DragEndEvent, section: VariantSection) => {
        const activeId = String(active.id);
        const overId = over ? String(over.id) : null;
        if (!overId || activeId === overId) {
            resetDrag();
            return;
        }

        const sectionVariants = variantsForSection(section);
        const oldIndex = sectionVariants.findIndex((variant) => variant.id === activeId);
        const newIndex = sectionVariants.findIndex((variant) => variant.id === overId);
        if (oldIndex === -1 || newIndex === -1) {
            resetDrag();
            return;
        }

        const source = sectionVariants[oldIndex];
        const target = sectionVariants[newIndex];
        if (!source || !target || source.enabled !== target.enabled) {
            resetDrag();
            return;
        }

        const nextIds = arrayMove(sectionVariants.map((variant) => variant.id), oldIndex, newIndex);
        setDragDraftOrder({ section, ids: nextIds });
        setPending(`move:${activeId}:drag`);
        try {
            await onReorderVariantTo(source, target, oldIndex < newIndex ? 'after' : 'before');
        } finally {
            setPending(null);
            resetDrag();
        }
    };

    const renderVariantRow = (
        v: Mod,
        idx: number,
        sectionVariants: Mod[],
        overlay = false
    ) => {
        const isActive = v.enabled;
        const isPending = pending === v.id;
        const isDeletePending = pending === `delete:${v.id}`;
        const isEditing = !overlay && editing?.id === v.id;
        const isRenamePending = pending === `rename:${v.id}`;
        const canMoveUp = idx > 0;
        const canMoveDown = idx < sectionVariants.length - 1;
        const showReorder = sectionVariants.length > 1;
        const isMoveUpPending = pending === `move:${v.id}:up`;
        const isMoveDownPending = pending === `move:${v.id}:down`;
        const hasUpdate = variantsWithUpdate?.has(v.id) ?? false;
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
                className={`relative flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    isActive
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border bg-bg-tertiary hover:bg-white/5'
                } ${hasUpdate ? 'update-stripes' : ''} ${overlay ? 'shadow-2xl ring-1 ring-accent/30' : ''}`}
            >
                <button
                    type="button"
                    onClick={overlay ? undefined : () => pick(v)}
                    disabled={overlay || !!pending || isEditing}
                    className="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default disabled:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                    title={isActive ? 'Disable this file' : 'Enable this file'}
                    aria-pressed={isActive}
                >
                    <div className="flex items-center gap-3">
                        <CheckboxMark checked={isActive} />
                        <div className="min-w-0 flex-1">
                            {isEditing ? (
                                <Input
                                    ref={editInputRef}
                                    inputSize="sm"
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
                                    placeholder={t('variantPicker.renamePlaceholder')}
                                    maxLength={80}
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
                                    {hasUpdate && (
                                        <Tag
                                            tone="accent"
                                            icon={Download}
                                            title={t('variantPicker.updateAvailable')}
                                            className="flex-shrink-0 uppercase tracking-wide"
                                        >
                                            {t('profiles.actions.update')}
                                        </Tag>
                                    )}
                                    {conflictDetails.length > 0 && (
                                        <Tag
                                            tone="warning"
                                            icon={AlertTriangle}
                                            title={conflictDetails.join(', ')}
                                            className="flex-shrink-0"
                                        >
                                            {t('variantPicker.conflict')}
                                        </Tag>
                                    )}
                                </div>
                            )}
                            <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5 min-w-0">
                                <span className="flex-shrink-0">{formatBytes(v.size)}</span>
                                <span className="opacity-50 flex-shrink-0">-</span>
                                <span className="flex-shrink-0">{t('variantPicker.slot', { priority: v.priority })}</span>
                                <span className="opacity-50 flex-shrink-0">-</span>
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
                            title={t('common.actions.save')}
                            aria-label={t('variantPicker.saveFileName')}
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
                            title={t('common.actions.cancel')}
                            aria-label={t('profiles.actions.cancelRename')}
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
                                    disabled={overlay || !!pending || !canMoveUp}
                                    className="p-0.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                                    title={canMoveUp ? 'Move up' : 'Already first in load order'}
                                    aria-label={t('variantPicker.moveFileUp')}
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
                                    disabled={overlay || !!pending || !canMoveDown}
                                    className="p-0.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                                    title={canMoveDown ? 'Move down' : 'Already last in load order'}
                                    aria-label={t('variantPicker.moveFileDown')}
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
                            disabled={overlay || !!pending}
                            className="flex-shrink-0 p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                            title={v.variantLabel ? 'Rename file' : 'Give this file a name'}
                            aria-label={t('variantPicker.renameFile')}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(v)}
                            disabled={overlay || !!pending}
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
                    <span className="text-xs text-accent">{t('variantPicker.saving')}</span>
                )}
            </div>
        );
    };

    const renderSortableVariantSection = (section: VariantSection) => {
        const sectionVariants = variantsForSection(section);
        if (sectionVariants.length === 0) return null;

        const activeVariant = draggingSection === section
            ? sectionVariants.find((variant) => variant.id === draggingId)
            : undefined;
        const activeIndex = activeVariant
            ? sectionVariants.findIndex((variant) => variant.id === activeVariant.id)
            : -1;
        const sectionCanReorder = sectionVariants.length > 1 && !editing && !pending;

        return (
            <DndContext
                sensors={sortableSensors}
                collisionDetection={closestCenter}
                onDragStart={(event) => handleSortableDragStart(event, section)}
                onDragEnd={(event) => {
                    void handleSortableDragEnd(event, section);
                }}
                onDragCancel={resetDrag}
            >
                <SortableContext
                    items={sectionVariants.map((variant) => variant.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="space-y-1.5">
                        {sectionVariants.map((variant, idx) => (
                            <SortableVariantRow
                                key={variant.id}
                                id={variant.id}
                                disabled={!sectionCanReorder}
                            >
                                {renderVariantRow(variant, idx, sectionVariants)}
                            </SortableVariantRow>
                        ))}
                    </div>
                </SortableContext>
                <DragOverlay>
                    {activeVariant ? (
                        <div className="pointer-events-none opacity-95 shadow-2xl">
                            {renderVariantRow(activeVariant, activeIndex, sectionVariants, true)}
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        );
    };

    return (
        <Modal
            onClose={onClose}
            labelledBy="variant-picker-title"
            size="none"
            panelClassName="max-w-xl"
        >
                <div className="flex items-center justify-between p-5 border-b border-border gap-3">
                    <div className="min-w-0">
                        <h3 id="variant-picker-title" className="text-lg font-semibold text-text-primary truncate">
                            {modName}
                        </h3>
                        <p className="text-xs text-text-secondary mt-0.5">
                            {t('variantPicker.filesEnabled', { enabled: enabledCount, total: variants.length })}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {onUpdateGroup && variantsWithUpdate && variantsWithUpdate.size > 0 && (
                            <Button
                                variant="primary"
                                size="sm"
                                icon={Download}
                                isLoading={isUpdating}
                                onClick={() => void onUpdateGroup()}
                                title={
                                    isUpdating
                                        ? 'Update already in progress'
                                        : `Re-download ${variantsWithUpdate.size} file${variantsWithUpdate.size === 1 ? '' : 's'} and restore their enabled state`
                                }
                            >
                                {isUpdating && updateProgress
                                    ? `Updating ${updateProgress.done}/${updateProgress.total}`
                                    : `Update ${variantsWithUpdate.size}`}
                            </Button>
                        )}
                        {onOpenModDetails && (
                            <button
                                onClick={onOpenModDetails}
                                disabled={isUpdating}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded cursor-pointer transition-colors disabled:cursor-default disabled:opacity-50"
                                title={t('variantPicker.openModPage')}
                            >
                                <Info className="w-3.5 h-3.5" />
                                {t('variantPicker.modPage')}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
                            aria-label={t('common.actions.close')}
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-3 max-h-[60vh] overflow-y-auto space-y-1.5">
                    {renderSortableVariantSection('enabled')}
                    {renderSortableVariantSection('disabled')}
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
                            {t('variantPicker.disableAll')}
                        </Button>
                    ) : (
                        <span className="text-xs text-text-secondary inline-flex items-center gap-1.5">
                            <Power className="w-3 h-3" />
                            {t('variantPicker.noFilesEnabled')}
                        </span>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        {t('common.actions.done')}
                    </Button>
                </div>
        </Modal>
    );
}
