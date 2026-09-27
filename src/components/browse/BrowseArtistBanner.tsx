import { useTranslation } from 'react-i18next';
import type { ComponentType } from 'react';
import { ArrowLeft, ExternalLink, EyeOff, Globe } from 'lucide-react';
import {
  BlueskyIcon,
  CarrdIcon,
  DeviantartIcon,
  DiscordIcon,
  FacebookIcon,
  GithubIcon,
  InstagramIcon,
  KofiIcon,
  LinktreeIcon,
  MastodonIcon,
  PatreonIcon,
  RedditIcon,
  SoundcloudIcon,
  SpotifyIcon,
  SteamIcon,
  ThreadsIcon,
  TiktokIcon,
  TumblrIcon,
  TwitchIcon,
  XIcon,
  YoutubeIcon,
} from '../common/BrandIcons';
import { IconButton } from '../common/ui';
import type { GameBananaArtistLink } from '../../types/gamebanana';
import type { BrowseArtistRef } from '../../stores/appStore';
import type { HiddenCreator } from '../../types/mod';

// Filled brand glyphs (see common/BrandIcons). Platform keys come from
// GameBanana's contact icon classes, lowercased by normalizeContactPlatform
// in the main process. Unknown platforms fall back to a generic globe.
type SocialIconComponent = ComponentType<{ className?: string }>;
const BROWSE_SOCIAL_ICONS: Record<string, SocialIconComponent> = {
  youtube: YoutubeIcon,
  twitter: XIcon,
  x: XIcon,
  twitch: TwitchIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  github: GithubIcon,
  discord: DiscordIcon,
  bluesky: BlueskyIcon,
  tiktok: TiktokIcon,
  patreon: PatreonIcon,
  kofi: KofiIcon,
  steam: SteamIcon,
  reddit: RedditIcon,
  spotify: SpotifyIcon,
  soundcloud: SoundcloudIcon,
  carrd: CarrdIcon,
  linktree: LinktreeIcon,
  tumblr: TumblrIcon,
  deviantart: DeviantartIcon,
  mastodon: MastodonIcon,
  threads: ThreadsIcon,
};

function browseSocialIcon(platform: string): SocialIconComponent {
  return BROWSE_SOCIAL_ICONS[platform] ?? Globe;
}

// Brand colors so the social symbols read as the real platforms. All chosen to
// contrast with a white glyph; unknown platforms fall back to the accent.
const BROWSE_SOCIAL_COLORS: Record<string, string> = {
  youtube: '#FF0000',
  twitter: '#111111',
  x: '#111111',
  twitch: '#9146FF',
  instagram: '#E4405F',
  facebook: '#1877F2',
  github: '#333333',
  discord: '#5865F2',
  bluesky: '#1185FE',
  tiktok: '#111111',
  patreon: '#FF424D',
  kofi: '#FF5E5B',
  steam: '#1B2838',
  reddit: '#FF4500',
  spotify: '#1DB954',
  soundcloud: '#FF5500',
  carrd: '#1F2D3D',
  linktree: '#43E660',
  tumblr: '#36465D',
  deviantart: '#05CC47',
  mastodon: '#6364FF',
  threads: '#111111',
};

function browseSocialColor(platform: string): string {
  return BROWSE_SOCIAL_COLORS[platform] ?? '#f97316';
}

export function BrowseArtistBanner({
  submitter,
  artistAvatarFailed,
  setArtistAvatarFailed,
  totalCount,
  artistSocials,
  section,
  setSection,
  clearArtist,
  requestHideCreator,
}: {
  submitter: BrowseArtistRef;
  artistAvatarFailed: boolean;
  setArtistAvatarFailed: (failed: boolean) => void;
  totalCount: number;
  artistSocials: GameBananaArtistLink[];
  section: string;
  setSection: (section: string) => void;
  clearArtist: () => void;
  requestHideCreator: (creator: HiddenCreator) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3">
      <IconButton
        icon={ArrowLeft}
        label={t('browse.artist.backToBrowse')}
        onClick={clearArtist}
        className="flex-shrink-0"
      />
      {submitter.avatarUrl && !artistAvatarFailed ? (
        <img
          src={submitter.avatarUrl}
          alt={submitter.name}
          className="h-11 w-11 flex-shrink-0 rounded-full border border-border object-cover"
          onError={() => setArtistAvatarFailed(true)}
        />
      ) : (
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-lg font-bold uppercase text-accent">
          {submitter.name.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {submitter.profileUrl ? (
            <a
              href={submitter.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`View ${submitter.name} on GameBanana`}
              className="group inline-flex min-w-0 items-center gap-1.5 text-lg font-bold text-text-primary transition-colors hover:text-accent"
            >
              <span className="min-w-0 truncate">{submitter.name}</span>
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent" />
            </a>
          ) : (
            <span className="min-w-0 truncate text-lg font-bold text-text-primary">{submitter.name}</span>
          )}
          {totalCount > 0 && (
            <span className="flex-shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-2xs font-semibold text-text-secondary border border-border">
              {totalCount.toLocaleString()} {totalCount === 1 ? 'mod' : 'mods'}
            </span>
          )}
        </div>
      </div>
      {/* Social symbols + Ko-fi grouped on the right. Ko-fi is filtered out
          of the symbol row since it gets its own labelled brand button. */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {artistSocials
          .filter((link) => !(submitter.kofiUrl && link.platform === 'kofi'))
          .map((link) => {
            const Icon = browseSocialIcon(link.platform);
            const color = browseSocialColor(link.platform);
            return (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.label}
                aria-label={link.label}
                style={{ backgroundColor: color }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm ring-1 ring-hl/10 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hl/60"
              >
                <Icon className="h-4 w-4" />
              </a>
            );
          })}
        {submitter.kofiUrl && (
          <a
            href={submitter.kofiUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Support ${submitter.name} on Ko-fi`}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-kofi px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-kofi-hover"
          >
            <KofiIcon className="h-4 w-4" />
            {t('browse.artist.kofi')}
          </a>
        )}
        <IconButton
          icon={EyeOff}
          label={t('hiddenCreators.hideNamedCreator', { name: submitter.name })}
          onClick={() => requestHideCreator({ id: submitter.id, name: submitter.name })}
        />
      </div>
      <div className="hidden flex-shrink-0 items-center gap-1 rounded-lg border border-border bg-bg-secondary p-0.5 sm:flex">
        {(['Mod', 'Sound', 'Wip'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              section === s ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s === 'Mod'
              ? t('profiles.mods.label')
              : s === 'Sound'
                ? t('browse.section.sounds')
                : t('browse.section.wips')}
          </button>
        ))}
      </div>
    </div>
  );
}
