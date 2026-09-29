import { useTranslation } from 'react-i18next';
import { Modal, ModalBody } from '../common/Modal';
import { ModalHeader } from '../common/ui';

export default function SafetyExplainer({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
    return <Modal onClose={onClose} size="lg" labelledBy="safety-explainer-title">
        <ModalHeader title={t('modSafety.explainer.title')} titleId="safety-explainer-title"
            onClose={onClose} closeLabel={t('common.actions.close')} />
        <ModalBody className="space-y-4 text-sm leading-relaxed [scrollbar-gutter:stable]">
            <section className="space-y-1">
                <h3 className="font-medium text-text-primary">{t('modSafety.explainer.simpleTitle')}</h3>
                <p className="text-text-secondary">{t('modSafety.explainer.simple')}</p>
            </section>
            <section className="space-y-1">
                <h3 className="font-medium text-text-primary">{t('modSafety.explainer.technicalTitle')}</h3>
                <p className="text-text-secondary">{t('modSafety.explainer.technical')}</p>
            </section>
            <p className="text-text-primary">{t('modSafety.explainer.choice')}</p>
        </ModalBody>
    </Modal>;
}
