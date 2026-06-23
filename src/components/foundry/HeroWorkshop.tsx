import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Swords,
  Volume2,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HeroInfo } from '../../types/foundry';
import type { Mod } from '../../types/mod';
import {
  getHeroRenderPath,
  getHeroNamePath,
  getHeroWikiUrl,
  isLockerManagedSound,
  getEffectiveGlobalType,
} from '../../lib/lockerUtils';
import { useAppStore } from '../../stores/appStore';
import HeroEffectsPanel from '../locker/HeroEffectsPanel';
import HeroSoundPicker from '../locker/HeroSoundPicker';
import SoundBrowse from './SoundBrowse';
import TextureBrowse from './TextureBrowse';
import LibraryBrowse from './LibraryBrowse';
import Tx from '../translation/Tx';

interface HeroWorkshopProps {
  hero: HeroInfo;
  /** Full roster codename -> display name map (for the reused browse panels). */
  heroNames: Map<string, string>;
  onBack: () => void;
}

type SectionId = 'appearance' | 'abilities' | 'voice' | 'icons';

/**
 * The per-hero Foundry workshop: pick a hero, edit everything about them. Mirrors
 * the Locker's hero-detail frame (full-bleed render backdrop + frosted-glass rail
 * + section nav) but the sections are creation surfaces over the asset catalog:
 *
 *   Appearance  recolor / prism / body+gun materials  (HeroEffectsPanel, live)
 *   Abilities   per-ability SFX (HeroSoundPicker, live) + gameplay-sound browse;
 *               per-ability icon + VFX editing is the next phase
 *   Voice       hero VO voice-line browse + audition   (SoundBrowse only=voice)
 *   Icons       ability icons + model textures         (Texture/LibraryBrowse, live browse)
 *
 * Each section applies directly to its own managed mod (the model recolor already
 * uses): there is no separate compose-and-forge step. The per-section apply paths
 * run through the existing Locker engines (e.g. sound via `applyHeroSound`).
 */
export default function HeroWorkshop({ hero, heroNames, onBack }: HeroWorkshopProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>('appearance');
  const [renderStep, setRenderStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);

  // A single-hero roster so the reused browse panels are pre-scoped to this hero
  // (they each carry their own hero filter; handing them one hero pins it).
  const scopedRoster = useMemo<HeroInfo[]>(() => [hero], [hero]);

  // This hero's installed sound mods, scoped by name the same way the Locker's
  // dominant path does (manual lockerHero tag, else a fuzzy name match). The
  // Voice section reuses the Locker's HeroSoundPicker over this list so sound
  // assignment + volume/pitch retune run through the one engine, not a parallel
  // one. (We skip the GameBanana categoryId branch the Locker also uses; sound
  // mods rarely carry a hero categoryId, so name scoping covers the vast bulk.)
  const mods = useAppStore((s) => s.mods);
  const heroSoundList = useMemo<Mod[]>(() => {
    const hn = hero.name.toLowerCase();
    return mods.filter(
      (m) =>
        isLockerManagedSound(m) &&
        !getEffectiveGlobalType(m) &&
        (m.lockerHero?.toLowerCase() === hn || (m.name?.toLowerCase().includes(hn) ?? false)),
    );
  }, [mods, hero.name]);

  const sections: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
    { id: 'appearance', label: t('foundry.workshop.appearance', 'Appearance'), icon: Sparkles },
    { id: 'abilities', label: t('foundry.workshop.abilities', 'Abilities'), icon: Swords },
    { id: 'voice', label: t('foundry.workshop.voice', 'Voice'), icon: Volume2 },
    { id: 'icons', label: t('foundry.workshop.icons', 'Icons & Textures'), icon: ImageIcon },
  ];

  const renderSrc =
    renderStep === 0
      ? getHeroRenderPath(hero.name)
      : renderStep === 1
        ? getHeroWikiUrl(hero.name)
        : '';

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Hero render backdrop, anchored right, behind the frosted rail. */}
      <div className="hidden lg:block absolute inset-0 bg-bg-primary animate-hero-zoom-in overflow-hidden">
        {renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            onError={() => setRenderStep((s) => s + 1)}
            className="absolute top-0 right-0 h-full w-auto max-w-none"
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

      {/* Feathered frosted glass behind the rail + content, so the render bleeds
          through to clear on the right. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] hidden lg:block lg:w-[1040px] xl:w-[1160px]"
      >
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(40px) saturate(130%)',
            WebkitBackdropFilter: 'blur(40px) saturate(130%)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 44%, transparent 94%)',
            maskImage: 'linear-gradient(to right, black 0%, black 44%, transparent 94%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, var(--color-bg-secondary) 0%, rgba(26,26,26,0.95) 42%, rgba(26,26,26,0.7) 62%, rgba(26,26,26,0.3) 80%, transparent 96%)',
          }}
        />
      </div>

      {/* Left rail: hero identity + section nav + build tray. */}
      <div className="relative z-10 flex w-[280px] flex-shrink-0 flex-col gap-5 overflow-y-auto scrollbar-glass bg-bg-secondary p-5 animate-slide-in-left lg:bg-transparent xl:w-[320px]">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('foundry.workshop.back', 'All heroes')}
        </button>

        {nameFailed ? (
          <h2 className="text-2xl font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            {hero.name}
          </h2>
        ) : (
          <img
            src={getHeroNamePath(hero.name)}
            alt={hero.name}
            className="h-8 w-auto self-start object-contain"
            onError={() => setNameFailed(true)}
          />
        )}

        <nav aria-label={t('foundry.workshop.sections', 'Workshop sections')} className="flex flex-col gap-1.5">
          {sections.map(({ id, label, icon: Icon }) => {
            const isActive = section === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'border-accent/60 bg-accent/15'
                    : 'border-transparent hover:bg-white/10'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-white/80" />
                <span className="flex-1 truncate text-sm font-medium text-white">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content pane: the active section. */}
      <div className="relative z-10 min-w-0 flex-1 overflow-y-auto scrollbar-glass">
        <div className="space-y-4 p-6">
          {section === 'appearance' ? (
            <HeroEffectsPanel key={hero.name} heroName={hero.name} />
          ) : section === 'abilities' ? (
            <div className="space-y-6">
              {/* Per-ability SOUND editing: assign installed sound mods to ability
                  slots + retune volume/pitch, through the Locker's one engine. The
                  ability axis lives here (not under Voice); Voice is VO only. */}
              <HeroSoundPicker
                key={hero.name}
                heroName={hero.name}
                soundList={heroSoundList}
                onSelect={() => {}}
              />
              {/* Discovery: every gameplay sound this hero makes (no VO). */}
              <div className="space-y-2 border-t border-border/60 pt-5">
                <h4 className="text-sm font-semibold text-white/90">
                  {t('foundry.workshop.browseGameplay', "Browse all of {{hero}}'s gameplay sounds", {
                    hero: hero.name,
                  })}
                </h4>
                <SoundBrowse heroes={scopedRoster} heroNames={heroNames} only="gameplay" />
              </div>
              <AbilitiesComingNote />
            </div>
          ) : section === 'voice' ? (
            <SoundBrowse heroes={scopedRoster} heroNames={heroNames} only="voice" />
          ) : section === 'icons' ? (
            <div className="space-y-8">
              <TextureBrowse heroes={scopedRoster} heroNames={heroNames} />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white/90">
                  {t('foundry.workshop.abilityIcons', 'Ability & item icons')}
                </h4>
                <LibraryBrowse heroNames={heroNames} initialCategory="ability-icon" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AbilitiesComingNote() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg-secondary/50 p-4 text-sm leading-relaxed text-text-secondary">
      <p className="mb-1 font-medium text-text-primary">
        <Tx k="foundry.workshop.abilitiesSoon.title" fallback="More per-ability editing coming" />
      </p>
      <Tx
        k="foundry.workshop.abilitiesSoon.body"
        fallback="Per-ability icon and VFX color editing will land here next, one row per ability. For now, recolor all ability VFX at once under Appearance, and browse ability icons under Icons & Textures."
      />
    </div>
  );
}
