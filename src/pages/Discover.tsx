import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe2,
  Heart,
  AlertTriangle,
  Sparkles,
  Clock,
  Flame,
  CloudOff,
  Loader2,
  X,
  ExternalLink,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { SteamIcon } from '../components/social/SteamIcon';
import {
  socialListProfiles,
  socialLike,
  socialUnlike,
  type SocialListProfilesResponse,
  type SocialProfileSort,
} from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { useSocialStore } from '../stores/socialStore';
import { Card, Button } from '../components/common/ui';
import { EmptyState, PageHeader } from '../components/common/PageComponents';
import ImportProfileDialog from '../components/profiles/ImportProfileDialog';
import MyPublishedSection from '../components/social/MyPublishedSection';
import PublishPickerDialog from '../components/social/PublishPickerDialog';
import PublishDialog from '../components/social/PublishDialog';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { formatRelativeDate } from '../lib/dates';

// 'mine' is a client-side view, not a backend sort. We branch on it before
// hitting /v1/profiles and render the user's own published profiles instead.
type TabKey = Extract<SocialProfileSort, 'top' | 'new'> | 'mine';

const BROWSE_TABS: { key: Extract<TabKey, 'top' | 'new'>; labelKey: string; icon: typeof Flame }[] = [
  { key: 'top', labelKey: 'discover.tabs.top', icon: Flame },
  { key: 'new', labelKey: 'discover.tabs.new', icon: Clock },
];

type CardProfile = SocialListProfilesResponse['profiles'][number];

function isoFromUnix(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

export default function Discover() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const hideNsfw = settings?.hideNsfwPreviews ?? true;
  const signedIn = useSocialStore((s) => s.status.signedIn);
  const user = useSocialStore((s) => s.status.user);
  const signInBusy = useSocialStore((s) => s.loading);
  const signInError = useSocialStore((s) => s.error);
  const login = useSocialStore((s) => s.login);
  const cancelLogin = useSocialStore((s) => s.cancelLogin);
  const clearSignInError = useSocialStore((s) => s.clearError);

  const handleSignIn = useCallback(async () => {
    try {
      await login();
    } catch {
      // store already captured the error; banner shows it
    }
  }, [login]);

  const [tab, setTab] = useState<TabKey>('top');
  const [data, setData] = useState<SocialListProfilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likingId, setLikingId] = useState<string | null>(null);
  // Tracks the viewer's like state per profile. Seeded from the list response
  // when the server returns viewer_has_liked (only when authenticated), and
  // kept in sync by each like/unlike response. Cards without an entry default
  // to "not liked" — same as before the field existed on the wire.
  const [viewerLiked, setViewerLiked] = useState<Record<string, boolean>>({});
  // Pulses the header sign-in button when a signed-out user clicks Like.
  const [signInPulse, setSignInPulse] = useState(false);

  // The active card-import target: profileId + a seed row from the list so the
  // dialog's left rail can render instantly while /v1/profiles/:id loads.
  const [importTarget, setImportTarget] = useState<CardProfile | null>(null);

  // Publish flow: picker -> publish dialog. Two-stage so users can back out of
  // the picker without committing to a specific local profile.
  const [showPicker, setShowPicker] = useState(false);
  const [publishTarget, setPublishTarget] = useState<{ id: string; name: string } | null>(null);
  // Bumped on every successful publish so MyPublishedSection refetches without
  // remounting (otherwise the new row only appears after a manual tab switch).
  const [publishedTick, setPublishedTick] = useState(0);

  // Merge the viewer_has_liked field from a response into our local map.
  // Pulled out so loadProfiles and loadMore can share it.
  const mergeViewerLiked = useCallback((profiles: SocialListProfilesResponse['profiles']) => {
    setViewerLiked((prev) => {
      const next = { ...prev };
      for (const p of profiles) {
        if (typeof p.viewer_has_liked === 'boolean') {
          next[p.id] = p.viewer_has_liked;
        }
      }
      return next;
    });
  }, []);

  const loadProfiles = useCallback(async () => {
    if (tab === 'mine') return;
    setLoading(true);
    setError(null);
    try {
      const res = await socialListProfiles({ sort: tab, hideNsfw, page: 1 });
      setData(res);
      mergeViewerLiked(res.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tab, hideNsfw, mergeViewerLiked]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // Are more profiles available beyond what's currently in `data.profiles`?
  // Drives both the observer sentinel rendering and the early-out in loadMore.
  const hasMore = !!(data && data.profiles.length < data.total);

  const loadMore = useCallback(async () => {
    if (!data || loading || loadingMore || tab === 'mine' || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = data.page + 1;
      const res = await socialListProfiles({ sort: tab, hideNsfw, page: nextPage });
      setData((prev) => {
        // Tab/filter changed mid-fetch: drop the response, let the fresh
        // loadProfiles win. Comparing the snapshot identity catches resets.
        if (!prev || prev !== data) return prev;
        // De-dupe defensively in case a new publish shifted offsets between
        // pages. id is the primary key.
        const seen = new Set(prev.profiles.map((p) => p.id));
        const merged = prev.profiles.concat(res.profiles.filter((p) => !seen.has(p.id)));
        return { ...res, profiles: merged };
      });
      mergeViewerLiked(res.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [data, hasMore, hideNsfw, loading, loadingMore, mergeViewerLiked, tab]);

  // IntersectionObserver-driven infinite scroll. Mirrors the pattern Browse
  // uses so the two pages feel the same.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (tab === 'mine' || !hasMore) return;
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, hasMore, loadMore]);

  // If a signed-in user lands on Your profile and then signs out, fall back
  // to Top so they don't end up staring at an empty owner-only view.
  useEffect(() => {
    if (tab === 'mine' && !signedIn) setTab('top');
  }, [tab, signedIn]);

  const applyLikeUpdate = useCallback((id: string, likeCount: number, liked?: boolean) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === id ? { ...p, like_count: likeCount } : p
        ),
      };
    });
    if (typeof liked === 'boolean') {
      setViewerLiked((prev) => ({ ...prev, [id]: liked }));
    }
  }, []);

  const handleCardLikeClick = useCallback(
    async (e: React.MouseEvent, profile: CardProfile) => {
      e.stopPropagation();
      if (!signedIn) {
        // Don't auto-open Steam. Just nudge the header button.
        setSignInPulse(true);
        window.setTimeout(() => setSignInPulse(false), 1200);
        return;
      }
      if (likingId) return;
      setLikingId(profile.id);
      // Drive direction from local state instead of trial-and-error against
      // the server. The previous "try Like, fall back to Unlike on error"
      // pattern broke when the server treated duplicate Like as idempotent
      // (returns success, no error to catch, no toggle).
      const currentlyLiked = viewerLiked[profile.id] === true;
      try {
        const res = currentlyLiked
          ? await socialUnlike(profile.id)
          : await socialLike(profile.id);
        applyLikeUpdate(profile.id, res.like_count, res.viewer_has_liked);
      } catch (err) {
        // Out of sync with server (e.g., session expired then resumed).
        // Try the opposite op once and trust the server's state.
        try {
          const res = currentlyLiked
            ? await socialLike(profile.id)
            : await socialUnlike(profile.id);
          applyLikeUpdate(profile.id, res.like_count, res.viewer_has_liked);
        } catch {
          console.warn('[discover] like toggle failed:', err);
        }
      } finally {
        setLikingId(null);
      }
    },
    [signedIn, likingId, viewerLiked, applyLikeUpdate]
  );


  // Page header action: either a sign-in CTA (signed-out) or the publish
  // button + user chip (signed-in). The pulse ring fires when a signed-out
  // user clicks a card's like button so the right action is obvious.
  const headerAction = signedIn && user ? (
    <>
      <Button
        size="sm"
        icon={Upload}
        onClick={() => setShowPicker(true)}
        title={t('discover.publish.pickAndPublishTitle')}
      >
        {t('discover.publish.publishProfile')}
      </Button>
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-secondary border border-white/10"
        title={`Signed in as ${user.display_name}`}
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            referrerPolicy="no-referrer"
            className="w-5 h-5 rounded-full"
          />
        ) : (
          <UserIcon className="w-4 h-4 text-text-secondary" />
        )}
        <span className="text-xs text-text-primary truncate max-w-[10rem]">
          {user.display_name}
        </span>
      </div>
    </>
  ) : (
    <div
      className={`flex items-center gap-2 rounded-md transition-shadow ${signInPulse ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-primary shadow-[0_0_0_4px_rgba(56,189,248,0.25)] animate-pulse' : ''}`}
    >
      <Button
        size="sm"
        icon={SteamIcon}
        onClick={handleSignIn}
        isLoading={signInBusy}
        disabled={signInBusy}
        title={t('discover.signIn.opensSteamHint')}
      >
        {t('discover.signIn.withSteam')}
      </Button>
      {signInBusy && (
        <Button size="sm" variant="secondary" icon={X} onClick={cancelLogin}>
          {t('common.actions.cancel')}
        </Button>
      )}
    </div>
  );

  const headerDescription = (
    <>
      {t('discover.header.description')}
      {!signedIn && (
        <span className="text-text-tertiary">
          {' '}{t('discover.header.signInHint')}
        </span>
      )}
    </>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <PageHeader
          title={t('nav.discover')}
          description={headerDescription}
          action={headerAction}
        />
        <div className="flex items-center justify-between gap-3 border-b border-border">
          <div className="flex items-center gap-1">
            {BROWSE_TABS.map(({ key, labelKey, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-3 py-2 -mb-px border-b-2 inline-flex items-center gap-2 text-sm transition-colors cursor-pointer ${
                    active
                      ? 'border-accent text-text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t(labelKey)}
                </button>
              );
            })}
            {signedIn && (
              <button
                type="button"
                onClick={() => setTab('mine')}
                className={`px-3 py-2 -mb-px border-b-2 inline-flex items-center gap-2 text-sm transition-colors cursor-pointer ${
                  tab === 'mine'
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                <UserIcon className="w-4 h-4" />
                {t('discover.tabs.yourProfile')}
              </button>
            )}
          </div>
          {tab !== 'mine' && data && (
            <span className="text-xs text-text-tertiary tabular-nums pr-1">
              {data.total} {data.total === 1 ? 'profile' : 'profiles'}
            </span>
          )}
        </div>
      </div>

      {!signedIn && signInBusy && (
        <div className="text-xs text-text-secondary flex items-start gap-1.5">
          <ExternalLink className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            {t('discover.signIn.finishInBrowser')}
          </span>
        </div>
      )}
      {!signedIn && signInError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2.5 text-xs text-red-400 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="break-words">{signInError}</span>
          </div>
          <button
            onClick={clearSignInError}
            className="text-red-300 hover:text-red-200 underline shrink-0 cursor-pointer"
          >
            {t('common.actions.dismiss')}
          </button>
        </div>
      )}

      {tab === 'mine' && signedIn && (
        <MyPublishedSection
          refreshKey={publishedTick}
          onPublishNew={() => setShowPicker(true)}
          onOpenProfile={(id) => {
            // Prefer the discover-list seed if it's there; otherwise the
            // dialog refetches detail and fills in the header from /v1/profiles/:id.
            const seed = data?.profiles.find((p) => p.id === id) ?? null;
            if (seed) setImportTarget(seed);
          }}
          onUnpublished={(id) => {
            setData((prev) =>
              prev ? { ...prev, profiles: prev.profiles.filter((p) => p.id !== id) } : prev
            );
          }}
          onUpdated={(updated) => {
            // Keep the browse-list cache in sync so switching back to Top/New
            // doesn't show a stale title.
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    profiles: prev.profiles.map((p) =>
                      p.id === updated.id
                        ? {
                            ...p,
                            title: updated.title,
                            description: updated.description,
                            updated_at: updated.updated_at,
                          }
                        : p
                    ),
                  }
                : prev
            );
          }}
        />
      )}

      {tab !== 'mine' && loading && !data && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4 animate-pulse h-32">
              <div className="h-4 bg-white/5 rounded w-1/2 mb-2" />
              <div className="h-3 bg-white/5 rounded w-1/3 mb-4" />
              <div className="h-3 bg-white/5 rounded w-full mb-1" />
              <div className="h-3 bg-white/5 rounded w-3/4" />
            </Card>
          ))}
        </div>
      )}

      {tab !== 'mine' && error && (
        <EmptyState
          icon={CloudOff}
          variant="error"
          title={t('discover.error.title')}
          description={
            <div className="space-y-2">
              <p>{error}</p>
              <p className="text-xs text-text-secondary">
                {t('discover.error.retryHint')}
              </p>
            </div>
          }
        />
      )}

      {tab !== 'mine' && !loading && !error && data && data.profiles.length === 0 && (
        <EmptyState
          icon={Globe2}
          title={t('discover.empty.title')}
          description={t('discover.empty.description')}
        />
      )}

      {tab !== 'mine' && data && data.profiles.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 items-start">
          {data.profiles.map((p) => {
            const isLiking = likingId === p.id;
            const isActive = importTarget?.id === p.id;
            const liked = viewerLiked[p.id] === true;
            const openImport = () => setImportTarget(p);
            const thumbs = p.thumbnail_urls ?? [];
            // 0 -> tiny placeholder bar. 1 -> full-bleed single hero. 2-4 ->
            // 2x2 mosaic, padding missing slots so the grid stays balanced.
            const mosaicSlots = thumbs.length >= 2
              ? [thumbs[0] ?? null, thumbs[1] ?? null, thumbs[2] ?? null, thumbs[3] ?? null]
              : null;
            const singleHero = thumbs.length === 1 ? thumbs[0]! : null;
            return (
              <div
                key={p.id}
                id={`discover-card-${p.id}`}
                role="button"
                tabIndex={0}
                onClick={openImport}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openImport();
                  }
                }}
                className="text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
              >
                <Card
                  contentClassName="p-0"
                  className={`overflow-hidden flex flex-col transition-colors ${isActive ? 'border-accent/40' : 'hover:border-white/20'}`}
                >
                  {/* Image at the top, Twitter-card style. 16:9 full-bleed.
                      Layouts:
                      - 0 thumbs   : empty placeholder
                      - 1 thumb    : full-bleed hero
                      - 2-4 thumbs : 2x2 mosaic, hairline separators */}
                  <div className="relative aspect-video bg-bg-tertiary overflow-hidden">
                    {mosaicSlots && (
                      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-black/40">
                        {mosaicSlots.map((url, i) =>
                          url ? (
                            <img
                              key={i}
                              src={url}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                              className="w-full h-full object-cover object-top"
                            />
                          ) : (
                            <div key={i} className="bg-bg-tertiary/60" aria-hidden />
                          )
                        )}
                      </div>
                    )}
                    {!mosaicSlots && singleHero && (
                      <img
                        src={singleHero}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                        className="absolute inset-0 w-full h-full object-cover object-top"
                      />
                    )}
                    {(p.is_featured || p.has_nsfw) && (
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        {p.is_featured && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-sm bg-black/60 backdrop-blur-sm text-amber-300 border border-amber-300/30">
                            <Sparkles className="w-3 h-3" />
                            {t('discover.card.featured')}
                          </span>
                        )}
                        {p.has_nsfw && (
                          <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded-sm bg-black/60 backdrop-blur-sm text-yellow-300 border border-yellow-300/30">
                            NSFW
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Body: title block, then meta/actions row. Vertical
                      rhythm is 12px (gap-3) between sections and 6px
                      (gap-1.5) within the title block. */}
                  <div className="p-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <div
                        className="text-base font-semibold text-text-primary leading-snug line-clamp-2"
                        title={p.title}
                      >
                        {p.title}
                      </div>
                      {p.description && (
                        <div className="text-sm text-text-secondary leading-snug line-clamp-2">
                          {p.description}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      {p.owner.avatar_url ? (
                        <img
                          src={p.owner.avatar_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-8 h-8 rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center flex-shrink-0">
                          <UserIcon className="w-4 h-4 text-text-secondary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 leading-tight">
                        <div
                          className="text-sm text-text-primary truncate"
                          title={p.owner.display_name}
                        >
                          {p.owner.display_name}
                        </div>
                        <div className="text-xs text-text-tertiary mt-0.5">
                          {formatRelativeDate(isoFromUnix(p.created_at))} · {p.mod_count} {p.mod_count === 1 ? 'mod' : 'mods'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleCardLikeClick(e, p)}
                        disabled={isLiking}
                        className={`flex-shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 -mr-1 rounded-md transition-colors ${
                          signedIn
                            ? liked
                              ? 'text-red-400 hover:bg-red-500/10 cursor-pointer'
                              : 'text-text-secondary hover:text-red-400 hover:bg-white/5 cursor-pointer'
                            : 'text-text-tertiary cursor-help hover:bg-white/5'
                        } disabled:opacity-50`}
                        title={signedIn ? (liked ? 'Unlike' : 'Like') : 'Sign in to like'}
                        aria-label={signedIn ? (liked ? 'Unlike profile' : 'Like profile') : 'Sign in to like'}
                        aria-pressed={liked}
                      >
                        <Heart className={`w-4 h-4 ${isLiking ? 'animate-pulse' : ''} ${liked ? 'fill-current' : ''}`} />
                        <span className="tabular-nums">{p.like_count}</span>
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {tab !== 'mine' && hasMore && (
        <div
          ref={loadMoreRef}
          className="text-xs text-text-secondary text-center pt-2 inline-flex items-center gap-2 justify-center w-full"
        >
          {loadingMore ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('discover.pagination.loadingMore')}
            </>
          ) : (
            <span className="opacity-60">
              {t('discover.pagination.showing', { shown: data!.profiles.length, total: data!.total })}
            </span>
          )}
        </div>
      )}

      </div>
      {showPicker && (
        <PublishPickerDialog
          onClose={() => setShowPicker(false)}
          onPick={(picked) => {
            setShowPicker(false);
            setPublishTarget(picked);
          }}
        />
      )}
      {publishTarget && (
        <PublishDialog
          profileId={publishTarget.id}
          profileName={publishTarget.name}
          onClose={() => setPublishTarget(null)}
          onPublished={() => {
            // Reveal the new post immediately: jump to "Your profile" and
            // bump the refresh tick so MyPublishedSection refetches.
            setPublishedTick((n) => n + 1);
            setTab('mine');
          }}
        />
      )}
      {importTarget && (
        <ImportProfileDialog
          activeDeadlockPath={getActiveDeadlockPath(settings)}
          hideNsfwPreviews={hideNsfw}
          socialProfileId={importTarget.id}
          socialProfileSeed={importTarget}
          onClose={() => setImportTarget(null)}
          onImported={() => {
            // Stay open: the dialog shows a success state after the user
            // finishes. They can close it manually.
          }}
          onLikeChange={(id, likeCount, viewerHasLiked) => applyLikeUpdate(id, likeCount, viewerHasLiked)}
          onSignInRequested={() => { void handleSignIn(); }}
          onLikeWithoutSignIn={() => {
            setSignInPulse(true);
            window.setTimeout(() => setSignInPulse(false), 1200);
          }}
        />
      )}
    </div>
  );
}
