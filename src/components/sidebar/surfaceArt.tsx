import type { CSSProperties } from 'react';
import { DEFAULT_SIDEBAR_HERO, getSidebarHeroImageStyle, getHeroRenderPath } from '../../lib/lockerUtils';
import type { AppearanceBg } from '../../types/mod';

// Surface art primitives shared by the live Sidebar and the Appearance art
// settings previews, so the previews render the EXACT same surfaces the user
// gets (no drift between "what I picked" and "what shows up"). The Sidebar owns
// the layout/foreground (icons, labels, slider); these render only the backdrop
// layer (image + gradients) from a resolved appearance descriptor.

/** The active-tab highlight backdrop: a hero render under a left-to-right fade,
 *  or the plain accent glow when there's no hero/image. */
export function SidebarActiveBackdrop({
  heroSrc,
  heroImageStyle,
}: {
  heroSrc: string | null;
  heroImageStyle: CSSProperties;
}) {
  if (heroSrc) {
    return (
      <span aria-hidden className="sidebar-active-backdrop pointer-events-none absolute inset-0">
        <img
          src={heroSrc}
          alt=""
          className="sidebar-active-backdrop__image h-full w-full object-cover opacity-75"
          style={heroImageStyle}
        />
        <span className="absolute inset-0 bg-gradient-to-r from-bg-primary/90 via-bg-primary/55 to-bg-primary/20" />
        <span className="absolute inset-0 bg-black/20" />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="sidebar-active-backdrop pointer-events-none absolute inset-0 bg-accent/10"
    >
      <span className="absolute inset-0 bg-gradient-to-r from-accent/20 via-accent/8 to-transparent" />
    </span>
  );
}

export function LaunchButtonBackdrop({
  src,
  position = 'center',
  warm = false,
  imageStyle,
}: {
  src: string;
  position?: string;
  warm?: boolean;
  /** Full object-position/margin override (used for hero renders, which need the
   *  shared face-crop framing). Takes precedence over `position`. */
  imageStyle?: CSSProperties;
}) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <img
        src={src}
        alt=""
        className={`h-full w-full object-cover opacity-65 transition-transform duration-300 group-hover:scale-[1.04] ${
          warm ? 'saturate-[0.95]' : 'saturate-[1.05]'
        }`}
        style={imageStyle ?? { objectPosition: position }}
      />
      <span
        className={`absolute inset-0 ${
          warm
            ? 'bg-gradient-to-r from-bg-primary/85 via-bg-primary/55 to-amber-950/25'
            : 'bg-gradient-to-r from-bg-primary/82 via-bg-primary/50 to-emerald-950/20'
        }`}
      />
      <span className="absolute inset-0 bg-black/20" />
    </span>
  );
}

/** Render a launch-button / volume-popup backdrop from its resolved descriptor
 *  (issue: unify launcher backgrounds). `none` -> no art. Otherwise, if the user
 *  framed this surface, a baked image (`customSrc`) is stored for ANY kind and is
 *  rendered centered (the framing is baked in). With no baked image we fall back
 *  to the live source: `hero` -> a hero render with the shared face crop; anything
 *  else -> the built-in art (this also covers legacy installs that never framed). */
export function SurfaceBackdrop({
  bg,
  defaultSrc,
  defaultPosition = 'center',
  warm = false,
  customSrc,
}: {
  bg: AppearanceBg;
  defaultSrc: string;
  defaultPosition?: string;
  warm?: boolean;
  customSrc?: string;
}) {
  if (bg.kind === 'none') return null;
  // A framed surface bakes its crop into customSrc, regardless of source kind.
  if (customSrc) {
    return <LaunchButtonBackdrop src={customSrc} position="center" warm={warm} />;
  }
  if (bg.kind === 'hero') {
    const hero = bg.hero ?? DEFAULT_SIDEBAR_HERO;
    return (
      <LaunchButtonBackdrop
        src={getHeroRenderPath(hero)}
        imageStyle={getSidebarHeroImageStyle(hero)}
        warm={warm}
      />
    );
  }
  return <LaunchButtonBackdrop src={defaultSrc} position={defaultPosition} warm={warm} />;
}
