import { useState, useEffect } from 'react';
import { FolderOpen, Wrench, Check, X, ArrowRight, Loader2, Terminal } from 'lucide-react';
import { Button, Badge } from './common/ui';
import {
    validateDeadlockPath,
    showOpenDialog,
    getGameinfoStatus,
    fixGameinfo,
    getSettings,
    setSettings,
} from '../lib/api';
import { useAppStore } from '../stores/appStore';

interface WelcomeModalProps {
    onComplete: () => void;
}

export default function WelcomeModal({ onComplete }: WelcomeModalProps) {
    const { detectDeadlock } = useAppStore();
    const [localPath, setLocalPath] = useState<string | null>(null);
    const [isValidPath, setIsValidPath] = useState<boolean | null>(null);
    const [isDetecting, setIsDetecting] = useState(true); // Start detecting immediately
    const [gameinfoStatus, setGameinfoStatus] = useState<string | null>(null);
    const [gameinfoConfigured, setGameinfoConfigured] = useState<boolean | null>(null);
    const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
    const [detectFailed, setDetectFailed] = useState(false);

    // Autoexec state
    const [autoexecStatus, setAutoexecStatus] = useState<{
        exists: boolean;
        path: string | null;
    } | null>(null);
    const [isCreatingAutoexec, setIsCreatingAutoexec] = useState(false);

    // Auto-detect on mount
    useEffect(() => {
        const runAutoDetect = async () => {
            setIsDetecting(true);
            try {
                const detected = await detectDeadlock();
                if (detected) {
                    setLocalPath(detected);
                    setIsValidPath(true);
                    // Save immediately
                    const settings = await getSettings();
                    await setSettings({ ...settings, deadlockPath: detected });
                } else {
                    setIsValidPath(false);
                    setDetectFailed(true);
                }
            } finally {
                setIsDetecting(false);
            }
        };

        runAutoDetect();
    }, [detectDeadlock]);

    // Check gameinfo and autoexec status when path changes
    useEffect(() => {
        if (!localPath || !isValidPath) {
            setGameinfoStatus(null);
            setGameinfoConfigured(null);
            setAutoexecStatus(null);
            return;
        }

        const checkStatus = async () => {
            try {
                // Check gameinfo
                const gameinfoResult = await getGameinfoStatus();
                setGameinfoStatus(gameinfoResult.message);
                setGameinfoConfigured(gameinfoResult.configured);

                // Check autoexec
                const autoexecResult = await window.electronAPI.getAutoexecStatus(localPath);
                setAutoexecStatus(autoexecResult);
            } catch (err) {
                setGameinfoStatus(String(err));
                setGameinfoConfigured(false);
            }
        };

        checkStatus();
    }, [localPath, isValidPath]);

    const handleBrowse = async () => {
        const selected = await showOpenDialog({
            directory: true,
            title: 'Select Deadlock Installation Folder',
        });

        if (selected) {
            setLocalPath(selected);
            const valid = await validateDeadlockPath(selected);
            setIsValidPath(valid);

            if (valid) {
                const settings = await getSettings();
                await setSettings({ ...settings, deadlockPath: selected });
                setDetectFailed(false);
            } else {
                setDetectFailed(true);
            }
        }
    };

    const handleFixGameinfo = async () => {
        setIsFixingGameinfo(true);
        try {
            const result = await fixGameinfo();
            setGameinfoStatus(result.message);
            setGameinfoConfigured(result.configured);
        } catch (err) {
            setGameinfoStatus(String(err));
            setGameinfoConfigured(false);
        } finally {
            setIsFixingGameinfo(false);
        }
    };

    const handleCreateAutoexec = async () => {
        if (!localPath) return;
        setIsCreatingAutoexec(true);
        try {
            await window.electronAPI.createAutoexec(localPath);
            const newStatus = await window.electronAPI.getAutoexecStatus(localPath);
            setAutoexecStatus(newStatus);
        } catch (err) {
            console.error('Failed to create autoexec:', err);
        } finally {
            setIsCreatingAutoexec(false);
        }
    };

    const canProceed = isValidPath && gameinfoConfigured;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-scale-in">
                {/* Header */}
                <div className="p-6 pb-4 text-center">
                    <h1
                        className="text-3xl text-accent mb-1"
                        style={{ fontFamily: "'IM Fell English', serif" }}
                    >
                        Welcome to Grimoire
                    </h1>
                    <p className="text-sm text-text-secondary">
                        Let's set up your mod manager
                    </p>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                    {/* Step 1: Game Path */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">1</span>
                                Deadlock Location
                            </h3>
                            {isDetecting && (
                                <Badge variant="neutral"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Detecting...</Badge>
                            )}
                            {!isDetecting && isValidPath === true && (
                                <Badge variant="success"><Check className="w-3 h-3 mr-1" />Detected</Badge>
                            )}
                            {!isDetecting && isValidPath === false && (
                                <Badge variant="error"><X className="w-3 h-3 mr-1" />Not Found</Badge>
                            )}
                        </div>

                        {localPath && isValidPath && (
                            <div className="text-xs font-mono bg-black/30 p-2 rounded text-text-secondary break-all ml-7">
                                {localPath}
                            </div>
                        )}

                        {/* Help text when auto-detect fails */}
                        {detectFailed && !isDetecting && (
                            <div className="ml-7 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <p className="text-xs text-yellow-200 mb-2">
                                    Couldn't auto-detect. Browse to your Steam library:
                                </p>
                                <code className="block text-xs text-text-secondary font-mono mb-2">
                                    steamapps/common/Deadlock
                                </code>
                                <Button
                                    onClick={handleBrowse}
                                    variant="secondary"
                                    size="sm"
                                    icon={FolderOpen}
                                >
                                    Browse
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Step 2: Gameinfo Configuration */}
                    <div className={`space-y-2 transition-opacity ${isValidPath ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">2</span>
                                Game Files
                            </h3>
                            {gameinfoConfigured === true && (
                                <Badge variant="success"><Check className="w-3 h-3 mr-1" />Ready</Badge>
                            )}
                            {gameinfoConfigured === false && (
                                <Badge variant="warning">Needs Setup</Badge>
                            )}
                            {gameinfoConfigured === null && isValidPath && (
                                <Badge variant="neutral"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Checking...</Badge>
                            )}
                        </div>

                        {gameinfoConfigured === false && (
                            <div className="ml-7 flex items-center gap-3">
                                <p className="text-xs text-text-secondary flex-1">
                                    gameinfo.gi needs to be configured for mods to load.
                                </p>
                                <Button
                                    onClick={handleFixGameinfo}
                                    disabled={isFixingGameinfo}
                                    isLoading={isFixingGameinfo}
                                    size="sm"
                                    icon={Wrench}
                                >
                                    Fix
                                </Button>
                            </div>
                        )}

                        {gameinfoConfigured === true && (
                            <p className="ml-7 text-xs text-green-400">
                                {gameinfoStatus}
                            </p>
                        )}
                    </div>

                    {/* Step 3: Autoexec (optional info) */}
                    <div className={`space-y-2 transition-opacity ${isValidPath && gameinfoConfigured ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">3</span>
                                Autoexec
                            </h3>
                            {autoexecStatus?.exists && (
                                <Badge variant="success"><Check className="w-3 h-3 mr-1" />Found</Badge>
                            )}
                            {autoexecStatus && !autoexecStatus.exists && (
                                <Badge variant="neutral">Optional</Badge>
                            )}
                        </div>

                        <div className="ml-7">
                            {autoexecStatus?.exists ? (
                                <p className="text-xs text-text-secondary">
                                    Existing autoexec.cfg found. Your settings will be preserved.
                                </p>
                            ) : autoexecStatus ? (
                                <div className="flex items-center gap-3">
                                    <p className="text-xs text-text-secondary flex-1">
                                        Create autoexec.cfg for crosshairs and console commands.
                                    </p>
                                    <Button
                                        onClick={handleCreateAutoexec}
                                        disabled={isCreatingAutoexec}
                                        isLoading={isCreatingAutoexec}
                                        variant="secondary"
                                        size="sm"
                                        icon={Terminal}
                                    >
                                        Create
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 bg-bg-tertiary/30">
                    <Button
                        onClick={onComplete}
                        disabled={!canProceed}
                        icon={ArrowRight}
                        className="w-full justify-center"
                    >
                        Get Started
                    </Button>
                    <div className="flex justify-center mt-3">
                        <button
                            onClick={onComplete}
                            className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                            Skip for now
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
