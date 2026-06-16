// Rare meme tooltips that occasionally replace a nav item's real hover text.
// Deliberately hardcoded here and never run through t(): these must never reach
// the en translation catalog (and therefore Weblate), or they'd get "translated"
// and tank the completeness numbers. Keyed by NavLink `to` path.
const MEME_NAV_TOOLTIPS: Record<string, string> = {
  '/': 'W Mods Only',
  '/browse': 'Mod Shopping Spree',
  '/discover': "Other People's Drip",
  '/servers': 'Friend Simulator',
  '/locker': 'Fortnite Locker',
  '/crosshair': 'Aimbot (Legal)',
  '/autoexec': "Hacker Voice: I'm In",
  '/stats': 'Losing Streak',
  '/conflicts': 'They Are Fighting',
  '/profiles': 'Alt Accounts',
  '/settings': 'Nerd Stuff',
};

const MEME_TOOLTIP_CHANCE = 0.07;

// Rolls once per hover. Returns a meme tooltip on a hit, otherwise null so the
// caller falls back to the real localized tooltip.
export function rollMemeTooltip(to: string): string | null {
  const meme = MEME_NAV_TOOLTIPS[to];
  if (!meme) return null;
  return Math.random() < MEME_TOOLTIP_CHANCE ? meme : null;
}

// One-in-twenty boot rolls the window title to his signature "DeadGame".
export function rollMemeAppTitle(): string | null {
  return Math.random() < 0.05 ? 'DeadGame' : null;
}

// Appended (never substituted) to a low-stakes toast on a rare hit. The real
// localized message always shows; the meme is just a trailing flourish.
export function memeToastSuffix(tone: 'success' | 'error'): string {
  if (Math.random() >= 0.1) return '';
  return tone === 'success' ? ' YAY' : ' Womp Womp';
}

export const MEME_ERROR_NOTE = 'Womp Womp';
export const MEME_ERROR_BUTTON = 'Try Again now papi';

// Rolled once when an error is caught, so the crash screen doesn't flicker.
export function rollErrorBoundaryEgg(): boolean {
  return Math.random() < 0.2;
}

// Rolled once per indicator mount so "Preparing…" doesn't flicker between
// renders. Returns the suffix to append, or '' for the normal label.
export function rollPreparingSuffix(): string {
  return Math.random() < 0.12 ? ' brppapapa' : '';
}
