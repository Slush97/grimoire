import { useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  Eye,
  History,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  ThumbsUp,
  Volume2,
} from 'lucide-react';
import { formatAbsoluteDate, formatRelativeDate } from '../lib/dates';
import { getHeroFacePosition, getHeroRenderPath } from '../lib/lockerUtils';

type SampleKind = 'mod' | 'sound';
type SampleAction = 'install' | 'installed' | 'queued' | 'downloading' | 'enable' | 'disable' | 'update' | 'selected';
type ChipTone = 'neutral' | 'accent' | 'danger' | 'info';

type SampleChip = {
  label: string;
  tone?: ChipTone;
};

type SampleCard = {
  id: string;
  title: string;
  author: string;
  kind: SampleKind;
  hero: string;
  chips: SampleChip[];
  likes: string;
  views: string;
  downloads: string;
  updatedAt: string;
  action: SampleAction;
  queuePosition?: number;
  duration?: string;
  media?: 'image' | 'audio-placeholder';
};

const MAX_VISIBLE_CHIPS = 3;
const DEFAULT_BODY_HEIGHT = 158;
const CHIP_ROW_APPROX_WIDTH = 256;
const CHIP_GAP_WIDTH = 6;
const CHIP_OVERFLOW_WIDTH = 30;

const MOD_GRID_CARDS: SampleCard[] = [
  {
    id: 'normal',
    title: "dacooderr's FPS Essentials",
    author: 'dacooderr',
    kind: 'mod',
    hero: 'Warden',
    chips: [{ label: 'Utility' }, { label: 'Warden', tone: 'info' }],
    likes: '3',
    views: '3.4k',
    downloads: '824',
    updatedAt: '2026-05-27T00:00:00.000Z',
    action: 'install',
  },
  {
    id: 'installed-skin',
    title: 'Kobold Paige (V2.0-NEW COLORS)',
    author: 'Squinnky',
    kind: 'mod',
    hero: 'Paige',
    chips: [{ label: 'Skin' }, { label: 'Paige', tone: 'info' }, { label: 'Model' }],
    likes: '14',
    views: '1.8k',
    downloads: '611',
    updatedAt: '2026-03-13T00:00:00.000Z',
    action: 'installed',
  },
  {
    id: 'outdated',
    title: 'Legacy Wraith Celestial HUD and Portrait Pack',
    author: 'modforge',
    kind: 'mod',
    hero: 'Wraith',
    chips: [{ label: 'HUD' }, { label: 'Wraith', tone: 'info' }, { label: '18+', tone: 'danger' }],
    likes: '29',
    views: '8.9k',
    downloads: '2.4k',
    updatedAt: '2025-12-18T00:00:00.000Z',
    action: 'update',
  },
  {
    id: 'translation-stress',
    title: 'Yamato Complete Translation Patch With Very Long Localized Labels',
    author: 'atelierNix',
    kind: 'mod',
    hero: 'Yamato',
    chips: [
      { label: 'Translation', tone: 'accent' },
      { label: 'Localization' },
      { label: 'Yamato', tone: 'info' },
      { label: 'Community Patch' },
      { label: 'Long Category Label' },
    ],
    likes: '42',
    views: '12.7k',
    downloads: '5.2k',
    updatedAt: '2026-05-03T00:00:00.000Z',
    action: 'enable',
  },
  {
    id: 'selected-model',
    title: 'Bebop Steelworks Model Override',
    author: 'chassisLab',
    kind: 'mod',
    hero: 'Bebop',
    chips: [{ label: 'Model' }, { label: 'Bebop', tone: 'info' }, { label: 'Experimental' }],
    likes: '8',
    views: '1.1k',
    downloads: '320',
    updatedAt: '2026-02-02T00:00:00.000Z',
    action: 'selected',
  },
];

const SOUND_GRID_CARDS: SampleCard[] = [
  {
    id: 'sound',
    title: 'The First Hunter - Venator Mod',
    author: 'r3djok3r1',
    kind: 'sound',
    hero: 'Venator',
    chips: [{ label: 'Sound', tone: 'accent' }, { label: 'Venator', tone: 'info' }, { label: 'Audio' }],
    likes: '1',
    views: '16',
    downloads: '42',
    updatedAt: '2026-05-27T00:00:00.000Z',
    action: 'queued',
    queuePosition: 2,
    duration: '0:30',
  },
  {
    id: 'ability-sfx',
    title: 'Seven Storm Cloud Killstreak Set',
    author: 'VoltArchive',
    kind: 'sound',
    hero: 'Seven',
    chips: [{ label: 'Ability SFX', tone: 'accent' }, { label: 'Seven', tone: 'info' }, { label: 'Audio' }],
    likes: '18',
    views: '2.1k',
    downloads: '560',
    updatedAt: '2026-05-12T00:00:00.000Z',
    action: 'downloading',
    duration: '0:18',
    media: 'audio-placeholder',
  },
  {
    id: 'nsfw-hidden',
    title: 'After Hours Lash Voice Pack With Extended Author Metadata',
    author: 'RedactedUser',
    kind: 'sound',
    hero: 'Lash',
    chips: [{ label: 'Voice', tone: 'accent' }, { label: 'Lash', tone: 'info' }, { label: '18+', tone: 'danger' }, { label: 'Audio' }],
    likes: '7',
    views: '980',
    downloads: '130',
    updatedAt: '2026-04-19T00:00:00.000Z',
    action: 'installed',
    duration: '0:24',
  },
  {
    id: 'voice-stress',
    title: 'Multilingual Announcer Voice Pack for Every Menu State',
    author: 'voxFoundry',
    kind: 'sound',
    hero: 'Ivy',
    chips: [
      { label: 'Voice Pack', tone: 'accent' },
      { label: 'Translation' },
      { label: 'Multilingual' },
      { label: 'Audio' },
      { label: 'Very Long Descriptor' },
    ],
    likes: '16',
    views: '4.6k',
    downloads: '880',
    updatedAt: '2026-01-14T00:00:00.000Z',
    action: 'disable',
    duration: '0:21',
    media: 'audio-placeholder',
  },
  {
    id: 'audio-install',
    title: 'Pocket Radio UI Clicks',
    author: 'wavequeue',
    kind: 'sound',
    hero: 'Infernus',
    chips: [{ label: 'Audio' }, { label: 'UI SFX', tone: 'accent' }, { label: 'Infernus', tone: 'info' }],
    likes: '5',
    views: '710',
    downloads: '89',
    updatedAt: '2026-03-08T00:00:00.000Z',
    action: 'install',
    duration: '0:09',
    media: 'audio-placeholder',
  },
];

function hasNsfwChip(card: SampleCard): boolean {
  return card.chips.some((chip) => chip.label === '18+');
}

function actionLabel(card: SampleCard): string {
  switch (card.action) {
    case 'installed':
      return 'Installed';
    case 'queued':
      return card.queuePosition ? `Queued ${card.queuePosition}` : 'Queued';
    case 'downloading':
      return 'Loading';
    case 'enable':
      return 'Enable';
    case 'disable':
      return 'Disable';
    case 'update':
      return 'Update';
    case 'selected':
      return 'Selected';
    default:
      return 'Install';
  }
}

function actionTone(card: SampleCard): string {
  switch (card.action) {
    case 'installed':
    case 'selected':
      return 'border-state-success/30 bg-state-success/[0.055] text-state-success';
    case 'queued':
      return 'border-state-info/30 bg-state-info/[0.055] text-state-info';
    case 'downloading':
      return 'border-accent/30 bg-accent/[0.055] text-accent';
    case 'enable':
      return 'border-state-success/30 bg-state-success/[0.055] text-state-success hover:border-state-success/50';
    case 'disable':
      return 'border-white/[0.08] bg-white/[0.025] text-text-secondary/85 hover:border-white/[0.14]';
    case 'update':
      return 'border-state-warning/35 bg-state-warning/[0.06] text-state-warning hover:border-state-warning/55';
    default:
      return 'border-accent/30 bg-accent/[0.055] text-accent hover:border-accent/50';
  }
}

function chipTone(tone: ChipTone = 'neutral'): string {
  switch (tone) {
    case 'accent':
      return 'border-accent/15 bg-accent/[0.045] text-accent/75';
    case 'danger':
      return 'border-state-danger/25 bg-state-danger/[0.07] text-state-danger/85';
    case 'info':
      return 'border-state-info/15 bg-state-info/[0.045] text-state-info/75';
    default:
      return 'border-white/[0.08] bg-white/[0.028] text-text-tertiary';
  }
}

function heroStyle(card: SampleCard): CSSProperties {
  return { objectPosition: `${getHeroFacePosition(card.hero)}% 20%` };
}

function ChipRow({ chips }: { chips: SampleChip[] }) {
  const visibleChips: SampleChip[] = [];
  let usedWidth = 0;

  for (const [index, chip] of chips.entries()) {
    if (visibleChips.length >= MAX_VISIBLE_CHIPS) break;

    const remainingAfter = chips.length - index - 1;
    const chipWidth = Math.ceil(chip.label.length * 5.5 + 14);
    const gapBefore = visibleChips.length > 0 ? CHIP_GAP_WIDTH : 0;
    const overflowReserve = remainingAfter > 0 ? CHIP_GAP_WIDTH + CHIP_OVERFLOW_WIDTH : 0;

    if (usedWidth + gapBefore + chipWidth + overflowReserve > CHIP_ROW_APPROX_WIDTH) break;

    visibleChips.push(chip);
    usedWidth += gapBefore + chipWidth;
  }

  const hiddenChips = chips.slice(visibleChips.length);

  return (
    <div className="flex min-h-6 min-w-0 items-start gap-1.5 overflow-hidden">
      {visibleChips.map((chip, index) => (
        <span
          key={`${chip.label}-${index}`}
          title={chip.label}
          className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 text-[10px] font-medium leading-none ${chipTone(
            chip.tone
          )}`}
        >
          {chip.label}
        </span>
      ))}
      {hiddenChips.length > 0 && (
        <span
          title={hiddenChips.map((chip) => chip.label).join(', ')}
          className="inline-flex h-5 shrink-0 items-center rounded-sm border border-white/[0.08] bg-white/[0.028] px-1.5 text-[10px] font-medium leading-none text-text-tertiary"
        >
          +{hiddenChips.length}
        </span>
      )}
    </div>
  );
}

function FooterActionButton({ card }: { card: SampleCard }) {
  const label = actionLabel(card);
  const passive = card.action === 'installed' || card.action === 'queued' || card.action === 'downloading' || card.action === 'selected';

  return (
    <button
      type="button"
      aria-label={`${label} ${card.title}`}
      className={`inline-flex h-7 w-[98px] shrink-0 items-center justify-center rounded-md border px-[9px] text-xs font-semibold leading-none transition-colors ${actionTone(
        card
      )} ${passive ? 'cursor-default' : ''}`}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {card.action === 'downloading' ? (
          <Loader2 className="h-[13px] w-[13px] shrink-0 animate-spin" />
        ) : card.action === 'installed' || card.action === 'enable' || card.action === 'selected' ? (
          <Check className="h-[13px] w-[13px] shrink-0" />
        ) : card.action === 'queued' ? (
          <Clock className="h-[13px] w-[13px] shrink-0" />
        ) : card.action === 'update' ? (
          <AlertTriangle className="h-[13px] w-[13px] shrink-0" />
        ) : (
          <Download className="h-[13px] w-[13px] shrink-0 -translate-y-0.5" />
        )}
        <span className="min-w-0 truncate leading-none">{label}</span>
      </span>
    </button>
  );
}

function SoundPlaceholderArt({ card }: { card: SampleCard }) {
  const bars = [22, 38, 54, 30, 68, 46, 34, 58, 26, 42, 62, 36, 48, 28];

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_24%_22%,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(96,165,250,0.16),transparent_28%),linear-gradient(135deg,#151312,#22242a_55%,#121416)]"
      role="img"
      aria-label={`${card.title} audio preview`}
    >
      <Volume2 className="absolute left-1/2 top-[43%] h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-text-primary/12" />
      <div className="absolute inset-x-8 top-[46%] flex h-12 -translate-y-1/2 items-center justify-center gap-1.5 opacity-35">
        {bars.map((height, index) => (
          <span
            key={`${card.id}-wave-${index}`}
            className="w-1 rounded-full bg-text-secondary"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-primary/55 to-transparent" />
    </div>
  );
}

function ThumbnailAudioPreview({ card }: { card: SampleCard }) {
  if (card.kind !== 'sound') return null;

  return (
    <div className="absolute inset-x-3 bottom-3 flex h-9 items-center gap-2 rounded-[10px] border border-white/10 bg-[#0a0c10]/75 px-2 text-text-secondary shadow-[0_2px_10px_rgba(0,0,0,0.55)] backdrop-blur-md">
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-bg-primary"
        aria-label={`Preview ${card.title}`}
      >
        <Play className="ml-0.5 h-3 w-3 fill-current" />
      </button>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
        <div className="h-full w-1/3 rounded-full bg-accent" />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-text-tertiary">{card.duration ?? '0:00'}</span>
    </div>
  );
}

function Thumbnail({ card }: { card: SampleCard }) {
  const nsfw = hasNsfwChip(card);
  const useSoundPlaceholder = card.kind === 'sound' && card.media === 'audio-placeholder';

  return (
    <div className="relative h-40 overflow-hidden rounded-t-md bg-bg-tertiary">
      {useSoundPlaceholder ? (
        <SoundPlaceholderArt card={card} />
      ) : (
        <img
          src={getHeroRenderPath(card.hero)}
          alt={card.hero}
          className={`h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] ${
            nsfw ? 'scale-105 blur-lg saturate-75' : ''
          }`}
          style={heroStyle(card)}
        />
      )}

      {nsfw && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/55 text-state-danger">
          <ShieldCheck className="h-5 w-5" />
          <span className="mt-1 text-[11px] font-semibold">NSFW hidden</span>
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent via-bg-secondary/45 to-bg-secondary"
        aria-hidden="true"
      />

      <ThumbnailAudioPreview card={card} />
    </div>
  );
}

function StatsRow({ card }: { card: SampleCard }) {
  return (
    <div className="flex h-4 min-w-0 items-end gap-1.5 overflow-visible text-[10px] font-medium leading-[11px] text-text-tertiary/60">
      <span className="inline-flex h-4 items-end gap-0.5 tabular-nums">
        <ThumbsUp className="block h-3 w-3 shrink-0 -translate-y-0.5" />
        <span className="block h-[11px] leading-[11px]">{card.likes}</span>
      </span>
      <span className="inline-flex h-4 items-end gap-0.5 tabular-nums">
        <Eye className="block h-3 w-3 shrink-0" />
        <span className="block h-[11px] leading-[11px]">{card.views}</span>
      </span>
      <span className="inline-flex h-4 items-end gap-0.5 tabular-nums">
        <Download className="block h-3 w-3 shrink-0 -translate-y-0.5" />
        <span className="block h-[11px] leading-[11px]">{card.downloads}</span>
      </span>
    </div>
  );
}

function FreshnessLabel({ card }: { card: SampleCard }) {
  const relative = formatRelativeDate(card.updatedAt).replace(/(\d+)\s+(mo|yr)\s+ago/, '$1$2 ago');
  const absolute = formatAbsoluteDate(card.updatedAt);
  if (!relative || !absolute) return null;

  return (
    <span
      className="mt-0.5 inline-flex h-3.5 shrink-0 items-center gap-0.5 text-[10px] font-medium leading-[11px] tabular-nums text-text-tertiary/60"
      title={`Last updated on GameBanana: ${absolute}`}
    >
      <History className="h-3 w-3 shrink-0 -translate-y-0.5" />
      <span className="leading-[11px]">{relative}</span>
    </span>
  );
}

function ProductModCard({ card, bodyHeight }: { card: SampleCard; bodyHeight: number }) {
  const cardHeight = 160 + bodyHeight;

  return (
    <article
      className="group flex w-[280px] flex-col overflow-hidden rounded-md border border-white/[0.07] bg-bg-secondary text-left shadow-[0_1px_0_rgba(255,255,255,0.03)] transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
      style={{ height: cardHeight }}
    >
      <Thumbnail card={card} />

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <ChipRow chips={card.chips} />

        <div className="mt-2 min-w-0">
          <h3 className="truncate text-[15px] font-bold leading-[1.25] text-[#eee8df]" title={card.title}>
            {card.title}
          </h3>
          <p className="mt-1 truncate text-xs font-medium leading-tight text-text-secondary">by {card.author}</p>
          <FreshnessLabel card={card} />
        </div>

        <div className="mt-auto flex h-7 items-center justify-between gap-3">
          <StatsRow card={card} />
          <FooterActionButton card={card} />
        </div>
      </div>
    </article>
  );
}

function GridExample({
  title,
  description,
  cards,
  bodyHeight,
}: {
  title: string;
  description: string;
  cards: SampleCard[];
  bodyHeight: number;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="font-reaver text-lg font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-secondary">{description}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,280px)] justify-start gap-4">
        {cards.map((card) => (
          <ProductModCard key={card.id} card={card} bodyHeight={bodyHeight} />
        ))}
      </div>
    </section>
  );
}

export default function BrowseCardTestbed() {
  const [bodyHeight, setBodyHeight] = useState(DEFAULT_BODY_HEIGHT);

  return (
    <div className="min-h-full bg-bg-primary text-text-primary">
      <div className="mx-auto flex w-full max-w-[932px] flex-col gap-8 px-5 py-6">
        <header className="border-b border-border pb-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-sm border border-accent/30 bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
                <Layers className="h-3.5 w-3.5" />
                Testbed example
              </p>
              <h1 className="font-reaver text-2xl font-semibold text-text-primary">Clean media mod card</h1>
              <p className="mt-2 max-w-3xl text-sm text-text-secondary">
                Media stays clean. Intrinsic chips move below the thumbnail. Action state lives only in the footer button.
              </p>
            </div>
            <div className="rounded-sm border border-border bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
              Route: #/browse-card-testbed
            </div>
          </div>
        </header>

        <section className="rounded-md border border-border bg-bg-secondary p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Body spacing test</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Fixed chip behavior: fit up to {MAX_VISIBLE_CHIPS} full chips, then +N. Current card height: {160 + bodyHeight}px.
              </p>
            </div>
            <span className="rounded-sm border border-white/10 bg-bg-primary px-2 py-1 text-[11px] font-medium tabular-nums text-text-tertiary">
              body {bodyHeight}px
            </span>
          </div>
          <input
            type="range"
            min="148"
            max="178"
            step="2"
            value={bodyHeight}
            onChange={(event) => setBodyHeight(Number(event.target.value))}
            className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-primary accent-accent"
            aria-label="Card body height"
          />
        </section>

        <GridExample
          title="Mods grid"
          description="Tests clean media, installed, update-needed, selected, NSFW hidden, long title, and long chip cases without overlaying metadata on the image."
          cards={MOD_GRID_CARDS}
          bodyHeight={bodyHeight}
        />

        <GridExample
          title="Sounds grid"
          description="Every sound card uses the media slot for image or generated audio preview. Body, chips, footer, and actions match the Mods grid."
          cards={SOUND_GRID_CARDS}
          bodyHeight={bodyHeight}
        />
      </div>
    </div>
  );
}
