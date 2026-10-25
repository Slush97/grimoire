export const MOD_LIST_DRAG_TYPE = 'application/x-grimoire-list-item';

export type ModListDrag = { kind: 'list'; id: string } | { kind: 'entry'; key: string };

export function readModListDrag(raw: string): ModListDrag | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('kind' in value)) return null;
    if (value.kind === 'list' && 'id' in value && typeof value.id === 'string' && value.id) {
      return { kind: 'list', id: value.id };
    }
    if (value.kind === 'entry' && 'key' in value && typeof value.key === 'string' && value.key) {
      return { kind: 'entry', key: value.key };
    }
  } catch { /* Ignore unrelated drag data. */ }
  return null;
}
