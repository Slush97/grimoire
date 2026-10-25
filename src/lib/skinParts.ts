import type { SkinPartEdit } from '../types/skinEditor';
import { hasSkinPartEdit } from './skinColorAdjustments';

export function materialBasename(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.vmat(?:_c)?$/i, '').toLowerCase() ?? '';
}

export function skinPartLabel(path: string): string {
  return materialBasename(path).replace(/[_-]+/g, ' ');
}

export function editedPartCount(edits: SkinPartEdit[]): number {
  return edits.filter(hasSkinPartEdit).length;
}

export function skinTintVector(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

/** Full material paths remain authoritative. A basename only maps when unique. */
export function editForMaterial(name: string, edits: SkinPartEdit[]): SkinPartEdit | undefined {
  const matches = edits.filter((edit) => materialBasename(edit.material) === materialBasename(name));
  return matches.length === 1 ? matches[0] : undefined;
}
