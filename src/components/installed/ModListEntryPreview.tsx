import { Image, Music } from 'lucide-react';
import ModThumbnail from '../ModThumbnail';
import { entryPrimaryMod, type ModEntry } from '../../lib/modEntries';

export function ModListEntryPreview({ entry, hideNsfw }: { entry: ModEntry; hideNsfw: boolean }) {
  const mod = entryPrimaryMod(entry);
  return <div className="h-11 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary"><ModThumbnail src={mod.thumbnailUrl} alt="" nsfw={mod.nsfw} hideNsfw={hideNsfw}
    mergedSources={mod.merged?.sources} forgeInstalled={!!mod.forgeInstall}
    enableImageContextMenu={false} width={64} height={44}
    className="h-full w-full"
    fallback={<span className="flex h-full items-center justify-center text-text-tertiary">
      {mod.sourceSection === 'Sound' ? <Music className="h-5 w-5" aria-hidden /> : <Image className="h-5 w-5" aria-hidden />}
    </span>} /></div>;
}
