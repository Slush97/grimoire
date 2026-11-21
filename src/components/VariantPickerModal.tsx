import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
    Pencil,
    ChevronUp,
    ChevronDown,
    AlertTriangle,
    Download,
    ExternalLink,
    Ellipsis,
    FilePlus,
    ImagePlus,
    Unlink,
} from 'lucide-react';
import type { Mod } from '../types/mod';
import { ArchivedTag, Button, CheckboxMark, IconButton, ModalHeader, Tag } from './common/ui';
import { Input } from './common/forms';
import { Modal } from './common/Modal';
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates';
import { formatBytes } from '../lib/formatBytes';
import { shakeElement } from '../lib/shakeElement';
import { useAppStore } from '../stores/appStore';
import type { RequirementToggleSession } from '../stores/requirementsStore';
import { useCategoryStore } from '../stores/categoryStore';
import { getInstalledCardTaxonomy } from '../lib/installedCardTaxonomy';
import { canonicalHeroName } from '../lib/lockerUtils';
import { isModLoadedInGame, isReorderBlocked } from '../lib/modLocks';
import { HeroIconStack } from './installed/chips';
import { getLocalModGallery, readImageDataUrl, showOpenDialogMulti } from '../lib/api';
import { IMAGE_EXTS, localImportErrorMessage, VPK_IMPORT_EXTS } from '../lib/customModImport';
import { shouldBlurNsfw } from '../lib/appSettings';
import { ModImageGallery, ModImageLightbox } from './common/RevealImage';
import { MenuCheckboxItem, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from './common/menu';
import { useStableCallback } from '../lib/useStableCallback';
import { canJoinLocalVariantGroup } from '../lib/localVariantEligibility';

type DropPosition = 'before' | 'after';
type VariantSection = 'enabled' | 'disabled';
type VariantDraftOrder = { section: VariantSection; ids: string[] } | null;

interface Props {
    /** Display name shared by the variants (use primary.name). */
    modName: string;
    onRenameMod?: (name: string) => Promise<void>;
    variants: Mod[];
    /** Toggle a single variant's enabled state. Variants are independent. */
    onToggle: (target: Mod, session?: RequirementToggleSession) => Promise<boolean> | void;
    /** Swap a variant with its picker-neighbor. */
    onMoveVariant: (target: Mod, direction: 'up' | 'down') => Promise<void> | void;
    /** Drag-drop reorder. Drops source before or after neighbor in load order. */
    onReorderVariantTo: (source: Mod, neighbor: Mod, position: DropPosition) => Promise<void> | void;
    /** Conflicts keyed by local mod id. Only in-group conflicts are passed in. */
    conflictsByVariantId?: Record<string, string[]>;
    /** Called when the user requests deletion of a single variant. */
    onDeleteVariant: (variant: Mod) => Promise<void> | void;
    /** Persist a user-given label for a variant. Empty string clears it. */
    onRenameVariant: (variant: Mod, label: string) => Promise<void> | void;
    /** Optional - open the GameBanana details modal for this mod. */
    onOpenModDetails?: () => void;
    /** Optional - import more local VPKs as variants of this mod. Passed only
     *  for local groups (a GameBanana group's files come from its submission). */
    onAddVariant?: (paths?: string[]) => void;
    /** Local artwork is shared by the group, including single-file local mods. */
    onGalleryChange?: (images: string[]) => Promise<void>;
    /** Apply the existing NSFW flag to every file in this mod. */
    onNsfwChange?: (nsfw: boolean) => Promise<void>;
    /** Optional - take one file back out of the group. It stays installed and
     *  enabled, it just stops being a variant of this mod. Local groups only. */
    onDetachVariant?: (variant: Mod) => Promise<void> | void;
    /** Local mod ids that have a newer version available on GameBanana.
     *  Drives the per-row "Update" stamp and the group-level Update button. */
    variantsWithUpdate?: Set<string>;
    /** Trigger an in-place update for every flagged variant in this group.
     *  Omitted when nothing in the group has an update. */
    onUpdateGroup?: () => void | Promise<void>;
    /** Shared batch state keeps this action disabled while work remains. */
    isUpdating?: boolean;
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
        transform: disabled ? undefined : CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.32 : undefined,
        position: 'relative',
        zIndex: isDragging ? 1 : undefined,
    };

    // A disabled drag handle must not disable the controls inside it.
    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            role={disabled ? undefined : attributes.role}
            tabIndex={disabled ? undefined : attributes.tabIndex}
            aria-disabled={disabled ? undefined : attributes['aria-disabled']}
            {...listeners}
        >
            {children}
        </div>
    );
}

/**
 * Variant picker for grouped mods. Shown when a card represents multiple VPKs
 * that are variants of one mod: files from one GameBanana submission, or local
 * imports sharing a group id. Any combination can be enabled. The add and
 * detach affordances are passed only for local groups, whose membership is the
 * user's to edit.
 */
export default function VariantPickerModal({
    modName,
    onRenameMod,
    variants,
    onToggle,
    onMoveVariant,
    onReorderVariantTo,
    conflictsByVariantId = {},
    onDeleteVariant,
    onRenameVariant,
    onOpenModDetails,
    onAddVariant,
    onGalleryChange,
    onNsfwChange,
    onDetachVariant,
    variantsWithUpdate,
    onUpdateGroup,
    isUpdating = false,
    onClose,
}: Props) {
    const { t } = useTranslation();
    const localMod = variants.length > 0 && variants.every(canJoinLocalVariantGroup);
    const galleryGroupId = localMod ? variants.find(variant => variant.localGroupId)?.localGroupId : undefined;
    const [gallery, setGallery] = useState<{ groupId?: string; images: string[] } | null>(null);
    const thumbnailSources = JSON.stringify(localMod && (galleryGroupId || onGalleryChange)
        ? [...new Set(variants.map(variant => variant.thumbnailUrl).filter((image): image is string => !!image))] : []);
    const fallbackImages = useMemo<string[]>(() => JSON.parse(thumbnailSources), [thumbnailSources]);
    const galleryWork = useRef(false);
    const galleryRevision = useRef(0);
    const mounted = useRef(true);
    const [error, setError] = useState<string | null>(null);
    const [imageIndex, setImageIndex] = useState<number | null>(null);
    const settings = useAppStore(state => state.settings);
    const galleryBlurred = variants.some(variant => variant.nsfw) && shouldBlurNsfw(settings);
    const revealGalleryOnHover = settings?.revealNsfwOnHover ?? false;
    const galleryPolicy = `${galleryBlurred}:${revealGalleryOnHover}`;
    const [previousPolicy, setPreviousPolicy] = useState(galleryPolicy);
    if (previousPolicy !== galleryPolicy) {
        setPreviousPolicy(galleryPolicy);
        if (imageIndex !== null) setImageIndex(null);
    }
    const galleryImages = gallery && gallery.groupId === galleryGroupId ? gallery.images : fallbackImages;
    const galleryLoading = !!galleryGroupId && gallery?.groupId !== galleryGroupId;
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
        if (!galleryGroupId) return;
        let live = true;
        const revision = ++galleryRevision.current;
        void getLocalModGallery(galleryGroupId).then(images => {
            if (live && revision === galleryRevision.current) setGallery({ groupId: galleryGroupId, images: images.length ? images : fallbackImages });
        }).catch(reason => {
            if (live && revision === galleryRevision.current) {
                setError(localImportErrorMessage(reason));
                setGallery({ groupId: galleryGroupId, images: fallbackImages });
            }
        });
        return () => { live = false; };
    }, [galleryGroupId, fallbackImages]);
    const loadedGameModIds = useAppStore((state) => state.loadedGameModIds);
    const heroByCategoryId = useCategoryStore((state) => state.heroByCategoryId);
    const heroNames = useCategoryStore((state) => state.heroNames);
    const pathsByModel = useCategoryStore((state) => state.pathsByModel);
    const variantHeroes = useMemo(() => new Map(variants.map(variant => {
        const resolved = getInstalledCardTaxonomy(variant, { heroByCategoryId, heroNames, pathsByModel }).heroNames;
        const heroes = [...new Map(resolved.map(hero => {
            const canonical = canonicalHeroName(hero);
            return [canonical.toLowerCase(), canonical];
        })).values()];
        return [variant.id, heroes];
    })), [variants, heroByCategoryId, heroNames, pathsByModel]);
    const showVariantHeroes = new Set([...variantHeroes.values()].map(heroes =>
        JSON.stringify(heroes.map(hero => hero.toLowerCase()).sort()),
    )).size > 1;
    const isOrderLocked = (mod?: Mod) => isModLoadedInGame(mod, loadedGameModIds);
    const titleId = useId();
    const [pending, setPending] = useState<string | null>(null);
    const [titleDraft, setTitleDraft] = useState<string | null>(null);
    const titleEditor = useRef<HTMLSpanElement>(null);
    const titleEditing = titleDraft !== null;
    useEffect(() => {
        if (!titleEditing || !titleEditor.current) return;
        titleEditor.current.focus();
        const range = document.createRange();
        range.selectNodeContents(titleEditor.current);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }, [titleEditing]);
    const titleSaving = useRef(false);
    const commitTitle = async () => {
        if (!localMod || !onRenameMod || titleDraft === null || titleSaving.current || pending) return;
        const name = titleDraft.replace(/[\r\n]+/g, ' ').trim();
        if (!name || name === modName) { setTitleDraft(null); return; }
        titleSaving.current = true;
        setPending('title');
        setError(null);
        try {
            await onRenameMod(name);
            if (mounted.current) setTitleDraft(null);
        } catch (reason) {
            if (mounted.current) setError(localImportErrorMessage(reason));
        } finally {
            titleSaving.current = false;
            if (mounted.current) setPending(null);
        }
    };
    const acceptArtwork = useStableCallback((images: string[]) => {
        galleryRevision.current++;
        setGallery({ groupId: galleryGroupId, images });
    });
    const changeNsfw = async (nsfw: boolean) => {
        if (!onNsfwChange || pending || isUpdating) return;
        setPending('nsfw');
        setError(null);
        try { await onNsfwChange(nsfw); }
        catch (reason) { if (mounted.current) setError(localImportErrorMessage(reason)); }
        finally { if (mounted.current) setPending(null); }
    };
    const editArtwork = async (change: () => Promise<string[]>) => {
        if (!onGalleryChange || galleryWork.current || galleryLoading || isUpdating || pending) return;
        galleryWork.current = true;
        galleryRevision.current++;
        setPending('gallery');
        setError(null);
        try {
            const images = await change();
            if (!mounted.current) return;
            await onGalleryChange(images);
            if (mounted.current) acceptArtwork(images);
        } catch (reason) {
            if (mounted.current) setError(localImportErrorMessage(reason));
        } finally {
            galleryWork.current = false;
            if (mounted.current) setPending(null);
        }
    };
    const addImages = (paths: string[]) => editArtwork(async () =>
        [...new Set([...galleryImages, ...await Promise.all(paths.map(readImageDataUrl))])]);
    const pickImages = async () => {
        try {
            const paths = await showOpenDialogMulti({ title: t('installed.imageField.selectImage'),
                filters: [{ name: t('common.fileTypes.images'), extensions: IMAGE_EXTS }] });
            if (mounted.current && paths.length) await addImages(paths);
        } catch (reason) {
            if (mounted.current) setError(localImportErrorMessage(reason));
        }
    };
    const pickVariants = async () => {
        try {
            const paths = await showOpenDialogMulti({ title: t('installed.batchImport.selectFiles'),
                filters: [{ name: t('common.fileTypes.vpkOrArchive'), extensions: VPK_IMPORT_EXTS }] });
            if (mounted.current && paths.length) onAddVariant?.(paths);
        } catch (reason) {
            if (mounted.current) setError(localImportErrorMessage(reason));
        }
    };
    const requirementsSession = useRef<RequirementToggleSession>({});
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

    const variantDisplayName = (v: Mod) =>
        v.variantLabel ??
        v.fileDescription ??
        v.sourceFileName ??
        v.fileName;

    const startRename = (v: Mod) => {
        setEditing({ id: v.id, draft: variantDisplayName(v) });
    };

    const cancelRename = () => setEditing(null);

    const commitRename = async (v: Mod) => {
        if (!editing || editing.id !== v.id || pending) return;
        const next = editing.draft.trim();
        if (next === variantDisplayName(v)) {
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

    const pick = async (target: Mod, row: HTMLElement | null) => {
        if (pending) return;
        setPending(target.id);
        try {
            const toggled = await onToggle(target, requirementsSession.current);
            if (target.enabled && toggled === false) shakeElement(row);
        } finally {
            setPending(null);
        }
    };

    const handleDetach = async (variant: Mod) => {
        if (pending || editing || !onDetachVariant) return;
        setPending(`detach:${variant.id}`);
        try {
            await onDetachVariant(variant);
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
        if (pending || isOrderLocked(variant)) return;
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
        if (isReorderBlocked(sectionVariants, oldIndex, newIndex, isOrderLocked)) {
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
        const isDeletePending = pending === `delete:${v.id}`;
        const isDetachPending = pending === `detach:${v.id}`;
        const isEditing = !overlay && editing?.id === v.id;
        const isRenamePending = pending === `rename:${v.id}`;
        const upLocked = isOrderLocked(v) || isOrderLocked(sectionVariants[idx - 1]);
        const downLocked = isOrderLocked(v) || isOrderLocked(sectionVariants[idx + 1]);
        const canMoveUp = idx > 0 && !upLocked;
        const canMoveDown = idx < sectionVariants.length - 1 && !downLocked;
        const showReorder = sectionVariants.length > 1;
        const isMoveUpPending = pending === `move:${v.id}:up`;
        const isMoveDownPending = pending === `move:${v.id}:down`;
        const hasUpdate = variantsWithUpdate?.has(v.id) ?? false;
        const conflictDetails = conflictsByVariantId[v.id] ?? [];
        const primaryTitle = variantDisplayName(v);
        const showSecondaryFileName =
            !!v.variantLabel || !!v.fileDescription || !!v.sourceFileName;
        const heroes = variantHeroes.get(v.id) ?? [];

        return (
            <div
                className={`relative flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    isActive
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border bg-bg-tertiary hover:bg-hl/5'
                } ${hasUpdate ? 'update-stripes' : ''} ${overlay ? 'shadow-2xl ring-1 ring-accent/30' : ''}`}
            >
                <button
                    type="button"
                    onClick={overlay ? undefined : (event) => pick(v, event.currentTarget.parentElement)}
                    disabled={overlay || !!pending || isEditing}
                    className="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default disabled:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                    title={isActive ? t('variantPicker.disableFile') : t('variantPicker.enableFile')}
                    aria-pressed={isActive}
                >
                    <div className="flex items-center gap-3">
                        <CheckboxMark checked={isActive} />
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1">
                            {showVariantHeroes && heroes.length > 0 && (
                                <HeroIconStack heroes={heroes} maxVisible={4} iconSize={16} maxWidth={32} />
                            )}
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
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <span
                                        className={`truncate ${showSecondaryFileName ? 'text-sm text-text-primary font-medium' : 'font-mono text-sm text-text-primary'}`}
                                        title={primaryTitle}
                                    >
                                        {primaryTitle}
                                    </span>
                                    {v.isArchived && <ArchivedTag />}
                                    {hasUpdate && (
                                        <Tag
                                            tone="update"
                                            variant="overlay"
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
                            </div>
                            <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5 min-w-0">
                                <span className="flex-shrink-0">{formatBytes(v.size)}</span>
                                <span className="opacity-50 flex-shrink-0">-</span>
                                <span className="flex-shrink-0">{t('variantPicker.slot', { priority: v.priority })}</span>
                                <span className="opacity-50 flex-shrink-0">-</span>
                                <span
                                    className="flex-shrink-0 tabular-nums"
                                    title={t('installed.card.installedAt', { date: formatAbsoluteDate(v.installedAt) })}
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
                            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hl/5 rounded transition-colors cursor-pointer disabled:opacity-50"
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
                                    title={upLocked ? t('common.gameRunningWarning') : canMoveUp ? t('installed.lists.moveUp') : t('variantPicker.alreadyFirst')}
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
                                    title={downLocked ? t('common.gameRunningWarning') : canMoveDown ? t('installed.lists.moveDown') : t('variantPicker.alreadyLast')}
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
                            title={v.variantLabel ? t('variantPicker.renameFile') : t('variantPicker.nameFile')}
                            aria-label={t('variantPicker.renameFile')}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        {onDetachVariant && canJoinLocalVariantGroup(v) && (
                            <button
                                type="button"
                                onClick={() => handleDetach(v)}
                                disabled={overlay || !!pending}
                                className="flex-shrink-0 p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                                title={t('variantPicker.detachVariantHint')}
                                aria-label={t('variantPicker.detachVariant')}
                            >
                                {isDetachPending ? (
                                    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Unlink className="w-4 h-4" />
                                )}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => handleDelete(v)}
                            disabled={overlay || !!pending}
                            className="flex-shrink-0 p-1.5 text-text-secondary hover:text-state-danger hover:bg-red-500/10 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                            title={t('variantPicker.deleteFile', { name: primaryTitle })}
                            aria-label={t('variantPicker.deleteFile', { name: primaryTitle })}
                        >
                            {isDeletePending ? (
                                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <Trash2 className="w-4 h-4" />
                            )}
                        </button>
                    </>
                )}
            </div>
        );
    };

    const renderSortableVariantSection = (section: VariantSection) => {
        const sectionVariants = variantsForSection(section);
        if (sectionVariants.length === 0) return null;

        const activeVariant = draggingSection === section
            ? sectionVariants.find((variant) => variant.id === draggingId && !isOrderLocked(variant))
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
                                disabled={!sectionCanReorder || isOrderLocked(variant)}
                            >
                                {renderVariantRow(variant, idx, sectionVariants)}
                            </SortableVariantRow>
                        ))}
                    </div>
                </SortableContext>
                {createPortal(
                    <DragOverlay zIndex={60} className="pointer-events-none">
                        {activeVariant ? (
                            <div className="opacity-95 shadow-2xl">
                                {renderVariantRow(activeVariant, activeIndex, sectionVariants, true)}
                            </div>
                        ) : null}
                    </DragOverlay>,
                    document.body,
                )}
            </DndContext>
        );
    };

    return (
        <Modal onClose={onClose} labelledBy={titleId} size="none" panelClassName="max-w-xl">
                <ModalHeader
                    titleId={titleId}
                    title={
                        localMod && onRenameMod ? (
                            titleEditing ? <span ref={titleEditor} contentEditable={pending === 'title' ? false : 'plaintext-only'}
                                suppressContentEditableWarning role="textbox" tabIndex={0} aria-multiline={false}
                                onInput={event => setTitleDraft(event.currentTarget.textContent ?? '')}
                                aria-label={t('variantPicker.renameMod')} aria-disabled={pending === 'title'}
                                className="block min-w-0 whitespace-nowrap outline-none"
                                onBlur={() => void commitTitle()}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' || event.key === 'Escape') {
                                        event.preventDefault(); event.stopPropagation();
                                        if (event.key === 'Enter') void commitTitle(); else setTitleDraft(null);
                                    }
                                }}>{modName}</span> : <button type="button" disabled={isUpdating || !!pending}
                                onClick={() => setTitleDraft(modName)} title={t('variantPicker.renameMod')}
                                className="max-w-full cursor-text truncate text-left disabled:opacity-60">{modName}</button>
                        ) : onOpenModDetails ? (
                            <button
                                type="button"
                                onClick={onOpenModDetails}
                                disabled={isUpdating}
                                title={t('variantPicker.openModPage')}
                                className="group inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-text-primary transition-colors hover:text-accent disabled:cursor-default disabled:opacity-60"
                            >
                                <span className="min-w-0 truncate">{modName}</span>
                                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent" />
                            </button>
                        ) : (
                            modName
                        )
                    }
                    subtitle={t('variantPicker.filesEnabled', { enabled: enabledCount, total: variants.length })}
                    onClose={onClose}
                    closeLabel={t('common.actions.close')}
                    className="pb-3"
                    actions={
                        <>
                            {onUpdateGroup && variantsWithUpdate && variantsWithUpdate.size > 0 && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={Download}
                                    isLoading={isUpdating}
                                    onClick={() => {
                                        void onUpdateGroup();
                                        onClose();
                                    }}
                                    title={
                                        isUpdating
                                            ? t('variantPicker.updateInProgress')
                                            : t('variantPicker.updateGroupHint', { count: variantsWithUpdate.size })
                                    }
                                >
                                    {isUpdating
                                        ? t('installed.updateAll.updating')
                                        : t('variantPicker.updateCount', { count: variantsWithUpdate.size })}
                                </Button>
                            )}
                            {localMod && onRenameMod && onOpenModDetails && (
                                <IconButton icon={ExternalLink} label={t('variantPicker.openModPage')}
                                    onClick={onOpenModDetails} disabled={isUpdating || !!pending} />
                            )}
                            {localMod && (onNsfwChange || onAddVariant || onGalleryChange) && <MenuRoot kind="dropdown">
                                <MenuTrigger asChild>
                                    <IconButton icon={Ellipsis} label={t('installed.card.moreActions')} disabled={isUpdating || !!pending} />
                                </MenuTrigger>
                                <MenuContent>
                                    {onNsfwChange && <MenuCheckboxItem checked={variants.some(variant => !!variant.nsfw)}
                                        disabled={isUpdating || !!pending} onCheckedChange={nsfw => void changeNsfw(nsfw)}>
                                        {t('installed.imageField.nsfw')}
                                    </MenuCheckboxItem>}
                                    {onNsfwChange && (onAddVariant || onGalleryChange) && <MenuSeparator />}
                                    {onAddVariant && <MenuItem icon={FilePlus} disabled={isUpdating || !!pending}
                                        onSelect={() => void pickVariants()}>{t('variantPicker.addFiles')}</MenuItem>}
                                    {onGalleryChange && <MenuItem icon={ImagePlus} disabled={isUpdating || !!pending || galleryLoading}
                                        onSelect={() => void pickImages()}>{t('variantPicker.addImages')}</MenuItem>}
                                </MenuContent>
                            </MenuRoot>}
                        </>
                    }
                />

                <div className="max-h-[60vh] min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                    {galleryImages.length > 0 && <ModImageGallery
                        images={galleryImages} modName={modName} blurred={galleryBlurred} revealOnHover={revealGalleryOnHover}
                        disabled={isUpdating || !!pending || galleryLoading} loading={pending === 'gallery' || galleryLoading}
                        onImageClick={setImageIndex}
                        actionsInContextMenu={!!onGalleryChange}
                        onMakeThumbnail={onGalleryChange ? index => void editArtwork(async () => [galleryImages[index], ...galleryImages.filter((_, current) => current !== index)]) : undefined}
                        onRemove={onGalleryChange ? index => void editArtwork(async () => galleryImages.filter((_, current) => current !== index)) : undefined}
                    />}
                    {renderSortableVariantSection('enabled')}
                    {renderSortableVariantSection('disabled')}
                    {error && <p role="alert" className="text-xs text-state-danger">{error}</p>}
                </div>
                {imageIndex !== null && galleryImages[imageIndex] && <ModImageLightbox
                    src={galleryImages[imageIndex]} modName={modName}
                    index={imageIndex} count={galleryImages.length} onClose={() => setImageIndex(null)}
                    onPrevious={() => setImageIndex((imageIndex + galleryImages.length - 1) % galleryImages.length)}
                    onNext={() => setImageIndex((imageIndex + 1) % galleryImages.length)} />}

        </Modal>
    );
}
