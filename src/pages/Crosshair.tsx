import { useState, useEffect } from 'react';
import { Copy, Check, RotateCcw, Save, Trash2, Play, Pin, XCircle, Download } from 'lucide-react';
import { useCrosshairStore } from '../stores/crosshairStore';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
import { renderCrosshairThumbnail } from '../components/crosshair/drawCrosshair';
import { getSettings } from '../lib/api';
import { Card, Slider, Toggle, Button } from '../components/common/ui';

// The in-game crosshair is authored in 1080p-reference px and scaled by
// screen height, so the preview multiplies by (resolution / 1080).
const RESOLUTIONS = [
    { label: '1080p', height: 1080 },
    { label: '1440p', height: 1440 },
    { label: '4K', height: 2160 },
];

function detectResolutionHeight(): number {
    const h = window.screen.height * (window.devicePixelRatio || 1);
    if (h >= 2160) return 2160;
    if (h >= 1440) return 1440;
    return 1080;
}

export default function Crosshair() {
    const [copied, setCopied] = useState(false);
    const [imported, setImported] = useState(false);
    const [resolution, setResolution] = useState(detectResolutionHeight);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [presetName, setPresetName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [showSaveInput, setShowSaveInput] = useState(false);
    const [gamePath, setGamePath] = useState<string | null>(null);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);

    const {
        pipGap,
        pipGapStatic,
        pipHeight,
        pipWidth,
        pipOpacity,
        pipOutlineBorder,
        pipOutlineGap,
        pipOutlineOpacity,
        dotOpacity,
        dotSize,
        dotOutlineBorder,
        dotOutlineGap,
        dotOutlineOpacity,
        colorR,
        colorG,
        colorB,
        outlineColorR,
        outlineColorG,
        outlineColorB,
        disableHeroSpecificCrosshairs,
        setPipGap,
        setPipGapStatic,
        setPipHeight,
        setPipWidth,
        setPipOpacity,
        setPipOutlineBorder,
        setPipOutlineGap,
        setPipOutlineOpacity,
        setDotOpacity,
        setDotSize,
        setDotOutlineBorder,
        setDotOutlineGap,
        setDotOutlineOpacity,
        setColorR,
        setColorG,
        setColorB,
        setOutlineColor,
        setDisableHeroSpecificCrosshairs,
        reset,
        generateCommands,
        getSettings: getCrosshairSettings,
        importFromGame,
        presets,
        activePresetId,
        loadPresets,
        savePreset,
        deletePreset,
        applyPreset,
        loadSettingsFromPreset,
        clearAutoexec,
    } = useCrosshairStore();

    // Load presets and game path on mount
    useEffect(() => {
        loadPresets();
        getSettings().then((settings) => setGamePath(settings.deadlockPath));
        // Load always on top state
        window.electronAPI.getAlwaysOnTop().then(setAlwaysOnTop);
    }, [loadPresets]);

    const handleAlwaysOnTop = async (enabled: boolean) => {
        const result = await window.electronAPI.setAlwaysOnTop(enabled);
        setAlwaysOnTop(result);
    };

    const handleCopy = async () => {
        // One line, ';'-separated, so a single paste into the in-game console
        // (which only takes the first line) applies every command.
        const commands = generateCommands().split('\n').join('; ');
        await navigator.clipboard.writeText(commands);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const rgbToHex = (r: number, g: number, b: number) => {
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    };

    const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
        } : null;
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const hex = e.target.value;
        const rgb = hexToRgb(hex);
        if (rgb) {
            setColorR(rgb.r);
            setColorG(rgb.g);
            setColorB(rgb.b);
        }
    };

    const handleOutlineColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rgb = hexToRgb(e.target.value);
        if (rgb) {
            setOutlineColor(rgb.r, rgb.g, rgb.b);
        }
    };

    const handleImportFromGame = async () => {
        if (!gamePath) {
            alert('Please configure your Deadlock game path in Settings first.');
            return;
        }
        try {
            const found = await importFromGame(gamePath);
            if (found) {
                setImported(true);
                setTimeout(() => setImported(false), 2000);
            } else {
                alert('No crosshair settings found in the game config. Change any crosshair setting in-game once, then try again.');
            }
        } catch (error) {
            console.error('Failed to import crosshair from game:', error);
            alert('Failed to read the game config. Check the game path in Settings.');
        }
    };

    const handleSavePreset = async () => {
        if (!presetName.trim()) return;
        setIsSaving(true);
        try {
            const thumbnail = renderCrosshairThumbnail(getCrosshairSettings());
            await savePreset(presetName.trim(), thumbnail);
            setPresetName('');
            setShowSaveInput(false);
        } catch (error) {
            console.error('Failed to save preset:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleApplyPreset = async (presetId: string) => {
        if (!gamePath) {
            alert('Please configure your Deadlock game path in Settings first.');
            return;
        }
        try {
            await applyPreset(presetId, gamePath);
        } catch (error) {
            console.error('Failed to apply preset:', error);
            alert('Failed to apply preset. Make sure the game path is correct.');
        }
    };

    const handleDeletePreset = async (presetId: string) => {
        if (!confirm('Delete this crosshair preset?')) return;
        const wasActive = presetId === activePresetId;
        if (wasActive && gamePath) {
            try {
                await clearAutoexec(gamePath);
            } catch (error) {
                console.error('Failed to clear crosshair from autoexec:', error);
            }
        }
        await deletePreset(presetId);
    };

    const handleClearActive = async () => {
        if (!gamePath) {
            alert('Please configure your Deadlock game path in Settings first.');
            return;
        }
        if (!confirm('Remove the active crosshair from autoexec.cfg? Your saved presets will be kept.\n\nNote: an in-progress game session keeps its current crosshair until you restart the game.')) {
            return;
        }
        try {
            await clearAutoexec(gamePath);
        } catch (error) {
            console.error('Failed to clear crosshair:', error);
            alert('Failed to clear crosshair. Check the game path in Settings.');
        }
    };

    return (
        <div className="p-6 lg:p-0 lg:h-full">
            {/* On lg+ the page fills the viewport and each column scrolls
                independently, so the preview stays reachable while the long
                settings list scrolls. The columns carry the page padding so
                they tile the full area: no dead zones where the wheel does
                nothing. Below lg the page scrolls as one. */}
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-0 lg:h-full">
                {/* Left Panel - Settings */}
                {/* Both columns stack cards with space-y (block layout), not
                    flex-col: Card has overflow-hidden, and a height-bounded
                    flex column shrink-squeezes such children to fit instead
                    of overflowing, which clips the controls and leaves
                    nothing for overflow-y-auto to scroll. */}
                <div className="w-full lg:w-1/3 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:p-6">
                    <Card title="Crosshair Shape">
                        <div className="space-y-6">
                            <Slider editable label="Gap" value={pipGap} min={-10} max={50} onChange={setPipGap} />
                            <Slider editable label="Height" value={pipHeight} min={0} max={50} onChange={setPipHeight} />
                            <Slider editable label="Width" value={pipWidth} min={0} max={10} step={0.5} onChange={setPipWidth} />
                            <Slider editable label="Opacity" value={pipOpacity} min={0} max={1} step={0.05} onChange={setPipOpacity} />
                            <Slider editable label="Outline Width" value={pipOutlineBorder} min={0} max={5} onChange={setPipOutlineBorder} />
                            <Slider editable label="Outline Gap" value={pipOutlineGap} min={0} max={10} step={0.5} onChange={setPipOutlineGap} />
                            <Slider editable label="Outline Opacity" value={pipOutlineOpacity} min={0} max={1} step={0.05} onChange={setPipOutlineOpacity} />
                        </div>
                    </Card>

                    <Card title="Center Dot">
                        <div className="space-y-6">
                            <Slider editable label="Size" value={dotSize} min={0} max={20} step={0.5} onChange={setDotSize} />
                            <Slider editable label="Opacity" value={dotOpacity} min={0} max={1} step={0.05} onChange={setDotOpacity} />
                            <Slider editable label="Outline Width" value={dotOutlineBorder} min={0} max={5} onChange={setDotOutlineBorder} />
                            <Slider editable label="Outline Gap" value={dotOutlineGap} min={0} max={10} step={0.5} onChange={setDotOutlineGap} />
                            <Slider editable label="Outline Opacity" value={dotOutlineOpacity} min={0} max={1} step={0.05} onChange={setDotOutlineOpacity} />
                        </div>
                    </Card>

                    <Card title="In-Game Behavior">
                        <div className="space-y-4">
                            <Toggle
                                label="Static Gap"
                                description="Keep the gap fixed. When off, the in-game gap expands with weapon spread (not simulated in the preview)."
                                checked={pipGapStatic}
                                onChange={setPipGapStatic}
                            />
                            <Toggle
                                label="Disable Hero Crosshairs"
                                description="Some heroes override the crosshair with their own. Turn this on so your custom crosshair always wins."
                                checked={disableHeroSpecificCrosshairs}
                                onChange={setDisableHeroSpecificCrosshairs}
                            />
                        </div>
                    </Card>

                    <Card title="Color">
                        <div className="space-y-6">
                            <div className="flex items-center gap-4 p-3 bg-black/20 rounded-lg">
                                <input
                                    type="color"
                                    value={rgbToHex(colorR, colorG, colorB)}
                                    onChange={handleColorChange}
                                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-none"
                                />
                                <div className="font-mono text-xs text-text-secondary">
                                    RGB({colorR}, {colorG}, {colorB})
                                </div>
                            </div>
                            {/* Quick color presets */}
                            <div className="flex gap-2">
                                {[
                                    { label: 'White', r: 255, g: 255, b: 255 },
                                    { label: 'Green', r: 0, g: 255, b: 0 },
                                    { label: 'Cyan', r: 0, g: 255, b: 255 },
                                    { label: 'Yellow', r: 255, g: 255, b: 0 },
                                    { label: 'Red', r: 255, g: 0, b: 0 },
                                    { label: 'Magenta', r: 255, g: 0, b: 255 },
                                ].map((color) => (
                                    <button
                                        key={color.label}
                                        onClick={() => { setColorR(color.r); setColorG(color.g); setColorB(color.b); }}
                                        className="w-6 h-6 rounded-md border border-white/20 hover:border-white/50 transition-colors cursor-pointer"
                                        style={{ backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})` }}
                                        title={color.label}
                                    />
                                ))}
                            </div>
                            <Slider editable label="Red" value={colorR} min={0} max={255} onChange={setColorR} className="accent-red-500" />
                            <Slider editable label="Green" value={colorG} min={0} max={255} onChange={setColorG} className="accent-green-500" />
                            <Slider editable label="Blue" value={colorB} min={0} max={255} onChange={setColorB} className="accent-blue-500" />
                            <div className="flex items-center gap-4 p-3 bg-black/20 rounded-lg">
                                <input
                                    type="color"
                                    value={rgbToHex(outlineColorR, outlineColorG, outlineColorB)}
                                    onChange={handleOutlineColorChange}
                                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-none"
                                />
                                <div className="text-xs text-text-secondary">
                                    Outline color
                                    <span className="ml-2 font-mono">RGB({outlineColorR}, {outlineColorG}, {outlineColorB})</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Right Panel - Preview & Actions */}
                <div className="flex-1 space-y-6 min-w-0 lg:min-h-0 lg:overflow-y-auto lg:p-6 lg:pl-0">
                    {/* Top Actions Bar. The two cards share roughly half the
                        page, so they only sit side by side on wide windows;
                        contents wrap rather than clip when space runs out. */}
                    <div className="flex flex-col 2xl:flex-row gap-4">
                        <Card className="flex-1" contentClassName="p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button variant="secondary" onClick={reset} icon={RotateCcw} size="sm">Reset</Button>
                                    <Button
                                        variant={imported ? 'success' : 'secondary'}
                                        onClick={handleImportFromGame}
                                        icon={imported ? Check : Download}
                                        size="sm"
                                        title="Load your current in-game crosshair settings into the editor"
                                    >
                                        {imported ? 'Imported' : 'Import from Game'}
                                    </Button>
                                    <Button
                                        variant={copied ? 'success' : 'primary'}
                                        onClick={handleCopy}
                                        icon={copied ? Check : Copy}
                                        size="sm"
                                    >
                                        {copied ? 'Copied' : 'Copy Code'}
                                    </Button>
                                </div>
                                <div className="hidden sm:block text-xs text-text-secondary whitespace-nowrap">
                                    Press F7 in-game
                                </div>
                            </div>
                        </Card>

                        <Card className="flex-1" contentClassName="p-3">
                            <div className="flex items-center gap-2 h-full">
                                {showSaveInput ? (
                                    <>
                                        <input
                                            type="text"
                                            value={presetName}
                                            onChange={(e) => setPresetName(e.target.value)}
                                            placeholder="Name..."
                                            className="flex-1 px-3 py-1.5 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent min-w-0"
                                            onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                                            autoFocus
                                        />
                                        <Button
                                            onClick={handleSavePreset}
                                            disabled={!presetName.trim()}
                                            isLoading={isSaving}
                                            icon={Save}
                                            size="sm"
                                        >
                                            Save
                                        </Button>
                                        <button onClick={() => setShowSaveInput(false)} className="text-text-secondary hover:text-text-primary cursor-pointer">
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                    </>
                                ) : (
                                    <Button className="w-full" variant="secondary" onClick={() => setShowSaveInput(true)} icon={Save} size="sm">
                                        Save as New Preset
                                    </Button>
                                )}
                            </div>
                        </Card>
                    </div>

                    {/* Preview Area */}
                    <Card className="relative w-full" contentClassName="p-0">
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/5">
                            <select
                                value={resolution}
                                onChange={(e) => setResolution(parseInt(e.target.value, 10))}
                                title="Render the preview at this display resolution's in-game size"
                                className="bg-transparent text-xs text-text-secondary focus:outline-none cursor-pointer [&>option]:bg-bg-tertiary"
                            >
                                {RESOLUTIONS.map((r) => (
                                    <option key={r.height} value={r.height}>{r.label}</option>
                                ))}
                            </select>
                            <span className="text-xs text-text-secondary">Zoom:</span>
                            <div className="relative w-20 h-4 flex items-center">
                                <div className="absolute w-full h-1 bg-bg-tertiary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-accent"
                                        style={{ width: `${((previewZoom - 0.5) / 2.5) * 100}%` }}
                                    />
                                </div>
                                <input
                                    type="range"
                                    min={0.5}
                                    max={3}
                                    step={0.1}
                                    value={previewZoom}
                                    onChange={(e) => setPreviewZoom(parseFloat(e.target.value))}
                                    className="absolute w-full h-full opacity-0 cursor-pointer"
                                />
                                <div
                                    className="absolute h-3 w-3 bg-white rounded-full shadow-lg border border-accent pointer-events-none"
                                    style={{ left: `calc(${((previewZoom - 0.5) / 2.5) * 100}% - 6px)` }}
                                />
                            </div>
                            <span className="font-mono text-xs w-8">{previewZoom.toFixed(1)}x</span>
                        </div>

                        <div className="flex items-center justify-center bg-gradient-to-br from-bg-tertiary/50 to-bg-secondary/50 rounded-xl aspect-video lg:h-[420px] w-full overflow-hidden">
                            <CrosshairPreview size={400} scale={(resolution / 1080) * previewZoom} />
                        </div>

                        {/* Pin Window Control */}
                        <div className="p-4 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                            <p className="text-[10px] text-text-secondary italic">Preview approximates the in-game crosshair at the selected resolution. Dynamic spread bloom is not simulated.</p>
                            <Button
                                variant={alwaysOnTop ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => handleAlwaysOnTop(!alwaysOnTop)}
                                icon={Pin}
                                title="Keep the mod manager window on top of the game for quick adjustments"
                            >
                                {alwaysOnTop ? 'Pinned' : 'Pin Window'}
                            </Button>
                        </div>
                    </Card>

                    {/* Presets Gallery */}
                    {presets.length > 0 && (
                        <Card
                            title={`Saved Presets (${presets.length})`}
                            action={activePresetId ? (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleClearActive}
                                    icon={XCircle}
                                    title="Remove the active crosshair from autoexec.cfg (presets are kept)"
                                >
                                    Deselect Active
                                </Button>
                            ) : undefined}
                        >
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                                {presets.map((preset) => (
                                    <div
                                        key={preset.id}
                                        onClick={() => loadSettingsFromPreset(preset)}
                                        className={`group relative aspect-square rounded-lg border overflow-hidden transition-all bg-bg-tertiary cursor-pointer ${preset.id === activePresetId ? 'border-accent ring-1 ring-accent' : 'border-white/5 hover:border-white/20'
                                            }`}
                                    >
                                        <div className="w-full h-full flex items-center justify-center">
                                            <CrosshairPreview size={80} scale={1440 / 1080} settings={preset.settings} transparent />
                                        </div>

                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                                            <div className="text-xs font-bold text-center truncate w-full">{preset.name}</div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleApplyPreset(preset.id); }}
                                                    className="p-1.5 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 rounded-md text-text-primary cursor-pointer transition-colors"
                                                    title="Apply to Game"
                                                >
                                                    <Play className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeletePreset(preset.id); }}
                                                    className="p-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-md cursor-pointer"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
