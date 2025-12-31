import { useCrosshairStore } from '../../stores/crosshairStore';

interface CrosshairPreviewProps {
    size?: number;
    scale?: number;
}

export default function CrosshairPreview({ size = 200, scale = 1 }: CrosshairPreviewProps) {
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
    } = useCrosshairStore();

    const center = size / 2;
    const color = `rgb(${colorR}, ${colorG}, ${colorB})`;
    const borderColor = 'black';
    const borderWidth = pipBorder ? 1 : 0;

    // Scale factor for preview - calibrated to match in-game at 1.3x on 1080p
    // Width multiplier to make lines slightly thinner (matches in-game better)
    // Gap multiplier to make gaps slightly larger (matches in-game better)
    const widthMultiplier = 0.7;
    const gapMultiplier = 1.6;
    const scaledGap = pipGap * scale * gapMultiplier;
    const scaledHeight = pipHeight * scale;
    const scaledWidth = pipWidth * scale * widthMultiplier;

    // Pip positions (4 lines: top, bottom, left, right)
    const pips = [
        // Top pip
        {
            x: center - scaledWidth / 2,
            y: center - scaledGap - scaledHeight,
            width: scaledWidth,
            height: scaledHeight,
        },
        // Bottom pip
        {
            x: center - scaledWidth / 2,
            y: center + scaledGap,
            width: scaledWidth,
            height: scaledHeight,
        },
        // Left pip
        {
            x: center - scaledGap - scaledHeight,
            y: center - scaledWidth / 2,
            width: scaledHeight,
            height: scaledWidth,
        },
        // Right pip
        {
            x: center + scaledGap,
            y: center - scaledWidth / 2,
            width: scaledHeight,
            height: scaledWidth,
        },
    ];

    // Dot settings
    const dotRadius = 3 * scale;
    const dotOutlineWidth = 1;

    return (
        <div
            className="relative rounded-lg overflow-hidden"
            style={{
                width: size,
                height: size,
                backgroundColor: '#1a1a1a',
                backgroundImage: `
                    linear-gradient(45deg, #222 25%, transparent 25%),
                    linear-gradient(-45deg, #222 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #222 75%),
                    linear-gradient(-45deg, transparent 75%, #222 75%)
                `,
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            }}
        >
            <svg width={size} height={size} className="absolute inset-0">
                {/* Pips with optional border */}
                {pips.map((pip, i) => (
                    <g key={i}>
                        {/* Border (rendered first, slightly larger) */}
                        {pipBorder && (
                            <rect
                                x={pip.x - borderWidth}
                                y={pip.y - borderWidth}
                                width={pip.width + borderWidth * 2}
                                height={pip.height + borderWidth * 2}
                                fill={borderColor}
                                opacity={pipOpacity}
                            />
                        )}
                        {/* Main pip */}
                        <rect
                            x={pip.x}
                            y={pip.y}
                            width={pip.width}
                            height={pip.height}
                            fill={color}
                            opacity={pipOpacity}
                        />
                    </g>
                ))}

                {/* Dot outline */}
                {dotOutlineOpacity > 0 && (
                    <circle
                        cx={center}
                        cy={center}
                        r={dotRadius + dotOutlineWidth}
                        fill={borderColor}
                        opacity={dotOutlineOpacity}
                    />
                )}

                {/* Center dot */}
                {dotOpacity > 0 && (
                    <circle
                        cx={center}
                        cy={center}
                        r={dotRadius}
                        fill={color}
                        opacity={dotOpacity}
                    />
                )}
            </svg>
        </div>
    );
}
