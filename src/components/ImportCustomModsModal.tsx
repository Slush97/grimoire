import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Fingerprint,
  FilePlus,
  ImagePlus,
  Layers3,
  Loader2,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react';
import { Modal, ModalFooter } from './common/Modal';
import { Button, CheckboxMark, IconButton, ModalHeader, Tag } from './common/ui';
import { Input } from './common/forms';
import { ModImageGallery, RevealImage } from './common/RevealImage';
import {
  onImportCustomModsProgress,
  prepareLocalModImport,
  releaseLocalModImport,
  readImageDataUrl,
  showOpenDialogMulti,
} from '../lib/api';
import type {
  ImportCustomModArgs,
  ImportCustomModResult,
  PeekImprintResult,
} from '../lib/api';
import {
  IMAGE_EXTS,
  VPK_IMPORT_EXTS,
  classifyDroppedModFiles,
  deriveModNameFromPath,
  deriveVariantLabel,
  fileNameOf,
  imprintVariantLabel,
  localImportErrorMessage,
  pathDedupeKey,
} from '../lib/customModImport';
import { useAppStore } from '../stores/appStore';
import { useNavigate } from 'react-router-dom';
import { useModSafetyStore } from '../stores/modSafetyStore';
import type { PreparedLocalModImport } from '../types/electron';
import type { ModTagOverrides } from '../types/mod';
import { useCategoryStore } from '../stores/categoryStore';
import { EMPTY_CUSTOM_TAGS, EMPTY_TAG_ORDER, useInstalledTagsStore } from '../stores/installedTagsStore';
import { getInstallationScope } from '../lib/appSettings';
import { installedBaseTagOptions, sortInstalledTags } from '../lib/installedCardTaxonomy';
import { gameBananaCategoryLabel } from '../lib/gameBananaCategories';
import { HERO_NAMES_SORTED } from '../lib/lockerUtils';
import { ChipText, HeroTagLabel, MOD_TAG_CHIP_CLASS, MOD_TAG_SURFACE_CLASS } from './installed/chips';
import { formatBytes } from '../lib/formatBytes';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuTrigger } from './common/menu';
import { useStableCallback } from '../lib/useStableCallback';

type RowStatus = 'pending' | 'importing' | 'done' | 'failed';

interface ImportRow {
  id: string;
  inspection: 'checking' | 'ready' | 'failed';
  preparation?: PreparedLocalModImport;
  inspectionError?: string;
  labelFocused: boolean;
  /** Selected source and dedupe key, including archives. */
  path: string;
  name: string;
  nameTouched: boolean;
  thumbnailDataUrl?: string;
  nsfw: boolean;
  /** Name typed for the grouped variant picker. Until the user types one, the
   *  row shows `defaultVariantLabel`. */
  variantLabel: string;
  labelTouched: boolean;
  recognized: PeekImprintResult | null;
  status: RowStatus;
  imported: number;
  error?: string;
}

interface ImportCustomModsModalProps {
  onClose: () => void;
  /** Runs the batch. Resolves with one result per item, in the order given. */
  onImport: (items: ImportCustomModArgs[]) => Promise<ImportCustomModResult[]>;
  /** Fired once after a batch, with every source's outcome, so the host can
   *  toast a summary. Failed rows stay listed in the dialog either way. */
  onFinished?: (results: ImportCustomModResult[]) => void;
  /** Add-variants mode: every file imported here becomes another variant of an
   *  existing local mod. The group owns the name and artwork, so every item uses
   *  `modName`. The host's `onImport` is what attaches the group id (and mints
   *  the group when the target is still a standalone mod), which keeps uuid
   *  minting out of this dialog. */
  addToGroup?: { modName: string; nsfw?: boolean };
  /** Paths handed over by the app-wide drop controller. Staged as rows on
   *  arrival, then acknowledged through `onConsumedPaths`. */
  pendingPaths?: string[];
  onConsumedPaths?: (paths: string[]) => void;
  /** Lets the host mirror submission state (the app-wide controller rejects
   *  drops while a batch is running). Unused by the add-variants instance,
   *  which ignores drops on its own while submitting. */
  onSubmittingChange?: (submitting: boolean) => void;
}

const newRow = (path: string): ImportRow => ({
  path,
  id: crypto.randomUUID(),
  inspection: 'checking',
  labelFocused: false,
  name: deriveModNameFromPath(path),
  nameTouched: false,
  nsfw: false,
  variantLabel: '',
  labelTouched: false,
  recognized: null,
  status: 'pending',
  imported: 0,
});

/**
 * Batch local import: pick or drop any number of `.vpk` files and archives, get
 * a row per source. By default they become variants of one mod, sharing its
 * name, gallery, tags and NSFW setting. Separate imports keep per-source details.
 *
 * Failures are per row, not per batch: the main process keeps going after a bad
 * source, so a corrupt archive in the middle of 20 files doesn't cost the other
 * 19. Rows that landed disappear; rows that failed stay put with the reason, so
 * the button retries exactly what's left. That retry only holds because this
 * dialog is hosted by Layout, not by Installed: mounting it under a page that
 * early-returns on an empty mod list would unmount it the moment a first-ever
 * import made the list non-empty, taking the failed rows with it. (The
 * add-variants instance is hosted by Installed instead, which is safe: it can
 * only be opened from a card, so the page always has mods.)
 *
 * With `addToGroup`, the same dialog adds variants to an existing local mod:
 * same picking, dropping and retry behavior, preserving the group's artwork
 * and existing tags.
 */
export default function ImportCustomModsModal({
  onClose,
  onImport,
  onFinished,
  addToGroup,
  pendingPaths,
  onConsumedPaths,
  onSubmittingChange,
}: ImportCustomModsModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // With "Enable mods after download" on, imports that pass the review go live.
  const importsWaitDisabled = useAppStore(s =>
    (s.settings?.experimentalModSafety ?? false) && !(s.settings?.autoEnableDownloads ?? false));
  const reviewAfterClose = useRef(false);
  const close = () => {
    onClose();
    if (reviewAfterClose.current) {
      useModSafetyStore.setState({ detail: null });
      navigate('/settings/mod-safety');
    }
  };
  const platform = window.electronAPI.platform;
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantGroupName, setVariantGroupName] = useState<string | null>(null);
  const [groupAsVariants, setGroupAsVariants] = useState(true);
  const usesSharedName = !!addToGroup || groupAsVariants;
  const showGroupingToggle = !addToGroup && rows.length > 1;
  const groupNameId = useId();
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const galleryInitialized = useRef(false);
  const [groupNsfw, setGroupNsfw] = useState(addToGroup?.nsfw ?? false);
  const [sharedLocked, setSharedLocked] = useState(false);
  const sharedDisabled = submitting || sharedLocked;
  const dialogGeneration = useRef({ value: 0 });
  const [pendingImages, setPendingImages] = useState(0);
  const [tagChanges, setTagChanges] = useState<{ add: ModTagOverrides; remove: ModTagOverrides }>({ add: {}, remove: {} });
  const [customTagIds, setCustomTagIds] = useState<string[]>([]);
  const tagScope = useAppStore(state => getInstallationScope(state.settings));
  const customTags = useInstalledTagsStore(state => tagScope ? state.byScope[tagScope] ?? EMPTY_CUSTOM_TAGS : EMPTY_CUSTOM_TAGS);
  const tagOrder = useInstalledTagsStore(state => tagScope ? state.orderByScope[tagScope] ?? EMPTY_TAG_ORDER : EMPTY_TAG_ORDER);
  const heroNames = useCategoryStore(state => state.heroNames);
  const pathsByModel = useCategoryStore(state => state.pathsByModel);
  const taxonomyContext = useMemo(() => ({ heroNames, pathsByModel }), [heroNames, pathsByModel]);
  useEffect(() => { if (tagScope) useInstalledTagsStore.getState().load(tagScope); }, [tagScope]);
  // Main returns the UUID it minted. Keep it across a partial-failure retry so
  // the remaining files join the members that already landed.
  const [variantGroupId, setVariantGroupId] = useState<string | null>(null);
  // Row paths in submit order, so a progress event's index maps back to a row.
  const submittedPathsRef = useRef<string[]>([]);

  const patchRow = useCallback((path: string, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((row) => (row.path === path ? { ...row, ...patch } : row)));
  }, []);

  // Progress is streamed while the batch runs so a long copy shows movement
  // instead of one frozen spinner. Subscribed for the modal's whole life: the
  // main process only emits during our own invoke.
  useEffect(() => {
    return onImportCustomModsProgress((progress) => {
      const path = submittedPathsRef.current[progress.index];
      if (!path || progress.vpkPath !== path) return;
      if (progress.phase === 'importing') {
        patchRow(path, { status: 'importing', error: undefined });
      } else if (progress.phase === 'done') {
        patchRow(path, { status: 'done', imported: progress.imported ?? 1 });
      } else {
        patchRow(path, { status: 'failed', error: progress.error ? localImportErrorMessage(progress.error) : undefined });
      }
    });
  }, [patchRow]);

  // Keep each request tied to the row instance, not its filename. Removing
  // and re-adding a source must never accept an older inspection's response.
  const inspections = useRef(new Map<string, string>());
  useEffect(() => {
    const live = new Set(rows.map(row => row.id));
    for (const [id, requestId] of inspections.current) {
      if (live.has(id)) continue;
      inspections.current.delete(id);
      void releaseLocalModImport(requestId).catch(() => {});
    }
    for (const row of rows) {
      if (inspections.current.has(row.id)) continue;
      const requestId = crypto.randomUUID();
      inspections.current.set(row.id, requestId);
      void prepareLocalModImport(row.path, requestId).then(preparation => {
        if (inspections.current.get(row.id) !== requestId) return;
        const recognized = preparation.members.length === 1 ? preparation.members[0].recognized : null;
        setRows(previous => previous.map(current => current.id === row.id ? {
          ...current, preparation, recognized, inspection: 'ready', inspectionError: undefined,
          name: current.nameTouched ? current.name : recognized?.title || current.name,
          thumbnailDataUrl: current.thumbnailDataUrl ?? recognized?.thumbnailUrl,
        } : current));
      }).catch(reason => {
        if (inspections.current.get(row.id) !== requestId) return;
        setRows(previous => previous.map(current => current.id === row.id
          ? { ...current, inspection: 'failed', inspectionError: localImportErrorMessage(reason) } : current));
      });
    }
  }, [rows]);
  useEffect(() => {
    const requests = inspections.current;
    const generation = dialogGeneration.current;
    return () => {
      generation.value++;
      for (const requestId of requests.values()) void releaseLocalModImport(requestId).catch(() => {});
      requests.clear();
    };
  }, []);

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const candidates = paths.map(newRow);
      setRows((prev) => {
        const seen = new Set(prev.map((row) => pathDedupeKey(row.path, platform)));
        const fresh: ImportRow[] = [];
        for (const candidate of candidates) {
          const key = pathDedupeKey(candidate.path, platform);
          if (seen.has(key)) continue;
          seen.add(key);
          fresh.push(candidate);
        }
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    },
    [platform]
  );

  // Stage paths dropped anywhere in the app. addPaths owns the dedupe and the
  // row defaults, and inspection keys off each row, so files arriving
  // after mount get inspected with no extra wiring.
  useEffect(() => {
    if (!pendingPaths?.length) return;
    addPaths(pendingPaths);
    onConsumedPaths?.(pendingPaths);
  }, [pendingPaths, addPaths, onConsumedPaths]);

  useEffect(() => {
    onSubmittingChange?.(submitting);
    return () => onSubmittingChange?.(false);
  }, [submitting, onSubmittingChange]);

  // Add-variants mode is itself a VPK drop target, so the app-wide controller
  // must stand down for as long as this instance is mounted.
  const ownsModDrops = !!addToGroup;
  useEffect(() => {
    if (!ownsModDrops) return;
    const { setSuppressGlobalModDrop } = useAppStore.getState();
    setSuppressGlobalModDrop(true);
    return () => setSuppressGlobalModDrop(false);
  }, [ownsModDrops]);

  const pickFiles = async () => {
    if (submitting) return;
    const generation = dialogGeneration.current.value;
    try {
      const picked = await showOpenDialogMulti({
        title: t('installed.batchImport.selectFiles'),
        filters: [{ name: t('common.fileTypes.vpkOrArchive'), extensions: VPK_IMPORT_EXTS }],
      });
      if (generation !== dialogGeneration.current.value) return;
      setError(null);
      addPaths(picked);
    } catch (reason) {
      if (generation === dialogGeneration.current.value) setError(localImportErrorMessage(reason));
    }
  };

  // Live for the add-variants instance. The batch instance rarely sees this:
  // the app-wide controller claims supported files in the capture phase and
  // hands them over as pendingPaths instead.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (submitting) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;

    const { paths, rejectedNames, unresolvedCount } = classifyDroppedModFiles(files, (file) =>
      window.electronAPI.getDroppedFilePath(file)
    );

    if (unresolvedCount > 0) setError(t('installed.import.dropUnresolved'));
    else if (rejectedNames.length > 0)
      setError(t('installed.import.expectedVpk', { name: rejectedNames[0] }));
    else setError(null);
    addPaths(paths);
  };

  const acceptRowImage = useStableCallback((row: ImportRow, image: string) => {
    setRows(previous => previous.map(current => current.id === row.id ? { ...current, thumbnailDataUrl: image } : current));
    // The last source may have moved into the shared editor during the read.
    if (!addToGroup && usesSharedName && rows.length === 1 && rows[0].id === row.id) {
      setGalleryImages(current => row.thumbnailDataUrl
        ? current.map(source => source === row.thumbnailDataUrl ? image : source)
        : [...new Set([...current, image])]);
    }
  });
  const addImages = async (paths: string[], row?: ImportRow) => {
    const generation = dialogGeneration.current.value;
    const requestId = row ? inspections.current.get(row.id) : undefined;
    const isCurrent = () => generation === dialogGeneration.current.value
      && (!row || requestId !== undefined && inspections.current.get(row.id) === requestId);
    setPendingImages(count => count + 1);
    try {
      const images = await Promise.all((row ? paths.slice(0, 1) : paths).map(readImageDataUrl));
      if (!isCurrent()) return;
      if (row) {
        acceptRowImage(row, images[0]);
      } else {
        galleryInitialized.current = true;
        setGalleryImages(previous => [...new Set([...previous, ...images])]);
      }
      setError(null);
    } catch (reason) {
      if (isCurrent()) setError(t('installed.imageField.readFailed', { error: localImportErrorMessage(reason) }));
    } finally {
      if (generation === dialogGeneration.current.value) setPendingImages(count => count - 1);
    }
  };
  const pickThumbnail = async (row?: ImportRow) => {
    if (row ? submitting || pendingImages > 0 : sharedDisabled) return;
    const generation = dialogGeneration.current.value;
    try {
      const picked = await showOpenDialogMulti({
        title: t('installed.imageField.selectImage'),
        filters: [{ name: t('common.fileTypes.images'), extensions: IMAGE_EXTS }],
      });
      if (generation === dialogGeneration.current.value && picked.length && (!row || inspections.current.has(row.id))) await addImages(picked, row);
    } catch (reason) {
      if (generation === dialogGeneration.current.value) setError(localImportErrorMessage(reason));
    }
  };
  const dropThumbnail = async (e: React.DragEvent, row?: ImportRow) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (row ? submitting || pendingImages > 0 : sharedDisabled) return;
    const paths: string[] = [];
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of row ? files.slice(0, 1) : files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!IMAGE_EXTS.includes(ext)) {
        setError(t('installed.imageField.expectedImage', { exts: IMAGE_EXTS.join(', '), name: file.name }));
        return;
      }
      const path = window.electronAPI.getDroppedFilePath(file);
      if (!path) { setError(t('installed.imageField.dropUnresolved')); return; }
      paths.push(path);
    }
    if (paths.length) await addImages(paths, row);
  };

  const changeImportMode = (grouped: boolean, sources = rows) => {
    if (grouped === groupAsVariants) return;
    if (grouped && !galleryInitialized.current) {
      const thumbnails = sources.map(row => row.thumbnailDataUrl).filter((image): image is string => !!image);
      setGalleryImages([...new Set(thumbnails)]);
      galleryInitialized.current = true;
    }
    setGroupAsVariants(grouped);
  };

  const removeRow = (path: string) => {
    const remaining = rows.filter(row => row.path !== path);
    setRows(remaining);
    // A new one-file import uses the shared editor. Partial retries retain the
    // mode that already installed their successful sources.
    if (remaining.length === 1 && !sharedLocked && !groupAsVariants) {
      const single = remaining[0];
      setVariantGroupName(single.name);
      setGroupNsfw(single.nsfw);
      setGalleryImages(single.thumbnailDataUrl ? [single.thumbnailDataUrl] : []);
      galleryInitialized.current = true;
      setTagChanges({ add: {}, remove: {} });
      setCustomTagIds([]);
    }
    if (remaining.length < 2 && !sharedLocked) changeImportMode(true, remaining);
  };
  const clearRows = () => {
    dialogGeneration.current.value++;
    setPendingImages(0);
    setRows([]);
    setError(null);
    if (!variantGroupId) {
      setGroupAsVariants(true);
      galleryInitialized.current = false;
      setVariantGroupName(null); setGalleryImages([]); setGroupNsfw(addToGroup?.nsfw ?? false);
      setSharedLocked(false);
      setTagChanges({ add: {}, remove: {} }); setCustomTagIds([]);
    }
  };
  // Bare VPKs map one-to-one to picker rows, so each shows its generated label
  // ready to edit: the name from its imprint when that tells it apart, else its
  // file name. Archives stay blank because one source can expand into several
  // members; typing there intentionally supplies a shared prefix.
  const imprints = rows.map((row) => row.recognized);
  const sharedName = addToGroup ? addToGroup.modName : variantGroupName ?? rows[0]?.name ?? '';
  const defaultVariantLabel = (row: ImportRow): string =>
    row.path.toLowerCase().endsWith('.vpk')
      ? imprintVariantLabel(row.recognized, imprints, sharedName) ?? deriveVariantLabel(row.path)
      : '';
  const variantLabelOf = (row: ImportRow): string =>
    row.labelTouched ? row.variantLabel : defaultVariantLabel(row);
  const nameMissing = usesSharedName ? !sharedName.trim() : rows.some(row => !row.name.trim());
  const canSubmit = rows.length > 0 && !nameMissing && !submitting && pendingImages === 0 && rows.every(row => row.inspection === 'ready');
  const detected = {
    base: [...new Set(rows.flatMap(row => row.preparation?.members.flatMap(member => member.baseTags) ?? []))],
    heroes: [...new Set(rows.flatMap(row => row.preparation?.members.flatMap(member => member.heroes) ?? []))],
  };
  const selected = {
    base: [...new Set([...detected.base.filter(tag => !tagChanges.remove.base?.includes(tag)), ...(tagChanges.add.base ?? [])])],
    heroes: [...new Set([...detected.heroes.filter(tag => !tagChanges.remove.heroes?.includes(tag)), ...(tagChanges.add.heroes ?? [])])],
  };
  const setTag = (axis: 'base' | 'heroes', tag: string, included: boolean) => setTagChanges(previous => ({
    add: { ...previous.add, [axis]: included ? [...new Set([...(previous.add[axis] ?? []), tag])]
      : (previous.add[axis] ?? []).filter(value => value !== tag) },
    remove: { ...previous.remove, [axis]: included ? (previous.remove[axis] ?? []).filter(value => value !== tag)
      : [...new Set([...(previous.remove[axis] ?? []), tag])] },
  }));
  const baseChoices = sortInstalledTags(installedBaseTagOptions(taxonomyContext, detected.base)
    .map(label => ({ key: `tag:${label.toLowerCase()}`, label })), tagOrder);
  const tagChips = sortInstalledTags([
    ...customTags.filter(tag => customTagIds.includes(tag.id)).map(tag => ({ key: `custom:${tag.id}`, label: tag.name, remove: () => setCustomTagIds(ids => ids.filter(id => id !== tag.id)) })),
    ...selected.base.map(label => ({ key: `tag:${label.toLowerCase()}`, label: gameBananaCategoryLabel(label, t), remove: () => setTag('base', label, false) })),
    ...selected.heroes.map(label => ({ key: `hero:${label}`, label, remove: () => setTag('heroes', label, false) })),
  ], tagOrder);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const generation = dialogGeneration.current.value;
    setSubmitting(true);
    setError(null);
    const batch = rows;
    // Freeze the chosen name so retries retain it when successful rows leave.
    if (!addToGroup && groupAsVariants) setVariantGroupName(sharedName.trim());
    submittedPathsRef.current = batch.map((row) => row.path);
    setRows((prev) => prev.map((row) => ({ ...row, status: 'pending', error: undefined })));

    try {
      const results = await onImport(
        batch.map((row) => ({
          vpkPath: row.path,
          name: usesSharedName ? sharedName.trim() : row.name.trim(),
          variantLabel: usesSharedName ? variantLabelOf(row).trim() || undefined : undefined,
          preparationId: row.preparation!.id,
          ...(!addToGroup && groupAsVariants ? { galleryImages, tagChanges, customTagIds } : {}),
          thumbnailDataUrl: !usesSharedName ? row.thumbnailDataUrl || undefined : undefined,
          nsfw: usesSharedName ? groupNsfw : row.nsfw,
          localGroupId: !addToGroup && groupAsVariants ? variantGroupId ?? undefined : undefined,
          localGroupBatchKey:
            !addToGroup && groupAsVariants && !variantGroupId ? 'import-modal-variant-group' : undefined,
        }))
      );
      if (generation !== dialogGeneration.current.value) return;
      if (results.some(result => result.ok)) setSharedLocked(true);

      if (!addToGroup && groupAsVariants) {
        const resolvedGroupId = results.find((result) => result.localGroupId)?.localGroupId;
        if (resolvedGroupId) {
          setVariantGroupId(resolvedGroupId);
          setSharedLocked(true);
        }
      }

      const failed = new Map<string, string | undefined>();
      results.forEach((result, index) => {
        const path = batch[index]?.path;
        if (path && !result.ok) failed.set(path, result.error ? localImportErrorMessage(result.error) : undefined);
      });
      reviewAfterClose.current ||= results.some(result => result.ok && result.needsReview);
      onFinished?.(results);

      // Drop what landed, keep what didn't (with its reason) so the button
      // retries exactly the leftovers.
      if (failed.size === 0) {
        close();
        return;
      }
      setRows((prev) =>
        prev
          .filter((row) => failed.has(row.path))
          .map((row) => ({ ...row, status: 'failed' as const, error: failed.get(row.path) }))
      );
      setError(t('installed.batchImport.someFailed', { count: failed.size }));
      setSubmitting(false);
    } catch (err) {
      if (generation !== dialogGeneration.current.value) return;
      // The batch never ran (no game path, empty list): nothing landed, so no
      // row carries a reason. Clear any error left from an earlier attempt.
      setError(localImportErrorMessage(err));
      setRows((prev) =>
        prev.map((row) => ({ ...row, status: 'pending' as const, error: undefined }))
      );
      setSubmitting(false);
    }
  };

  const statusIcon = (row: ImportRow) => {
    if (row.status === 'importing' || row.inspection === 'checking') {
      return <Loader2 className={`h-4 w-4 flex-shrink-0 animate-spin ${row.inspection === 'checking' ? 'text-state-warning' : 'text-accent'}`} aria-hidden />;
    }
    if (row.status === 'done') {
      return <Check className="h-4 w-4 flex-shrink-0 text-state-success" aria-hidden />;
    }
    if (row.status === 'failed' || row.inspection === 'failed') {
      return <AlertCircle className="h-4 w-4 flex-shrink-0 text-state-danger" aria-hidden />;
    }
    return null;
  };

  const dropArea = (compact: boolean) => (
    <button type="button" onClick={() => void pickFiles()} disabled={submitting}
      aria-label={t('installed.batchImport.ariaBrowse')}
      className={`flex w-full items-center justify-center rounded-sm border border-dashed px-4 text-center transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'flex-row flex-wrap gap-x-1 py-2.5' : 'flex-col gap-1 py-10'} ${dragActive
        ? 'border-accent bg-accent/10' : 'cursor-pointer border-border bg-bg-tertiary/40 hover:border-hl/20 hover:bg-bg-tertiary'}`}>
      {!compact && <UploadCloud className="h-7 w-7 text-text-secondary" aria-hidden />}
      <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-text-primary`}>
        <Trans i18nKey="installed.batchImport.dropFilesHere" components={{ code: <code className="font-mono text-accent" /> }} />
      </span>
      <span className="text-xs text-text-secondary">{t('installed.import.orClickToBrowse')}</span>
    </button>
  );

  const nsfwButton = (checked: boolean, onClick: () => void, disabled = sharedDisabled) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked}
      className={`h-7 shrink-0 cursor-pointer rounded-sm border px-2 text-2xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'border-state-danger/50 bg-state-danger/15 text-state-danger' : 'border-border text-text-secondary hover:border-hl/20 hover:text-text-primary'}`}>
      {t('installed.imageField.nsfw')}
    </button>
  );

  return (
    <Modal onClose={close} labelledBy="import-custom-mods-title" size="xl" dismissable={!submitting}
      panelClassName="max-h-[min(85vh,100%)]">
      <ModalHeader title={addToGroup ? t('installed.batchImport.addVariantsTitle', { name: addToGroup.modName })
        : groupAsVariants ? t('installed.batchImport.title') : t('installed.batchImport.separateTitle')}
        titleId="import-custom-mods-title" subtitle={rows.length ? t('installed.batchImport.fileCount', { count: rows.length }) : undefined}
        onClose={close} closeLabel={t('common.actions.close')} closeDisabled={submitting} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
        onDragEnter={e => { e.preventDefault(); e.stopPropagation(); if (!submitting) setDragActive(true); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = submitting ? 'none' : 'copy'; if (!submitting) setDragActive(true); }}
        onDragLeave={e => {
          e.preventDefault(); e.stopPropagation();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
        }} onDrop={handleDrop}>
        <div className="space-y-0.5 text-xs leading-5 text-text-secondary">
          <p>{addToGroup ? t('installed.batchImport.addVariantsHelp', { name: addToGroup.modName })
            : groupAsVariants ? importsWaitDisabled ? t('installed.batchImport.help') : t('installed.batchImport.helpEnabled')
              : importsWaitDisabled ? t('installed.batchImport.separateHelp') : t('installed.batchImport.separateHelpEnabled')}</p>
          {!addToGroup && rows.length > 0 && <p>{usesSharedName ? t('installed.batchImport.variantNamesHint') : t('installed.batchImport.namesHint')}</p>}
          {sharedLocked && groupAsVariants && <p>{t('installed.batchImport.retrySharedLocked')}</p>}
        </div>
        {rows.length === 0 ? dropArea(false) : <>
          {!addToGroup && <div className="min-w-0 rounded-lg border border-border bg-bg-tertiary/40 p-3">
            {showGroupingToggle && <button type="button"
              className="flex w-full items-start gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('installed.batchImport.importAsVariants')} aria-pressed={groupAsVariants}
              onClick={() => changeImportMode(!groupAsVariants)} disabled={sharedDisabled || pendingImages > 0}>
              <CheckboxMark checked={groupAsVariants} className="mt-0.5" />
              <Layers3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">{t('installed.batchImport.importAsVariants')}</span>
                <span className="mt-0.5 block text-xs leading-5 text-text-secondary">{t('installed.batchImport.importAsVariantsHelp')}</span>
              </span>
            </button>}
            {groupAsVariants && <div className={`min-w-0 space-y-3 ${showGroupingToggle ? 'mt-3 border-t border-border pt-3' : ''}`}>
              <div>
                <span id={groupNameId} className="mb-1 block text-xs font-medium text-text-secondary">{t('installed.batchImport.variantGroupName')}</span>
                <div className="flex items-center gap-2">
                  <Input inputSize="sm" value={sharedName} onChange={e => setVariantGroupName(e.target.value)}
                    aria-labelledby={groupNameId} placeholder={t('installed.batchImport.variantGroupNamePlaceholder')}
                    disabled={sharedDisabled} aria-invalid={nameMissing || undefined}
                    className={`min-w-0 flex-1 ${nameMissing ? 'ring-1 ring-state-danger/60' : ''}`} />
                  {nsfwButton(groupNsfw, () => setGroupNsfw(!groupNsfw))}
                </div>
              </div>
              <ModImageGallery images={galleryImages} mainImageIndex={0} disabled={sharedDisabled}
                loading={pendingImages > 0} onImageClick={index => setGalleryImages(images => [images[index], ...images.filter((_, current) => current !== index)])}
                onRemove={index => setGalleryImages(images => images.filter((_, current) => current !== index))}
                onAdd={() => void pickThumbnail()} onDrop={event => void dropThumbnail(event)} />
              <div className="flex flex-wrap items-center gap-1.5">
                {tagChips.map(tag => <span key={tag.key} className={`${MOD_TAG_CHIP_CLASS} ${MOD_TAG_SURFACE_CLASS} gap-1.5`}>
                  <ChipText>{tag.label}</ChipText>
                  <button type="button" disabled={sharedDisabled} onClick={tag.remove} aria-label={t('installed.batchImport.removeTag', { name: tag.label })}
                    className="shrink-0 cursor-pointer text-text-secondary hover:text-state-danger disabled:cursor-not-allowed">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>)}
                <MenuRoot kind="dropdown">
                  <MenuTrigger asChild>{tagChips.length > 0
                    ? <button type="button" disabled={sharedDisabled} aria-label={t('installed.batchImport.addTag')} title={t('installed.batchImport.addTag')}
                        className={`${MOD_TAG_CHIP_CLASS} ${MOD_TAG_SURFACE_CLASS} cursor-pointer transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50`}>
                        <Plus className="h-3 w-3" aria-hidden />
                      </button>
                    : <Button variant="secondary" size="sm" icon={Plus} disabled={sharedDisabled}>{t('installed.batchImport.addTag')}</Button>}
                  </MenuTrigger>
                  <MenuContent align="start" className="max-h-72 overflow-y-auto">
                    {customTags.some(tag => !customTagIds.includes(tag.id)) && <>
                      <MenuLabel>{t('installed.tag.custom')}</MenuLabel>
                      {sortInstalledTags(customTags.map(tag => ({ ...tag, key: `custom:${tag.id}` })), tagOrder).filter(tag => !customTagIds.includes(tag.id)).map(tag => (
                        <MenuItem key={tag.id} onSelect={() => setCustomTagIds(ids => [...ids, tag.id])}>{tag.name}</MenuItem>
                      ))}
                    </>}
                    {baseChoices.some(tag => !selected.base.includes(tag.label)) && <MenuLabel>{t('installed.tag.base')}</MenuLabel>}
                    {baseChoices.filter(tag => !selected.base.includes(tag.label)).map(tag => <MenuItem key={tag.key} onSelect={() => setTag('base', tag.label, true)}>{gameBananaCategoryLabel(tag.label, t)}</MenuItem>)}
                    <MenuLabel>{t('installed.tag.hero')}</MenuLabel>
                    {[...new Set([...(heroNames.length ? heroNames : HERO_NAMES_SORTED), ...detected.heroes])].sort((a, b) => a.localeCompare(b))
                      .filter(hero => !selected.heroes.includes(hero)).map(hero => <MenuItem key={hero} onSelect={() => setTag('heroes', hero, true)}><HeroTagLabel heroName={hero} /></MenuItem>)}
                  </MenuContent>
                </MenuRoot>
              </div>
            </div>}
          </div>}
          <ul className="space-y-1.5">
            {rows.map(row => {
              const heroes = [...new Set(row.preparation?.members.flatMap(member => member.heroes) ?? [])];
              const variantName = row.labelFocused && !row.labelTouched
                ? defaultVariantLabel(row) || deriveVariantLabel(row.path) : variantLabelOf(row);
              return <li key={row.id} className={`flex items-center gap-2.5 rounded-sm border p-2 ${row.status === 'failed' || row.inspection === 'failed'
                ? 'border-state-danger/40 bg-state-danger/5' : row.inspection === 'checking'
                  ? 'border-state-warning/40 bg-state-warning/5' : 'border-border bg-bg-tertiary/40'}`}>
                {!usesSharedName && <button type="button" disabled={submitting || pendingImages > 0}
                  aria-label={t('installed.batchImport.thumbnailFor', { file: fileNameOf(row.path) })}
                  title={row.thumbnailDataUrl ? t('installed.batchImport.removeImage') : t('installed.batchImport.thumbnailHint')}
                  onClick={() => row.thumbnailDataUrl ? patchRow(row.path, { thumbnailDataUrl: '' }) : void pickThumbnail(row)}
                  onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
                  onDrop={event => void dropThumbnail(event, row)}
                  className="flex aspect-video w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-dashed border-border bg-bg-tertiary text-text-secondary hover:border-accent/50 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
                  {row.thumbnailDataUrl ? <RevealImage src={row.thumbnailDataUrl} alt={t('installed.imageField.thumbnailPreview')} className="h-full w-full object-contain" />
                    : <ImagePlus className="h-5 w-5" aria-hidden />}
                </button>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Input inputSize="sm" value={usesSharedName ? variantName : row.name}
                      onFocus={e => {
                        if (!usesSharedName || row.labelFocused || row.labelTouched) return;
                        patchRow(row.path, { labelFocused: true });
                        e.currentTarget.value = defaultVariantLabel(row) || deriveVariantLabel(row.path);
                        e.currentTarget.select();
                      }}
                      onChange={e => patchRow(row.path, usesSharedName ? { variantLabel: e.target.value, labelTouched: true }
                        : { name: e.target.value, nameTouched: true })}
                      placeholder={usesSharedName ? deriveVariantLabel(row.path) : deriveModNameFromPath(row.path)}
                      disabled={submitting} aria-label={usesSharedName ? t('installed.batchImport.variantNameFor', { file: fileNameOf(row.path) }) : t('installed.batchImport.nameFor', { file: fileNameOf(row.path) })}
                      aria-invalid={!usesSharedName && !row.name.trim() || undefined}
                      className="min-w-0 flex-1" />
                    {statusIcon(row)}
                    {!usesSharedName && nsfwButton(row.nsfw, () => patchRow(row.path, { nsfw: !row.nsfw }), submitting)}
                    <IconButton icon={X} size="sm" label={t('installed.batchImport.removeFile', { file: fileNameOf(row.path) })} onClick={() => removeRow(row.path)} disabled={submitting} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-text-secondary">
                    {heroes.map(hero => <span key={hero} title={hero}><HeroTagLabel heroName={hero} iconClassName="h-3 w-3" iconOnly /></span>)}
                    <span className="min-w-0 truncate font-mono" title={row.path}>{fileNameOf(row.path)}</span>
                    {row.preparation && <span className="shrink-0">({formatBytes(row.preparation.size)})</span>}
                    {row.inspection === 'checking' && <span role="status">{t('installed.batchImport.checking')}</span>}
                    {row.recognized && <Tag tone="success" icon={Fingerprint}>{t('installed.import.recognizedFromImprint')}</Tag>}
                    {row.recognized?.gamebananaId && <Tag tone="neutral">{t('installed.import.recognizedGameBananaId', { id: row.recognized.gamebananaId })}</Tag>}
                    {(row.inspectionError || row.error) && <span role="alert" className="text-state-danger">{row.inspectionError || row.error}</span>}
                  </div>
                </div>
              </li>;
            })}
          </ul>
          {dropArea(true)}
        </>}
        {error && <div role="alert" className="rounded-sm border border-state-danger/30 bg-state-danger/10 p-2 text-sm text-state-danger">{error}</div>}
      </div>
      <ModalFooter>
        {rows.length > 0 && nameMissing && <span className="mr-auto text-2xs text-state-danger">{t('installed.batchImport.nameRequired')}</span>}
        {rows.length > 0 && <Button variant="secondary" onClick={clearRows} disabled={submitting}>{t('installed.batchImport.clearAll')}</Button>}
        <Button variant="primary" icon={FilePlus} onClick={handleSubmit} disabled={!canSubmit} isLoading={submitting}>
          {addToGroup ? t('installed.batchImport.addVariantCount', { count: rows.length })
            : t('profiles.actions.import')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
