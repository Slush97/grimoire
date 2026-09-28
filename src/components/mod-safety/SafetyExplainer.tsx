import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Braces, FileMusic, Globe, Headphones, ShieldQuestion, Shirt, Timer } from 'lucide-react';
import { Modal, ModalBody } from '../common/Modal';
import { ModalHeader, SegmentedControl } from '../common/ui';

const EXAMPLES = ['timer', 'music', 'cosmetic'] as const;
type Example = typeof EXAMPLES[number];

function ModIllustration({ example }: { example: Example }) {
    return <svg viewBox="0 0 160 120" className="h-28 w-full max-w-40" aria-hidden="true">
        <rect x="8" y="12" width="144" height="96" rx="4" className="fill-bg-tertiary stroke-border" />
        <path d="M8 32 H152" className="stroke-border" />
        <circle cx="19" cy="22" r="2" className="fill-text-tertiary" />
        <path d="M29 22 H60" className="stroke-text-tertiary" strokeWidth="2" />
        {example === 'timer' && <>
            {[24, 65, 106].map((x, i) => <g key={x}>
                <rect x={x} y="47" width="30" height="30" rx="3" className="fill-bg-secondary stroke-border" />
                <path d={`M${x + 7} 63 L${x + 14} 53 L${x + 14} 61 L${x + 23} 61 L${x + 16} 71 L${x + 16} 63 Z`} className="fill-text-secondary" />
                <rect x={x} y="86" width="30" height="4" rx="2" className="fill-border" />
                <rect x={x} y="86" width={10 + i * 8} height="4" rx="2" className="fill-text-secondary" />
            </g>)}
        </>}
        {example === 'music' && <>
            {[18, 34, 44, 26, 38, 20, 30].map((h, i) => <rect key={i} x={31 + i * 14} y={70 - h / 2} width="5" height={h} rx="2" className="fill-text-secondary" />)}
            <path d="M25 97 H135" className="stroke-border" strokeWidth="2" />
            <circle cx="65" cy="97" r="3" className="fill-text-secondary" />
        </>}
        {example === 'cosmetic' && <>
            <Shirt x="48" y="40" width="64" height="58" className="text-text-secondary" strokeWidth="1.5" />
            <path d="M77 63 L72 76 H83 L78 88" className="stroke-text-secondary" strokeWidth="2" fill="none" />
        </>}
    </svg>;
}

function ExampleScene({ example }: { example: Example }) {
    const { t } = useTranslation();
    const ResultIcon = example === 'timer' ? Timer : example === 'music' ? Headphones : ShieldQuestion;
    return <>
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 py-4 sm:gap-3">
            <figure className="flex min-w-0 flex-col items-center gap-3 text-center">
                <ModIllustration example={example} />
                <figcaption className="text-sm font-medium text-text-primary">{t(`modSafety.explainer.${example}.name`)}</figcaption>
            </figure>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
            <figure className="flex min-w-0 flex-col items-center gap-3 text-center">
                <div className="flex h-28 items-center justify-center gap-3 text-text-secondary" aria-hidden="true">
                    {example === 'timer' ? <Braces className="h-12 w-12" /> : example === 'music'
                        ? <><FileMusic className="h-8 w-8" /><Globe className="h-8 w-8" /></>
                        : <><Braces className="h-8 w-8" /><Globe className="h-8 w-8" /></>}
                </div>
                <figcaption className="text-sm font-medium text-text-primary">{t(`modSafety.explainer.${example}.access`)}</figcaption>
            </figure>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
            <figure className="flex min-w-0 flex-col items-center gap-3 text-center">
                <div className={`flex h-28 items-center justify-center ${example === 'cosmetic' ? 'text-state-warning' : 'text-text-secondary'}`}>
                    <ResultIcon className="h-14 w-14" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <figcaption className="text-sm font-medium text-text-primary">{t(`modSafety.explainer.${example}.result`)}</figcaption>
            </figure>
        </div>
        <div className="space-y-2 border-t border-border pt-4 text-sm text-text-secondary">
            <p>{t(`modSafety.explainer.${example}.purpose`)}</p>
            <p>{t(`modSafety.explainer.${example}.caution`)}</p>
        </div>
    </>;
}

export default function SafetyExplainer({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
    const [example, setExample] = useState<Example>('timer');
    return <Modal onClose={onClose} size="lg" labelledBy="safety-explainer-title">
        <ModalHeader title={t('modSafety.explainer.title')} titleId="safety-explainer-title"
            onClose={onClose} closeLabel={t('common.actions.close')} />
        <ModalBody className="space-y-4 [scrollbar-gutter:stable]">
            <SegmentedControl value={example} onChange={setExample} label={t('modSafety.explainer.examples')}
                options={EXAMPLES.map(value => ({ value, label: t(`modSafety.explainer.${value}.name`) }))} />
            <div className="grid rounded-sm border border-border bg-bg-primary p-4" aria-live="polite">
                {EXAMPLES.map(value => <div key={value} aria-hidden={value !== example}
                    className={`col-start-1 row-start-1 ${value !== example ? 'invisible' : ''}`}>
                    <ExampleScene example={value} />
                </div>)}
            </div>
            <div className="space-y-1">
                <p className="text-sm text-text-primary">{t('modSafety.explainer.choice')}</p>
                <p className="text-xs text-text-secondary">{t('modSafety.explainer.limits')}</p>
            </div>
        </ModalBody>
    </Modal>;
}
