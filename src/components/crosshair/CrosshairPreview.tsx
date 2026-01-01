import { useCrosshairStore } from '../../stores/crosshairStore';

export interface CrosshairSettings {
    pipGap: number;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    pipBorder: boolean;
    dotOpacity: number;
    dotOutlineOpacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
}

interface CrosshairPreviewProps {
    size?: number;
    scale?: number;
    // Optional override settings (for displaying saved profiles)
    settings?: CrosshairSettings;
    // Render with transparent background instead of gray
    transparent?: boolean;
}

// Based on https://github.com/mcipenuks/deadlock-crosshair with adjusted gap formula

export default function CrosshairPreview({ size = 200, scale = 1, settings, transparent }: CrosshairPreviewProps) {
    const storeSettings = useCrosshairStore();

    // Use provided settings or fall back to store
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
    } = settings || storeSettings;

    const crosshairColor = `rgba(${colorR}, ${colorG}, ${colorB}, ${pipOpacity})`;
    const dotColor = `rgba(${colorR}, ${colorG}, ${colorB}, ${dotOpacity})`;

    // Gap formula - calibrated to match in-game behavior
    const baseGap = 9;
    const gapMultiplier = 2.5;
    const lineGap = (baseGap + pipGap * gapMultiplier) * scale;
    const lineWidth = pipWidth * scale;
    const lineHeight = pipHeight * scale;
    const noWidthOrHeight = pipWidth === 0 || pipHeight === 0;

    // Pip style with box-sizing: border-box so border is INSIDE the dimensions
    const pipStyle = (width: number, height: number): React.CSSProperties => ({
        display: noWidthOrHeight ? 'none' : 'block',
        boxSizing: 'border-box',
        width,
        height,
        background: crosshairColor,
        border: pipBorder ? '1px solid black' : 'none',
    });

    // Dot dimensions - in-game dot is about 2x2px (smaller than before)
    const dotSize = 2 * scale;
    // Outline is about 7x7 in-game - renders BEHIND the pips
    const outlineSize = 7 * scale;

    return (
        <div
            className="relative rounded-lg overflow-hidden"
            style={{
                width: size,
                height: size,
                backgroundColor: transparent ? 'transparent' : '#555',
            }}
        >
            {/* Center container for crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                {/* Dot outline - BOTTOM LAYER (behind pips) - z-index 0 */}
                {dotOutlineOpacity > 0 && (
                    <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{
                            zIndex: 0,
                            width: outlineSize,
                            height: outlineSize,
                            background: `rgba(0,0,0,${dotOutlineOpacity})`,
                        }}
                    />
                )}

                {/* Pip container - MIDDLE LAYER - z-index 1 */}
                <div
                    className="relative flex justify-center items-center"
                    style={{
                        zIndex: 1,
                        height: lineGap,
                        width: lineGap,
                    }}
                >
                    {/* Bottom pip */}
                    <div
                        className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={pipStyle(lineWidth, lineHeight)}
                    />
                    {/* Right pip */}
                    <div
                        className="absolute left-full top-1/2 -translate-y-1/2 -translate-x-1/2"
                        style={pipStyle(lineHeight, lineWidth)}
                    />
                    {/* Left pip */}
                    <div
                        className="absolute right-full top-1/2 -translate-y-1/2 translate-x-1/2"
                        style={pipStyle(lineHeight, lineWidth)}
                    />
                    {/* Top pip */}
                    <div
                        className="absolute bottom-full left-1/2 -translate-x-1/2 translate-y-1/2"
                        style={pipStyle(lineWidth, lineHeight)}
                    />
                </div>

                {/* Center dot - TOP LAYER - z-index 2 */}
                {dotOpacity > 0 && (
                    <div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{
                            zIndex: 2,
                            width: dotSize,
                            height: dotSize,
                            background: dotColor,
                        }}
                    />
                )}
            </div>
        </div>
    );
}
