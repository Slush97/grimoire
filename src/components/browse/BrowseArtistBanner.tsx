import { useTranslation } from 'react-i18next';
import type { ComponentType } from 'react';
import { ArrowLeft, Construction, ExternalLink, EyeOff, Globe, Music, Package } from 'lucide-react';
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
import { Button, MultiSelectSegments } from '../common/ui';
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

const ARTIST_LINK_CLASS = 'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

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
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        icon={ArrowLeft}
        title={t('browse.artist.backToBrowse')}
        aria-label={t('browse.artist.backToBrowse')}
        onClick={clearArtist}
        className="h-10! w-10 shrink-0 rounded-lg! border-0! bg-transparent! px-0! [&>svg]:size-5"
      />
      {submitter.avatarUrl && !artistAvatarFailed ? (
        <img
          src={submitter.avatarUrl}
          alt={submitter.name}
          className="h-10 w-10 flex-shrink-0 rounded-full border border-border object-cover"
          onError={() => setArtistAvatarFailed(true)}
        />
      ) : (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-lg font-bold uppercase text-accent">
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
              title={t('browse.artist.viewOnGameBanana', { name: submitter.name })}
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
              {t('browse.artist.modCount', { count: totalCount, formatted: totalCount.toLocaleString() })}
            </span>
          )}
        </div>
      </div>
      {/* Social symbols + Ko-fi grouped on the right. Ko-fi is filtered out
          of the symbol row since it gets its own labelled button. */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {artistSocials
          .filter((link) => !(submitter.kofiUrl && link.platform === 'kofi'))
          .map((link) => {
            const Icon = browseSocialIcon(link.platform);
            return (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.label}
                aria-label={link.label}
                style={{ backgroundColor: BROWSE_SOCIAL_COLORS[link.platform] ?? 'var(--color-accent)' }}
                className={`${ARTIST_LINK_CLASS} w-10`}
              >
                <Icon className="h-5 w-5" />
              </a>
            );
          })}
        {submitter.kofiUrl && (
          <a
            href={submitter.kofiUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t('browse.artist.supportOnKofi', { name: submitter.name })}
            className={`${ARTIST_LINK_CLASS} bg-brand-kofi px-3 hover:bg-brand-kofi-hover`}
          >
            <KofiIcon className="h-4 w-4" />
            {t('browse.artist.kofi')}
          </a>
        )}
        <Button
          type="button"
          variant="toolbar"
          icon={EyeOff}
          title={t('hiddenCreators.hideNamedCreator', { name: submitter.name })}
          aria-label={t('hiddenCreators.hideNamedCreator', { name: submitter.name })}
          onClick={() => requestHideCreator({ id: submitter.id, name: submitter.name })}
          className="h-10! w-10 shrink-0 rounded-lg! px-0! [&>svg]:size-5"
        />
      </div>
      <MultiSelectSegments
        label={t('browse.section.label')}
        multiselectable={false}
        selected={[section]}
        onToggle={setSection}
        className="hidden h-10 flex-shrink-0 sm:flex"
        itemClassName="h-8 px-3"
        options={(['Mod', 'Sound', 'Wip'] as const).map((s) => ({
          value: s,
          icon: s === 'Sound' ? Music : s === 'Wip' ? Construction : Package,
          label: <span className="text-sm">{s === 'Mod'
              ? t('profiles.mods.label')
              : s === 'Sound'
                ? t('browse.section.sounds')
                : t('browse.section.wips')}</span>,
        }))}
      />
    </div>
  );
}
