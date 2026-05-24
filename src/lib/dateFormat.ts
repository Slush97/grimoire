/**
 * User-selectable absolute-date formatting. The preference lives in AppSettings
 * (`dateFormat`) and is mirrored here as a module-level value so the many pure
 * formatting call sites (mod cards, file rows, comments) don't each have to read
 * the store. The appStore keeps this in sync on load and on save; a change takes
 * effect the next time a view renders.
 *
 * Formatting is deterministic (built from the date parts) rather than relying on
 * `toLocaleDateString()`, whose order varies by system locale. That is the whole
 * point: the user gets the order they picked regardless of their OS locale.
 */

export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY';

export const DEFAULT_DATE_FORMAT: DateFormat = 'MM/DD/YYYY';

let currentFormat: DateFormat = DEFAULT_DATE_FORMAT;

/** Update the active format. Ignores anything that isn't a known format so a
 *  stale/missing setting falls back to the current value. */
export function setDateFormat(format: DateFormat | undefined | null): void {
  if (format === 'MM/DD/YYYY' || format === 'DD/MM/YYYY') {
    currentFormat = format;
  }
}

export function getDateFormat(): DateFormat {
  return currentFormat;
}

/** Format a Date into the user's chosen day/month/year order. Returns '' for an
 *  invalid date so callers can guard cleanly. */
export function formatDateParts(date: Date, format: DateFormat = currentFormat): string {
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return format === 'DD/MM/YYYY' ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
}
