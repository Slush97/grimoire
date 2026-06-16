import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, LogOut, AlertTriangle, ShieldAlert, Trash2, X, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button, Badge } from '../common/ui';
import { ConfirmModal } from '../common/PageComponents';
import { useSocialStore } from '../../stores/socialStore';
import { SteamIcon } from './SteamIcon';

function KeyringNotice() {
  const { t } = useTranslation();
  return (
    <div
      className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-sm border border-yellow-500/25 bg-yellow-500/[0.07] px-2.5 py-1.5 text-[11px] leading-tight text-yellow-100"
      title={t('social.account.safeStorageUnencrypted')}
    >
      <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 text-yellow-300" />
      <span className="min-w-0">
        <span className="font-medium text-yellow-200">{t('social.account.sessionOnlyPunctuated')}</span>{' '}
        <span className="text-text-secondary">{t('social.account.keyringUnavailable')}</span>
      </span>
    </div>
  );
}

export default function SocialAccountSection() {
  const { t } = useTranslation();
  const { status, loading, error, hydrated, hydrate, login, cancelLogin, logout, deleteAccount, clearError } =
    useSocialStore();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const showKeyringNotice = hydrated && status.persistenceMode === 'session-only';

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
        {t('social.account.signInPrompt')}
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
            {t('common.actions.dismiss')}
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
                <Badge variant="success">{t('social.account.signedIn')}</Badge>
                {status.persistenceMode === 'session-only' && (
                  <Badge variant="warning" className="font-normal">{t('social.account.sessionOnly')}</Badge>
                )}
              </div>
            </div>
          </div>

          {showKeyringNotice && (
            <KeyringNotice />
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            <Button variant="secondary" icon={LogOut} onClick={logout} disabled={loading}>
              {t('social.account.signOut')}
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={loading}
            >
              {t('social.account.deleteAccount')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 flex-wrap">
                <Button icon={SteamIcon} onClick={handleLogin} isLoading={loading} disabled={loading}>
                  {t('social.account.signInWithSteam')}
                </Button>
                {loading && (
                  <Button variant="secondary" icon={X} onClick={cancelLogin}>
                    {t('common.actions.cancel')}
                  </Button>
                )}
              </div>
              {showKeyringNotice && (
                <KeyringNotice />
              )}
            </div>
            <div className="text-xs text-text-secondary flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                {t('social.account.opensSteamInBrowser')}
              </span>
            </div>
            {loading && (
              <div className="text-xs text-text-secondary flex items-start gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t('social.account.finishSigningIn')}
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
        title={t('social.account.deleteAccountTitle')}
        message={t('social.account.deleteMessage')}
        confirmLabel={t('social.account.deleteAccount')}
        variant="danger"
      />
    </div>
  );
}
