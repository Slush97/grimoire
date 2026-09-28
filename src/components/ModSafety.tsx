import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Modal, ModalBody } from './common/Modal';
import { Button, ModalHeader, Tag } from './common/ui';
import { useModSafetyStore } from '../stores/modSafetyStore';
import { useAppStore } from '../stores/appStore';
import type { ModSafetyPrompt, ModSafetyReport, ModSafetySnapshot } from '../types/modSafety';

export function ModSafetyBadge({ id, name, snapshot }: { id: string; name: string; snapshot?: ModSafetySnapshot }) {
    const { t } = useTranslation();
    const open = useModSafetyStore(s => s.openDetail);
    if (!snapshot || snapshot.report.verdict === 'no-findings') return null;
    const blocked = snapshot.report.verdict === 'blocked';
    const Icon = blocked ? ShieldAlert : snapshot.trusted ? ShieldCheck : ShieldQuestion;
    return <button type="button" className="max-w-full shrink-0 cursor-pointer rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
        title={t('modSafety.viewFindings', { name })} onClick={e => { e.stopPropagation(); open(id, name, snapshot); }}>
        <Tag className="max-w-full" tone={blocked ? 'danger' : snapshot.trusted ? 'neutral' : 'warning'}>
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0 break-words whitespace-normal">{blocked ? t('modSafety.blocked') : snapshot.trusted ? t('modSafety.trusted') : t('modSafety.needsReview')}</span>
        </Tag>
    </button>;
}

function Risks({ report }: { report: ModSafetyReport }) {
    const { t } = useTranslation();
    const descriptions = {
        'local-file': t('modSafety.risks.localFile'), browser: t('modSafety.risks.browser'),
        'remote-code': t('modSafety.risks.remoteCode'), 'dynamic-code': t('modSafety.risks.dynamicCode'),
        executable: t('modSafety.risks.executable'), uninspectable: t('modSafety.risks.uninspectable'),
    };
    const reasons = [...new Set(report.findings.map(f => f.reason))];
    const specific = reasons.filter(reason => reason !== 'executable');
    const visible = specific.length ? specific : reasons;
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
            onClick={() => useModSafetyStore.setState({ panelOpen: true })}>{t('modSafety.reviewMods')}</Button>
    </div>;
}

export function ModSafetyCenter() {
    const { t } = useTranslation();
    const [prompts, setPrompts] = useState<ModSafetyPrompt[]>([]);
    const [busy, setBusy] = useState(false);
    const [responding, setResponding] = useState(false);
    const [error, setError] = useState(false);
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
                setPrompts(queue);
                useModSafetyStore.setState({ installed: results.mods, scanning: results.running, scanFailed: results.failed });
                void useAppStore.getState().loadMods({ force: true, silent: true });
            } catch { if (live) setError(true); }
        };
        const unsubscribe = window.electronAPI.onModSafetyChanged(() => { void refresh(); });
        void refresh();
        return () => { live = false; unsubscribe(); };
    }, []);

    const request = prompts[0];
    const closeDetail = () => useModSafetyStore.setState({ detail: null });
    const run = async (action: () => Promise<unknown>) => {
        setBusy(true); setError(false);
        try { await action(); }
        catch (err) { if (!String(err).includes('MOD_SAFETY_')) setError(true); }
        finally { setBusy(false); void useAppStore.getState().loadMods({ force: true, silent: true }); }
    };
    const answer = (accepted: boolean) => {
        if (!request || responding) return;
        setResponding(true);
        void window.electronAPI.respondModSafety(request.id, accepted)
            .catch(() => setError(true)).finally(() => setResponding(false));
    };
    const review = (id: string) => {
        closeDetail();
        useModSafetyStore.setState({ panelOpen: false });
        void run(async () => {
            const results = await window.electronAPI.reviewModSafety(id);
            useModSafetyStore.setState({ installed: results });
        });
    };
    const rescan = () => void run(async () => {
        const results = await window.electronAPI.rescanModSafety();
        useModSafetyStore.setState({ installed: results });
    });
    const inspect = () => detail && void run(async () => {
        const snapshot = await window.electronAPI.inspectModSafety(detail.id);
        useModSafetyStore.setState({ detail: { ...detail, snapshot } });
    });
    const rows = mods.filter(m => m.safety && m.safety.report.verdict !== 'no-findings');
    return <>
        {panelOpen && !request && !detail && <Modal onClose={() => useModSafetyStore.setState({ panelOpen: false })} labelledBy="mod-safety-list" size="lg">
            <ModalHeader title={t('modSafety.manage')} titleId="mod-safety-list" onClose={() => useModSafetyStore.setState({ panelOpen: false })} />
            <ModalBody className="space-y-4">
                <p className="text-sm text-text-secondary">{t('modSafety.listIntro')}</p>
                <div className="max-h-[50vh] space-y-3 overflow-y-auto">
                    {rows.map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-hl/10 p-3">
                        <span className="min-w-0 break-all text-sm text-text-primary">{m.name}
                            <span className="block text-xs text-text-secondary">{m.fileName}</span>
                        </span>
                        <ModSafetyBadge id={m.id} name={m.name} snapshot={m.safety} />
                    </div>)}
                    {installed.filter(m => !m.modId).map((m, i) => <div key={i} className="rounded-sm border border-hl/10 p-3">
                        <p className="break-all text-sm text-text-primary">{m.name}</p>
                        <Risks report={m.report} />
                        <p className="my-2 text-xs text-text-secondary">{m.enabled ? t('modSafety.closeGame') : t('modSafety.movedDisabled')}</p>
                        <Findings report={m.report} />
                    </div>)}
                    {!rows.length && !installed.some(m => !m.modId) && <p className="text-sm text-text-secondary">{scanning
                        ? t('modSafety.scanning') : scanFailed ? t('modSafety.scanFailed') : t('modSafety.noFlaggedMods')}</p>}
                </div>
                {error && <p role="alert" className="text-sm text-state-danger">{t('modSafety.failed')}</p>}
                <Button variant="secondary" isLoading={busy} onClick={rescan}>{t('modSafety.rescan')}</Button>
            </ModalBody>
        </Modal>}
        {detail && !request && <Modal onClose={closeDetail} labelledBy="mod-safety-detail">
            <ModalHeader title={detail.snapshot?.report.verdict === 'blocked' ? t('modSafety.blockedTitle')
                : detail.snapshot?.trusted ? t('modSafety.trustedTitle') : t('modSafety.trustTitle')}
                subtitle={detail.name} titleId="mod-safety-detail" onClose={closeDetail} />
            <ModalBody className="space-y-4">
                {detail.snapshot && <Risks report={detail.snapshot.report} />}
                <p className="text-sm text-text-secondary">{detail.snapshot?.trusted
                    ? t('modSafety.trustedBody') : detail.snapshot?.report.verdict === 'blocked'
                        ? t('modSafety.blockedBody') : t('modSafety.trustBody')}</p>
                {detail.snapshot && <Findings report={detail.snapshot.report} />}
                {error && <p role="alert" className="text-sm text-state-danger">{t('modSafety.failed')}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={closeDetail}>{t('modSafety.close')}</Button>
                    <Button variant="secondary" isLoading={busy} onClick={inspect}>{t('modSafety.checkAgain')}</Button>
                    {detail.snapshot?.report.verdict === 'requires-trust' && !detail.snapshot.trusted
                        && <Button disabled={busy} onClick={() => review(detail.id)}>{t('modSafety.reviewAndEnable')}</Button>}
                </div>
            </ModalBody>
        </Modal>}
        {request && <Modal key={request.id} onClose={() => answer(false)} labelledBy="mod-safety-prompt" dismissable={!responding}>
            <ModalHeader title={request.report.verdict === 'blocked' ? t('modSafety.blockedTitle') : t('modSafety.trustTitle')}
                titleId="mod-safety-prompt" subtitle={request.name} onClose={() => answer(false)} closeDisabled={responding} />
            <ModalBody className="space-y-4">
                <Risks report={request.report} />
                <p className="text-sm leading-relaxed text-text-secondary">{request.report.verdict === 'blocked'
                    ? t('modSafety.blockedBody') : t('modSafety.trustBody')}</p>
                {request.context === 'installation' && <p className="text-sm text-text-primary">{t('modSafety.oldVersionKept')}</p>}
                {request.context === 'startup' && <p className="text-sm text-state-warning">{request.restartRequired
                    ? t('modSafety.closeGame') : t('modSafety.movedDisabled')}</p>}
                <Findings report={request.report} />
                {error && <p role="alert" className="text-sm text-state-danger">{t('modSafety.failed')}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" disabled={responding} onClick={() => answer(false)}>{request.canTrust
                        ? t('modSafety.cancel') : t('modSafety.close')}</Button>
                    {request.canTrust && <Button isLoading={responding} onClick={() => answer(true)}>{t('modSafety.trustVersion')}</Button>}
                </div>
            </ModalBody>
        </Modal>}
    </>;
}
