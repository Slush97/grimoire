import { useState, useEffect, useRef } from 'react';
import { Copy, Check, RotateCcw, Crosshair as CrosshairIcon, Save, Loader2 } from 'lucide-react';
import { useCrosshairStore, type CrosshairPreset } from '../stores/crosshairStore';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
import CrosshairPresetCard from '../components/crosshair/CrosshairPresetCard';
import { getSettings } from '../lib/api';

export default function Crosshair() {
    const [copied, setCopied] = useState(false);
    const [previewScale, setPreviewScale] = useState(1.3);
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

    const handleLoadPreset = (preset: CrosshairPreset) => {
        loadSettingsFromPreset(preset);
    };

    const handleDeletePreset = async (presetId: string) => {
        if (confirm('Delete this crosshair preset?')) {
            await deletePreset(presetId);
        }
    };

    return (
        <div className="flex flex-col flex-1 gap-6 p-6 overflow-auto">
            <div className="flex gap-6">
                {/* Left Panel - Settings */}
                <div className="flex-1 space-y-6 max-w-md">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <CrosshairIcon className="w-6 h-6 text-accent" />
                        <h1 className="text-2xl font-bold text-text-primary">Crosshair Designer</h1>
                    </div>

                    {/* Crosshair/Pip Settings */}
                    <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <h2 className="text-lg font-semibold text-text-primary mb-4">Crosshair</h2>
                        <div className="space-y-4">
                            <SliderControl
                                label="Gap"
                                value={pipGap}
                                min={-10}
                                max={50}
                                step={1}
                                onChange={setPipGap}
                            />
                            <SliderControl
                                label="Height"
                                value={pipHeight}
                                min={0}
                                max={50}
                                step={1}
                                onChange={setPipHeight}
                            />
                            <SliderControl
                                label="Width"
                                value={pipWidth}
                                min={0}
                                max={10}
                                step={0.5}
                                onChange={setPipWidth}
                            />
                            <SliderControl
                                label="Opacity"
                                value={pipOpacity}
                                min={0}
                                max={1}
                                step={0.05}
                                onChange={setPipOpacity}
                            />
                            <ToggleControl
                                label="Border"
                                checked={pipBorder}
                                onChange={setPipBorder}
                            />
                        </div>
                    </section>

                    {/* Dot Settings */}
                    <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <h2 className="text-lg font-semibold text-text-primary mb-4">Dot</h2>
                        <div className="space-y-4">
                            <SliderControl
                                label="Opacity"
                                value={dotOpacity}
                                min={0}
                                max={1}
                                step={0.05}
                                onChange={setDotOpacity}
                            />
                            <SliderControl
                                label="Outline Opacity"
                                value={dotOutlineOpacity}
                                min={0}
                                max={1}
                                step={0.05}
                                onChange={setDotOutlineOpacity}
                            />
                        </div>
                    </section>

                    {/* Color Settings */}
                    <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <h2 className="text-lg font-semibold text-text-primary mb-4">Color</h2>
                        <div className="space-y-4">
                            <div className="flex items-center gap-4">
                                <label className="text-sm text-text-secondary w-20">Color</label>
                                <input
                                    type="color"
                                    value={rgbToHex(colorR, colorG, colorB)}
                                    onChange={handleColorChange}
                                    className="w-12 h-8 rounded border border-border cursor-pointer"
                                />
                                <span className="text-sm text-text-secondary font-mono">
                                    RGB({colorR}, {colorG}, {colorB})
                                </span>
                            </div>
                            <SliderControl
                                label="Red"
                                value={colorR}
                                min={0}
                                max={255}
                                step={1}
                                onChange={setColorR}
                            />
                            <SliderControl
                                label="Green"
                                value={colorG}
                                min={0}
                                max={255}
                                step={1}
                                onChange={setColorG}
                            />
                            <SliderControl
                                label="Blue"
                                value={colorB}
                                min={0}
                                max={255}
                                step={1}
                                onChange={setColorB}
                            />
                        </div>
                    </section>
                </div>

                {/* Right Panel - Preview & Output */}
                <div className="flex-1 space-y-6 max-w-lg">
                    {/* Preview */}
                    <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-primary">Preview</h2>
                            <div className="flex items-center gap-2 text-xs text-text-secondary">
                                <span>Scale:</span>
                                <input
                                    type="range"
                                    min={0.5}
                                    max={3}
                                    step={0.1}
                                    value={previewScale}
                                    onChange={(e) => setPreviewScale(parseFloat(e.target.value))}
                                    className="w-20 accent-accent"
                                />
                                <span className="font-mono w-8">{previewScale.toFixed(1)}x</span>
                            </div>
                        </div>
                        <div className="flex justify-center" ref={previewRef}>
                            <CrosshairPreview size={250} scale={previewScale} />
                        </div>
                        <p className="mt-3 text-xs text-text-secondary text-center">
                            Adjust scale to match your in-game view
                        </p>
                    </section>

                    {/* Save Preset */}
                    <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-primary">Save Preset</h2>
                        </div>
                        {showSaveInput ? (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={presetName}
                                    onChange={(e) => setPresetName(e.target.value)}
                                    placeholder="Preset name..."
                                    className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                                    onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                                    autoFocus
                                />
                                <button
                                    onClick={handleSavePreset}
                                    disabled={isSaving || !presetName.trim()}
                                    className="flex items-center gap-1 px-3 py-2 text-sm bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded-lg transition-colors"
                                >
                                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Save
                                </button>
                                <button
                                    onClick={() => setShowSaveInput(false)}
                                    className="px-3 py-2 text-sm bg-bg-tertiary text-text-secondary rounded-lg hover:bg-bg-tertiary/80"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowSaveInput(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors"
                            >
                                <Save className="w-5 h-5" />
                                Save as Preset
                            </button>
                        )}
                    </section>

                    {/* Generated Commands */}
                    <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-primary">Console Commands</h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={reset}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary rounded-lg transition-colors"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                    Reset
                                </button>
                                <button
                                    onClick={handleCopy}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors"
                                >
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                        </div>
                        <div className="bg-black/50 rounded-lg p-3 font-mono text-sm text-text-secondary break-all">
                            {generateCommands()}
                        </div>
                        <p className="mt-3 text-xs text-text-secondary">
                            Paste this code in the game console (Default Key: F7)
                        </p>
                    </section>
                </div>
            </div>

            {/* Saved Presets Gallery */}
            {presets.length > 0 && (
                <section className="bg-bg-secondary rounded-xl p-4 border border-border">
                    <h2 className="text-lg font-semibold text-text-primary mb-4">
                        Saved Presets ({presets.length})
                    </h2>
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                        {presets.map((preset) => (
                            <CrosshairPresetCard
                                key={preset.id}
                                preset={preset}
                                isActive={preset.id === activePresetId}
                                onLoad={handleLoadPreset}
                                onApply={handleApplyPreset}
                                onDelete={handleDeletePreset}
                            />
                        ))}
                    </div>
                    {!gamePath && (
                        <p className="mt-3 text-xs text-yellow-500">
                            ⚠️ Configure your Deadlock game path in Settings to enable "Apply to game" functionality.
                        </p>
                    )}
                </section>
            )}
        </div>
    );
}

// Slider Control Component
interface SliderControlProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}

function SliderControl({ label, value, min, max, step, onChange }: SliderControlProps) {
    return (
        <div className="flex items-center gap-4">
            <label className="text-sm text-text-secondary w-20">{label}</label>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="flex-1 accent-accent"
            />
            <span className="text-sm text-text-primary w-12 text-right font-mono">
                {typeof value === 'number' && value % 1 !== 0 ? value.toFixed(2) : value}
            </span>
        </div>
    );
}

// Toggle Control Component
interface ToggleControlProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}

function ToggleControl({ label, checked, onChange }: ToggleControlProps) {
    return (
        <div className="flex items-center gap-4">
            <label className="text-sm text-text-secondary w-20">{label}</label>
            <button
                onClick={() => onChange(!checked)}
                className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-tertiary'
                    }`}
            >
                <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'
                        }`}
                />
            </button>
            <span className="text-sm text-text-primary">{checked ? 'On' : 'Off'}</span>
        </div>
    );
}
