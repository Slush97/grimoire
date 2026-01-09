import { useState, useEffect, useMemo } from 'react';
import { Terminal, Copy, Check, Plus, Trash2, RefreshCw, Zap, Globe, Layout, Map, Users, MousePointer2, Search, Save, AlertTriangle } from 'lucide-react';
import { getSettings } from '../lib/api';
import { Card, Badge, Button } from '../components/common/ui';

// Popular Deadlock autoexec command presets
const COMMAND_PRESETS = [
    {
        category: 'Performance',
        icon: Zap,
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
        icon: Globe,
        commands: [
            { name: 'Max Network Rate', command: 'rate 1000000', description: 'Maximum network update rate' },
        ],
    },
    {
        category: 'HUD & UI',
        icon: Layout,
        commands: [
            { name: 'New Health Bars', command: 'citadel_unit_status_use_new true', description: 'Enable new-style health bars' },
            { name: 'Hide HUD', command: 'citadel_hud_visible false', description: 'Hide the entire HUD' },
            { name: 'Show HUD', command: 'citadel_hud_visible true', description: 'Show the HUD' },
            { name: 'Disable Post-Match Survey', command: 'deadlock_post_match_survey_disabled true', description: 'Skip the survey after matches' },
        ],
    },
    {
        category: 'Minimap',
        icon: Map,
        commands: [
            { name: 'Faster Minimap', command: 'minimap_update_rate_hz 60', description: 'Update minimap at 60Hz' },
            { name: 'Larger Click Radius', command: 'citadel_minimap_unit_click_radius 200', description: 'Easier to click units on minimap' },
            { name: 'Larger Player Icons', command: 'citadel_minimap_player_width 6.5', description: 'Bigger player icons on minimap' },
            { name: 'Thicker Ziplines', command: 'citadel_minimap_zip_line_thickness 2', description: 'More visible ziplines' },
        ],
    },
    {
        category: 'Matchmaking',
        icon: Users,
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
        icon: MousePointer2,
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
    const [searchTerm, setSearchTerm] = useState('');
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

    const filteredPresets = useMemo(() => {
        if (!searchTerm) return COMMAND_PRESETS;
        const lowerSearch = searchTerm.toLowerCase();

        return COMMAND_PRESETS.map(cat => ({
            ...cat,
            commands: cat.commands.filter(cmd =>
                cmd.name.toLowerCase().includes(lowerSearch) ||
                cmd.command.toLowerCase().includes(lowerSearch) ||
                cmd.description.toLowerCase().includes(lowerSearch)
            )
        })).filter(cat => cat.commands.length > 0);
    }, [searchTerm]);

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
        <div className="flex flex-col min-h-0 flex-1 p-6 space-y-6 overflow-auto">
            <div className="flex items-center gap-3 shrink-0">
                <div className="p-3 bg-accent/10 rounded-xl">
                    <Terminal className="w-8 h-8 text-accent" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold font-reaver tracking-wide">Autoexec Commands</h1>
                    <p className="text-text-secondary">Manage startup commands and game configuration</p>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row flex-1 gap-6 min-h-0 overflow-auto">
                {/* Left Panel - Command Presets */}
                <div className="w-full lg:w-1/2 flex flex-col gap-4 overflow-hidden order-2 lg:order-1">
                    <div className="relative shrink-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search commands..."
                            className="w-full pl-10 pr-4 py-2.5 bg-bg-secondary border border-white/5 rounded-xl text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-text-secondary/50"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                        {/* Custom Command Input */}
                        <Card title="Custom Command">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={customCommand}
                                    onChange={(e) => setCustomCommand(e.target.value)}
                                    placeholder="e.g. fps_max 0"
                                    className="flex-1 px-3 py-2 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCustomCommand()}
                                />
                                <Button onClick={handleAddCustomCommand} disabled={!customCommand.trim()} icon={Plus} />
                            </div>
                        </Card>

                        {filteredPresets.map((category) => (
                            <Card key={category.category} title={category.category} icon={category.icon}>
                                <div className="space-y-1">
                                    {category.commands.map((cmd) => {
                                        const isAdded = commands.includes(cmd.command);
                                        return (
                                            <button
                                                key={cmd.command}
                                                onClick={() => handleAddCommand(cmd.command)}
                                                disabled={isAdded}
                                                className={`w-full text-left p-3 rounded-lg transition-all group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${isAdded
                                                    ? 'bg-accent/10 border border-accent/20 cursor-default opacity-60'
                                                    : 'bg-bg-tertiary/50 hover:bg-bg-tertiary border border-transparent hover:border-white/5'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className={`text-sm font-medium ${isAdded ? 'text-accent' : 'text-text-primary'}`}>
                                                        {cmd.name}
                                                    </span>
                                                    {isAdded && <Check className="w-3 h-3 text-accent" />}
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-text-secondary">
                                                    <span>{cmd.description}</span>
                                                    <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-text-primary/80">
                                                        {cmd.command}
                                                    </code>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>

                {/* Right Panel - Active Commands */}
                <div className="w-full lg:w-1/2 flex flex-col gap-4 overflow-hidden order-1 lg:order-2">
                    <Card
                        className="flex flex-col"
                        title={`Your Commands (${commands.length})`}
                        icon={Terminal}
                        action={
                            <div className="flex gap-2">
                                <Button size="sm" variant="secondary" onClick={handleClear} disabled={commands.length === 0} icon={RefreshCw}>
                                    Clear
                                </Button>
                                <Button size="sm" variant="secondary" onClick={handleCopy} disabled={commands.length === 0} icon={copied ? Check : Copy}>
                                    {copied ? 'Copied' : 'Copy'}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isSaving || !gamePath}
                                    isLoading={isSaving}
                                    icon={Save}
                                >
                                    Save
                                </Button>
                            </div>
                        }
                    >
                        {(saveMessage || hasUnsaved) && (
                            <div className="mb-3" role="status" aria-live="polite">
                                {saveMessage && (
                                    <div className={`text-xs flex items-center gap-2 p-2 rounded-lg border ${saveMessage.includes('Error') ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                                        {saveMessage.includes('Error') ? <AlertTriangle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                                        {saveMessage}
                                    </div>
                                )}
                                {hasUnsaved && !saveMessage && (
                                    <div className="text-xs text-yellow-400 flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                        <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                                        You have unsaved changes
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="overflow-y-auto space-y-2 pr-1 custom-scrollbar flex-1 min-h-0">
                            {commands.length > 0 ? (
                                commands.map((cmd, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-3 p-3 bg-bg-tertiary/50 border border-white/5 rounded-lg group hover:border-white/10 transition-colors animate-fade-in"
                                    >
                                        <div className="flex-1 font-mono text-sm text-text-primary truncate">
                                            {cmd}
                                        </div>
                                        <button
                                            onClick={() => handleRemoveCommand(i)}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-text-secondary hover:text-red-400 rounded transition-all"
                                            title="Remove"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <div className="flex items-center gap-3 py-6 text-text-secondary opacity-50">
                                    <Terminal className="w-6 h-6" />
                                    <div>
                                        <p className="text-sm font-medium">No commands added</p>
                                        <p className="text-xs">Select from presets on the left</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card title="Status" className="shrink-0">
                        <div className="flex justify-between items-center text-sm">
                            <div className="space-y-1">
                                <p className="text-text-secondary">File Status</p>
                                <div className="flex items-center gap-2">
                                    {status ? (
                                        status.exists ? (
                                            <Badge variant="success">Active</Badge>
                                        ) : (
                                            <Badge variant="warning">Missing</Badge>
                                        )
                                    ) : (
                                        <span className="text-text-secondary">Checking...</span>
                                    )}
                                </div>
                            </div>
                            {!gamePath && (
                                <div className="text-xs text-yellow-500 flex items-center gap-1 bg-yellow-500/10 px-3 py-2 rounded-lg">
                                    <AlertTriangle className="w-3 h-3" />
                                    Game path not configured
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
