// The skin editor's undo history: the generic draft history (editHistory.ts) over its part edits.

import type { SkinPartEdit } from '../types/skinEditor';
import { createEditHistory, recordEdit, redoEdit, undoEdit, type EditHistory, type EditInteraction } from './editHistory';

export type SkinEditInteraction = EditInteraction;
export type SkinEditHistory = EditHistory<SkinPartEdit[]>;

export const createSkinEditHistory = (edits: SkinPartEdit[]): SkinEditHistory => createEditHistory(edits);
export const recordSkinEdit = (history: SkinEditHistory, edits: SkinPartEdit[]): SkinEditHistory => recordEdit(history, edits);
export const undoSkinEdit = (history: SkinEditHistory): SkinEditHistory => undoEdit(history);
export const redoSkinEdit = (history: SkinEditHistory): SkinEditHistory => redoEdit(history);
