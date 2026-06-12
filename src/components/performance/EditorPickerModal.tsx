import { useEffect, useState } from 'react';
import { AppWindow, FolderOpen, MonitorCog, X } from 'lucide-react';
import { listEditorCandidates, showOpenDialog } from '../../lib/api';
import type { EditorCandidate } from '../../types/electron';

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
  const [candidates, setCandidates] = useState<EditorCandidate[]>([]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const browse = async () => {
    const path = await showOpenDialog({
      title: 'Choose an editor application',
      filters: navigator.platform.startsWith('Win')
        ? [{ name: 'Applications', extensions: ['exe'] }]
        : undefined,
    });
    if (path) onChoose(path);
  };

  const rowClass =
    'w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg border border-white/10 bg-bg-tertiary hover:border-accent transition-colors cursor-pointer';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-picker-title"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="editor-picker-title" className="text-base font-semibold text-text-primary">
              Open gameinfo.gi with
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              Pick the editor for config tweaks. Grimoire remembers this; use the change editor
              link on the Performance Config card to switch later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-2">
          <button type="button" className={rowClass} onClick={() => onChoose(null)}>
            <MonitorCog className="w-4 h-4 text-text-secondary shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm text-text-primary">System default</span>
              <span className="block text-xs text-text-secondary">
                Whatever your OS opens text files with
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
            <span className="block text-sm text-text-primary">Browse for an application...</span>
          </button>
        </div>
      </div>
    </div>
  );
}
