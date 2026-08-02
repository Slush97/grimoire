import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Images, Loader2 } from 'lucide-react';
import type { Mod } from '../../types/mod';
import { lockerLinkKey } from '../../lib/lockerCardLinks';
import { useAppStore } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';

interface SkinIconLinkPickerProps {
  /** The skin group's representative mod, which the link key is derived from. */
  skin: Mod;
  /** Display name for the skin (the group's title, not the VPK filename). */
  skinName: string;
  heroName: string;
  /** Companion icon mods available for this hero (see heroIconMods). */
  candidates: Mod[];
  /** Extra classes for the trigger button, so each layout can place it. */
  className?: string;
  /** Keep the trigger visible instead of hover-only (used once a link exists). */
  alwaysVisible?: boolean;
}

/**
 * "Match icons" control on a skin card.
 *
 * Links this skin to a companion icon mod so the icons follow the skin: turn the
 * skin on and its icons apply, turn it off and they revert. The alternative
 * users face today is the instruction those addons actually ship with ("RENAME
 * THE TOASTED ICON MOD TO pak02_dir.vpk OR A NUMBER BIGGER"), because the addon
 * has to out-rank both the skin bundle and the icon pack. A link sidesteps load
 * order entirely: the art is split into the Locker-managed VPK in
 * citadel/grimoire, which wins by search-path precedence.
 *
 * Renders nothing when the hero has no companion icon mods installed, so the
 * control only appears for users who actually have the pairing to make.
 */
export default function SkinIconLinkPicker({
  skin,
  skinName,
  heroName,
  candidates,
  className = '',
  alwaysVisible = false,
}: SkinIconLinkPickerProps) {
  const { t } = useTranslation();
  const cardLinks = useAppStore((s) => s.cardLinks);
  const linkSkinIcons = useAppStore((s) => s.linkSkinIcons);
  const unlinkSkinIcons = useAppStore((s) => s.unlinkSkinIcons);
  const loadMods = useAppStore((s) => s.loadMods);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const skinKey = useMemo(() => lockerLinkKey(skin), [skin]);
  const activeLink = cardLinks.find((link) => link.skinKey === skinKey);
  const linkedSourceKey = activeLink?.sourceKey;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Nothing to pair with: stay out of the way entirely.
  if (candidates.length === 0) return null;

  const choose = async (sourceKey: string | null) => {
    setBusy(true);
    try {
      if (sourceKey === null) {
        await unlinkSkinIcons(skinKey);
      } else {
        await linkSkinIcons({ skinKey, skinName, heroName, sourceKey });
      }
      // The applied cards live in a Grimoire-managed VPK the mod list reflects,
      // and a link can take a hero over from a manual pick, so re-read.
      await loadMods({ silent: true });
      setOpen(false);
    } catch (err) {
      showToast(String(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const linked = Boolean(activeLink);
  const label = linked
    ? t('locker.iconLink.linkedTo', { name: activeLink?.sourceModName ?? activeLink?.sourceKey })
    : t('locker.iconLink.matchIcons');

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-[opacity,background-color,color] duration-150 focus-visible:opacity-100 group-hover/card:opacity-100 group-hover/row:opacity-100 ${
          linked
            ? 'bg-accent text-accent-foreground opacity-100 hover:bg-accent/80'
            : `${alwaysVisible ? 'opacity-100' : 'opacity-0'} bg-black/65 text-white/90 hover:bg-accent/70 hover:text-accent-foreground`
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Images className="h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-60 rounded-md border border-white/[0.12] bg-bg-secondary/95 p-1.5 shadow-xl shadow-black/50 backdrop-blur-md"
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="px-1.5 pb-1.5 pt-1">
            <div className="text-[11px] font-semibold text-text-primary">
              {t('locker.iconLink.title')}
            </div>
            <div className="text-[10px] leading-snug text-text-secondary">
              {t('locker.iconLink.hint')}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            {candidates.map((candidate) => {
              const isActive = candidate.metaKey === linkedSourceKey;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  disabled={busy}
                  onClick={() => choose(isActive ? null : candidate.metaKey)}
                  className={`flex items-center gap-2 rounded px-1.5 py-1.5 text-left text-[11px] transition-colors disabled:opacity-60 ${
                    isActive
                      ? 'bg-accent/15 text-text-primary'
                      : 'text-text-primary/85 hover:bg-white/[0.06] hover:text-text-primary'
                  }`}
                >
                  <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                    {isActive && <Check className="h-3.5 w-3.5 text-accent" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={candidate.name}>
                    {candidate.name}
                  </span>
                </button>
              );
            })}
            {linked && (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => choose(null)}
                className="mt-0.5 rounded border-t border-white/[0.08] px-1.5 pb-1 pt-1.5 text-left text-[11px] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
              >
                {t('locker.iconLink.unlink')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
