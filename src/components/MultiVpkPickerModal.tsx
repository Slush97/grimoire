import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileArchive, Check } from 'lucide-react';
import type { MultiVpkPickData } from '../types/electron';
import { formatBytes } from '../lib/formatBytes';
import { Modal, ModalBody, ModalFooter } from './common/Modal';
import { Button, ModalHeader } from './common/ui';

interface Props {
    data: MultiVpkPickData;
    onConfirm: (selected: string[]) => void;
    onCancel: () => void;
}

/**
 * Multi-VPK picker. Shown when an archive (Warden Remodel, etc.) yields more
 * than one .vpk after extraction. Previously the install pipeline silently
 * kept the alphabetically-first VPK and unlinked the rest: felt like data
 * loss to users. This modal makes the choice explicit.
 *
 * Default selection: all VPKs are checked. Most multi-VPK archives ship
 * complementary content (model + voice lines, mod + optional addons) where
 * users want everything; unchecking unwanted variants is easier than
 * remembering to check missing content.
 *
 * NOTE: the parent must mount this with a key tied to `data.requestId` so a
 * fresh request resets the selection: we deliberately avoid a syncing
 * useEffect here.
 */
export default function MultiVpkPickerModal({ data, onConfirm, onCancel }: Props) {
    const { t } = useTranslation();
    const titleId = useId();
    const [selected, setSelected] = useState<Set<string>>(() => new Set(data.vpkFileNames));

    const allSelected = selected.size === data.vpkFileNames.length;
    const toggle = (vpk: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(vpk)) next.delete(vpk);
            else next.add(vpk);
            return next;
        });
    };

    const toggleAll = () => {
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(data.vpkFileNames));
        }
    };

    return (
        <Modal onClose={onCancel} labelledBy={titleId} size="md">
            <ModalHeader
                title={t('multiVpk.title')}
                titleId={titleId}
                onClose={onCancel}
                closeLabel={t('common.actions.close')}
            />
                <ModalBody className="space-y-4">
                    <p className="text-sm text-text-secondary">
                        <span className="font-medium text-text-primary">{data.modName}</span> contains{' '}
                        {data.vpkFileNames.length} <code className="font-mono text-text-primary/90 bg-black/30 px-1 py-0.5 rounded">.vpk</code> files.
                        {t('multiVpk.uncheckHint')}
                    </p>

                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                        <span className="text-xs uppercase tracking-wide text-text-secondary">
                            {selected.size} of {data.vpkFileNames.length} selected
                        </span>
                        <button
                            type="button"
                            onClick={toggleAll}
                            className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
                        >
                            {allSelected ? t('multiVpk.deselectAll') : t('multiVpk.selectAll')}
                        </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                        {data.vpkFileNames.map((vpk) => {
                            const isChecked = selected.has(vpk);
                            const label = data.vpkLabels?.[vpk];
                            const size = data.vpkFileSizes?.[vpk];
                            const sizeLabel = typeof size === 'number' ? formatBytes(size, '') : '';
                            return (
                                <label
                                    key={vpk}
                                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer ${
                                        isChecked
                                            ? 'border-accent/40 bg-accent/5 text-text-primary'
                                            : 'border-border bg-bg-tertiary text-text-secondary hover:bg-hl/5'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggle(vpk)}
                                        className="w-4 h-4 accent-accent cursor-pointer flex-shrink-0"
                                    />
                                    <FileArchive className="w-4 h-4 flex-shrink-0 opacity-70" />
                                    <div className="min-w-0 flex-1">
                                        {label ? (
                                            <>
                                                <div className="text-sm font-medium truncate" title={label}>{label}</div>
                                                <div className="font-mono text-2xs text-text-secondary/80 truncate" title={vpk}>{vpk}</div>
                                            </>
                                        ) : (
                                            <span className="font-mono text-xs truncate block" title={vpk}>{vpk}</span>
                                        )}
                                    </div>
                                    {sizeLabel && (
                                        <span className="flex-shrink-0 rounded bg-bg-primary/70 px-1.5 py-0.5 text-2xs tabular-nums text-text-secondary border border-hl/5">
                                            {sizeLabel}
                                        </span>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                </ModalBody>

                <ModalFooter>
                    <Button variant="secondary" onClick={onCancel}>
                        {t('multiVpk.cancelInstall')}
                    </Button>
                    <Button
                        icon={Check}
                        onClick={() => onConfirm(Array.from(selected))}
                        disabled={selected.size === 0}
                    >
                        {selected.size > 0 ? t('multiVpk.installCount', { count: selected.size }) : t('multiVpk.install')}
                    </Button>
                </ModalFooter>
        </Modal>
    );
}
