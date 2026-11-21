import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2, RotateCw } from 'lucide-react';
import { getSoulModelInfo, exportSoulModel, getSoulPreviewThumbnail, saveSoulPreviewThumbnail } from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import { buildNormalizedRoot, preparedPropCache, meshUrlFor, zeroMetalness, normalizePropYaw,
  queuePropThumbnail, propThumbnailSource, readPropYaw, savePropYaw, thumbnailUrlFor, type PreparedPropLease } from './soulModel';
import { useSoulRegistry } from './soulRegistry';
import ModThumbnail from '../ModThumbnail';
import { showToast } from '../../stores/toastStore';
import { LockerCardAction, LockerCardHeader } from './ShuffleControls';

interface Controller {
  hover(value: boolean): void;
  manual(): void;
  rotate(delta: number): void;
  resume(): void;
  save(): Promise<void>;
}

export default function SoulContainerTile({ tileId, modKey, entry, thumbnailUrl, name, nsfw, hideNsfw, actions, status, portrait = false, onActivate }: {
  tileId: string;
  modKey: string;
  entry?: string;
  thumbnailUrl?: string;
  name?: string;
  nsfw?: boolean;
  hideNsfw?: boolean;
  actions?: ReactNode;
  status?: { active: boolean; favorite: boolean; shuffled: boolean };
  portrait?: boolean;
  onActivate?: (target: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const registry = useSoulRegistry();
  const registryId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const sourceRef = useRef(modKey);
  const controller = useRef<Controller | null>(null);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const [image, setImage] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { sourceRef.current = modKey; }, [modKey]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    registry.register(registryId, el);
    const tile = registry.tiles.get(registryId)!;
    tile.portrait = portrait;
    tile.savedYaw = readPropYaw(tileId);
    tile.yaw = tile.savedYaw;
    tile.image = imageRef.current;
    let cancelled = false;
    let visible = false;
    let known = false;
    let hasImage = false;
    let queued = false;
    let cleared = false;
    let epoch = 0;
    let lease: PreparedPropLease | null = null;
    let loading: Promise<void> | null = null;
    let modelMtime: number | null = null;
    let capturing = false;

    const release = () => {
      if (tile.hovered || tile.opacity > 0 || capturing || queued) return;
      registry.setRoot(registryId, null);
      lease?.release(); lease = null;
    };
    tile.onIdle = release;
    const load = (): Promise<void> => {
      if (lease) return Promise.resolve();
      if (loading) return loading;
      const revision = epoch;
      loading = (async () => {
        if (!cancelled) setGenerating(true);
        let info = await getSoulModelInfo(tileId);
        if (!info.hasModel) info = await exportSoulModel(sourceRef.current, tileId, entry);
        if (!info.hasModel || info.mtimeMs === null) throw new Error('Prop preview unavailable');
        const acquired = await preparedPropCache.acquire(tileId + ':' + (entry ?? 'soul-container') + ':2', async () => {
          const gltf = await loadGltfPreview(meshUrlFor(tileId, info.mtimeMs));
          zeroMetalness(gltf.scene);
          return buildNormalizedRoot(gltf.scene);
        });
        if (cancelled || revision !== epoch) { acquired.release(); return; }
        lease = acquired;
        modelMtime = info.mtimeMs;
        registry.setRoot(registryId, acquired.root);
        setGenerating(false);
        setFailed(false);
      })().finally(() => { loading = null; });
      return loading;
    };
    const capture = async (yaw: number, revision: number) => {
      capturing = true;
      try {
        await load();
        if (cancelled || revision !== epoch || modelMtime === null) return false;
        const pngDataUrl = await registry.capture(registryId, yaw);
        if (cancelled || revision !== epoch) return false;
        const source = await propThumbnailSource(pngDataUrl,
          () => saveSoulPreviewThumbnail(tileId, { yaw, pngDataUrl, modelMtimeMs: modelMtime! }),
          mtime => thumbnailUrlFor(tileId, mtime));
        if (cancelled || revision !== epoch) return false;
        setImage(source);
        hasImage = true;
        return true;
      } finally { capturing = false; }
    };
    const ensureThumbnail = () => {
      if (!visible || !known || hasImage || queued || cleared || cancelled) return;
      queued = true;
      const revision = epoch;
      void queuePropThumbnail(async () => {
        if (cancelled || cleared || revision !== epoch || !visible) return;
        await capture(tile.savedYaw, revision);
      }).catch(() => {
        if (!cancelled && revision === epoch) { setGenerating(false); setFailed(true); }
      }).finally(() => { queued = false; if (!cancelled) release(); });
    };
    controller.current = {
      hover(value) {
        if (cancelled) return;
        registry.hover(registryId, value);
        if (value) {
          cleared = false;
          void load().then(() => { ensureThumbnail(); registry.invalidate(); }).catch(() => {
            if (!cancelled) { setGenerating(false); setFailed(true); }
          });
        }
      },
      manual() { tile.manual = true; setManual(true); registry.invalidate(); },
      rotate(delta) { if (tile.root) { tile.root.rotation.y += delta * 0.01; tile.yaw = tile.root.rotation.y; registry.invalidate(); } },
      resume() { tile.manual = false; setManual(false); registry.invalidate(); },
      async save() {
        if (!tile.root || cancelled) return;
        const yaw = normalizePropYaw(tile.root.rotation.y);
        const revision = epoch;
        setSaving(true);
        try {
          await queuePropThumbnail(async () => {
            if (cancelled || revision !== epoch) return;
            if (await capture(yaw, revision)) { savePropYaw(tileId, yaw); tile.savedYaw = yaw; }
          });
        } finally { if (!cancelled) setSaving(false); release(); }
      },
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (!visible) registry.hover(registryId, false);
      ensureThumbnail();
    });
    observer.observe(el);
    void getSoulPreviewThumbnail(tileId).then(info => {
      if (cancelled) return;
      if (!!info.portrait === portrait && info.mtimeMs !== null && info.yaw !== null && Math.abs(normalizePropYaw(info.yaw) - tile.savedYaw) < 1e-6) {
        hasImage = true;
        setImage(thumbnailUrlFor(tileId, info.mtimeMs));
      }
    }).catch(() => {}).finally(() => { if (!cancelled) { known = true; ensureThumbnail(); } });
    const unsubscribe = window.electronAPI.onPreviewCacheCleared(() => {
      epoch++;
      cleared = true;
      hasImage = false;
      setImage(undefined);
      registry.hover(registryId, false);
      tile.opacity = 0;
      release();
    });
    const blur = () => { drag.current = null; registry.hover(registryId, false); };
    window.addEventListener('blur', blur);
    return () => {
      cancelled = true;
      observer.disconnect(); unsubscribe();
      window.removeEventListener('blur', blur);
      controller.current = null;
      registry.unregister(registryId);
      lease?.release();
    };
  }, [tileId, entry, portrait, registry, registryId]);

  const stopDrag = (target: HTMLElement, pointerId: number, x: number, y: number) => {
    if (drag.current?.id !== pointerId) return;
    drag.current = null;
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    const rect = trackRef.current?.getBoundingClientRect();
    controller.current?.hover(!!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  };
  return (
    <div ref={trackRef} className="absolute inset-0" data-prop-preview={tileId} data-preview-mode={manual ? 'manual' : 'auto'}
      onPointerEnter={() => controller.current?.hover(true)}
      onPointerLeave={() => { if (!drag.current) controller.current?.hover(false); }}>
      <img ref={imageRef} src={image} hidden={!image} alt={name ?? ''} draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      {failed && !image && <ModThumbnail src={thumbnailUrl} alt={name ?? ''} nsfw={nsfw} hideNsfw={hideNsfw}
        className="h-full w-full" fallback={<div className="flex h-full w-full items-center justify-center text-xs text-text-secondary">{t('locker.page.noPreview')}</div>} />}
      {generating && !image && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-text-secondary" /></div>}
      <button type="button" tabIndex={-1} aria-label={t('locker.preview.interact', { name })}
        className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing"
        onContextMenu={e => e.preventDefault()}
        onClick={e => onActivate?.(e.currentTarget)}
        onPointerDown={e => {
          if (e.button !== 2) return;
          e.preventDefault();
          controller.current?.manual();
          drag.current = { id: e.pointerId, x: e.clientX };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const previous = drag.current;
          if (!previous || previous.id !== e.pointerId) return;
          controller.current?.rotate(e.clientX - previous.x);
          previous.x = e.clientX;
        }}
        onPointerUp={e => stopDrag(e.currentTarget, e.pointerId, e.clientX, e.clientY)}
        onPointerCancel={e => stopDrag(e.currentTarget, e.pointerId, e.clientX, e.clientY)}
        onLostPointerCapture={e => stopDrag(e.currentTarget, e.pointerId, e.clientX, e.clientY)} />
      <LockerCardHeader {...status}>
        {actions}
        {manual && <div className="flex shrink-0 gap-1">
          <LockerCardAction icon={RotateCw} label={t('locker.preview.resume')}
            onClick={() => controller.current?.resume()} />
          <LockerCardAction icon={saving ? Loader2 : Camera} label={t('locker.preview.save')}
            className={saving ? '[&_svg]:animate-spin' : ''} disabled={saving || generating} onClick={() => {
              void controller.current?.save().catch(() => showToast(t('locker.preview.saveFailed'), { tone: 'error' }));
            }} />
        </div>}
      </LockerCardHeader>
    </div>
  );
}
