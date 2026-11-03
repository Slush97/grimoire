import type { TFunction } from 'i18next';

/**
 * Hero card variant names, shared by the main-process card services and the
 * Locker picker. A plain variant comes straight from `vpkmerge portrait`
 * (`card`, `card_critical`, ...). A variant from an alternate form carries the
 * form as a prefix (`wolf_card` for `werewolf_wolf_card_psd.vtex_c`).
 */
export const VARIANT_LABEL_KEYS: Record<string, string> = {
  card: 'locker.cards.variants.card',
  vertical: 'locker.cards.variants.vertical',
  card_critical: 'locker.cards.variants.cardCritical',
  card_gloat: 'locker.cards.variants.cardGloat',
  minimap: 'locker.cards.variants.minimap',
  small: 'locker.cards.variants.small',
  other: 'locker.cards.variants.other',
};

/** A form missing here reads as its capitalized file name token. */
export const FORM_LABEL_KEYS: Record<string, string> = {
  wolf: 'locker.cards.forms.wolf',
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

export function heroCardVariantLabel(variant: string, t: TFunction): string {
  const form = FORM_VARIANT.exec(variant);
  if (!form) {
    const key = VARIANT_LABEL_KEYS[variant];
    return key ? t(key) : variant;
  }
  const formKey = FORM_LABEL_KEYS[form[1]];
  return t('locker.cards.formVariant', {
    form: formKey ? t(formKey) : form[1].charAt(0).toUpperCase() + form[1].slice(1),
    variant: t(VARIANT_LABEL_KEYS[form[2]]),
  });
}
