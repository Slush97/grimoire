import { useState, useEffect, useRef } from 'react';
import { Copy, Check, RotateCcw, Crosshair as CrosshairIcon, Save, Trash2, Play } from 'lucide-react';
import { useCrosshairStore } from '../stores/crosshairStore';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
import { getSettings } from '../lib/api';
import { Card, Slider, Toggle, Button } from '../components/common/ui';

export default function Crosshair() {
    const [copied, setCopied] = useState(false);
    const [previewScale, setPreviewScale] = useState(1.5);
    const [presetName, setPresetName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [showSaveInput, setShowSaveInput] = useState(false);
    const [gamePath, setGamePath] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);

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
    }, [loadPresets]);

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
        // Create a simple thumbnail using SVG data URL
        const color = `rgb(${colorR}, ${colorG}, ${colorB})`;
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
                <rect width="100" height="100" fill="#1a1a1a"/>
                <rect x="${50 - pipWidth}" y="${50 - pipGap * 0.5 - pipHeight}" width="${pipWidth * 2}" height="${pipHeight}" fill="${color}" opacity="${pipOpacity}"/>
                <rect x="${50 - pipWidth}" y="${50 + pipGap * 0.5}" width="${pipWidth * 2}" height="${pipHeight}" fill="${color}" opacity="${pipOpacity}"/>
                <rect x="${50 - pipGap * 0.5 - pipHeight}" y="${50 - pipWidth}" width="${pipHeight}" height="${pipWidth * 2}" fill="${color}" opacity="${pipOpacity}"/>
                <rect x="${50 + pipGap * 0.5}" y="${50 - pipWidth}" width="${pipHeight}" height="${pipWidth * 2}" fill="${color}" opacity="${pipOpacity}"/>
                ${dotOpacity > 0 ? `<circle cx="50" cy="50" r="3" fill="${color}" opacity="${dotOpacity}"/>` : ''}
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
        <div className="flex flex-col h-full p-6 space-y-6 overflow-hidden">
            <div className="flex items-center gap-3 shrink-0">
                <div className="p-3 bg-accent/10 rounded-xl">
                    <CrosshairIcon className="w-8 h-8 text-accent" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold font-reaver tracking-wide">Crosshair Designer</h1>
                    <p className="text-text-secondary">Customize your in-game crosshair appearance</p>
                </div>
            </div>

            <div className="flex flex-1 gap-6 min-h-0">
                {/* Left Panel - Settings */}
                <div className="w-1/3 flex flex-col gap-6 overflow-y-auto pr-2">
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
                                    className="w-12 h-12 rounded cursor-pointer bg-transparent border-none"
                                />
                                <div className="font-mono text-xs text-text-secondary">
                                    RGB({colorR}, {colorG}, {colorB})
                                </div>
                            </div>
                            <Slider label="Red" value={colorR} min={0} max={255} onChange={setColorR} className="accent-red-500" />
                            <Slider label="Green" value={colorG} min={0} max={255} onChange={setColorG} className="accent-green-500" />
                            <Slider label="Blue" value={colorB} min={0} max={255} onChange={setColorB} className="accent-blue-500" />
                        </div>
                    </Card>
                </div>

                {/* Right Panel - Preview & Actions */}
                <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                    {/* Top Actions Bar */}
                    <div className="flex gap-4">
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
                                        {copied ? 'Copied code' : 'Copy Code'}
                                    </Button>
                                </div>
                                <div className="text-xs text-text-secondary">
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
                                        <button onClick={() => setShowSaveInput(false)} className="text-text-secondary hover:text-text-primary">
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
                    <Card className="relative" contentClassName="p-0">
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-black/40 backdrop-blur-md rounded-full px-3 py-1 border border-white/5">
                            <span className="text-xs text-text-secondary">Scale:</span>
                            <input
                                type="range"
                                min={0.5}
                                max={3}
                                step={0.1}
                                value={previewScale}
                                onChange={(e) => setPreviewScale(parseFloat(e.target.value))}
                                className="w-20 accent-accent"
                            />
                            <span className="font-mono text-xs w-8">{previewScale.toFixed(1)}x</span>
                        </div>

                        <div className="flex items-center justify-center bg-gradient-to-br from-bg-tertiary/50 to-bg-secondary/50 rounded-xl h-[420px]" ref={previewRef}>
                            <CrosshairPreview size={400} scale={previewScale} />
                        </div>
                    </Card>

                    {/* Presets Gallery */}
                    {presets.length > 0 && (
                        <Card title={`Saved Presets (${presets.length})`}>
                            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                                {presets.map((preset) => (
                                    <div
                                        key={preset.id}
                                        className={`group relative aspect-square rounded-lg border overflow-hidden transition-all bg-bg-tertiary ${preset.id === activePresetId ? 'border-accent ring-1 ring-accent' : 'border-white/5 hover:border-white/20'
                                            }`}
                                    >
                                        <img src={preset.thumbnail} alt={preset.name} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />

                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                                            <div className="text-xs font-bold text-center truncate w-full">{preset.name}</div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => loadSettingsFromPreset(preset)}
                                                    className="p-1.5 bg-white/10 hover:bg-white/20 rounded-md text-white"
                                                    title="Load"
                                                >
                                                    <RotateCcw className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={() => handleApplyPreset(preset.id)}
                                                    className="p-1.5 bg-accent hover:bg-accent-hover rounded-md text-white"
                                                    title="Apply to Game"
                                                >
                                                    <Play className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeletePreset(preset.id); }}
                                                    className="p-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-md"
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
