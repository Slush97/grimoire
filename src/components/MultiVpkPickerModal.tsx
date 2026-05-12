import { useState } from 'react';
import { FileArchive, Check, X } from 'lucide-react';
import type { MultiVpkPickData } from '../types/electron';

interface Props {
    data: MultiVpkPickData;
    onConfirm: (selected: string[]) => void;
    onCancel: () => void;
}

/**
 * Multi-VPK picker. Shown when an archive (Warden Remodel, etc.) yields more
 * than one .vpk after extraction. Previously the install pipeline silently
 * kept the alphabetically-first VPK and unlinked the rest — felt like data
 * loss to users. This modal makes the choice explicit.
 *
 * Default selection: only the first VPK is checked, matching the previous
 * implicit behavior. Users who want everything can flip the master toggle.
 *
 * NOTE: the parent must mount this with a key tied to `data.requestId` so a
 * fresh request resets the selection — we deliberately avoid a syncing
 * useEffect here.
 */
export default function MultiVpkPickerModal({ data, onConfirm, onCancel }: Props) {
    const [selected, setSelected] = useState<Set<string>>(() => {
        const next = new Set<string>();
        if (data.vpkFileNames[0]) next.add(data.vpkFileNames[0]);
        return next;
    });

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
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="multi-vpk-pick-title"
            onClick={onCancel}
        >
            <div
                className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 id="multi-vpk-pick-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <FileArchive className="w-5 h-5" />
                        Multiple VPKs in archive
                    </h3>
                    <button
                        onClick={onCancel}
                        className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-sm text-text-secondary">
                        <span className="font-medium text-text-primary">{data.modName}</span> contains{' '}
                        {data.vpkFileNames.length} <code className="font-mono text-text-primary/90 bg-black/30 px-1 py-0.5 rounded">.vpk</code> files.
                        Pick which ones to install — leave any unwanted ones unchecked and they&apos;ll be skipped.
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
                            {allSelected ? 'Deselect all' : 'Select all'}
                        </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                        {data.vpkFileNames.map((vpk) => {
                            const isChecked = selected.has(vpk);
                            const label = data.vpkLabels?.[vpk];
                            return (
                                <label
                                    key={vpk}
                                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer ${
                                        isChecked
                                            ? 'border-accent/40 bg-accent/5 text-text-primary'
                                            : 'border-border bg-bg-tertiary text-text-secondary hover:bg-white/5'
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
                                                <div className="font-mono text-[11px] text-text-secondary/80 truncate" title={vpk}>{vpk}</div>
                                            </>
                                        ) : (
                                            <span className="font-mono text-xs truncate block" title={vpk}>{vpk}</span>
                                        )}
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <div className="flex justify-end gap-3 p-5 border-t border-border">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    >
                        Cancel install
                    </button>
                    <button
                        onClick={() => onConfirm(Array.from(selected))}
                        disabled={selected.size === 0}
                        className="px-4 py-2 bg-accent hover:bg-accent-hover text-black rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Check className="w-4 h-4" />
                        Install {selected.size > 0 ? `${selected.size}` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}
