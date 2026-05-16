import { useEffect, useState } from 'react';
import { Globe, LogOut, AlertTriangle, ShieldAlert, Trash2, X, ExternalLink } from 'lucide-react';
import { Button, Badge } from '../common/ui';
import { ConfirmModal } from '../common/PageComponents';
import { useSocialStore } from '../../stores/socialStore';
import { SteamIcon } from './SteamIcon';

export default function SocialAccountSection() {
  const { status, loading, error, hydrate, login, cancelLogin, logout, deleteAccount, clearError } =
    useSocialStore();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleLogin = async () => {
    try {
      await login();
    } catch {
      // error state is set by the store; UI shows it below
    }
  };

  const handleDelete = async () => {
    setDeleteConfirmOpen(false);
    try {
      await deleteAccount();
    } catch {
      // error state set by the store
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary -mt-2">
        Sign in with Steam to publish profiles and like ones you find. Importing works without an account.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
          <button
            onClick={clearError}
            className="text-xs text-red-300 hover:text-red-200 underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {status.signedIn && status.user ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {status.user.avatar_url ? (
              <img
                src={status.user.avatar_url}
                alt=""
                className="w-12 h-12 rounded-full border border-white/10"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-bg-tertiary border border-white/10 flex items-center justify-center text-text-secondary">
                <Globe className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-text-primary font-medium truncate" title={status.user.display_name}>
                {status.user.display_name}
              </div>
              <div className="text-xs text-text-secondary flex items-center gap-2 mt-0.5">
                <Badge variant="success">Signed in</Badge>
                {status.persistenceMode === 'session-only' && (
                  <Badge variant="warning" className="font-normal">Session only</Badge>
                )}
              </div>
            </div>
          </div>

          {status.persistenceMode === 'session-only' && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-xs text-yellow-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">No system keyring detected.</div>
                <p className="mt-1 text-text-secondary">
                  Your session will end when you close Grimoire. Install a Secret Service provider
                  (gnome-keyring, kwallet, or Flatpak Portal) to stay signed in across launches.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            <Button variant="secondary" icon={LogOut} onClick={logout} disabled={loading}>
              Sign out
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={loading}
            >
              Delete account
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {status.persistenceMode === 'session-only' && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-xs text-yellow-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">No system keyring detected.</div>
                <p className="mt-1 text-text-secondary">
                  Your session will end when you close Grimoire. Install a Secret Service provider
                  (gnome-keyring, kwallet, or Flatpak Portal) to stay signed in across launches.
                </p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Button icon={SteamIcon} onClick={handleLogin} isLoading={loading} disabled={loading}>
                Sign in with Steam
              </Button>
              {loading && (
                <Button variant="secondary" icon={X} onClick={cancelLogin}>
                  Cancel
                </Button>
              )}
            </div>
            {loading && (
              <div className="text-xs text-text-secondary flex items-start gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Finish signing in with Steam in your browser. This page will update automatically when you're done.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Grimoire Social account"
        message="This permanently deletes your account, removes your likes, and hides your published profiles from Discover. People who already imported your profiles keep them. This can't be undone."
        confirmLabel="Delete account"
        variant="danger"
      />
    </div>
  );
}
