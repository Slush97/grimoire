/**
 * Compact "time since" label for installed-mod timestamps. Granularity tops out
 * at years so the strings stay short enough for the meta row on cards and
 * variant rows (size, slot, filename, date). Pair with formatAbsoluteDate for
 * the hover tooltip so users can still see the exact install time.
 */
export function formatRelativeDate(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diffMs = Date.now() - then;

    if (diffMs < 60_000) return 'just now';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (days < 30) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (days < 365) return `${months} mo ago`;
    const years = Math.floor(days / 365);
    return `${years} yr ago`;
}

export function formatAbsoluteDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
}
