import { useCallback, useEffect, useState } from 'react';
import {
  X,
  Heart,
  Loader2,
  AlertTriangle,
  Sparkles,
  Download,
  Flag,
  Calendar,
  Boxes,
  User as UserIcon,
  CheckCircle2,
} from 'lucide-react';
import { Button, Badge } from '../common/ui';
import { SteamIcon } from './SteamIcon';
import {
  socialGetProfile,
  socialLike,
  socialUnlike,
  socialReport,
  type SocialProfileDetail,
} from '../../lib/api';
import { useSocialStore } from '../../stores/socialStore';

interface ProfileDetailDialogProps {
  profileId: string;
  // Optional seed values so the dialog can render instantly with what we know
  // from the list response, then fill in viewer_has_liked + share_code once
  // the detail fetch completes.
  seed?: {
    title: string;
    description: string | null;
    owner: { display_name: string; avatar_url: string | null };
    mod_count: number;
    primary_hero: string | null;
    has_nsfw: boolean;
    is_featured: boolean;
    like_count: number;
    created_at: number;
  };
  onClose: () => void;
  onImport: (shareCode: string, profile: SocialProfileDetail) => void;
  // Notify parent so list cards can sync their counters without a refetch.
  onLikeChange?: (profileId: string, likeCount: number, viewerHasLiked: boolean) => void;
  onSignInRequested?: () => void;
}

function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function ProfileDetailDialog({
  profileId,
  seed,
  onClose,
  onImport,
  onLikeChange,
  onSignInRequested,
}: ProfileDetailDialogProps) {
  const signedIn = useSocialStore((s) => s.status.signedIn);

  const [detail, setDetail] = useState<SocialProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleLikeToggle = useCallback(async () => {
    if (!signedIn) {
      onSignInRequested?.();
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
  }, [detail, likeBusy, signedIn, onLikeChange, onSignInRequested]);

  const handleSubmitReport = useCallback(async () => {
    if (!detail || reportSubmitting) return;
    setReportSubmitting(true);
    setReportError(null);
    try {
      await socialReport(detail.id, {
        reason: reportReason.trim() || undefined,
      });
      setReported(true);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setReportSubmitting(false);
    }
  }, [detail, reportReason, reportSubmitting]);

  const handleImport = useCallback(() => {
    if (!detail) return;
    onImport(detail.share_code, detail);
  }, [detail, onImport]);

  // Use detail when available, otherwise seed.
  const view = detail ?? seed;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-detail-title"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-white/10 gap-4">
          <div className="min-w-0 flex-1">
            <h2
              id="profile-detail-title"
              className="text-xl font-bold text-text-primary truncate"
              title={view?.title}
            >
              {view?.title ?? (loading ? 'Loading...' : 'Profile')}
            </h2>
            {view && (
              <div className="flex items-center gap-2 mt-1.5 text-xs text-text-secondary">
                {view.owner.avatar_url ? (
                  <img
                    src={view.owner.avatar_url}
                    alt=""
                    className="w-5 h-5 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <UserIcon className="w-4 h-4" />
                )}
                <span className="truncate" title={view.owner.display_name}>
                  by {view.owner.display_name}
                </span>
                <span className="text-text-tertiary">·</span>
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDate(view.created_at)}</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
          {error && !view && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading && !view && (
            <div className="text-text-secondary text-sm inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading profile...
            </div>
          )}

          {view && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="neutral">
                  <Boxes className="w-3 h-3 mr-1 inline" />
                  {view.mod_count} {view.mod_count === 1 ? 'mod' : 'mods'}
                </Badge>
                {view.primary_hero && <Badge variant="neutral">{view.primary_hero}</Badge>}
                {view.is_featured && (
                  <Badge variant="success">
                    <Sparkles className="w-3 h-3 mr-1 inline" />
                    Featured
                  </Badge>
                )}
                {view.has_nsfw && <Badge variant="warning">NSFW</Badge>}
              </div>

              {view.description ? (
                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                  {view.description}
                </p>
              ) : (
                <p className="text-sm text-text-tertiary italic">No description.</p>
              )}

              {likeError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2 text-xs text-red-400 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{likeError}</span>
                </div>
              )}

              {reportOpen && !reported && (
                <div className="bg-bg-tertiary border border-white/10 rounded-md p-3 space-y-2">
                  <div className="text-xs font-medium text-text-primary">
                    Report this profile
                  </div>
                  <p className="text-xs text-text-secondary">
                    Tell moderators what's wrong (optional). Reports are reviewed manually.
                  </p>
                  <textarea
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="What's the issue?"
                    className="w-full px-3 py-2 bg-bg-secondary border border-white/10 rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
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
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={Flag}
                      onClick={handleSubmitReport}
                      isLoading={reportSubmitting}
                      disabled={reportSubmitting}
                    >
                      Submit report
                    </Button>
                  </div>
                </div>
              )}

              {reported && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 text-sm text-green-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Report submitted. Moderators will take a look.</span>
                </div>
              )}
            </>
          )}
        </div>

        {view && (
          <div className="flex items-center justify-between gap-3 p-4 border-t border-white/10 bg-bg-tertiary/50">
            <div className="flex items-center gap-2">
              <Button
                variant={detail?.viewer_has_liked ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleLikeToggle}
                disabled={likeBusy || !detail}
                isLoading={likeBusy}
                title={signedIn ? (detail?.viewer_has_liked ? 'Unlike' : 'Like') : 'Sign in to like'}
              >
                <Heart
                  className={`w-4 h-4 ${detail?.viewer_has_liked ? 'fill-current' : ''}`}
                />
                {view.like_count}
              </Button>
              {signedIn && detail && !reportOpen && !reported && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Flag}
                  onClick={() => setReportOpen(true)}
                  title="Report this profile"
                >
                  Report
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!signedIn && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={SteamIcon}
                  onClick={onSignInRequested}
                  title="Opens Steam in your browser. Grimoire never sees your password."
                >
                  Sign in with Steam
                </Button>
              )}
              <Button
                variant="primary"
                icon={Download}
                onClick={handleImport}
                disabled={!detail}
                title="Import this profile into Grimoire"
              >
                Import
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
