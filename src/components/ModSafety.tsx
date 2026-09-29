import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, CircleHelp, ShieldAlert, ShieldCheck, ShieldQuestion, X } from 'lucide-react';
import SafetyExplainer from './mod-safety/SafetyExplainer';
import ModThumbnail from './ModThumbnail';
import { inferHeroFromTitle } from '../lib/lockerUtils';
import { shouldBlurNsfw } from '../lib/appSettings';
import { Button, Card, IconButton, Tag } from './common/ui';
import { useModSafetyStore } from '../stores/modSafetyStore';
import { useAppStore } from '../stores/appStore';
import type { ModSafetyReport, ModSafetySnapshot } from '../types/modSafety';
import { hasNewSafetyReview, pendingSafetyKeys, safetyReviewRows, scriptOnlySafetyRows, type SafetyReviewRow as ReviewRow } from '../lib/modSafetyReview';

export function ModSafetyBadge({ id, name, snapshot, variant = 'inline' }: {
    id: string; name: string; snapshot?: ModSafetySnapshot; variant?: 'inline' | 'overlay';
}) {
    const { t } = useTranslation();
    const open = useModSafetyStore(s => s.openDetail);
    if (!snapshot || snapshot.report.verdict === 'no-findings') return null;
    const unchecked = snapshot.report.verdict === 'blocked';
    const incomplete = snapshot.report.verdict === 'incomplete';
    const Icon = unchecked || incomplete ? ShieldQuestion : snapshot.trusted ? ShieldCheck : ShieldQuestion;
    const status = unchecked ? t('modSafety.unchecked') : incomplete ? t('modSafety.incomplete')
        : snapshot.trusted ? t('modSafety.trusted') : t('modSafety.needsReview');
    if (variant === 'overlay') return <button type="button" data-card-action="true"
        aria-label={`${status}. ${t('modSafety.viewFindings', { name })}`}
        title={`${status}. ${t('modSafety.viewFindings', { name })}`}
        className="inline-flex shrink-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        onClick={e => { e.stopPropagation(); open(id); }}>
        <Tag variant="overlay" tone={snapshot.trusted ? 'accepted' : 'warning'}>
            <Icon className="h-3 w-3" aria-hidden />
        </Tag>
    </button>;
    return <button type="button" className="max-w-full shrink-0 cursor-pointer rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
        title={t('modSafety.viewFindings', { name })} onClick={e => { e.stopPropagation(); open(id); }}>
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
        'inspection-failed': t('modSafety.risks.inspectionFailed'),
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
        'inspection-failed': t('modSafety.reasons.inspectionFailed'),
    };
    return <details className="rounded-sm border border-hl/10 p-3">
        <summary className="cursor-pointer text-sm text-text-primary">{t('modSafety.findings')}</summary>
        <ul tabIndex={0} aria-label={t('modSafety.findings')}
            className="mt-3 max-h-[min(20rem,40vh)] space-y-3 overflow-y-auto overscroll-contain rounded-sm pr-2 text-xs [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-accent">
            {report.findings.map((f, i) => <li key={`${f.entry}:${f.reason}:${i}`}>
                <div className="text-text-primary">{labels[f.reason]}</div>
                <div className="mt-1 break-all font-mono text-text-secondary">{f.entry}</div>
            </li>)}
        </ul>
    </details>;
}

export function ModSafetyBanner() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { installed, prompts, dismissed, dismiss } = useModSafetyStore();
    const mods = useAppStore(s => s.mods);
    const pending = pendingSafetyKeys(safetyReviewRows(mods, installed, prompts));
    if (location.pathname === '/settings/mod-safety' || !hasNewSafetyReview(pending, dismissed)) return null;
    return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hl/5 bg-bg-secondary px-4 py-2 text-xs">
        <span className="text-state-warning">
            {t('modSafety.attention', { count: pending.length })}
        </span>
        <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={ShieldAlert}
                onClick={() => { useModSafetyStore.setState({ detail: null }); navigate('/settings/mod-safety'); }}>{t('modSafety.reviewMods')}</Button>
            <IconButton size="sm" icon={X} label={t('modSafety.dismissNotice')} onClick={() => dismiss(pending)} />
        </div>
    </div>;
}

function ReviewCard({ row, expanded, busy, error, onExpand, onAllow, onKeepDisabled }: {
    row: ReviewRow; expanded: boolean; busy: boolean; error?: string;
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
        'inspection-failed': t('modSafety.incomplete'),
    };
    const reasons = [...new Set(row.report.findings.map(f => f.reason))];
    const summary = reasons.length > 1 ? reasons.filter(r => r !== 'executable') : reasons;
    const unreadable = row.report.verdict === 'blocked';
    const incomplete = row.report.verdict === 'incomplete';
    const canAllow = !unreadable && !incomplete && !row.trusted && (!!row.mod || row.request?.canTrust);
    const state = unreadable ? t('modSafety.unchecked') : incomplete ? t('modSafety.incomplete')
        : row.trusted ? t('modSafety.trusted') : t('modSafety.needsReview');
    const hero = row.mod?.sourceSection === 'Sound' && !row.mod.thumbnailUrl
        ? row.mod.lockerHero ?? inferHeroFromTitle(row.name) : undefined;
    const contentId = 'safety-review-' + encodeURIComponent(row.key);
    // A pending prompt stays answerable: answering never waits on the mod lock.
    const locked = busy && !row.request;
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
                : incomplete ? t('modSafety.incompleteBody') : row.trusted ? t('modSafety.trustedBody') : t('modSafety.allowHint')}</p>
            {row.request?.context === 'installation' && <p className="text-sm text-text-secondary">{t('modSafety.oldVersionKept')}</p>}
            {row.request?.context === 'server' && <p className="text-sm text-text-secondary">{t('modSafety.serverContent')}</p>}
            {row.request?.restartRequired && <p className="text-sm text-state-warning">{t('modSafety.closeGame')}</p>}
            {!row.mod && !row.request?.canTrust && !unreadable && !incomplete && <p className="text-sm text-text-secondary">{row.enabled
                ? t('modSafety.closeGame') : t('modSafety.movedDisabled')}</p>}
            <Findings report={row.report} />
            {error && <p role="alert" className="text-sm text-state-danger">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
                {!row.trusted && <Button variant="secondary" disabled={locked} onClick={onKeepDisabled}>{t('modSafety.cancel')}</Button>}
                {canAllow && <Button isLoading={locked} onClick={onAllow}>{t('modSafety.trustVersion')}</Button>}
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

export function ModSafetySync() {
    const navigate = useNavigate();
    const openRequested = useModSafetyStore(s => s.openRequested);
    const prompts = useModSafetyStore(s => s.prompts);
    const openedRequests = useRef(new Set<string>());
    useEffect(() => {
        if (!openRequested) return;
        navigate('/settings/mod-safety');
        useModSafetyStore.setState({ openRequested: false });
    }, [openRequested, navigate]);
    useEffect(() => {
        // A user-initiated install or enable is waiting for a decision.
        // Startup findings only raise the dismissible notice.
        const waiting = prompts.filter(p => p.context !== 'startup' && !openedRequests.current.has(p.id));
        if (!waiting.length) return;
        for (const p of waiting) openedRequests.current.add(p.id);
        useModSafetyStore.setState({ detail: null });
        navigate('/settings/mod-safety');
    }, [prompts, navigate]);
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
                useModSafetyStore.setState({ prompts: queue, installed: results.mods, scanning: results.running, scanFailed: results.failed });
                void useAppStore.getState().loadMods({ force: true, silent: true });
            } catch { if (live) useModSafetyStore.setState({ scanFailed: true }); }
        };
        const unsubscribe = window.electronAPI.onModSafetyChanged(() => { void refresh(); });
        void refresh();
        return () => { live = false; unsubscribe(); };
    }, []);
    return null;
}

export function ModSafetySection() {
    const { t } = useTranslation();
    const [explainerOpen, setExplainerOpen] = useState(false);
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
    const [expanded, setExpanded] = useState<string | null>(null);
    const [error, setError] = useState<{ key: string; text: string } | null>(null);
    // Per row: an action queued behind the mod lock must not block answering another row's prompt.
    const operations = useRef(new Set<string>());
    const { installed, prompts, detail, scanning, scanFailed } = useModSafetyStore();
    const mods = useAppStore(s => s.mods);
    const rows = safetyReviewRows(mods, installed, prompts).sort((a, b) => Number(a.trusted) - Number(b.trusted));
    // A card's shield opens its row directly; automatic prompts expand in place.
    const expandedKey = (detail && rows.find(r => r.mod?.id === detail.id)?.key) ?? expanded ?? rows.find(r => r.request)?.key;
    const expand = (key: string) => {
        useModSafetyStore.setState({ detail: null });
        setExpanded(expandedKey === key ? '' : key);
    };
    const run = async (key: string, action: () => Promise<void>) => {
        if (operations.current.has(key)) return;
        operations.current.add(key);
        setBusy(new Set(operations.current)); setError(null);
        try { await action(); }
        catch (err) {
            setError({ key, text: t(String(err).includes('MOD_SAFETY_CHANGED') ? 'modSafety.changed' : 'modSafety.failed') });
        } finally {
            operations.current.delete(key);
            setBusy(new Set(operations.current));
            void useAppStore.getState().loadMods({ force: true, silent: true });
        }
    };
    // The prompting operation holds the mod lock and applies the decision itself.
    const answer = (row: ReviewRow, id: string, accepted: boolean) => window.electronAPI.respondModSafety(id, accepted)
        .catch(() => setError({ key: row.key, text: t('modSafety.failed') }));
    const review = async (row: ReviewRow, id: string) => {
        const updated = await window.electronAPI.reviewModSafety(id, row.report.fingerprint);
        useAppStore.setState(state => ({ mods: state.mods.map(m => m.id === id
            ? { ...m, id: updated.id, path: updated.path, fileName: updated.fileName,
                metaKey: updated.metaKey, enabled: updated.enabled, priority: updated.priority, safety: updated.safety } : m) }));
    };
    const allow = (row: ReviewRow) => {
        setExpanded(row.key); useModSafetyStore.setState({ detail: null });
        const mod = row.mod;
        if (row.request?.canTrust) void answer(row, row.request.id, true);
        else if (mod) void run(row.key, () => review(row, mod.id));
    };
    const scriptOnly = scriptOnlySafetyRows(rows);
    // One at a time: each enable takes the mod lock and picks the next free slot.
    const allowScripts = () => void run('allow-scripts', async () => {
        for (const row of scriptOnly) await review(row, row.mod!.id);
    });
    const keepDisabled = (row: ReviewRow) => {
        useModSafetyStore.setState({ detail: null });
        if (row.request) void answer(row, row.request.id, false);
        const mod = row.mod;
        if (!mod?.enabled || row.request?.context === 'installation') { setExpanded(''); return; }
        void run(row.key, async () => {
            await window.electronAPI.disableMod(mod.id);
            setExpanded('');
        });
    };
    const rescan = () => void run('scan', async () => {
        const results = await window.electronAPI.rescanModSafety();
        useModSafetyStore.setState({ installed: results });
    });
    return <Card title={t('modSafety.manage')} icon={ShieldCheck} description={t('modSafety.description')} action={
        <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={CircleHelp} onClick={() => setExplainerOpen(true)}>{t('modSafety.explainer.title')}</Button>
            <Button variant="ghost" isLoading={busy.has('scan') || scanning} onClick={rescan}>{t('modSafety.rescan')}</Button>
        </div>
    }>
        {scanFailed && <p role="alert" className="mb-4 text-sm text-state-warning">{t('modSafety.scanFailed')}</p>}
        {scriptOnly.length > 1 && <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-secondary">{t('modSafety.allowScriptsHint')}</p>
            <Button isLoading={busy.has('allow-scripts')} onClick={allowScripts}>{t('modSafety.allowScripts', { count: scriptOnly.length })}</Button>
        </div>}
        <div className="space-y-3">
            <ReviewList rows={rows}>{row => <ReviewCard key={row.key} row={row} expanded={expandedKey === row.key}
                busy={busy.has(row.key) || busy.has('allow-scripts')} error={error?.key === row.key ? error.text : undefined}
                onExpand={() => expand(row.key)} onAllow={() => allow(row)} onKeepDisabled={() => keepDisabled(row)} />}</ReviewList>
            {!rows.length && <p className="text-sm text-text-secondary">{scanning
                ? t('modSafety.scanning') : scanFailed ? t('modSafety.scanFailed') : t('modSafety.noFlaggedMods')}</p>}
            {error && !rows.some(r => r.key === error.key) && <p role="alert" className="text-sm text-state-danger">{error.text}</p>}
        </div>
        {explainerOpen && <SafetyExplainer onClose={() => setExplainerOpen(false)} />}
    </Card>;
}
