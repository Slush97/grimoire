import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { ModRequirementSource } from '../../../src/types/gamebanana';

const pending = new Map<string, { sender: number; resolve: (accepted: boolean) => void }>();
export function requestRequirementCheck(window: BrowserWindow | null, source: ModRequirementSource): Promise<boolean> {
    if (!window || window.isDestroyed()) return Promise.resolve(false);
    if (source.requirements.status === 'loaded' && source.requirements.items.length === 0) return Promise.resolve(true);
    return new Promise(resolve => {
        const requestId = randomUUID();
        const finish = (accepted: boolean) => {
            clearTimeout(timer);
            window.webContents.removeListener('destroyed', cancel);
            pending.delete(requestId);
            resolve(accepted);
        };
        const cancel = () => finish(false);
        const timer = setTimeout(cancel, 10 * 60 * 1000);
        pending.set(requestId, { sender: window.webContents.id, resolve: finish });
        window.webContents.once('destroyed', cancel);
        window.webContents.send('requirement-install-check', { requestId, source });
    });
}
export function respondToRequirementCheck(sender: number, requestId: string, accepted: boolean): void {
    const request = pending.get(requestId);
    if (request?.sender === sender) request.resolve(accepted);
}
