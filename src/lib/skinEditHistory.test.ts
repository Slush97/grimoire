import { describe, expect, it } from 'vitest';
import type { SkinPartEdit } from '../types/skinEditor';
import { createSkinEditHistory, recordSkinEdit, redoSkinEdit, undoSkinEdit } from './skinEditHistory';

const edit = (tint: string): SkinPartEdit[] => [{ material: 'body.vmat', hidden: false, tint }];

describe('skin edit history', () => {
  it('keeps the restored edit set as the first undo boundary', () => {
    const baseline = edit('#123456');
    const initial = createSkinEditHistory(baseline);
    expect(undoSkinEdit(initial)).toBe(initial);
    const changed = recordSkinEdit(initial, edit('#654321'));
    expect(undoSkinEdit(changed).present).toEqual(baseline);
    expect(redoSkinEdit(undoSkinEdit(changed)).present).toEqual(changed.present);
  });
  it('groups continuous updates within one interaction, then records the next interaction separately', () => {
    const initial = createSkinEditHistory([]);
    let history = recordSkinEdit({ ...initial, interaction: { kind: 'pointer', recorded: false } }, edit('#111111'));
    history = recordSkinEdit(history, edit('#222222'));
    history = recordSkinEdit(history, edit('#333333'));
    expect(history.past).toEqual([[]]);
    history = recordSkinEdit({ ...history, interaction: null }, edit('#444444'));
    expect(undoSkinEdit(history).present).toEqual(edit('#333333'));
    expect(undoSkinEdit(undoSkinEdit(history)).present).toEqual([]);
  });
  it('clears redo when a new edit branches after undo', () => {
    const first = recordSkinEdit(createSkinEditHistory([]), edit('#111111'));
    const second = recordSkinEdit(first, edit('#222222'));
    const branched = recordSkinEdit(undoSkinEdit(second), edit('#333333'));
    expect(branched.future).toEqual([]);
    expect(redoSkinEdit(branched)).toBe(branched);
  });
  it('ignores unchanged values and bounds memory to 100 undo steps', () => {
    let history = createSkinEditHistory([]);
    expect(recordSkinEdit(history, [])).toBe(history);
    for (let i = 0; i < 130; i++) history = recordSkinEdit(history, edit(`#${i.toString(16).padStart(6, '0')}`));
    expect(history.past).toHaveLength(100);
  });
});
