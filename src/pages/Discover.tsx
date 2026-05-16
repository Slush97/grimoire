import { useCallback, useEffect, useState } from 'react';
import {
  Globe2,
  Loader2,
  Heart,
  AlertTriangle,
  Sparkles,
  Clock,
  Flame,
  LogIn,
  CloudOff,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  socialListProfiles,
  socialLike,
  socialUnlike,
  type SocialListProfilesResponse,
  type SocialProfileSort,
  type SocialProfileDetail,
} from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { useSocialStore } from '../stores/socialStore';
import { Card, Badge, Button } from '../components/common/ui';
import { EmptyState, PageHeader } from '../components/common/PageComponents';
import ProfileDetailDialog from '../components/social/ProfileDetailDialog';
import ImportProfileDialog from '../components/profiles/ImportProfileDialog';
import { getActiveDeadlockPath } from '../lib/appSettings';

type SortKey = Extract<SocialProfileSort, 'top' | 'new' | 'featured'>;

const SORTS: { key: SortKey; label: string; icon: typeof Flame }[] = [
  { key: 'top', label: 'Top', icon: Flame },
  { key: 'new', label: 'New', icon: Clock },
  { key: 'featured', label: 'Featured', icon: Sparkles },
];

type CardProfile = SocialListProfilesResponse['profiles'][number];

export default function Discover() {
  const settings = useAppStore((s) => s.settings);
  const hideNsfw = settings?.hideNsfwPreviews ?? true;
  const signedIn = useSocialStore((s) => s.status.signedIn);
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

  const [sort, setSort] = useState<SortKey>('top');
  const [data, setData] = useState<SocialListProfilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likingId, setLikingId] = useState<string | null>(null);

  // Detail / Import flow state.
  const [detailProfile, setDetailProfile] = useState<CardProfile | null>(null);
  const [importInput, setImportInput] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await socialListProfiles({ sort, hideNsfw });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sort, hideNsfw]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const applyLikeUpdate = useCallback((id: string, likeCount: number) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === id ? { ...p, like_count: likeCount } : p
        ),
      };
    });
  }, []);

  const handleCardLikeClick = useCallback(
    async (e: React.MouseEvent, profile: CardProfile) => {
      e.stopPropagation();
      if (!signedIn) {
        void handleSignIn();
        return;
      }
      if (likingId) return;
      setLikingId(profile.id);
      try {
        // We don't track viewer_has_liked on the list response (only on detail).
        // Best-effort: try Like first; if the server says "already liked"
        // (typically 409), fall back to Unlike. For now, optimistically like.
        const res = await socialLike(profile.id);
        applyLikeUpdate(profile.id, res.like_count);
      } catch (err) {
        // If like fails because already liked, try unlike for toggle.
        try {
          const res = await socialUnlike(profile.id);
          applyLikeUpdate(profile.id, res.like_count);
        } catch {
          console.warn('[discover] like toggle failed:', err);
        }
      } finally {
        setLikingId(null);
      }
    },
    [signedIn, likingId, handleSignIn, applyLikeUpdate]
  );

  const handleImportFromDetail = useCallback(
    (shareCode: string, _detail: SocialProfileDetail) => {
      setDetailProfile(null);
      setImportInput(shareCode);
    },
    []
  );

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <PageHeader
        title="Discover"
        description="Mod profiles published by other Grimoire users."
        stats={data ? `${data.total} ${data.total === 1 ? 'profile' : 'profiles'}` : undefined}
      />

      {!signedIn && (
        <div className="bg-bg-secondary border border-white/10 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <Globe2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-text-primary font-medium">Browsing as a guest</div>
                <div className="text-xs text-text-secondary mt-0.5">
                  Sign in with Steam to like profiles or publish your own. Importing works without an account.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                icon={LogIn}
                variant="secondary"
                onClick={handleSignIn}
                isLoading={signInBusy}
                disabled={signInBusy}
              >
                Sign in
              </Button>
              {signInBusy && (
                <Button variant="secondary" icon={X} onClick={cancelLogin}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
          {signInBusy && (
            <div className="text-xs text-text-secondary flex items-start gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Finish signing in with Steam in your browser. This banner will update automatically when you're done.
              </span>
            </div>
          )}
          {signInError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2 text-xs text-red-400 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="break-words">{signInError}</span>
              </div>
              <button
                onClick={clearSignInError}
                className="text-red-300 hover:text-red-200 underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border">
        {SORTS.map(({ key, label, icon: Icon }) => {
          const active = sort === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`px-4 py-2 -mb-px border-b-2 inline-flex items-center gap-2 text-sm transition-colors cursor-pointer ${
                active
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading profiles...
        </div>
      )}

      {error && (
        <EmptyState
          icon={CloudOff}
          variant="error"
          title="Couldn't reach Grimoire Social"
          description={
            <div className="space-y-2">
              <p>{error}</p>
              <p className="text-xs text-text-secondary">
                Check your connection, then switch sort tabs to retry.
              </p>
            </div>
          }
        />
      )}

      {!loading && !error && data && data.profiles.length === 0 && (
        <EmptyState
          icon={Globe2}
          title="No profiles here yet"
          description="Be the first to publish: open Profiles, pick one, and click Publish to Discover."
        />
      )}

      {data && data.profiles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.profiles.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetailProfile(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDetailProfile(p);
                }
              }}
              className="text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
            >
              <Card className="p-4 flex flex-col gap-2 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-text-primary font-medium truncate" title={p.title}>
                      {p.title}
                    </div>
                    <div className="text-xs text-text-secondary truncate" title={p.owner.display_name}>
                      by {p.owner.display_name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleCardLikeClick(e, p)}
                    disabled={likingId === p.id}
                    className={`inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md transition-colors ${
                      signedIn
                        ? 'text-text-secondary hover:text-red-400 hover:bg-white/5 cursor-pointer'
                        : 'text-text-tertiary cursor-help'
                    } disabled:opacity-50`}
                    title={signedIn ? 'Like / unlike' : 'Sign in to like'}
                  >
                    <Heart className={`w-4 h-4 ${likingId === p.id ? 'animate-pulse' : ''}`} />
                    {p.like_count}
                  </button>
                </div>
                {p.description && (
                  <div className="text-sm text-text-secondary line-clamp-2">{p.description}</div>
                )}
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <Badge variant="neutral">
                    {p.mod_count} {p.mod_count === 1 ? 'mod' : 'mods'}
                  </Badge>
                  {p.primary_hero && <Badge variant="neutral">{p.primary_hero}</Badge>}
                  {p.is_featured && (
                    <Badge variant="success">
                      <Sparkles className="w-3 h-3 mr-1 inline" />
                      Featured
                    </Badge>
                  )}
                  {p.has_nsfw && <Badge variant="warning">NSFW</Badge>}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {data && data.profiles.length > 0 && data.total > data.profiles.length && (
        <div className="text-xs text-text-secondary text-center pt-2 inline-flex items-center gap-2 justify-center w-full">
          <AlertTriangle className="w-3 h-3" />
          Pagination not wired up yet (showing first {data.page_size} of {data.total}).
        </div>
      )}

      {detailProfile && (
        <ProfileDetailDialog
          profileId={detailProfile.id}
          seed={{
            title: detailProfile.title,
            description: detailProfile.description,
            owner: detailProfile.owner,
            mod_count: detailProfile.mod_count,
            primary_hero: detailProfile.primary_hero,
            has_nsfw: detailProfile.has_nsfw,
            is_featured: detailProfile.is_featured,
            like_count: detailProfile.like_count,
            created_at: detailProfile.created_at,
          }}
          onClose={() => setDetailProfile(null)}
          onImport={handleImportFromDetail}
          onLikeChange={(id, likeCount) => applyLikeUpdate(id, likeCount)}
          onSignInRequested={() => {
            void handleSignIn();
          }}
        />
      )}

      {importInput && (
        <ImportProfileDialog
          activeDeadlockPath={getActiveDeadlockPath(settings)}
          hideNsfwPreviews={hideNsfw}
          initialInput={importInput}
          onClose={() => setImportInput(null)}
          onImported={() => {
            // Stay open: the dialog itself shows a success state after the
            // user finishes. They can close it manually.
          }}
        />
      )}
    </div>
  );
}
