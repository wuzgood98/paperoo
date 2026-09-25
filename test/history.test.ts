import { expect, test } from "vitest";

import {
  emptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/lib/editor/history";
import type { HistorySnapshot } from "@/lib/editor/types";

const snapshot = (label: string): HistorySnapshot => ({
  currentPageId: label,
  document: { pages: [] },
  selectedObjectIds: [label],
});

test("undo and redo restore snapshots and coalesce a linear stack", () => {
  let history = emptyHistory();
  const a = snapshot("a");
  const b = snapshot("b");
  const c = snapshot("c");

  history = pushHistory(history, a);
  history = pushHistory(history, b);

  const undone = undoHistory(history, c);
  expect(undone?.snapshot.currentPageId).toBe("b");

  const redone = redoHistory(undone?.history ?? history, undone?.snapshot ?? b);
  expect(redone?.snapshot.currentPageId).toBe("c");
});

test("pushing after undo clears the redo stack", () => {
  let history = pushHistory(emptyHistory(), snapshot("a"));
  history = pushHistory(history, snapshot("b"));
  const undone = undoHistory(history, snapshot("c"));
  expect(undone).not.toBeNull();
  if (!undone) {
    return;
  }
  history = pushHistory(undone.history, undone.snapshot);
  expect(history.future).toHaveLength(0);
});
