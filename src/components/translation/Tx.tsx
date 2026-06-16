import { useTranslation } from 'react-i18next';

interface TxProps {
  /** Dot-notation catalog key, e.g. 'settings.language.label'. */
  k: string;
  /** Interpolation values, including `count` for plurals. */
  values?: Record<string, unknown>;
  /** English source string, used when the active catalog lacks the key. */
  fallback?: string;
  className?: string;
}

/**
 * Renders a single translated UI string.
 *
 * t() resolves against the active language (a downloaded catalog once
 * registered), falling back to the in-code English `fallback` when the key is
 * missing from that catalog. Wrapping in a <span> keeps call sites able to pass
 * a className and lets these strings be targeted in the DOM.
 */
export default function Tx({ k, values, fallback, className }: TxProps) {
  const { t } = useTranslation();
  const text = t(k, { defaultValue: fallback ?? k, ...values });
  return <span className={className}>{text}</span>;
}
