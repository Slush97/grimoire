import i18n from '../i18n';

/**
 * Compact "time since" label for installed-mod timestamps. Granularity tops out
 * at years so the strings stay short enough for the meta row on cards and
 * variant rows (size, slot, filename, date). Pair with formatAbsoluteDate for
 * the hover tooltip so users can still see the exact install time.
 *
 * Strings come from the active i18n catalog (common.relativeTime.*), so the
 * label follows the user's selected language. Components that render this also
 * consume `t`, so they re-render (and re-call this) when the language switches.
 */
export function formatRelativeDate(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diffMs = Date.now() - then;
    const t = i18n.t.bind(i18n);

    if (diffMs < 60_000) return t('common.relativeTime.justNow');
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return t('common.relativeTime.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('common.relativeTime.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('common.relativeTime.daysAgo', { count: days });
    const weeks = Math.floor(days / 7);
    if (days < 30) return t('common.relativeTime.weeksAgo', { count: weeks });
    const months = Math.floor(days / 30);
    if (days < 365) return t('common.relativeTime.monthsAgo', { count: months });
    const years = Math.floor(days / 365);
    return t('common.relativeTime.yearsAgo', { count: years });
}

export function formatAbsoluteDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // Format with the active UI language so the tooltip's month/day order and
    // separators match the user's locale, not the OS default.
    return d.toLocaleString(i18n.language || undefined);
}
