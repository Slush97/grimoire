import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  AlertTriangle,
  Sparkles,
  Heart,
  Flag,
  Boxes,
  User as UserIcon,
  Terminal,
  Crosshair,
  CheckCircle2,
} from 'lucide-react';
import { Button, Badge } from '../common/ui';
import {
  socialGetProfile,
  socialLike,
  socialUnlike,
  socialReport,
  parsePortableProfile,
  type SocialProfileDetail,
  type SocialListProfilesResponse,
} from '../../lib/api';
import { useSocialStore } from '../../stores/socialStore';
import { formatRelativeDate } from '../../lib/dates';

// Seed for instant render before the /v1/profiles/:id call completes. Matches
// the list response shape — pass straight through from the Discover card.
export type SocialProfileSeed = SocialListProfilesResponse['profiles'][number];

interface SocialProfileHeaderProps {
  profileId: string;
  seed?: SocialProfileSeed;
  // Fires once the detail fetch resolves so the parent can start parsing the
  // share_code (the import flow needs it; we don't want to refetch).
  onDetailReady?: (detail: SocialProfileDetail) => void;
  // Sync like-count changes back to the parent list / card.
  onLikeChange?: (profileId: string, likeCount: number, viewerHasLiked: boolean) => void;
  // Explicit "Sign in with Steam" click. Distinct from the implicit case
  // below so the parent can decide whether to start an OAuth flow.
  onSignInRequested?: () => void;
  // The user clicked Like while signed-out — NOT an explicit sign-in request.
  // Use this to nudge a UI affordance (e.g. pulse the header sign-in button).
  onLikeWithoutSignIn?: () => void;
}

function isoFromUnix(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

export default function SocialProfileHeader({
  profileId,
  seed,
  onDetailReady,
  onLikeChange,
  onLikeWithoutSignIn,
}: SocialProfileHeaderProps) {
  const { t } = useTranslation();
  const signedIn = useSocialStore((s) => s.status.signedIn);

  const [detail, setDetail] = useState<SocialProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCrosshair, setHasCrosshair] = useState(false);
  const [autoexecCount, setAutoexecCount] = useState(0);

  const [likeBusy, setLikeBusy] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    socialGetProfile(profileId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        onDetailReady?.(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // onDetailReady deliberately omitted — parent should pass a stable ref;
    // we only want this to fire when the profile id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // Inspect the share_code purely for the crosshair / autoexec indicators.
  // Parsing the mod list happens in the import dialog itself.
  useEffect(() => {
    if (!detail?.share_code) return;
    let cancelled = false;
    parsePortableProfile(detail.share_code)
      .then((p) => {
        if (cancelled) return;
        setHasCrosshair(!!p.extensions?.grimoire?.crosshair);
        setAutoexecCount(p.extensions?.grimoire?.autoexecCommands?.length ?? 0);
      })
      .catch(() => { /* best-effort; the import path surfaces real errors */ });
    return () => { cancelled = true; };
  }, [detail?.share_code]);

  const handleLikeToggle = useCallback(async () => {
    if (!signedIn) {
      onLikeWithoutSignIn?.();
      return;
    }
    if (!detail || likeBusy) return;
    setLikeBusy(true);
    setLikeError(null);
    const willLike = !detail.viewer_has_liked;
    try {
      const res = willLike ? await socialLike(detail.id) : await socialUnlike(detail.id);
      setDetail({ ...detail, like_count: res.like_count, viewer_has_liked: res.viewer_has_liked });
      onLikeChange?.(detail.id, res.like_count, res.viewer_has_liked);
    } catch (err) {
      setLikeError(err instanceof Error ? err.message : String(err));
    } finally {
      setLikeBusy(false);
    }
  }, [detail, likeBusy, signedIn, onLikeChange, onLikeWithoutSignIn]);

  const handleSubmitReport = useCallback(async () => {
    if (!detail || reportSubmitting) return;
    setReportSubmitting(true);
    setReportError(null);
    try {
      await socialReport(detail.id, { reason: reportReason.trim() || undefined });
      setReported(true);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setReportSubmitting(false);
    }
  }, [detail, reportReason, reportSubmitting]);

  const view = detail ?? seed;

  // Same mosaic / single-hero / placeholder logic as the Discover card. We
  // already have the URLs on `view`; no extra fetch.
  const { mosaicSlots, singleHero } = useMemo(() => {
    const thumbs = view?.thumbnail_urls ?? [];
    if (thumbs.length >= 2) {
      return {
        mosaicSlots: [
          thumbs[0] ?? null,
          thumbs[1] ?? null,
          thumbs[2] ?? null,
          thumbs[3] ?? null,
        ],
        singleHero: null as string | null,
      };
    }
    return {
      mosaicSlots: null as (string | null)[] | null,
      singleHero: thumbs.length === 1 ? thumbs[0]! : null,
    };
  }, [view?.thumbnail_urls]);

  const allHeroes = useMemo(() => {
    if (!view) return [];
    if (view.heroes && view.heroes.length > 0) return view.heroes;
    return view.primary_hero ? [view.primary_hero] : [];
  }, [view]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header art */}
      <div className="relative h-32 bg-bg-tertiary overflow-hidden flex-shrink-0">
        {mosaicSlots && (
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5">
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
        {!mosaicSlots && !singleHero && (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary">
            <Boxes className="w-10 h-10 opacity-30" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />
        {view && (
          <div
            className="absolute left-3 right-3 bottom-2 text-base font-semibold text-white truncate leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            title={view.title}
          >
            {view.title}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3 text-sm">
        {error && !view && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2.5 text-xs text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading && !view && (
          <div className="text-text-secondary text-xs inline-flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('social.header.loadingProfile')}
          </div>
        )}

        {view && (
          <>
            <div className="flex items-center gap-2 min-w-0">
              {view.owner.avatar_url ? (
                <img
                  src={view.owner.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-bg-tertiary flex items-center justify-center flex-shrink-0">
                  <UserIcon className="w-3 h-3 text-text-secondary" />
                </div>
              )}
              <span className="text-xs text-text-secondary truncate" title={view.owner.display_name}>
                {view.owner.display_name}
              </span>
              <span className="text-[11px] text-text-tertiary flex-shrink-0">
                · {formatRelativeDate(isoFromUnix(view.created_at))}
              </span>
            </div>

            {view.description ? (
              <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed break-words">
                {view.description}
              </p>
            ) : (
              <p className="text-xs text-text-tertiary italic">{t('social.header.noDescription')}</p>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="neutral">
                <Boxes className="w-3 h-3 mr-1 inline" />
                {t('profiles.mods.count', { count: view.mod_count })}
              </Badge>
              {allHeroes.map((hero) => (
                <Badge key={hero} variant="neutral">{hero}</Badge>
              ))}
              {view.is_featured && (
                <Badge variant="success">
                  <Sparkles className="w-3 h-3 mr-1 inline" />
                  {t('social.header.featured')}
                </Badge>
              )}
              {view.has_nsfw && <Badge variant="warning">NSFW</Badge>}
              {hasCrosshair && (
                <Badge variant="info">
                  <Crosshair className="w-3 h-3 mr-1 inline" />
                  {t('nav.crosshair')}
                </Badge>
              )}
              {autoexecCount > 0 && (
                <Badge variant="warning">
                  <Terminal className="w-3 h-3 mr-1 inline" />
                  {autoexecCount} autoexec
                </Badge>
              )}
            </div>

            {likeError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2 text-xs text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{likeError}</span>
              </div>
            )}

            {reportOpen && !reported && (
              <div className="bg-bg-secondary border border-white/10 rounded-md p-2.5 space-y-2">
                <div className="text-xs font-medium text-text-primary">{t('social.header.reportThisProfile')}</div>
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder={t('social.header.reportIssuePlaceholder')}
                  className="w-full px-2.5 py-1.5 bg-bg-tertiary border border-white/10 rounded-md text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
                {reportError && (
                  <div className="text-xs text-red-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{reportError}</span>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setReportOpen(false); setReportReason(''); setReportError(null); }}
                    disabled={reportSubmitting}
                  >
                    {t('common.actions.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={Flag}
                    onClick={handleSubmitReport}
                    isLoading={reportSubmitting}
                    disabled={reportSubmitting}
                  >
                    {t('social.header.submit')}
                  </Button>
                </div>
              </div>
            )}

            {reported && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-md p-2 text-xs text-green-300 flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{t('social.header.reportSubmitted')}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 pt-1 border-t border-white/5">
              <Button
                variant={detail?.viewer_has_liked ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleLikeToggle}
                disabled={likeBusy || !detail}
                isLoading={likeBusy}
                title={signedIn ? (detail?.viewer_has_liked ? 'Unlike' : 'Like') : 'Sign in to like'}
              >
                <Heart className={`w-3.5 h-3.5 ${detail?.viewer_has_liked ? 'fill-current' : ''}`} />
                {view.like_count}
              </Button>
              {signedIn && detail && !reportOpen && !reported && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Flag}
                  onClick={() => setReportOpen(true)}
                  title={t('social.header.reportThisProfile')}
                >
                  {t('social.header.report')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
