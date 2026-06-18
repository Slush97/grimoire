import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles } from 'lucide-react';
import type { HeroPoseSkinSource } from '../../types/portrait';
import { HeroCardBaker } from '../../lib/heroCardBake';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';

/** One hero's bake job: the canonical hero name, the per-skin override store
 *  key to write (the active skin's getLockerSkinKey), and the enabled visual
 *  VPK stack to pose. */
export interface CardBakeJob {
  heroName: string;
  storeKey: string;
  skinSources: HeroPoseSkinSource[];
}

/**
 * Locker top-bar action: regenerate every eligible hero's card snapshot in one
 * sweep. Bakes SEQUENTIALLY through a single shared HeroCardBaker (one WebGL
 * context for the whole run), shows n/total progress, and logs + skips heroes
 * that fail (clipless WIP heroes will) so one bad hero never aborts the sweep.
 *
 * `getJobs` is a thunk so the eligible set is recomputed at click time (the
 * enabled stack can change while the page is open).
 */
export function RegenerateAllCardsButton({ getJobs }: { getJobs: () => CardBakeJob[] }) {
  const { t } = useTranslation();
  const applyCardImage = useAppStore((s) => s.applyLockerCardImage);
  const showToast = useToastStore((s) => s.showToast);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);

  const run = async () => {
    if (running) return;
    const jobs = getJobs();
    if (jobs.length === 0) {
      showToast(t('locker.cardBake.regenNone'), { tone: 'info' });
      return;
    }
    setRunning(true);
    cancelRef.current = false;
    setProgress({ done: 0, total: jobs.length });
    const baker = new HeroCardBaker();
    let ok = 0;
    let failed = 0;
    try {
      for (let i = 0; i < jobs.length; i++) {
        if (cancelRef.current) break;
        const job = jobs[i];
        try {
          const dataUrl = await baker.bakeHeroCard(job.heroName, job.storeKey, job.skinSources);
          applyCardImage(job.storeKey, dataUrl);
          ok += 1;
        } catch (err) {
          // Clipless WIP heroes (and any export hiccup) land here; skip, never
          // abort the whole sweep.
          console.error(`Failed to bake card for ${job.heroName}`, err);
          failed += 1;
        }
        setProgress({ done: i + 1, total: jobs.length });
      }
    } finally {
      baker.dispose();
      setRunning(false);
      setProgress(null);
    }
    showToast(t('locker.cardBake.regenDone', { count: ok, failed }), {
      tone: failed > 0 ? 'warning' : 'success',
    });
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={running}
      aria-busy={running}
      className="flex items-center gap-1.5 self-stretch rounded-sm border border-border bg-bg-secondary px-3 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-default disabled:opacity-70 cursor-pointer"
      title={t('locker.cardBake.regenTitle')}
    >
      {running ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {running && progress
        ? t('locker.cardBake.regenProgress', { done: progress.done, total: progress.total })
        : t('locker.cardBake.regenAll')}
    </button>
  );
}
