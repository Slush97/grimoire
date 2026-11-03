/**
 * Hero card variant names, shared by the main-process card services and the
 * Locker picker. A plain variant comes straight from `vpkmerge portrait`
 * (`card`, `card_critical`, ...). A variant from an alternate form carries the
 * form as a prefix (`wolf_card` for `werewolf_wolf_card_psd.vtex_c`).
 */
const VARIANT_LABEL: Record<string, string> = {
  card: 'Card',
  vertical: 'Vertical',
  card_critical: 'Low HP',
  card_gloat: 'Gloat',
  minimap: 'Minimap',
  small: 'Small',
  other: 'Other',
};

/** The full card reads first, then the rest roughly by prominence. */
const VARIANT_ORDER = ['card', 'vertical', 'card_critical', 'card_gloat', 'minimap', 'small', 'other'];

const FORM_VARIANT = new RegExp(`^([a-z0-9]+)_(${VARIANT_ORDER.join('|')})$`);

function baseRank(variant: string): number {
  const i = VARIANT_ORDER.indexOf(variant);
  return i === -1 ? VARIANT_ORDER.length : i;
}

/** Sort key for a variant: the hero's own art first, then each form's art in
 *  the same order. Unknown variants sit between the two. */
export function heroCardVariantRank(variant: string): number {
  const form = FORM_VARIANT.exec(variant);
  return form ? VARIANT_ORDER.length + 1 + baseRank(form[2]) : baseRank(variant);
}

export function heroCardVariantLabel(variant: string): string {
  const form = FORM_VARIANT.exec(variant);
  if (!form) return VARIANT_LABEL[variant] ?? variant;
  const name = form[1].charAt(0).toUpperCase() + form[1].slice(1);
  return `${name} ${VARIANT_LABEL[form[2]]}`;
}
