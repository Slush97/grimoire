import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronsUp, GripVertical, Replace, X } from 'lucide-react';
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

function QueueRow({ number, name, title = name, handle, status, progress, children }: {
  number: number; name: string; title?: string; handle?: ReactNode;
  status?: string; progress?: number; children?: ReactNode;
}) {
  return <>
    {handle ?? <span className="w-7 shrink-0" aria-hidden />}
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hl/5 text-2xs tabular-nums text-text-secondary">
      <span className="text-trim-cap">{number}</span>
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs text-text-secondary" title={title}>{name}</p>
      {status && <p className="text-2xs text-text-secondary">{status}</p>}
      {progress !== undefined && <div className="mt-1 h-1 overflow-hidden rounded-full bg-hl/5">
        <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
      </div>}
    </div>
    {children}
  </>;
}

const rowClassName = 'group flex items-center gap-1 rounded-sm px-1.5 py-1.5 hover:bg-hl/5';

function DownloadRowContent({ item, number, priorityDeferred, onCancel, handle, overlay = false }: {
  item: DownloadQueueItem; number: number; priorityDeferred: boolean;
  onCancel: Props['onCancel']; handle: ReactNode; overlay?: boolean;
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
  return <QueueRow number={number} name={item.fileName} title={item.modName ?? item.fileName}
      status={item.phase === 'paused' ? t('downloadQueue.paused', { percent: Math.round(percentage ?? 0) }) : undefined}
      progress={percentage} handle={handle}>
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
    <DownloadRowContent {...props} handle={<button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      disabled={!item.jobId} aria-label={t('downloadQueue.reorder', { name: item.fileName })}
      title={t('downloadQueue.reorder', { name: item.fileName })}
      className="flex h-7 w-7 shrink-0 touch-none items-center justify-center rounded-sm text-text-tertiary hover:text-text-primary cursor-grab active:cursor-grabbing disabled:cursor-default disabled:opacity-30">
      <GripVertical className="h-3.5 w-3.5" />
    </button>} />
  </li>;
}

/** Queue membership changes independently from high-frequency active progress. */
export default memo(function DownloadQueueRows({ items, manualRequests, priorityDeferred, onCancel, onOpenReplacement }: Props) {
  const { t } = useTranslation();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const backendIds = items.flatMap(item => item.jobId ? [item.jobId] : []);
  const liveIds = new Set(backendIds);
  const orderedIds = draftOrder && draggingId && liveIds.has(draggingId)
    ? [...draftOrder.filter(id => liveIds.has(id)), ...backendIds.filter(id => !draftOrder.includes(id))]
    : backendIds;
  const byId = new Map(items.filter(item => item.jobId).map(item => [item.jobId!, item]));
  const ordered = [...orderedIds.map(id => byId.get(id)!), ...items.filter(item => !item.jobId)];
  const resetDrag = () => { setDraggingId(null); setDraftOrder(null); };
  const reorderDraft = ({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return;
    const from = orderedIds.indexOf(String(active.id));
    const to = orderedIds.indexOf(String(over.id));
    if (from >= 0 && to >= 0) setDraftOrder(arrayMove(orderedIds, from, to));
  };
  const finishDrag = async ({ active, over }: DragEndEvent) => {
    const source = String(active.id);
    const target = over ? String(over.id) : null;
    const finalIds = orderedIds;
    const index = finalIds.indexOf(source);
    const changed = finalIds.some((id, position) => backendIds[position] !== id);
    resetDrag();
    if (!target || index < 0 || !liveIds.has(target) || !changed) return;
    try { await window.electronAPI.moveQueuedDownload(source, finalIds[index + 1] ?? null); }
    catch { showToast(t('downloadQueue.reorderFailed'), { tone: 'error' }); }
  };
  const activeIndex = ordered.findIndex(item => item.jobId === draggingId);
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragStart={({ active }) => { setDraggingId(String(active.id)); setDraftOrder(backendIds); }}
    onDragOver={reorderDraft} onDragEnd={event => void finishDrag(event)} onDragCancel={resetDrag}>
    <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
      <ul className="space-y-0.5">
        {ordered.map((item, index) => <SortableDownloadRow key={item.jobId ?? `pending:${item.modId}:${item.fileId}`}
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
    <DragOverlay>{activeIndex >= 0 ? <ul className="pointer-events-none opacity-95">
      <li className={`${rowClassName} bg-bg-secondary shadow-2xl`}>
        <DownloadRowContent item={ordered[activeIndex]} number={activeIndex + 1} priorityDeferred={priorityDeferred} onCancel={onCancel}
          handle={<span className="flex h-7 w-7 shrink-0 items-center justify-center text-text-tertiary"><GripVertical className="h-3.5 w-3.5" /></span>} overlay />
      </li>
    </ul> : null}</DragOverlay>
  </DndContext>;
});
