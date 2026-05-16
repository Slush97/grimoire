import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Heart,
  Boxes,
  Sparkles,
  Pencil,
  Globe2,
  Upload,
} from 'lucide-react';
import { Button, Badge } from '../common/ui';
import { EmptyState } from '../common/PageComponents';
import {
  socialMe,
  socialDeleteProfile,
  type SocialMeResponse,
  type SocialUpdateProfileResponse,
} from '../../lib/api';
import { formatRelativeDate } from '../../lib/dates';
import EditProfileDialog from './EditProfileDialog';

interface MyPublishedSectionProps {
  // Bumped by the parent whenever a publish completes elsewhere so this
  // section refetches without remounting.
  refreshKey?: number;
  onOpenProfile?: (profileId: string) => void;
  // Opens the parent's "pick a local profile to publish" flow. Surfaced from
  // both the empty state and the list header so a signed-in user can start a
  // new post from this tab.
  onPublishNew?: () => void;
  // Notify parent when a profile was unpublished so the main Discover list
  // can drop the row optimistically.
  onUnpublished?: (profileId: string) => void;
  // Notify parent when a profile's title/description was edited so the
  // main Discover list can patch its cached row.
  onUpdated?: (updated: SocialUpdateProfileResponse) => void;
}

function isoFromUnix(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

type EditTarget = {
  id: string;
  title: string;
  description: string | null;
};

export default function MyPublishedSection({
  refreshKey,
  onOpenProfile,
  onPublishNew,
  onUnpublished,
  onUpdated,
}: MyPublishedSectionProps) {
  const [data, setData] = useState<SocialMeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await socialMe();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleUnpublish = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await socialDeleteProfile(id);
        setData((prev) =>
          prev ? { ...prev, profiles: prev.profiles.filter((p) => p.id !== id) } : prev
        );
        onUnpublished?.(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeletingId(null);
        setConfirmingId(null);
      }
    },
    [onUnpublished]
  );

  const handleEdited = useCallback(
    (updated: SocialUpdateProfileResponse) => {
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
      onUpdated?.(updated);
    },
    [onUpdated]
  );

  return (
    <div className="space-y-3">
      {loading && !data && (
        <div className="text-sm text-text-secondary inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your profiles...
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2.5 text-xs text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto underline text-red-300 hover:text-red-200 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {data && data.profiles.length === 0 && !loading && (
        <EmptyState
          icon={Globe2}
          title="You haven't published anything yet"
          description="Pick one of your local profiles and post it to Discover."
          action={
            onPublishNew ? (
              <Button icon={Upload} onClick={onPublishNew}>
                Publish a profile
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.profiles.length > 0 && onPublishNew && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" icon={Upload} onClick={onPublishNew}>
            Publish another
          </Button>
        </div>
      )}

      {data && data.profiles.length > 0 && (
        <ul className="divide-y divide-white/5 border border-white/10 rounded-lg bg-bg-secondary overflow-hidden">
          {data.profiles.map((p) => {
            const confirming = confirmingId === p.id;
            const busy = deletingId === p.id;
            return (
              <li
                key={p.id}
                className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm text-text-primary font-medium truncate"
                    title={p.title}
                  >
                    {p.title}
                  </div>
                  {p.description && (
                    <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">
                      {p.description}
                    </div>
                  )}
                  <div className="text-xs text-text-secondary flex items-center gap-x-3 gap-y-0.5 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="w-3 h-3" />
                      {p.mod_count} {p.mod_count === 1 ? 'mod' : 'mods'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Heart className="w-3 h-3" />
                      {p.like_count}
                    </span>
                    {p.primary_hero && (
                      <span className="text-text-tertiary">{p.primary_hero}</span>
                    )}
                    {p.is_featured && (
                      <Badge variant="success">
                        <Sparkles className="w-3 h-3 mr-1 inline" />
                        Featured
                      </Badge>
                    )}
                    {p.has_nsfw && <Badge variant="warning">NSFW</Badge>}
                    <span className="text-text-tertiary">
                      {formatRelativeDate(isoFromUnix(p.updated_at ?? p.created_at))}
                    </span>
                  </div>
                </div>

                {confirming ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Unpublish?</span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleUnpublish(p.id)}
                      isLoading={busy}
                      disabled={busy}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmingId(null)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    {onOpenProfile && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={ExternalLink}
                        onClick={() => onOpenProfile(p.id)}
                        title="View details"
                      >
                        View
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Pencil}
                      onClick={() =>
                        setEditTarget({
                          id: p.id,
                          title: p.title,
                          description: p.description,
                        })
                      }
                      title="Edit title and description"
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      onClick={() => setConfirmingId(p.id)}
                      title="Unpublish this profile"
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editTarget && (
        <EditProfileDialog
          profileId={editTarget.id}
          initialTitle={editTarget.title}
          initialDescription={editTarget.description}
          onClose={() => setEditTarget(null)}
          onSaved={(updated) => handleEdited(updated)}
        />
      )}
    </div>
  );
}
