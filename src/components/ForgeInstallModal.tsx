import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Modal, ModalBody, ModalFooter } from './common/Modal';
import { Button } from './common/ui';
import { formatBytes } from '../lib/formatBytes';
import { getForgeBadgePath } from '../lib/assetPath';
import type { ForgeInstallRequestData } from '../types/electron';

/**
 * Confirmation dialog for a mod handed over by deadlockforge.net.
 *
 * This dialog is the security boundary for the whole local-install feature.
 * Any page that gets past the origin allowlist can ask to install something,
 * so the user's decision here is what stands between a request and the game
 * folder. Two consequences for this component:
 *
 *  - Everything shown is either sanitized in the main process (name, author)
 *    or measured by it (size, origin). Nothing the caller claimed is displayed
 *    verbatim.
 *  - The confirm button is not focused by default and stays inert briefly
 *    after the dialog appears, so a held Enter key or a burst of prompts
 *    cannot click through it.
 */

/** How long the confirm button stays disabled after the dialog opens. Long
 *  enough to break "hold Enter" and click-through timing, short enough that a
 *  reading user never notices it. */
const ARM_DELAY_MS = 600;

interface ForgeInstallModalProps {
    data: ForgeInstallRequestData;
    /** True when no Deadlock folder is configured yet. The install cannot
     *  proceed, so the dialog becomes a setup prompt instead. */
    needsGamePath: boolean;
    onRespond: (accepted: boolean) => void;
}

export default function ForgeInstallModal({
    data,
    needsGamePath,
    onRespond,
}: ForgeInstallModalProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const titleId = useId();
    const [armed, setArmed] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setArmed(true), ARM_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, []);

    // Strip the scheme for display: the hostname is the part that carries
    // meaning, and showing it plainly is what lets a user notice a prompt they
    // did not expect.
    const displayOrigin = data.origin.replace(/^https?:\/\//, '');

    const goToSettings = () => {
        onRespond(false);
        navigate('/settings');
    };

    return (
        <Modal open onClose={() => onRespond(false)} labelledBy={titleId} size="sm">
            <ModalBody className="pt-5">
            <div className="flex items-start gap-4">
                <img
                    src={getForgeBadgePath()}
                    alt=""
                    aria-hidden
                    className="h-12 w-12 flex-shrink-0 rounded-sm border border-border object-cover"
                />
                <div className="min-w-0">
                    <h2 id={titleId} className="font-reaver text-base font-semibold text-text-primary">
                        {needsGamePath
                            ? t('forge.install.needsPathTitle')
                            : t('forge.install.title')}
                    </h2>
                    <p className="text-xs text-text-secondary">
                        {t('forge.install.from', { origin: displayOrigin })}
                    </p>
                </div>
            </div>

            {needsGamePath ? (
                <p className="mt-4 text-sm text-text-secondary">{t('forge.install.needsPathBody')}</p>
            ) : (
                <>
                    <dl className="mt-4 space-y-2 rounded-sm border border-border bg-bg-tertiary px-3 py-2 text-sm">
                        <div className="flex gap-3">
                            <dt className="w-16 flex-shrink-0 text-text-secondary">
                                {t('forge.install.modLabel')}
                            </dt>
                            {/* Sanitized in the main process: control characters,
                                bidi overrides and zero-width padding are stripped
                                before this ever reaches the renderer. */}
                            <dd className="min-w-0 break-words font-medium text-text-primary">
                                {data.name}
                            </dd>
                        </div>
                        {data.author && (
                            <div className="flex gap-3">
                                <dt className="w-16 flex-shrink-0 text-text-secondary">
                                    {t('forge.install.authorLabel')}
                                </dt>
                                <dd className="min-w-0 break-words text-text-primary">
                                    {data.author}
                                </dd>
                            </div>
                        )}
                        <div className="flex gap-3">
                            <dt className="w-16 flex-shrink-0 text-text-secondary">
                                {t('forge.install.sizeLabel')}
                            </dt>
                            {/* Bytes actually received, never a caller-supplied figure. */}
                            <dd className="text-text-primary">{formatBytes(data.sizeBytes)}</dd>
                        </div>
                    </dl>

                    <p className="mt-3 text-xs text-text-secondary">
                        {t('forge.install.disclaimer')}
                    </p>
                </>
            )}

            </ModalBody>

            <ModalFooter>
                <Button variant="secondary" onClick={() => onRespond(false)}>
                    {t('common.actions.cancel')}
                </Button>
                {needsGamePath ? (
                    <Button onClick={goToSettings}>{t('forge.install.openSettings')}</Button>
                ) : (
                    <Button onClick={() => onRespond(true)} disabled={!armed}>
                        {t('forge.install.confirm')}
                    </Button>
                )}
            </ModalFooter>
        </Modal>
    );
}
