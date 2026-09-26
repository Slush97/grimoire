import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyDroppedModFiles } from './customModImport';
import { useAppStore } from '../stores/appStore';
import { showToast } from '../stores/toastStore';

/** Whether a drag carries at least one external file (as opposed to a link,
 *  selected text, or an internal reorder). Extensions are unknowable until the
 *  drop, so this is all the indicator can key off. */
function isFileDrag(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  for (let i = 0; i < transfer.items.length; i++) {
    if (transfer.items[i].kind === 'file') return true;
  }
  return false;
}

/**
 * App-wide local mod drop: a `.vpk` or archive dropped anywhere in the window
 * stages in the batch import dialog, whatever page or surface is under the
 * pointer. Returns whether an external file drag is currently over the window,
 * for the drop indicator.
 *
 * The handlers are capture-phase on window so they see the drop ahead of any
 * React handler that stops propagation (modal backdrops, portal content,
 * thumbnail zones). Ownership is decided by extension at drop time, so image,
 * MP3 and model zones keep every file type this controller does not claim.
 */
export function useGlobalModFileDrop(): boolean {
  const { t } = useTranslation();
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    // dragenter/dragleave fire again on every element the pointer crosses, so
    // count depth instead of toggling per event or the indicator strobes.
    let depth = 0;

    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth++;
      setDragActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };

    // Accepting the drag is what keeps Electron from navigating the window to
    // the dropped file. Links and internal drags are left to their own targets.
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragActive(false);
      e.preventDefault();

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      const state = useAppStore.getState();
      // The add-variants dialog owns mod drops for its whole mounted lifetime.
      if (state.suppressGlobalModDrop) return;

      const { paths, rejectedNames, unresolvedCount } = classifyDroppedModFiles(files, (file) =>
        window.electronAPI.getDroppedFilePath(file)
      );
      // Nothing importable: let images, audio and models reach their own zones.
      if (paths.length === 0 && unresolvedCount === 0) return;
      e.stopPropagation();
      // The zone under the pointer never sees this drop, so its own onDrop can't
      // clear its drag highlight. A synthetic dragleave does, and carries no
      // dataTransfer so the depth counter above ignores it.
      e.target?.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));

      // Staging into a batch that is mid-submission would lose the files when
      // the finished rows are reconciled, so say so instead of swallowing them.
      if (state.batchImportBusy) {
        showToast(t('layout.modDrop.busy'), { tone: 'warning', duration: 7000 });
        return;
      }

      if (unresolvedCount > 0) {
        showToast(t('installed.import.dropUnresolved'), { tone: 'error', duration: 9000 });
      } else if (rejectedNames.length > 0) {
        showToast(t('installed.import.expectedVpk', { name: rejectedNames[0] }), {
          tone: 'warning',
        });
      }
      state.openBatchImport(paths);
    };

    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [t]);

  // While the add-variants dialog owns drops, its own highlight is the feedback:
  // an app-wide overlay on top of it would promise the wrong destination.
  const suppressed = useAppStore((s) => s.suppressGlobalModDrop);
  return dragActive && !suppressed;
}
