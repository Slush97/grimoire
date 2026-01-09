import { useState, useEffect, useRef } from 'react';
import { Copy, Check, RotateCcw, Crosshair as CrosshairIcon, Save, Trash2, Play, Pin } from 'lucide-react';
import { useCrosshairStore } from '../stores/crosshairStore';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
import { getSettings } from '../lib/api';
import { Card, Slider, Toggle, Button } from '../components/common/ui';

export default function Crosshair() {
    const [copied, setCopied] = useState(false);
    const [previewScale, setPreviewScale] = useState(1.3); // 1.3 matches 1440p in-game
    const [presetName, setPresetName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [showSaveInput, setShowSaveInput] = useState(false);
    const [gamePath, setGamePath] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);

    const {
        pipGap,
        pipHeight,
        pipWidth,
        pipOpacity,
        pipBorder,
        dotOpacity,
        dotOutlineOpacity,
        colorR,
        colorG,
        colorB,
        setPipGap,
        setPipHeight,
        setPipWidth,
        setPipOpacity,
        setPipBorder,
        setDotOpacity,
        setDotOutlineOpacity,
        setColorR,
        setColorG,
        setColorB,
        reset,
        generateCommands,
        presets,
        activePresetId,
        loadPresets,
        savePreset,
        deletePreset,
        applyPreset,
        loadSettingsFromPreset,
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
        const commands = generateCommands();
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

    const generateThumbnail = (): string => {
        // Create thumbnail using same formula as CrosshairPreview
        // Scale proportionally: preview is 400px, thumbnail viewBox is 100
        const baseGap = 9;
        const gapMultiplier = 2.5;
        const scale = 1.3;
        const scaleFactor = 100 / 400; // Match proportions of 400px preview

        const lineGap = (baseGap + pipGap * gapMultiplier) * scale * scaleFactor;
        const lineWidth = pipWidth * scale * scaleFactor;
        const lineHeight = pipHeight * scale * scaleFactor;
        const halfGap = lineGap / 2;
        const center = 50;

        // Use rgba like CrosshairPreview does
        const pipColor = `rgba(${colorR}, ${colorG}, ${colorB}, ${pipOpacity})`;
        const dotFillColor = `rgba(${colorR}, ${colorG}, ${colorB}, ${dotOpacity})`;

        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
                <rect width="100" height="100" fill="#555"/>
                <!-- Top pip - centered at (center, center - halfGap) -->
                <rect x="${center - lineWidth / 2}" y="${center - halfGap - lineHeight / 2}" width="${lineWidth}" height="${lineHeight}" fill="${pipColor}"${pipBorder ? ' stroke="black" stroke-width="0.25"' : ''}/>
                <!-- Bottom pip - centered at (center, center + halfGap) -->
                <rect x="${center - lineWidth / 2}" y="${center + halfGap - lineHeight / 2}" width="${lineWidth}" height="${lineHeight}" fill="${pipColor}"${pipBorder ? ' stroke="black" stroke-width="0.25"' : ''}/>
                <!-- Left pip - centered at (center - halfGap, center) -->
                <rect x="${center - halfGap - lineHeight / 2}" y="${center - lineWidth / 2}" width="${lineHeight}" height="${lineWidth}" fill="${pipColor}"${pipBorder ? ' stroke="black" stroke-width="0.25"' : ''}/>
                <!-- Right pip - centered at (center + halfGap, center) -->
                <rect x="${center + halfGap - lineHeight / 2}" y="${center - lineWidth / 2}" width="${lineHeight}" height="${lineWidth}" fill="${pipColor}"${pipBorder ? ' stroke="black" stroke-width="0.25"' : ''}/>
                ${dotOpacity > 0 ? `<circle cx="${center}" cy="${center}" r="${2 * scale * scaleFactor}" fill="${dotFillColor}"/>` : ''}
                ${dotOutlineOpacity > 0 ? `<circle cx="${center}" cy="${center}" r="${7 * scale * scaleFactor / 2}" fill="rgba(0,0,0,${dotOutlineOpacity})"/>` : ''}
            </svg>
        `;
        return `data:image/svg+xml;base64,${btoa(svg)}`;
    };

    const handleSavePreset = async () => {
        if (!presetName.trim()) return;
        setIsSaving(true);
        try {
            const thumbnail = generateThumbnail();
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
        if (confirm('Delete this crosshair preset?')) {
            await deletePreset(presetId);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-3 bg-accent/10 rounded-xl">
                    <CrosshairIcon className="w-8 h-8 text-accent" />
                </div>
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold font-reaver tracking-wide">Crosshair Designer</h1>
                    <p className="text-sm text-text-secondary">Customize your in-game crosshair appearance</p>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
                {/* Left Panel - Settings */}
                <div className="w-full lg:w-1/3 flex flex-col gap-6">
                    <Card title="Crosshair Shape">
                        <div className="space-y-6">
                            <Slider label="Gap" value={pipGap} min={-10} max={50} onChange={setPipGap} />
                            <Slider label="Height" value={pipHeight} min={0} max={50} onChange={setPipHeight} />
                            <Slider label="Width" value={pipWidth} min={0} max={10} step={0.5} onChange={setPipWidth} />
                            <Slider label="Opacity" value={pipOpacity} min={0} max={1} step={0.05} onChange={setPipOpacity} />
                            <Toggle label="Outline Border" checked={pipBorder} onChange={setPipBorder} />
                        </div>
                    </Card>

                    <Card title="Center Dot">
                        <div className="space-y-6">
                            <Slider label="Opacity" value={dotOpacity} min={0} max={1} step={0.05} onChange={setDotOpacity} />
                            <Slider label="Outline Opacity" value={dotOutlineOpacity} min={0} max={1} step={0.05} onChange={setDotOutlineOpacity} />
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
                            <Slider label="Red" value={colorR} min={0} max={255} onChange={setColorR} className="accent-red-500" />
                            <Slider label="Green" value={colorG} min={0} max={255} onChange={setColorG} className="accent-green-500" />
                            <Slider label="Blue" value={colorB} min={0} max={255} onChange={setColorB} className="accent-blue-500" />
                        </div>
                    </Card>
                </div>

                {/* Right Panel - Preview & Actions */}
                <div className="flex-1 flex flex-col gap-6 min-w-0">
                    {/* Top Actions Bar */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        <Card className="flex-1" contentClassName="p-3">
                            <div className="flex items-center justify-between gap-3 h-full">
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" onClick={reset} icon={RotateCcw} size="sm">Reset</Button>
                                    <Button
                                        variant={copied ? 'success' : 'primary'}
                                        onClick={handleCopy}
                                        icon={copied ? Check : Copy}
                                        size="sm"
                                    >
                                        {copied ? 'Copied' : 'Copy Code'}
                                    </Button>
                                </div>
                                <div className="hidden sm:block text-xs text-text-secondary">
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
                            <span className="text-xs text-text-secondary">Scale:</span>
                            <div className="relative w-20 h-4 flex items-center">
                                <div className="absolute w-full h-1 bg-bg-tertiary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-accent"
                                        style={{ width: `${((previewScale - 0.5) / 2.5) * 100}%` }}
                                    />
                                </div>
                                <input
                                    type="range"
                                    min={0.5}
                                    max={3}
                                    step={0.1}
                                    value={previewScale}
                                    onChange={(e) => setPreviewScale(parseFloat(e.target.value))}
                                    className="absolute w-full h-full opacity-0 cursor-pointer"
                                />
                                <div
                                    className="absolute h-3 w-3 bg-white rounded-full shadow-lg border border-accent pointer-events-none"
                                    style={{ left: `calc(${((previewScale - 0.5) / 2.5) * 100}% - 6px)` }}
                                />
                            </div>
                            <span className="font-mono text-xs w-8">{previewScale.toFixed(1)}x</span>
                        </div>

                        <div
                            className="flex items-center justify-center bg-gradient-to-br from-bg-tertiary/50 to-bg-secondary/50 rounded-xl aspect-video lg:h-[420px] w-full overflow-hidden"
                            ref={previewRef}
                            onWheel={(e) => {
                                e.preventDefault();
                                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                                setPreviewScale((prev) => Math.min(3, Math.max(0.5, prev + delta)));
                            }}
                        >
                            <CrosshairPreview size={400} scale={previewScale} />
                        </div>

                        {/* Pin Window Control */}
                        <div className="p-4 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                            <p className="text-[10px] text-text-secondary italic">Using verified formula from deadlock-crosshair project</p>
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
                        <Card title={`Saved Presets (${presets.length})`}>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                                {presets.map((preset) => (
                                    <div
                                        key={preset.id}
                                        onClick={() => loadSettingsFromPreset(preset)}
                                        className={`group relative aspect-square rounded-lg border overflow-hidden transition-all bg-bg-tertiary cursor-pointer ${preset.id === activePresetId ? 'border-accent ring-1 ring-accent' : 'border-white/5 hover:border-white/20'
                                            }`}
                                    >
                                        <div className="w-full h-full flex items-center justify-center">
                                            <CrosshairPreview size={80} scale={1.3} settings={preset.settings} transparent />
                                        </div>

                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                                            <div className="text-xs font-bold text-center truncate w-full">{preset.name}</div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleApplyPreset(preset.id); }}
                                                    className="p-1.5 bg-accent hover:bg-accent-hover rounded-md text-white cursor-pointer"
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
