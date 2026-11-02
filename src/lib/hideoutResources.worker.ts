import { decodeHideoutResource, hideoutResourceTransfers, type HideoutResourceRequest } from './hideoutResources';

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ id: number; request: HideoutResourceRequest }>) => void) | null; postMessage: (message: unknown, transfer: Transferable[]) => void };

scope.onmessage = ({ data: { id, request } }) => {
  decodeHideoutResource(request).then(
    resource => scope.postMessage({ id, resource }, hideoutResourceTransfers(resource)),
    (error: unknown) => scope.postMessage({ id, error: String(error) }, []),
  );
};
