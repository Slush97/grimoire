import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp, ArrowRight } from 'lucide-react';
import { Modal, ModalBody } from '../common/Modal';
import { Button, ModalHeader } from '../common/ui';

const SLOT_WIDTH = 120;

type Source = 'stock' | 'a' | 'b';

const FILL: Record<Source, string> = {
  stock: 'fill-bg-tertiary stroke-border',
  a: 'fill-accent stroke-accent',
  b: 'fill-text-secondary stroke-text-secondary',
};

function Figure({ hat, jacket, pants, hatLost = false }: { hat: Source; jacket: Source; pants: Source; hatLost?: boolean }) {
  return (
    <svg viewBox="0 0 80 148" className="h-32 w-[70px]" aria-hidden="true">
      <ellipse cx="40" cy="142" rx="26" ry="4" className="fill-hl/5" />
      <g
        className={`${FILL[hat]} transition-all duration-300 motion-reduce:transition-none ${hatLost ? 'opacity-15 -translate-y-1.5' : ''}`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        <path d="M27 26 C27 13 31 8 40 8 C49 8 53 13 53 26 Z" />
        <rect x="15" y="24" width="50" height="6" rx="3" />
      </g>
      <circle cx="40" cy="42" r="10" className={FILL.stock} strokeWidth="1.5" />
      <path
        d="M20 66 Q20 57 31 56 H49 Q60 57 60 66 L62 94 Q62 98 58 98 H22 Q18 98 18 94 Z"
        className={FILL[jacket]}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <g className={FILL[pants]} strokeWidth="1.5">
        <rect x="22" y="101" width="17" height="38" rx="4" />
        <rect x="41" y="101" width="17" height="38" rx="4" />
      </g>
    </svg>
  );
}

/**
 * Explains that a conflict is a shared file, not a launch blocker: both mods
 * load, and only the files they both replace go to whichever loads first.
 */
export default function ConflictExplainer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [aFirst, setAFirst] = useState(true);

  const mods = [
    { id: 'a' as const, name: t('conflicts.explainer.modA'), parts: t('conflicts.explainer.modAParts'), slot: aFirst ? 0 : 1 },
    { id: 'b' as const, name: t('conflicts.explainer.modB'), parts: t('conflicts.explainer.modBParts'), slot: aFirst ? 1 : 0 },
  ];
  const winner = aFirst ? mods[0].name : mods[1].name;

  return (
    <Modal open={open} onClose={onClose} size="lg" labelledBy="conflict-explainer-title">
      <ModalHeader
        title={t('conflicts.explainer.title')}
        titleId="conflict-explainer-title"
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
      <ModalBody className="space-y-5">
        <div className="flex flex-col items-center gap-3 rounded-sm border border-border bg-bg-primary px-4 py-5">
          <div className="flex items-start gap-3">
            <div>
              <div className="relative h-[196px]" style={{ width: SLOT_WIDTH * 2 }}>
                {mods.map((mod) => (
                  <div
                    key={mod.id}
                    className="absolute top-0 left-0 px-1.5 transition-transform duration-300 ease-out motion-reduce:transition-none"
                    style={{ width: SLOT_WIDTH, transform: `translateX(${mod.slot * SLOT_WIDTH}px)` }}
                  >
                    <figure className="flex flex-col items-center gap-1 rounded-sm border border-border bg-bg-secondary pt-2 pb-2.5">
                      {mod.id === 'a' ? (
                        <Figure hat="a" jacket="a" pants="stock" hatLost={mod.slot === 1} />
                      ) : (
                        <Figure hat="b" jacket="stock" pants="b" hatLost={mod.slot === 1} />
                      )}
                      <figcaption className="text-xs font-medium text-text-primary">{mod.name}</figcaption>
                      <span className="text-2xs text-text-secondary">{mod.parts}</span>
                    </figure>
                  </div>
                ))}
              </div>
              <div className="flex pt-2">
                {['pak01_dir.vpk', 'pak02_dir.vpk'].map((file, i) => (
                  <div key={file} className="flex flex-col items-center gap-0.5" style={{ width: SLOT_WIDTH }}>
                    <code className="font-mono text-2xs text-text-secondary">{file}</code>
                    <span className={`text-2xs ${i === 0 ? 'text-accent' : 'text-text-tertiary'}`}>
                      {i === 0 ? t('conflicts.explainer.loadsFirst') : t('conflicts.explainer.loadsSecond')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <ArrowRight className="mt-20 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />

            <figure
              className="flex flex-col items-center gap-1 rounded-sm border border-accent/40 bg-accent/5 pt-2 pb-2.5"
              style={{ width: SLOT_WIDTH - 12 }}
            >
              <Figure hat={aFirst ? 'a' : 'b'} jacket="a" pants="b" />
              <figcaption className="text-xs font-medium text-text-primary">{t('conflicts.explainer.inGame')}</figcaption>
              <span className="text-2xs text-text-secondary">{t('conflicts.explainer.hatFrom', { name: winner })}</span>
            </figure>
          </div>

          <Button size="sm" variant="secondary" icon={ArrowDownUp} onClick={() => setAFirst((v) => !v)}>
            {t('conflicts.explainer.swap')}
          </Button>
        </div>

        <div className="space-y-3 pb-1 text-sm text-text-secondary">
          <p>
            <span className="font-medium text-text-primary">{t('conflicts.explainer.notAnError')}</span>{' '}
            {t('conflicts.explainer.bothLoad')}
          </p>
          <p>{t('conflicts.explainer.sharedFiles')}</p>
          <p>{t('conflicts.explainer.whatToDo')}</p>
        </div>
      </ModalBody>
    </Modal>
  );
}
