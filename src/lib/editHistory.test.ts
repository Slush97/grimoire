import { describe, expect, it } from 'vitest';
import { EDIT_HISTORY_LIMIT, beginInteraction, createEditHistory, endInteraction, recordEdit, redoEdit, resumeEditHistory, undoEdit, type EditHistory } from './editHistory';

/** A movement choice's shape, cut down: the history holds any plain draft value. */
interface Choice { color: string; palette: { mode: 'solid' } | { mode: 'gradient'; end: string }; brightness: number; image: string | null }
const choice = (color: string, extra: Partial<Choice> = {}): Choice => ({ color, palette: { mode: 'solid' }, brightness: 1, image: null, ...extra });

/** A drag: begin, many values, end. */
function drag<T>(history: EditHistory<T>, values: T[], kind: 'pointer' | 'keyboard' | 'input' = 'pointer'): EditHistory<T> {
  let next = beginInteraction(history, kind);
  for (const value of values) next = recordEdit(next, value);
  return endInteraction(next, kind);
}

describe('edit history', () => {
  it('undoes and redoes whole values, back to the first one and no further', () => {
    const start = createEditHistory(choice('#ff70cf'));
    expect(undoEdit(start)).toBe(start);
    let history = recordEdit(start, choice('#21c4ff'));
    history = recordEdit(history, choice('#21c4ff', { palette: { mode: 'gradient', end: '#ffd000' } }));
    history = recordEdit(history, choice('#21c4ff', { palette: { mode: 'gradient', end: '#ffd000' }, image: 'data:image/png;base64,AA==' }));
    expect(undoEdit(history).present.image).toBeNull();
    expect(undoEdit(undoEdit(history)).present.palette).toEqual({ mode: 'solid' });
    const back = undoEdit(undoEdit(undoEdit(history)));
    expect(back.present).toEqual(choice('#ff70cf'));
    expect(undoEdit(back)).toBe(back);
    expect(redoEdit(redoEdit(redoEdit(back))).present).toEqual(history.present);
  });

  it('records a colour-picker or slider drag as one step', () => {
    let history = createEditHistory(choice('#ff70cf'));
    history = drag(history, ['#ff0000', '#ee1111', '#dd2222', '#cc3333'].map((color) => choice(color)));
    history = drag(history, [1.1, 1.4, 1.75, 2].map((brightness) => choice('#cc3333', { brightness })), 'keyboard');
    expect(history.past).toHaveLength(2);
    expect(undoEdit(history).present).toEqual(choice('#cc3333'));
    expect(undoEdit(undoEdit(history)).present).toEqual(choice('#ff70cf'));
  });

  it('records typing in a field as one step until it loses focus, and the next change apart', () => {
    let history = drag(createEditHistory(choice('#000000')), ['#1', '#12', '#123456'].map((color) => choice(color)), 'input');
    history = recordEdit(history, choice('#123456', { brightness: 2 }));
    expect(history.past.map((value) => value.color)).toEqual(['#000000', '#123456']);
  });

  it('keeps an interaction of one kind open while another kind ends', () => {
    let history = beginInteraction(createEditHistory(choice('#000000')), 'pointer');
    history = recordEdit(history, choice('#111111'));
    history = endInteraction(history, 'keyboard');
    history = recordEdit(history, choice('#222222'));
    expect(history.past).toHaveLength(1);
  });

  it('drops redo on a new edit, ignores unchanged values and keeps at most the limit', () => {
    const first = recordEdit(createEditHistory(choice('#000000')), choice('#111111'));
    const branched = recordEdit(undoEdit(recordEdit(first, choice('#222222'))), choice('#333333'));
    expect(branched.future).toEqual([]);
    expect(recordEdit(branched, choice('#333333'))).toBe(branched);
    let history = createEditHistory(0);
    for (let i = 1; i <= EDIT_HISTORY_LIMIT + 30; i++) history = recordEdit(history, i);
    expect(history.past).toHaveLength(EDIT_HISTORY_LIMIT);
  });

  it('resumes a session history only when it leads to the persisted value', () => {
    const kept = recordEdit(beginInteraction(createEditHistory(choice('#000000')), 'pointer'), choice('#111111'));
    const resumed = resumeEditHistory(kept, choice('#111111'));
    expect(resumed.past).toEqual(kept.past);
    expect(resumed.interaction).toBeNull();
    expect(resumeEditHistory(kept, choice('#999999'))).toEqual(createEditHistory(choice('#999999')));
    expect(resumeEditHistory(undefined, choice('#999999'))).toEqual(createEditHistory(choice('#999999')));
  });
});
