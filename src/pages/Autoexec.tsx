import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Copy, Check, Plus, Trash2, RefreshCw, Save, AlertTriangle, FileWarning } from 'lucide-react';
import { getSettings } from '../lib/api';
import { Card, Badge, Button, IconButton } from '../components/common/ui';
import { Input } from '../components/common/forms';
import { ConfirmModal, PageHeader } from '../components/common/PageComponents';
import CommandLibrary from '../components/autoexec/CommandLibrary';
import LaunchOptionsCard from '../components/autoexec/LaunchOptionsCard';
import Tx from '../components/translation/Tx';
import { memeToastSuffix } from '../lib/easterEggs';

interface AutoexecStatus {
    exists: boolean;
    path: string | null;
    hasCrosshairSettings: boolean;
}

export default function Autoexec() {
    const { t } = useTranslation();
    const [gamePath, setGamePath] = useState<string | null>(null);
    const [status, setStatus] = useState<AutoexecStatus | null>(null);
    const [commands, setCommands] = useState<string[]>([]);
    const [manualCommands, setManualCommands] = useState<string[]>([]);
    const [customCommand, setCustomCommand] = useState('');
    const [copied, setCopied] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveMessageTone, setSaveMessageTone] = useState<'success' | 'error' | null>(null);
    const [hasUnsaved, setHasUnsaved] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

    // Load game path, autoexec status, and existing commands
    useEffect(() => {
        const load = async () => {
            const settings = await getSettings();
            setGamePath(settings.deadlockPath);
            if (settings.deadlockPath) {
                const s = await window.electronAPI.getAutoexecStatus(settings.deadlockPath);
                setStatus(s);

                const result = await window.electronAPI.getAutoexecCommands(settings.deadlockPath);
                setCommands(result.commands);
                setManualCommands(result.manualCommands);
            }
        };
        load();
    }, []);

    const visibleCommandCount = commands.length + manualCommands.length;
    const copiedCommands = useMemo(() => [...commands, ...manualCommands], [commands, manualCommands]);
    const commandAlreadyPresent = (command: string) => commands.includes(command) || manualCommands.includes(command);

    const handleAddCommand = (command: string) => {
        if (commandAlreadyPresent(command)) return;
        setCommands(prev => [...prev, command]);
        setHasUnsaved(true);
    };

    const handleAddCustomCommand = () => {
        if (!customCommand.trim()) return;
        handleAddCommand(customCommand.trim());
        setCustomCommand('');
    };

    const handleRemoveCommand = (index: number) => {
        setCommands(prev => prev.filter((_, i) => i !== index));
        setHasUnsaved(true);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(copiedCommands.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSave = async () => {
        if (!gamePath) {
            setSaveMessage(t('autoexec.status.gamePathNotConfigured'));
            setSaveMessageTone('error');
            return;
        }
        setIsSaving(true);
        setSaveMessage(null);
        setSaveMessageTone(null);
        try {
            await window.electronAPI.saveAutoexecCommands(gamePath, commands);
            setSaveMessage(t('autoexec.status.savedToAutoexec') + memeToastSuffix('success'));
            setSaveMessageTone('success');
            setHasUnsaved(false);
            // Refresh status
            const s = await window.electronAPI.getAutoexecStatus(gamePath);
            setStatus(s);
            const result = await window.electronAPI.getAutoexecCommands(gamePath);
            setCommands(result.commands);
            setManualCommands(result.manualCommands);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (err) {
            setSaveMessage(t('autoexec.status.error', { error: String(err) }) + memeToastSuffix('error'));
            setSaveMessageTone('error');
        } finally {
            setIsSaving(false);
        }
    };

    const confirmClear = () => {
        setCommands([]);
        setHasUnsaved(true);
        setClearConfirmOpen(false);
    };

    const customIsDuplicate = !!customCommand.trim() && commandAlreadyPresent(customCommand.trim());

    return (
        // Library left, your list right, each column owning exactly one scroll.
        // The old page nested four scroll containers, so the wheel did something
        // different depending on which pixel the pointer was over. Below xl the
        // columns stack and the page scrolls as one.
        <div className="flex min-h-full flex-col gap-4 p-6 xl:h-full xl:min-h-0">
            <PageHeader
                title={<Tx k="nav.autoexec" fallback="Autoexec" />}
                description={
                    <Tx
                        k="autoexec.header.description"
                        fallback="Console commands Deadlock runs every time it starts"
                    />
                }
                action={
                    status ? (
                        <Badge variant={status.exists ? 'success' : 'warning'}>
                            {status.exists ? (
                                <Tx k="autoexec.status.fileActive" fallback="autoexec.cfg active" />
                            ) : (
                                <Tx k="autoexec.status.fileMissing" fallback="autoexec.cfg not created yet" />
                            )}
                        </Badge>
                    ) : undefined
                }
            />

            <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
                {/* Left: the catalog to pick from */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:max-h-full">
                    <CommandLibrary isAdded={commandAlreadyPresent} onAdd={handleAddCommand} />
                </div>

                {/* Right: what you have staged, plus launch args */}
                <div className="flex min-h-0 w-full flex-col gap-4 xl:w-[460px] xl:shrink-0">
                    <Card
                        className="flex min-h-0 flex-1 flex-col"
                        contentClassName="flex min-h-0 flex-1 flex-col gap-3 p-4"
                        icon={Terminal}
                        title={
                            <Tx
                                k="autoexec.commands.title"
                                values={{ count: visibleCommandCount }}
                                fallback={`Your Commands (${visibleCommandCount})`}
                            />
                        }
                        action={
                            <div className="flex flex-wrap items-center gap-2">
                                {/* The unsaved marker sits with Save, where the
                                    decision to act on it is made. */}
                                {hasUnsaved && (
                                    <span className="flex items-center gap-1.5 text-xs text-state-warning">
                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-state-warning" aria-hidden />
                                        <Tx k="autoexec.status.unsavedChanges" fallback="You have unsaved changes" />
                                    </span>
                                )}
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setClearConfirmOpen(true)}
                                    disabled={commands.length === 0}
                                    icon={RefreshCw}
                                >
                                    <Tx k="common.actions.clear" fallback="Clear" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={handleCopy}
                                    disabled={copiedCommands.length === 0}
                                    icon={copied ? Check : Copy}
                                >
                                    {copied ? (
                                        <Tx k="common.status.copied" fallback="Copied" />
                                    ) : (
                                        <Tx k="common.actions.copy" fallback="Copy" />
                                    )}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isSaving || !gamePath}
                                    isLoading={isSaving}
                                    icon={Save}
                                >
                                    <Tx k="common.actions.save" fallback="Save" />
                                </Button>
                            </div>
                        }
                    >
                        {/* Adding by hand lives with the list it appends to,
                            not in the catalog column. */}
                        <div className="flex gap-2">
                            <Input
                                inputSize="sm"
                                type="text"
                                value={customCommand}
                                onChange={(e) => setCustomCommand(e.target.value)}
                                placeholder={t('autoexec.customCommand.placeholder')}
                                aria-label={t('autoexec.customCommand.title')}
                                className="flex-1 font-mono"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddCustomCommand()}
                            />
                            <Button
                                size="sm"
                                onClick={handleAddCustomCommand}
                                disabled={!customCommand.trim() || customIsDuplicate}
                                icon={Plus}
                                title={customIsDuplicate ? t('autoexec.customCommand.duplicate') : t('autoexec.customCommand.title')}
                            >
                                <Tx k="autoexec.customCommand.add" fallback="Add" />
                            </Button>
                        </div>

                        {(!gamePath || saveMessage) && (
                            <div className="space-y-2" role="status" aria-live="polite">
                                {!gamePath && (
                                    <p className="flex items-center gap-2 rounded-sm border border-state-warning/20 bg-state-warning/10 p-2 text-xs text-state-warning">
                                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                                        <Tx
                                            k="autoexec.status.gamePathWarning"
                                            fallback="Game path not configured. Set it in Settings to save."
                                        />
                                    </p>
                                )}
                                {saveMessage && (
                                    <p
                                        className={`flex items-center gap-2 rounded-sm border p-2 text-xs ${
                                            saveMessageTone === 'error'
                                                ? 'border-state-danger/20 bg-state-danger/10 text-state-danger'
                                                : 'border-state-success/20 bg-state-success/10 text-state-success'
                                        }`}
                                    >
                                        {saveMessageTone === 'error' ? (
                                            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                                        ) : (
                                            <Check className="h-3 w-3 shrink-0" aria-hidden />
                                        )}
                                        {saveMessage}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
                            {visibleCommandCount === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
                                    <Terminal className="h-7 w-7 text-text-secondary/40" aria-hidden />
                                    <p className="text-sm font-medium text-text-secondary">
                                        <Tx k="autoexec.commands.emptyTitle" fallback="No commands added" />
                                    </p>
                                    <p className="max-w-xs text-xs text-text-secondary/70">
                                        <Tx k="autoexec.commands.emptyDescription" fallback="Select from presets on the left" />
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {commands.length > 0 && (
                                        <ul className="space-y-1.5">
                                            {commands.map((cmd, i) => (
                                                <li
                                                    key={`managed-${i}-${cmd}`}
                                                    className="group flex animate-fade-in items-center gap-2 rounded-sm border border-hl/5 bg-bg-tertiary/50 p-2 transition-colors hover:border-hl/15"
                                                >
                                                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary">
                                                        {cmd}
                                                    </code>
                                                    {/* Always rendered, not hover-only: an
                                                        invisible control cannot be found by
                                                        keyboard or touch. */}
                                                    <IconButton
                                                        size="sm"
                                                        tone="danger"
                                                        icon={Trash2}
                                                        label={t('autoexec.commands.removeLabel', { command: cmd })}
                                                        onClick={() => handleRemoveCommand(i)}
                                                        className="border-transparent opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                                    />
                                                </li>
                                            ))}
                                        </ul>
                                    )}

                                    {manualCommands.length > 0 && (
                                        <section>
                                            {/* Spelled out instead of the old 60%-opacity
                                                rows whose only explanation was a tooltip. */}
                                            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                                                <FileWarning className="h-3.5 w-3.5" aria-hidden />
                                                <Tx k="autoexec.commands.manualTitle" fallback="Already in autoexec.cfg" />
                                            </h3>
                                            <p className="mb-2 text-xs text-text-secondary/70">
                                                <Tx
                                                    k="autoexec.commands.manualDescription"
                                                    fallback="Lines that were in the file before grimoire. They are kept as-is and cannot be edited here."
                                                />
                                            </p>
                                            <ul className="space-y-1.5">
                                                {manualCommands.map((cmd, i) => (
                                                    <li
                                                        key={`manual-${i}-${cmd}`}
                                                        className="flex animate-fade-in items-center gap-2 rounded-sm border border-dashed border-hl/10 bg-bg-tertiary/20 p-2"
                                                    >
                                                        <code className="min-w-0 flex-1 truncate font-mono text-sm text-text-secondary">
                                                            {cmd}
                                                        </code>
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    )}
                                </>
                            )}
                        </div>
                    </Card>

                    <LaunchOptionsCard />
                </div>
            </div>

            <ConfirmModal
                isOpen={clearConfirmOpen}
                onCancel={() => setClearConfirmOpen(false)}
                onConfirm={confirmClear}
                title={<Tx k="autoexec.confirm.clearTitle" fallback="Clear all commands?" />}
                message={
                    <Tx
                        k="autoexec.confirm.clearMessage"
                        values={{ count: commands.length }}
                        fallback={`Remove all ${commands.length} command${commands.length === 1 ? '' : 's'} from the list? Your saved autoexec.cfg won't change until you click Save.`}
                    />
                }
                confirmLabel={<Tx k="common.actions.clear" fallback="Clear" />}
                variant="danger"
            />
        </div>
    );
}
