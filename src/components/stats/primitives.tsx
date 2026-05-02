import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { HERO_NAMES } from '../../types/deadlock-stats'
import { getHeroRenderPath, getHeroFacePosition } from '../../lib/lockerUtils'
import { RANK_TIER_COLORS, STAT_TYPE, STATS_COLORS, deltaColor, formatDelta } from './tokens'

// ============================================================================
// StatBlock — KPI tile. The fundamental "one big number + label" unit that
// every overview screen leans on. Optional delta sits beneath the value, color
// derived from sign. Optional inline icon on the label line.
// ============================================================================

type StatBlockTone = 'default' | 'win' | 'loss' | 'accent'

interface StatBlockProps {
    label: string
    value: ReactNode
    delta?: number
    deltaSuffix?: string
    deltaPrecision?: number
    icon?: LucideIcon
    tone?: StatBlockTone
    sublabel?: ReactNode
    className?: string
}

const TONE_VALUE_CLASS: Record<StatBlockTone, string> = {
    default: 'text-text-primary',
    win: 'text-stats-win',
    loss: 'text-stats-loss',
    accent: 'text-accent',
}

export function StatBlock({
    label,
    value,
    delta,
    deltaSuffix = '',
    deltaPrecision = 0,
    icon: Icon,
    tone = 'default',
    sublabel,
    className = '',
}: StatBlockProps) {
    return (
        <div className={`flex flex-col gap-1 p-4 bg-bg-secondary/50 border border-white/5 rounded-xl ${className}`}>
            <div className="flex items-center gap-1.5">
                {Icon && <Icon className="w-3.5 h-3.5 text-text-tertiary" />}
                <span className={STAT_TYPE.label}>{label}</span>
            </div>
            <div className={`${STAT_TYPE.hero} ${TONE_VALUE_CLASS[tone]} leading-none mt-1`}>
                {value}
            </div>
            {(delta !== undefined || sublabel) && (
                <div className="flex items-center gap-2 mt-1 text-xs">
                    {delta !== undefined && (
                        <span style={{ color: deltaColor(delta) }} className="font-medium tabular-nums">
                            {formatDelta(delta, deltaPrecision)}{deltaSuffix}
                        </span>
                    )}
                    {sublabel && <span className="text-text-tertiary">{sublabel}</span>}
                </div>
            )}
        </div>
    )
}

// ============================================================================
// Sparkline — tiny inline trend chart. Hand-rolled SVG so MMR/winrate
// micro-charts don't drag in recharts overhead per row. Renders a smooth path
// with optional area fill. Returns null for fewer than 2 points.
// ============================================================================

interface SparklineProps {
    data: number[]
    width?: number
    height?: number
    color?: string
    fill?: boolean
    /** Show a single dot at the last point — useful for "current value" emphasis. */
    showLastDot?: boolean
    className?: string
}

export function Sparkline({
    data,
    width = 120,
    height = 32,
    color = STATS_COLORS.accent,
    fill = true,
    showLastDot = true,
    className = '',
}: SparklineProps) {
    if (data.length < 2) return null

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const stepX = width / (data.length - 1)

    const points = data.map((v, i) => ({
        x: i * stepX,
        y: height - ((v - min) / range) * height,
    }))

    const linePath = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(' ')

    const areaPath = `${linePath} L${width},${height} L0,${height} Z`

    const last = points[points.length - 1]

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={`overflow-visible ${className}`}
            aria-hidden
        >
            {fill && <path d={areaPath} fill={color} fillOpacity={0.15} />}
            <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            {showLastDot && (
                <circle cx={last.x} cy={last.y} r={2.5} fill={color} stroke={STATS_COLORS.bgCard} strokeWidth={1} />
            )}
        </svg>
    )
}

// ============================================================================
// HeroAvatar — square cropped hero portrait. Uses the existing locker render
// PNGs and HERO_FACE_POSITION map for face-centered cropping. Falls back to
// initials chip when the hero ID is unknown (e.g. experimental heroes).
// ============================================================================

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const AVATAR_SIZE_CLASS: Record<AvatarSize, string> = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-12 h-12 text-sm',
    lg: 'w-16 h-16 text-base',
    xl: 'w-24 h-24 text-lg',
}

interface HeroAvatarProps {
    heroId: number
    size?: AvatarSize
    className?: string
    title?: string
}

export function HeroAvatar({ heroId, size = 'sm', className = '', title }: HeroAvatarProps) {
    const name = HERO_NAMES[heroId]
    const sizeClass = AVATAR_SIZE_CLASS[size]
    const tooltip = title ?? name ?? `Hero ${heroId}`

    if (!name) {
        return (
            <div
                className={`${sizeClass} rounded-md bg-bg-tertiary border border-white/5 flex items-center justify-center text-text-tertiary font-mono ${className}`}
                title={tooltip}
            >
                ?
            </div>
        )
    }

    return (
        <div
            className={`${sizeClass} rounded-md overflow-hidden bg-bg-tertiary border border-white/5 flex-shrink-0 ${className}`}
            title={tooltip}
        >
            <img
                src={getHeroRenderPath(name)}
                alt={name}
                className="w-full h-full object-cover scale-[1.6]"
                style={{ objectPosition: `${getHeroFacePosition(name)}% 20%` }}
                loading="lazy"
            />
        </div>
    )
}

// ============================================================================
// RankBadge — current-rank pill showing the player's division + tier. Uses
// API-provided badge_color when available, falls back to RANK_TIER_COLORS.
// Three sizes: sm (inline in tables), md (cards), lg (PlayerHeader hero spot).
// ============================================================================

const DIVISION_NAMES: Record<number, string> = {
    1: 'Initiate',
    2: 'Seeker',
    3: 'Alchemist',
    4: 'Arcanist',
    5: 'Ritualist',
    6: 'Emissary',
    7: 'Archon',
    8: 'Oracle',
    9: 'Phantom',
    10: 'Ascendant',
    11: 'Eternus',
}

const TIER_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

type RankSize = 'sm' | 'md' | 'lg'

const RANK_SIZE: Record<RankSize, { wrap: string; dot: string; name: string; tier: string }> = {
    sm: { wrap: 'gap-1.5 px-2 py-1', dot: 'w-2 h-2', name: 'text-xs font-medium', tier: 'text-[10px] text-text-tertiary' },
    md: { wrap: 'gap-2 px-3 py-1.5', dot: 'w-2.5 h-2.5', name: 'text-sm font-semibold', tier: 'text-xs text-text-tertiary' },
    lg: { wrap: 'gap-2.5 px-4 py-2', dot: 'w-3 h-3', name: 'text-base font-semibold tracking-wide', tier: 'text-sm text-text-tertiary' },
}

interface RankBadgeProps {
    division?: number
    tier?: number
    /** Override the dot color — pass when the API supplies a per-bucket color. */
    color?: string
    size?: RankSize
    className?: string
}

export function RankBadge({ division, tier, color, size = 'md', className = '' }: RankBadgeProps) {
    const s = RANK_SIZE[size]

    if (!division) {
        return (
            <span className={`inline-flex items-center bg-bg-tertiary border border-white/5 rounded-md ${s.wrap} ${className}`}>
                <span className={`${s.dot} rounded-full bg-text-tertiary/40`} />
                <span className={`${s.name} text-text-tertiary`}>Unranked</span>
            </span>
        )
    }

    const dotColor = color || RANK_TIER_COLORS[division] || STATS_COLORS.neutral
    const name = DIVISION_NAMES[division] || `Tier ${division}`
    const numeral = tier ? TIER_NUMERALS[tier] : ''

    return (
        <span
            className={`inline-flex items-center bg-bg-tertiary border border-white/10 rounded-md ${s.wrap} ${className}`}
            style={{ borderLeftColor: dotColor, borderLeftWidth: 2 }}
        >
            <span className={`${s.dot} rounded-full`} style={{ backgroundColor: dotColor }} />
            <span className={`${s.name} text-text-primary`}>{name}</span>
            {numeral && <span className={s.tier}>{numeral}</span>}
        </span>
    )
}

// ============================================================================
// WLPill — single W/L chip. Used densely in recent-form strips, so it stays
// minimal: square chip, monogram letter, semantic color. Optional title for
// hover context (hero name, score, MMR delta).
// ============================================================================

type WLSize = 'xs' | 'sm' | 'md'

const WL_SIZE: Record<WLSize, string> = {
    xs: 'w-4 h-4 text-[10px]',
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
}

interface WLPillProps {
    outcome: 'Win' | 'Loss'
    size?: WLSize
    title?: string
    className?: string
}

export function WLPill({ outcome, size = 'sm', title, className = '' }: WLPillProps) {
    const isWin = outcome === 'Win'
    return (
        <span
            className={`${WL_SIZE[size]} inline-flex items-center justify-center rounded font-bold tabular-nums ${
                isWin
                    ? 'bg-stats-win/15 text-stats-win border border-stats-win/30'
                    : 'bg-stats-loss/15 text-stats-loss border border-stats-loss/30'
            } ${className}`}
            title={title}
            aria-label={outcome}
        >
            {isWin ? 'W' : 'L'}
        </span>
    )
}
