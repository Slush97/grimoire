import { useState, useEffect } from 'react';
import { Terminal, Copy, Check, Plus, Trash2, RefreshCw } from 'lucide-react';
import { getSettings } from '../lib/api';

// Popular Deadlock autoexec command presets
const COMMAND_PRESETS = [
    {
        category: 'Performance',
        commands: [
            { name: 'Uncap FPS', command: 'fps_max 0', description: 'Remove framerate limit' },
            { name: 'Cap FPS 144', command: 'fps_max 144', description: 'Cap to 144 FPS' },
            { name: 'Cap FPS 240', command: 'fps_max 240', description: 'Cap to 240 FPS' },
            { name: 'Low Latency (Nvidia)', command: 'r_low_latency 2', description: 'Enable Nvidia Reflex low latency' },
            { name: 'Engine Low Latency', command: 'engine_low_latency_sleep_after_client_tick true', description: 'Reduce input lag' },
        ],
    },
    {
        category: 'Network',
        commands: [
            { name: 'Max Network Rate', command: 'rate 1000000', description: 'Maximum network update rate' },
        ],
    },
    {
        category: 'HUD & UI',
        commands: [
            { name: 'New Health Bars', command: 'citadel_unit_status_use_new true', description: 'Enable new-style health bars' },
            { name: 'Hide HUD', command: 'citadel_hud_visible false', description: 'Hide the entire HUD' },
            { name: 'Show HUD', command: 'citadel_hud_visible true', description: 'Show the HUD' },
            { name: 'Disable Post-Match Survey', command: 'deadlock_post_match_survey_disabled true', description: 'Skip the survey after matches' },
        ],
    },
    {
        category: 'Minimap',
        commands: [
            { name: 'Faster Minimap', command: 'minimap_update_rate_hz 60', description: 'Update minimap at 60Hz' },
            { name: 'Larger Click Radius', command: 'citadel_minimap_unit_click_radius 200', description: 'Easier to click units on minimap' },
            { name: 'Larger Player Icons', command: 'citadel_minimap_player_width 6.5', description: 'Bigger player icons on minimap' },
            { name: 'Thicker Ziplines', command: 'citadel_minimap_zip_line_thickness 2', description: 'More visible ziplines' },
        ],
    },
    {
        category: 'Matchmaking',
        commands: [
            { name: 'Solo Queue Only', command: 'mm_prefer_solo_only 1', description: 'Prefer matches with solo players' },
            { name: 'NA Region', command: 'citadel_region_override 0', description: 'Force North America servers' },
            { name: 'EU Region', command: 'citadel_region_override 1', description: 'Force Europe servers' },
            { name: 'Asia Region', command: 'citadel_region_override 2', description: 'Force Asia servers' },
            { name: 'Auto Region', command: 'citadel_region_override -1', description: 'Automatic region selection' },
        ],
    },
    {
        category: 'Mouse & Sensitivity',
        commands: [
            { name: '1:1 ADS Sensitivity', command: 'zoom_sensitivity_ratio 0.818933027098955175', description: 'Match ADS to hip-fire sensitivity' },
        ],
    },
];

interface AutoexecStatus {
    exists: boolean;
    path: string | null;
    hasCrosshairSettings: boolean;
}

export default function Autoexec() {
    const [gamePath, setGamePath] = useState<string | null>(null);
    const [status, setStatus] = useState<AutoexecStatus | null>(null);
    const [commands, setCommands] = useState<string[]>([]);
    const [customCommand, setCustomCommand] = useState('');
    const [copied, setCopied] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [hasUnsaved, setHasUnsaved] = useState(false);

    // Load game path, autoexec status, and existing commands
    useEffect(() => {
        const load = async () => {
            const settings = await getSettings();
            setGamePath(settings.deadlockPath);
            if (settings.deadlockPath) {
                const s = await window.electronAPI.getAutoexecStatus(settings.deadlockPath);
                setStatus(s);

                const result = await window.electronAPI.getAutoexecCommands(settings.deadlockPath);
                if (result.commands.length > 0) {
                    setCommands(result.commands);
                }
            }
        };
        load();
    }, []);

    const handleAddCommand = (command: string) => {
        if (commands.includes(command)) return;
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
        await navigator.clipboard.writeText(commands.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSave = async () => {
        if (!gamePath) {
            setSaveMessage('Game path not configured');
            return;
        }
        setIsSaving(true);
        setSaveMessage(null);
        try {
            await window.electronAPI.saveAutoexecCommands(gamePath, commands);
            setSaveMessage('Saved to autoexec.cfg!');
            setHasUnsaved(false);
            // Refresh status
            const s = await window.electronAPI.getAutoexecStatus(gamePath);
            setStatus(s);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (err) {
            setSaveMessage(`Error: ${err}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleClear = () => {
        setCommands([]);
        setHasUnsaved(true);
    };

    return (
        <div className="flex flex-1 gap-6 p-6 overflow-auto">
            {/* Left Panel - Command Presets */}
            <div className="flex-1 space-y-4 max-w-md overflow-auto">
                <div className="flex items-center gap-3">
                    <Terminal className="w-6 h-6 text-accent" />
                    <h1 className="text-2xl font-bold text-text-primary">Autoexec Commands</h1>
                </div>

                <p className="text-sm text-text-secondary">
                    Click on commands to add them to your autoexec.cfg
                </p>

                {COMMAND_PRESETS.map((category) => (
                    <section key={category.category} className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <h2 className="text-sm font-semibold text-text-primary mb-3">{category.category}</h2>
                        <div className="space-y-2">
                            {category.commands.map((cmd) => (
                                <button
                                    key={cmd.command}
                                    onClick={() => handleAddCommand(cmd.command)}
                                    className={`w-full text-left p-2 rounded-lg transition-colors ${commands.includes(cmd.command)
                                        ? 'bg-accent/20 border border-accent/50'
                                        : 'bg-bg-tertiary hover:bg-bg-tertiary/80 border border-transparent'
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-text-primary">{cmd.name}</span>
                                        {commands.includes(cmd.command) && (
                                            <Check className="w-4 h-4 text-accent" />
                                        )}
                                    </div>
                                    <code className="text-xs text-text-secondary font-mono">{cmd.command}</code>
                                </button>
                            ))}
                        </div>
                    </section>
                ))}

                {/* Custom Command Input */}
                <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                    <h2 className="text-sm font-semibold text-text-primary mb-3">Custom Command</h2>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={customCommand}
                            onChange={(e) => setCustomCommand(e.target.value)}
                            placeholder="Enter custom command..."
                            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCustomCommand()}
                        />
                        <button
                            onClick={handleAddCustomCommand}
                            disabled={!customCommand.trim()}
                            className="px-3 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded-lg transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </section>
            </div>

            {/* Right Panel - Current Commands */}
            <div className="flex-1 space-y-4 max-w-lg">
                <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-text-primary">
                            Your Commands ({commands.length})
                            {hasUnsaved && <span className="ml-2 text-xs text-yellow-400">• unsaved</span>}
                        </h2>
                        <div className="flex gap-2">
                            <button
                                onClick={handleClear}
                                disabled={commands.length === 0}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary rounded-lg transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Clear
                            </button>
                            <button
                                onClick={handleCopy}
                                disabled={commands.length === 0}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary rounded-lg transition-colors disabled:opacity-50"
                            >
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !gamePath}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded-lg transition-colors"
                            >
                                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                {isSaving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>

                    {saveMessage && (
                        <div className={`mb-3 text-sm ${saveMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
                            {saveMessage}
                        </div>
                    )}

                    {commands.length > 0 ? (
                        <div className="space-y-1">
                            {commands.map((cmd, i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between gap-2 p-2 bg-black/30 rounded-lg group"
                                >
                                    <code className="text-sm text-text-secondary font-mono flex-1 truncate">
                                        {cmd}
                                    </code>
                                    <button
                                        onClick={() => handleRemoveCommand(i)}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-400" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-text-secondary">
                            <Terminal className="w-12 h-12 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No commands added yet</p>
                            <p className="text-xs">Click on commands from the left to add them</p>
                        </div>
                    )}
                </section>

                {/* Status and Instructions */}
                <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                    <h2 className="text-sm font-semibold text-text-primary mb-3">How to Use</h2>
                    <ol className="text-xs text-text-secondary space-y-2 list-decimal list-inside">
                        <li>Select commands from the presets on the left</li>
                        <li>Click "Copy" to copy all commands</li>
                        <li>Open your game folder: <code className="bg-bg-tertiary px-1 rounded">game/citadel/cfg/autoexec.cfg</code></li>
                        <li>Paste the commands into the file</li>
                        <li>Add <code className="bg-bg-tertiary px-1 rounded text-accent">+exec autoexec</code> to Steam launch options</li>
                    </ol>

                    {!gamePath && (
                        <p className="mt-3 text-xs text-yellow-500">
                            ⚠️ Configure your Deadlock game path in Settings first.
                        </p>
                    )}

                    {status && (
                        <p className="mt-3 text-xs text-text-secondary">
                            {status.exists ? (
                                <span className="text-green-400">✓ autoexec.cfg found</span>
                            ) : (
                                <span className="text-yellow-400">✗ autoexec.cfg not found (will be created)</span>
                            )}
                        </p>
                    )}
                </section>
            </div>
        </div>
    );
}
