import type { Mod } from '../types/mod';
import type { InstalledModSafety, ModSafetyPrompt, ModSafetyReport } from '../types/modSafety';

export interface SafetyReviewRow {
    key: string;
    name: string;
    report: ModSafetyReport;
    trusted: boolean;
    enabled: boolean;
    mod?: Mod;
    request?: ModSafetyPrompt;
}

export function safetyReviewRows(mods: Mod[], installed: InstalledModSafety[], prompts: ModSafetyPrompt[]): SafetyReviewRow[] {
    const rows: SafetyReviewRow[] = mods.filter(m => m.safety && m.safety.report.verdict !== 'no-findings')
        .map(m => ({ key: m.id, name: m.name, mod: m, report: m.safety!.report, trusted: m.safety!.trusted, enabled: m.enabled }));
    for (const item of installed.filter(m => !m.modId)) {
        rows.push({ key: 'unmanaged:' + item.name, ...item });
    }
    for (const request of prompts) {
        const existing = rows.find(r => r.name === request.name && r.report.fingerprint === request.report.fingerprint);
        if (existing) existing.request = request;
        else rows.unshift({ key: 'request:' + request.id, name: request.name, request,
            report: request.report, trusted: false, enabled: request.restartRequired,
            mod: mods.find(m => m.name === request.name) });
    }
    const occurrences = new Map<string, number>();
    for (const row of rows) {
        // Slots change on enable. Dismissal and row identity follow content instead.
        const identity = JSON.stringify([row.name, row.report.fingerprint || row.key]);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        row.key = `${identity}:${occurrence}`;
    }
    return rows;
}

export function pendingSafetyKeys(rows: SafetyReviewRow[]): string[] {
    return rows.filter(row => !row.trusted).map(row => row.key);
}

export function hasNewSafetyReview(pending: string[], dismissed: string[]): boolean {
    const known = new Set(dismissed);
    return pending.some(key => !known.has(key));
}
