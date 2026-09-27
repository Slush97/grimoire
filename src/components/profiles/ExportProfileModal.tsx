import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ClipboardCopy, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button, ModalHeader } from '../common/ui';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { exportPortableProfile } from '../../lib/api';
import { PORTABLE_PROFILE_FILE_EXTENSION } from '../../types/portableProfile';
import type { PortableExportResult } from '../../types/portableProfile';

interface ExportProfileModalProps {
  profileId: string;
  profileName: string;
  onClose: () => void;
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 _.-]+/g, '').trim().replace(/\s+/g, '_');
  return cleaned || 'profile';
}

export default function ExportProfileModal({ profileId, profileName, onClose }: ExportProfileModalProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<PortableExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    exportPortableProfile(profileId)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [profileId]);

  const handleSaveFile = () => {
    if (!result) return;
    const blob = new Blob([result.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(profileName)}${PORTABLE_PROFILE_FILE_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shareCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy={titleId} size="md">
      <ModalHeader
        title={t('profiles.actions.exportProfile')}
        titleId={titleId}
        subtitle={profileName}
        subtitleTitle={profileName}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
        <ModalBody className="space-y-4">
          {!result && !error && (
            <div className="text-text-secondary text-sm inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('exportProfile.building')}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <>
              {result.warnings.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-sm text-yellow-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t('exportProfile.modsSkipped', { count: result.warnings.length })}
                    </div>
                    <div className="text-xs text-text-secondary mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                      {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                    <div className="text-xs text-text-secondary mt-2">
                      {t('exportProfile.localBlocked')}
                    </div>
                  </div>
                </div>
              )}

              <div className="text-xs text-text-secondary">
                {t('exportProfile.modsIncluded', { count: result.profile.mods.length })}
                {result.profile.extensions?.grimoire?.crosshair && t('exportProfile.crosshairSuffix')}
                {result.profile.extensions?.grimoire?.autoexecCommands?.length
                  ? t('exportProfile.autoexecSuffix', { count: result.profile.extensions.grimoire.autoexecCommands.length })
                  : ''}
              </div>

              <div className="flex flex-col gap-2">
                <Button onClick={handleSaveFile} icon={Download} className="w-full justify-center">
                  {t('exportProfile.saveFile')}
                </Button>
                <Button
                  onClick={handleCopy}
                  variant="secondary"
                  icon={copied ? CheckCircle2 : ClipboardCopy}
                  className="w-full justify-center"
                >
                  {copied ? t('exportProfile.copied') : t('exportProfile.copyShareCode')}
                </Button>
              </div>

              {result.shareCode && (
                <div className="mt-2">
                  <div className="text-xs text-text-secondary mb-1">{t('exportProfile.shareCodePreview')}</div>
                  <code className="block text-2xs font-mono bg-bg-tertiary border border-hl/5 rounded-md px-2 py-1.5 break-all text-text-secondary max-h-24 overflow-y-auto">
                    {result.shareCode}
                  </code>
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>{t('common.actions.close')}</Button>
        </ModalFooter>
    </Modal>
  );
}
