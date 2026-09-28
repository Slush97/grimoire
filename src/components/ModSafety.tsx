import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from './common/Modal';
import ModThumbnail from './ModThumbnail';
import { inferHeroFromTitle } from '../lib/lockerUtils';
import { shouldBlurNsfw } from '../lib/appSettings';
import type { Mod } from '../types/mod';
import { Button, ModalHeader, Tag } from './common/ui';
import { useModSafetyStore } from '../stores/modSafetyStore';
import { useAppStore } from '../stores/appStore';
import type { ModSafetyPrompt, ModSafetyReport, ModSafetySnapshot } from '../types/modSafety';

export function ModSafetyBadge({ id, name, snapshot, variant = 'inline' }: {
    id: string; name: string; snapshot?: ModSafetySnapshot; variant?: 'inline' | 'overlay';
}) {
    const { t } = useTranslation();
    const open = useModSafetyStore(s => s.openDetail);
    if (!snapshot || snapshot.report.verdict === 'no-findings') return null;
    const unchecked = snapshot.report.verdict === 'blocked';
    const Icon = unchecked ? ShieldQuestion : snapshot.trusted ? ShieldCheck : ShieldQuestion;
    const status = unchecked ? t('modSafety.unchecked') : snapshot.trusted ? t('modSafety.trusted') : t('modSafety.needsReview');
    if (variant === 'overlay') return <button type="button" data-card-action="true"
        aria-label={`${status}. ${t('modSafety.viewFindings', { name })}`}
        title={`${status}. ${t('modSafety.viewFindings', { name })}`}
        className="inline-flex shrink-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        onClick={e => { e.stopPropagation(); open(id, name, snapshot); }}>
        <Tag variant="overlay" tone={snapshot.trusted ? 'accepted' : 'warning'}>
            <Icon className="h-3 w-3" aria-hidden />
        </Tag>
    </button>;
    return <button type="button" className="max-w-full shrink-0 cursor-pointer rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
        title={t('modSafety.viewFindings', { name })} onClick={e => { e.stopPropagation(); open(id, name, snapshot); }}>
        <Tag className="max-w-full" tone={snapshot.trusted ? 'accepted' : 'warning'}>
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0 break-words whitespace-normal">{status}</span>
        </Tag>
    </button>;
}

function Risks({ report }: { report: ModSafetyReport }) {
    const { t } = useTranslation();
    const descriptions = {
        'local-file': t('modSafety.risks.localFile'), browser: t('modSafety.risks.browser'),
        'remote-code': t('modSafety.risks.remoteCode'), 'dynamic-code': t('modSafety.risks.dynamicCode'),
        executable: t('modSafety.risks.executable'), uninspectable: t('modSafety.risks.uninspectable'),
        'native-code': t('modSafety.risks.nativeCode'), 'unreadable-archive': t('modSafety.risks.unreadableArchive'),
    };
    const reasons = [...new Set(report.findings.map(f => f.reason))];
    const specific = reasons.filter(reason => reason !== 'executable');
    const visible = specific.some(reason => reason !== 'uninspectable') ? specific : reasons;
    return <ul className="space-y-2 text-sm leading-relaxed text-text-primary">
        {visible.map(reason => <li key={reason}>{descriptions[reason]}</li>)}
    </ul>;
}

function Findings({ report }: { report: ModSafetyReport }) {
    const { t } = useTranslation();
    const labels = {
        'local-file': t('modSafety.reasons.localFile'), browser: t('modSafety.reasons.browser'),
        'remote-code': t('modSafety.reasons.remoteCode'), 'dynamic-code': t('modSafety.reasons.dynamicCode'),
        executable: t('modSafety.reasons.executable'), uninspectable: t('modSafety.reasons.uninspectable'),
        'native-code': t('modSafety.reasons.nativeCode'), 'unreadable-archive': t('modSafety.reasons.unreadableArchive'),
    };
    return <details className="rounded-sm border border-hl/10 p-3">
        <summary className="cursor-pointer text-sm text-text-primary">{t('modSafety.findings')}</summary>
        <ul className="mt-3 space-y-3 text-xs">
            {report.findings.map((f, i) => <li key={`${f.entry}:${f.reason}:${i}`}>
                <div className="text-text-primary">{labels[f.reason]}</div>
                <div className="mt-1 break-all font-mono text-text-secondary">{f.entry}</div>
            </li>)}
        </ul>
    </details>;
}

export function ModSafetyBanner() {
    const { t } = useTranslation();
    const installed = useModSafetyStore(s => s.installed);
    const scanning = useModSafetyStore(s => s.scanning);
    const scanFailed = useModSafetyStore(s => s.scanFailed);
    const mods = useAppStore(s => s.mods);
    const count = mods.filter(m => m.safety && !m.safety.trusted).length
        + installed.filter(m => !m.modId && !m.trusted).length;
    return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hl/5 bg-bg-secondary px-4 py-2 text-xs">
        <span className={count ? 'text-state-warning' : 'text-text-secondary'}>
            {scanning ? t('modSafety.scanning') : scanFailed ? t('modSafety.scanFailed') : count ? t('modSafety.attention', { count }) : t('modSafety.manage')}
        </span>
        <Button size="sm" variant="ghost" icon={ShieldAlert}
            onClick={() => useModSafetyStore.setState({ panelOpen: true, detail: null })}>{t('modSafety.reviewMods')}</Button>
    </div>;
}

interface ReviewRow {
    key: string;
    name: string;
    report: ModSafetyReport;
    trusted: boolean;
    enabled: boolean;
    mod?: Mod;
    request?: ModSafetyPrompt;
}

function ReviewCard({ row, expanded, busy, disabled, error, onExpand, onAllow, onKeepDisabled }: {
    row: ReviewRow; expanded: boolean; busy: boolean; disabled: boolean; error?: string;
    onExpand: () => void; onAllow: () => void; onKeepDisabled: () => void;
}) {
    const { t } = useTranslation();
    const settings = useAppStore(s => s.settings);
    const card = useRef<HTMLElement>(null);
    useEffect(() => {
        if (expanded) card.current?.scrollIntoView({ block: 'nearest' });
    }, [expanded]);
    const labels = {
        'local-file': t('modSafety.summary.localFile'), browser: t('modSafety.summary.browser'),
        'remote-code': t('modSafety.summary.remoteCode'), 'dynamic-code': t('modSafety.summary.dynamicCode'),
        executable: t('modSafety.summary.executable'), uninspectable: t('modSafety.summary.uninspectable'),
        'native-code': t('modSafety.summary.nativeCode'), 'unreadable-archive': t('modSafety.unchecked'),
    };
    const reasons = [...new Set(row.report.findings.map(f => f.reason))];
    const summary = reasons.length > 1 ? reasons.filter(r => r !== 'executable') : reasons;
    const unreadable = row.report.verdict === 'blocked';
    const canAllow = !unreadable && !row.trusted && (!!row.mod || row.request?.canTrust);
    const state = unreadable ? t('modSafety.unchecked') : row.trusted ? t('modSafety.trusted') : t('modSafety.needsReview');
    const hero = row.mod?.sourceSection === 'Sound' && !row.mod.thumbnailUrl
        ? row.mod.lockerHero ?? inferHeroFromTitle(row.name) : undefined;
    const contentId = 'safety-review-' + encodeURIComponent(row.key);
    return <article ref={card} className="overflow-hidden rounded-sm border border-border bg-bg-primary" data-safety-row={row.key}>
        <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={onExpand}
            className="flex w-full items-center gap-3 p-3 text-left hover:bg-hl/5 focus-visible:outline-2 focus-visible:outline-accent">
            <ModThumbnail src={row.mod?.thumbnailUrl} alt="" nsfw={row.mod?.nsfw} hideNsfw={shouldBlurNsfw(settings)}
                heroPortrait={hero ?? undefined} mergedSources={row.mod?.merged?.sources} forgeInstalled={!!row.mod?.forgeInstall}
                enableImageContextMenu={false} className="h-16 w-24 shrink-0 overflow-hidden rounded-sm" />
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="break-words font-mod-title text-sm text-text-primary">{row.name}</span>
                    <span className={row.trusted ? 'text-xs text-state-accepted' : 'text-xs text-state-warning'}>{state}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                    {summary.map(reason => <span key={reason}>{labels[reason]}</span>)}
                </span>
            </span>
            <ChevronDown aria-hidden className={expanded ? 'h-4 w-4 shrink-0 rotate-180 text-text-secondary' : 'h-4 w-4 shrink-0 text-text-secondary'} />
        </button>
        {expanded && <div id={contentId} className="space-y-4 border-t border-border p-4">
            {row.mod && <p className="break-all text-xs text-text-secondary">{row.mod.fileName}</p>}
            <Risks report={row.report} />
            <p className="text-sm text-text-secondary">{unreadable ? t('modSafety.uncheckedBody')
                : row.trusted ? t('modSafety.trustedBody') : t('modSafety.allowHint')}</p>
            {row.request?.context === 'installation' && <p className="text-sm text-text-secondary">{t('modSafety.oldVersionKept')}</p>}
            {row.request?.restartRequired && <p className="text-sm text-state-warning">{t('modSafety.closeGame')}</p>}
            {!row.mod && !row.request?.canTrust && !unreadable && <p className="text-sm text-text-secondary">{row.enabled
                ? t('modSafety.closeGame') : t('modSafety.movedDisabled')}</p>}
            <Findings report={row.report} />
            {error && <p role="alert" className="text-sm text-state-danger">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
                {!row.trusted && <Button variant="secondary" disabled={disabled} onClick={onKeepDisabled}>{t('modSafety.cancel')}</Button>}
                {canAllow && <Button disabled={disabled} isLoading={busy} onClick={onAllow}>{t('modSafety.trustVersion')}</Button>}
            </div>
        </div>}
    </article>;
}

function ReviewList({ rows, children }: { rows: ReviewRow[]; children: (row: ReviewRow) => ReactNode }) {
    // Capture display order for this open panel. Enabling changes installed-list order.
    const [order, setOrder] = useState(() => new Map(rows.map((row, index) => [row.key, index])));
    const added = rows.filter(row => !order.has(row.key));
    if (added.length) {
        const next = new Map(order);
        for (const row of added) next.set(row.key, next.size);
        setOrder(next);
    }
    return [...rows].sort((a, b) => (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size)).map(children);
}

export function ModSafetyCenter() {
    const { t } = useTranslation();
    const [prompts, setPrompts] = useState<ModSafetyPrompt[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [error, setError] = useState<{ key: string; text: string } | null>(null);
    const operation = useRef(false);
    const dismissedPrompts = useRef(new Set<string>());
    const acceptingPrompt = useRef<string | undefined>(undefined);
    const { installed, panelOpen, detail, scanning, scanFailed } = useModSafetyStore();
    const mods = useAppStore(s => s.mods);
    useEffect(() => {
        let live = true;
        let revision = 0;
        const refresh = async () => {
            const rev = ++revision;
            try {
                const [queue, results] = await Promise.all([
                    window.electronAPI.getModSafetyPrompts(), window.electronAPI.getInstalledModSafety(),
                ]);
                if (!live || rev !== revision) return;
                setPrompts(queue.filter(p => !dismissedPrompts.current.has(p.id)));
                useModSafetyStore.setState({ installed: results.mods, scanning: results.running, scanFailed: results.failed });
                void useAppStore.getState().loadMods({ force: true, silent: true });
            } catch { if (live) setError({ key: 'panel', text: t('modSafety.failed') }); }
        };
        const unsubscribe = window.electronAPI.onModSafetyChanged(() => { void refresh(); });
        void refresh();
        return () => { live = false; unsubscribe(); };
    }, [t]);

    const rows: ReviewRow[] = mods.filter(m => m.safety && m.safety.report.verdict !== 'no-findings')
        .map(m => ({ key: m.id, name: m.name, mod: m, report: m.safety!.report, trusted: m.safety!.trusted, enabled: m.enabled }));
    for (const item of installed.filter(m => !m.modId)) {
        rows.push({ key: 'unmanaged:' + item.name + ':' + item.report.fingerprint, ...item });
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
        // File slots and mod IDs change on enable; reviewed content identity does not.
        const identity = JSON.stringify([row.name, row.report.fingerprint]);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        row.key = `${identity}:${occurrence}`;
    }
    // A card's shield opens its row directly; automatic prompts expand in place.
    const expandedKey = (detail && rows.find(r => r.mod?.id === detail.id)?.key) ?? expanded ?? rows.find(r => r.request)?.key;
    const open = panelOpen || prompts.length > 0;
    const expand = (key: string) => {
        useModSafetyStore.setState({ detail: null, panelOpen: true });
        setExpanded(expandedKey === key ? '' : key);
    };
    const run = async (key: string, action: () => Promise<void>) => {
        if (operation.current) return;
        operation.current = true;
        setBusy(key); setError(null);
        try { await action(); }
        catch (err) {
            setError({ key, text: t(String(err).includes('MOD_SAFETY_CHANGED') ? 'modSafety.changed' : 'modSafety.failed') });
        } finally {
            operation.current = false;
            setBusy(null);
            void useAppStore.getState().loadMods({ force: true, silent: true });
        }
    };
    const allow = (row: ReviewRow) => void run(row.key, async () => {
        useModSafetyStore.setState({ panelOpen: true });
        setExpanded(row.key); useModSafetyStore.setState({ detail: null });
        if (row.request?.canTrust) {
            acceptingPrompt.current = row.request.id;
            try { await window.electronAPI.respondModSafety(row.request.id, true); }
            finally { acceptingPrompt.current = undefined; }
        } else if (row.mod) {
            if (row.request) await window.electronAPI.respondModSafety(row.request.id, false);
            const updated = await window.electronAPI.reviewModSafety(row.mod.id, row.report.fingerprint);
            useAppStore.setState(state => ({ mods: state.mods.map(mod => mod.id === row.mod!.id
                ? { ...mod, id: updated.id, path: updated.path, fileName: updated.fileName,
                    metaKey: updated.metaKey, enabled: updated.enabled, priority: updated.priority, safety: updated.safety } : mod) }));
        }
    });
    const keepDisabled = (row: ReviewRow) => void run(row.key, async () => {
        if (row.request) await window.electronAPI.respondModSafety(row.request.id, false);
        if (row.mod?.enabled && row.request?.context !== 'installation') await window.electronAPI.disableMod(row.mod.id);
        setExpanded(''); useModSafetyStore.setState({ detail: null });
    });
    const close = () => {
        const dismiss = prompts.filter(p => p.id !== acceptingPrompt.current);
        for (const p of prompts) dismissedPrompts.current.add(p.id);
        setPrompts([]); setExpanded(null);
        useModSafetyStore.setState({ panelOpen: false, detail: null });
        void Promise.all(dismiss.map(p => window.electronAPI.respondModSafety(p.id, false)))
            .catch(() => setError({ key: 'panel', text: t('modSafety.failed') }));
    };
    const rescan = () => void run('scan', async () => {
        const results = await window.electronAPI.rescanModSafety();
        useModSafetyStore.setState({ installed: results });
    });
    if (!open) return null;
    return <Modal onClose={close} labelledBy="mod-safety-list" size="xl" panelClassName="h-[85vh]">
        <ModalHeader title={t('modSafety.manage')} titleId="mod-safety-list" onClose={close} />
        <ModalBody className="space-y-3 [scrollbar-gutter:stable]">
            <ReviewList rows={rows}>{row => <ReviewCard key={row.key} row={row} expanded={expandedKey === row.key}
                busy={busy === row.key} disabled={!!busy} error={error?.key === row.key ? error.text : undefined}
                onExpand={() => expand(row.key)} onAllow={() => allow(row)} onKeepDisabled={() => keepDisabled(row)} />}</ReviewList>
            {!rows.length && <p className="text-sm text-text-secondary">{scanning
                ? t('modSafety.scanning') : scanFailed ? t('modSafety.scanFailed') : t('modSafety.noFlaggedMods')}</p>}
            {error && !rows.some(r => r.key === error.key) && <p role="alert" className="text-sm text-state-danger">{error.text}</p>}
        </ModalBody>
        <ModalFooter>
            <Button variant="ghost" disabled={!!busy || scanning} isLoading={busy === 'scan'} onClick={rescan}>{t('modSafety.rescan')}</Button>
            <Button variant="secondary" onClick={close}>{t('modSafety.close')}</Button>
        </ModalFooter>
    </Modal>;
}
