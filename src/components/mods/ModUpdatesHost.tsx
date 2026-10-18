import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameBananaModDetails } from '../../types/gamebanana';
import { chooseModUpdateReplacement, downloadMod, getModDetails } from '../../lib/api';
import { requestDownload, releaseDownloadRequest } from '../../lib/downloadActivity';
import { shouldBlurNsfw } from '../../lib/appSettings';
import { visibleInstalledMods } from '../../lib/visibleMods';
import { decideFileDownload, replaceableFilesFor, summarizeUpdateScope } from '../../lib/updateActions';
import { classifyModFiles } from '../../lib/updateFileMatch';
import { mergeSourceFileIds } from '../../lib/updateCheck';
import { useAppStore } from '../../stores/appStore';
import { useModUpdatesStore } from '../../stores/modUpdatesStore';
import { showToast } from '../../stores/toastStore';
import { ActivityNotice } from '../common/ActivityNotice';
import { Button, ModalHeader } from '../common/ui';
import { Modal, ModalBody } from '../common/Modal';
import { LoadingState } from '../common/PageComponents';
import ModDetailsModal from '../ModDetailsModal';

export function ModUpdateNotices() {
  const { t } = useTranslation();
  const { state, dismissedNotices, dismissNotice, openRequest } = useModUpdatesStore();
  const request = state.manualRequests.find((item) => !dismissedNotices.has(item.id));
  const error = state.errors.find((item) => !dismissedNotices.has(item.id));
  return (
    <>
      {error && (
        <ActivityNotice tone="error" onDismiss={() => dismissNotice(error.id)}>
          <p>{t('installed.updateAll.failed', { name: error.modName })}</p>
          <p className="mt-1 text-xs text-text-secondary">{error.message}</p>
        </ActivityNotice>
      )}
      {request && (
        <ActivityNotice onDismiss={() => dismissNotice(request.id)}>
          <p>{t('installed.updateAll.manualNotice', { name: request.modName })}</p>
          <Button size="sm" variant="primary" className="mt-2" onClick={() => openRequest(request.id)}>
            {t('installed.updateAll.chooseReplacement')}
          </Button>
        </ActivityNotice>
      )}
    </>
  );
}

/** The queue can open replacement choices from any page without interrupting downloads. */
export function ModUpdateReplacementHost() {
  const { t } = useTranslation();
  const { state, selectedRequestId, closeRequest } = useModUpdatesStore();
  const request = state.manualRequests.find((item) => item.id === selectedRequestId);
  const mods = useAppStore((state) => state.mods);
  const settings = useAppStore((state) => state.settings);
  const [loaded, setLoaded] = useState<{ requestId: string; details: GameBananaModDetails } | null>(null);
  const requestId = request?.id;
  const modId = request?.modId;
  const section = request?.section;

  useEffect(() => {
    if (!requestId || modId === undefined || !section) return;
    let active = true;
    void getModDetails(modId, section).then((details) => {
      if (active) setLoaded({ requestId, details });
    }).catch(() => {
      if (!active) return;
      closeRequest();
      showToast(t('installed.updateAll.loadReplacementFailed'), { tone: 'error' });
    });
    return () => { active = false; };
  }, [requestId, modId, section, closeRequest, t]);

  if (!request) return null;
  if (loaded?.requestId !== request.id) {
    return (
      <Modal onClose={closeRequest} size="sm">
        <ModalHeader title={request.modName} onClose={closeRequest} />
        <ModalBody><LoadingState label={t('installed.details.loading')} /></ModalBody>
      </Modal>
    );
  }
  const visible = visibleInstalledMods(mods);
  const installed = visible.filter((mod) => mod.gameBananaId === request.modId && (mod.sourceSection ?? 'Mod') === request.section);
  const classification = classifyModFiles(request.modId, loaded.details.files ?? [], installed, mergeSourceFileIds(visible), settings?.autoMatchRemainingFiles ?? true);
  const summary = summarizeUpdateScope(classification);
  const installedFileIds = new Set(installed.flatMap((mod) => mod.gameBananaFileId === undefined ? [] : [mod.gameBananaFileId]));
  const activeFileIds = new Set(installed.flatMap((mod) => !mod.enabled || mod.gameBananaFileId === undefined ? [] : [mod.gameBananaFileId]));
  const handleDownload = async (fileId: number, fileName: string, oldFileId?: number) => {
    if (!requestDownload({ modId: request.modId, fileId, fileName, modName: request.modName })) return;
    try {
      if (oldFileId !== undefined) {
        await chooseModUpdateReplacement({ requestId: request.id, oldFileId, newFileId: fileId });
      } else {
        const decision = decideFileDownload(fileId, classification, installed);
        await downloadMod(request.modId, fileId, fileName, request.section, loaded.details.category?.id, request.modName, decision.replacedModIds.length > 0, decision.replacedModIds);
        await useAppStore.getState().loadMods({ force: true, silent: true });
      }
    } catch {
      showToast(t('installed.updateAll.replacementFailed'), { tone: 'error' });
    } finally {
      releaseDownloadRequest(request.modId, fileId);
    }
  };
  return (
    <ModDetailsModal
      mod={loaded.details}
      section={request.section}
      manualReplacement
      installed={installedFileIds.size > 0}
      installedFileIds={installedFileIds}
      activeFileIds={activeFileIds}
      hideNsfwPreviews={shouldBlurNsfw(settings)}
      updateAvailable
      updateFileIds={new Set(summary.targets.keys())}
      replaceableFiles={replaceableFilesFor(request.sourceFileIds, installed)}
      onReplace={handleDownload}
      onDownload={handleDownload}
      onClose={closeRequest}
    />
  );
}
