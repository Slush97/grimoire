import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronsUp, Replace, X } from 'lucide-react';
import type { DownloadQueueItem } from '../../types/electron';
import type { ModUpdateManualRequest } from '../../types/modUpdates';
import { removeModUpdateRequest } from '../../lib/api';
import { showToast } from '../../stores/toastStore';
import { IconButton } from '../common/ui';

interface Props {
  items: DownloadQueueItem[];
  manualRequests: ModUpdateManualRequest[];
  priorityDeferred: boolean;
  onCancel: (modId: number, fileId: number, jobId?: string) => Promise<void>;
  onOpenReplacement: (requestId: string) => void;
}

const rowContentClassName = 'flex min-w-0 flex-1 items-center gap-1';

function QueueRow({ number, name, title = name, status, progress, children, renderContent }: {
  number: number; name: string; title?: string;
  status?: string; progress?: number; children?: ReactNode;
  renderContent?: (content: ReactNode) => ReactNode;
}) {
  const content = <>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hl/5 text-2xs tabular-nums text-text-secondary">
      <span className="text-trim-cap">{number}</span>
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-xs text-text-secondary" title={title}>{name}</span>
      {status && <span className="block text-2xs text-text-secondary">{status}</span>}
      {progress !== undefined && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-hl/5">
        <span className="block h-full bg-accent" style={{ width: `${progress}%` }} />
      </span>}
    </span>
  </>;
  return <>
    {renderContent ? renderContent(content) : <div className={rowContentClassName}>{content}</div>}
    {children}
  </>;
}

const rowClassName = 'group flex items-center gap-1 rounded-sm px-1.5 py-1.5 hover:bg-hl/5';

function DownloadRowContent({ item, number, priorityDeferred, onCancel, renderContent, overlay = false }: {
  item: DownloadQueueItem; number: number; priorityDeferred: boolean;
  onCancel: Props['onCancel']; renderContent?: (content: ReactNode) => ReactNode; overlay?: boolean;
}) {
  const { t } = useTranslation();
  const [prioritizing, setPrioritizing] = useState(false);
  const percentage = item.phase === 'paused' && item.progress && item.progress.total > 0
    ? Math.min(100, Math.max(0, item.progress.downloaded / item.progress.total * 100)) : undefined;
  const prioritize = async () => {
    if (!item.jobId || prioritizing) return;
    setPrioritizing(true);
    try { await window.electronAPI.prioritizeQueuedDownload(item.jobId); }
    catch { showToast(t('downloadQueue.reorderFailed'), { tone: 'error' }); }
    finally { setPrioritizing(false); }
  };
  return <QueueRow number={number} name={item.fileName} title={item.modName ?? item.fileName} renderContent={renderContent}
      status={item.phase === 'paused' ? t('downloadQueue.paused', { percent: Math.round(percentage ?? 0) }) : undefined}
      progress={percentage}>
      <IconButton icon={ChevronsUp} size="sm" disabled={!item.jobId || prioritizing || overlay}
        label={priorityDeferred ? t('downloadQueue.downloadNext') : t('downloadQueue.downloadNow')}
        onClick={() => void prioritize()} />
      <IconButton icon={X} size="sm" label={t('downloadQueue.removeFromQueue')} disabled={overlay}
        onClick={() => void onCancel(item.modId, item.fileId, item.jobId)} />
    </QueueRow>;
}

function SortableDownloadRow(props: {
  item: DownloadQueueItem; number: number; priorityDeferred: boolean; onCancel: Props['onCancel'];
}) {
  const { t } = useTranslation();
  const { item } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.jobId ?? `pending:${item.modId}:${item.fileId}`, disabled: !item.jobId,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.32 : undefined,
  };
  return <li ref={setNodeRef} style={style} className={rowClassName} data-queue-job-id={item.jobId}>
    <DownloadRowContent {...props} renderContent={content => <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      disabled={!item.jobId} aria-label={t('downloadQueue.reorder', { name: item.fileName })}
      title={t('downloadQueue.reorder', { name: item.fileName })}
      className={`${rowContentClassName} touch-none rounded-sm text-left cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-default`}>
      {content}
    </button>} />
  </li>;
}

/** Queue membership changes independently from high-frequency active progress. */
export default memo(function DownloadQueueRows({ items, manualRequests, priorityDeferred, onCancel, onOpenReplacement }: Props) {
  const { t } = useTranslation();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const backendIds = items.flatMap(item => item.jobId ? [item.jobId] : []);
  const resetDrag = () => setDraggingId(null);
  const finishDrag = async ({ active, over }: DragEndEvent) => {
    const source = String(active.id);
    resetDrag();
    if (!over) return;
    const from = backendIds.indexOf(source);
    const to = backendIds.indexOf(String(over.id));
    if (from < 0 || to < 0 || from === to) return;
    const finalIds = arrayMove(backendIds, from, to);
    try { await window.electronAPI.moveQueuedDownload(source, finalIds[to + 1] ?? null); }
    catch { showToast(t('downloadQueue.reorderFailed'), { tone: 'error' }); }
  };
  const activeIndex = items.findIndex(item => item.jobId === draggingId);
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragStart={({ active }) => setDraggingId(String(active.id))}
    onDragEnd={event => void finishDrag(event)} onDragCancel={resetDrag}>
    <SortableContext items={backendIds} strategy={verticalListSortingStrategy}>
      <ul className="space-y-0.5">
        {items.map((item, index) => <SortableDownloadRow key={item.jobId ?? `pending:${item.modId}:${item.fileId}`}
          item={item} number={index + 1} priorityDeferred={priorityDeferred} onCancel={onCancel} />)}
        {manualRequests.map((request, index) => <li key={request.id} className={rowClassName} data-manual-request-id={request.id}>
          <QueueRow number={items.length + index + 1} name={request.modName} status={t('installed.updateAll.needsManualReplacement')}>
            <IconButton icon={Replace} size="sm" label={t('installed.updateAll.chooseReplacement')} onClick={() => onOpenReplacement(request.id)} />
            <IconButton icon={X} size="sm" label={t('installed.updateAll.cancelRequest')} onClick={() => {
              void removeModUpdateRequest(request.id).catch(() => showToast(t('installed.updateAll.cancelFailed'), { tone: 'error' }));
            }} />
          </QueueRow>
        </li>)}
      </ul>
    </SortableContext>
    {createPortal(
      <DragOverlay zIndex={60} className="pointer-events-none">
        {activeIndex >= 0 ? <ul className="opacity-95">
          <li className={`${rowClassName} bg-bg-secondary shadow-2xl`}>
            <DownloadRowContent item={items[activeIndex]} number={activeIndex + 1} priorityDeferred={priorityDeferred}
              onCancel={onCancel} overlay />
          </li>
        </ul> : null}
      </DragOverlay>,
      document.body,
    )}
  </DndContext>;
});
