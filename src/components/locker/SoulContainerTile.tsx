import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as THREE from 'three';
import { Loader2 } from 'lucide-react';
import { getSoulModelInfo, exportSoulModel } from '../../lib/api';
import { loadGltfPreview } from '../../lib/loadGltfPreview';
import { buildNormalizedRoot, disposeScene, meshUrlFor } from './soulModel';
import { useSoulRegistry } from './soulRegistry';
import ModThumbnail from '../ModThumbnail';

/**
 * One soul-container card's 3D preview, for the Locker's Global view.
 *
 * Unlike a normal viewer this mounts NO canvas of its own: it loads the GLB
 * (produced on demand by the bundled `vpkmerge model export` via
 * exportSoulModel, served over the privileged `grimoire-soul:` scheme) and
 * registers a normalized group with the shared SoulContainerCanvas, which draws
 * every card through a single WebGL context. That's what stops a large grid
 * from exhausting the browser's live-context cap and blanking cards white.
 *
 * Registration is keyed by `tileId` (the mod's content-stable sha256), NOT its
 * metaKey: enabling/disabling a mod changes its metaKey (the file moves), but we
 * want the card to keep rendering the same model across a toggle. When metaKey
 * changes we reload in the background and keep the previous model on screen
 * until the new one is ready, so selecting a card never flickers.
 *
 * The whole Locker card is the enable/disable control, so the track element is
 * pointer-events-none; clicks pass through to toggle the mod. When the model
 * can't be exported/decoded (e.g. a legacy-layout mesh older vpkmerge builds
 * couldn't read), it falls back to the mod's 2D GameBanana thumbnail rather than
 * leaving an empty window.
 */
export default function SoulContainerTile({
  tileId,
  modKey,
  entry,
  thumbnailUrl,
  name,
  nsfw,
  hideNsfw,
}: {
  /** Content-stable id (sha256) used as the registry key, so the model survives
   *  the metaKey change that a toggle causes. */
  tileId: string;
  /** The mod's metaKey: the SOURCE the main process resolves and exports from.
   *  Changes when the mod is enabled/disabled (the VPK is renamed); the export
   *  CACHE is keyed by the content-stable tileId instead, not this. */
  modKey: string;
  /** Model entry to export. Defaults to the soul-container model; a spirit urn
   *  passes its own entry (`idol_urn.vmdl_c`) so the tile shows the urn model. */
  entry?: string;
  /** GameBanana thumbnail, shown as the 2D fallback when the model fails. */
  thumbnailUrl?: string;
  /** Mod name, used as the thumbnail's alt text. */
  name?: string;
  nsfw?: boolean;
  hideNsfw?: boolean;
}) {
  const { t } = useTranslation();
  const registry = useSoulRegistry();
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // tileId is stable across a toggle, so this just (re)attaches the same track
    // element; the previously loaded model stays registered and on screen.
    registry.register(tileId, el);

    let cancelled = false;
    (async () => {
      try {
        // The export cache is keyed by tileId (the mod's content-stable sha256),
        // NOT modKey: a mod's metaKey changes when it's enabled/disabled (the VPK
        // is renamed into a reused pakNN slot), and keying by it served a stale
        // GLB from whatever soul last held that slot (wrong/white model on
        // select). Content addressing also makes a toggle a cache hit, so it no
        // longer re-exports. The SOURCE for an export is still resolved by modKey.
        let info = await getSoulModelInfo(tileId);
        if (!info.hasModel) {
          if (cancelled) return;
          // Spinner only when there's nothing to show yet; on a reload (toggle)
          // the existing model keeps rendering instead.
          if (!rootRef.current) setGenerating(true);
          info = await exportSoulModel(modKey, tileId, entry);
          if (cancelled) return;
          setGenerating(false);
        }
        if (!info.hasModel) {
          if (!rootRef.current && !cancelled) setFailed(true);
          return;
        }
        const url = meshUrlFor(tileId, info.mtimeMs);
        const gltf = await loadGltfPreview(url);
        if (cancelled) {
          disposeScene(gltf.scene);
          return;
        }
        const next = buildNormalizedRoot(gltf.scene);
        const prev = rootRef.current;
        rootRef.current = next;
        registry.setRoot(tileId, next);
        if (prev) disposeScene(prev); // swap first, then free the old model
        setFailed(false);
      } catch {
        if (!cancelled && !rootRef.current) {
          setGenerating(false);
          setFailed(true);
        }
      }
    })();

    // On a metaKey change, only cancel the in-flight load; the current model
    // stays registered so the card doesn't blank mid-reload. Full teardown is
    // the separate unmount effect below.
    return () => {
      cancelled = true;
    };
  }, [tileId, modKey, entry, registry]);

  // Unregister and free the model only on true unmount (tileId is stable, so
  // this does not run on a toggle).
  useEffect(() => {
    return () => {
      registry.unregister(tileId);
      if (rootRef.current) disposeScene(rootRef.current);
      rootRef.current = null;
    };
  }, [tileId, registry]);

  // The track element always renders (even before load, and on failure) so the
  // shared canvas keeps a stable rect to register; on failure the model is never
  // set, so the canvas skips this tile and only the 2D thumbnail shows.
  return (
    <div ref={trackRef} className="pointer-events-none absolute inset-0">
      {failed ? (
        <ModThumbnail
          src={thumbnailUrl}
          alt={name ?? ''}
          nsfw={nsfw}
          hideNsfw={hideNsfw}
          className="h-full w-full"
          fallback={
            <div className="flex h-full w-full items-center justify-center text-xs text-text-secondary">
              {t('locker.page.noPreview')}
            </div>
          }
        />
      ) : (
        generating && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2 className="h-5 w-5 animate-spin text-white/80" />
          </div>
        )
      )}
    </div>
  );
}
