import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, FolderOpen, MonitorCog } from 'lucide-react';
import { listEditorCandidates, showOpenDialog } from '../../lib/api';
import type { EditorCandidate } from '../../types/electron';
import { Modal, ModalBody } from '../common/Modal';
import { ModalHeader } from '../common/ui';

interface Props {
  onClose: () => void;
  /** null = OS default app; a string = path to the chosen editor binary. */
  onChoose: (editorPath: string | null) => void;
}

// Picker for which application opens gameinfo.gi. Shown the first time the
// user clicks Edit File (and from the "change editor" link): the OS default
// for .gi is text/plain, which often resolves to a word processor, so users
// pick a real editor once and Grimoire remembers it.
export default function EditorPickerModal({ onClose, onChoose }: Props) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<EditorCandidate[]>([]);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    listEditorCandidates()
      .then((found) => {
        if (!cancelled) setCandidates(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const browse = async () => {
    const path = await showOpenDialog({
      title: t('performance.editor.chooseTitle'),
      filters: navigator.platform.startsWith('Win')
        ? [{ name: 'Applications', extensions: ['exe'] }]
        : undefined,
    });
    if (path) onChoose(path);
  };

  const rowClass =
    'w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg border border-hl/10 bg-bg-tertiary hover:border-accent transition-colors cursor-pointer';

  return (
    <Modal onClose={onClose} size="sm" labelledBy={titleId}>
      <ModalHeader
        title={t('performance.editor.title')}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
      <ModalBody className="space-y-2">
        <p className="mb-3 text-xs text-text-secondary">{t('performance.editor.description')}</p>
        <button type="button" className={rowClass} onClick={() => onChoose(null)}>
          <MonitorCog className="w-4 h-4 text-text-secondary shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm text-text-primary">{t('settings.language.systemDefault')}</span>
            <span className="block text-xs text-text-secondary">
              {t('performance.editor.systemDefaultHint')}
            </span>
          </span>
        </button>
        {candidates.map((candidate) => (
          <button
            key={candidate.path}
            type="button"
            className={rowClass}
            onClick={() => onChoose(candidate.path)}
          >
            <AppWindow className="w-4 h-4 text-text-secondary shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm text-text-primary">{candidate.name}</span>
              <span className="block text-xs text-text-secondary truncate">{candidate.path}</span>
            </span>
          </button>
        ))}
        <button type="button" className={rowClass} onClick={() => void browse()}>
          <FolderOpen className="w-4 h-4 text-text-secondary shrink-0" aria-hidden="true" />
          <span className="block text-sm text-text-primary">{t('performance.editor.browse')}</span>
        </button>
      </ModalBody>
    </Modal>
  );
}
