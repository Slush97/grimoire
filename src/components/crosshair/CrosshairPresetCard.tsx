import { Trash2, Play, Edit3, Check } from 'lucide-react';
import type { CrosshairPreset } from '../../stores/crosshairStore';

interface CrosshairPresetCardProps {
    preset: CrosshairPreset;
    isActive: boolean;
    onLoad: (preset: CrosshairPreset) => void;
    onApply: (presetId: string) => void;
    onDelete: (presetId: string) => void;
}

export default function CrosshairPresetCard({
    preset,
    isActive,
    onLoad,
    onApply,
    onDelete,
}: CrosshairPresetCardProps) {
    return (
        <div
            className={`relative group rounded-lg border overflow-hidden transition-all ${isActive
                    ? 'border-accent bg-accent/10 ring-2 ring-accent/50'
                    : 'border-border bg-bg-secondary hover:border-accent/50'
                }`}
        >
            {/* Thumbnail */}
            <div className="relative aspect-square bg-black/50">
                {preset.thumbnail ? (
                    <img
                        src={preset.thumbnail}
                        alt={preset.name}
                        className="w-full h-full object-contain"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-secondary">
                        No preview
                    </div>
                )}

                {/* Active indicator */}
                {isActive && (
                    <div className="absolute top-2 right-2 bg-accent rounded-full p-1">
                        <Check className="w-3 h-3 text-white" />
                    </div>
                )}

                {/* Hover actions */}
                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                        onClick={() => onLoad(preset)}
                        className="p-2 rounded-full bg-bg-tertiary hover:bg-accent text-text-primary hover:text-white transition-colors"
                        title="Load into editor"
                    >
                        <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onApply(preset.id)}
                        className="p-2 rounded-full bg-accent hover:bg-accent/80 text-white transition-colors"
                        title="Apply to game"
                    >
                        <Play className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onDelete(preset.id)}
                        className="p-2 rounded-full bg-bg-tertiary hover:bg-red-500 text-text-primary hover:text-white transition-colors"
                        title="Delete"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Name */}
            <div className="p-2 text-center">
                <p className="text-sm text-text-primary truncate" title={preset.name}>
                    {preset.name}
                </p>
                {isActive && (
                    <p className="text-xs text-accent mt-0.5">Active</p>
                )}
            </div>
        </div>
    );
}
