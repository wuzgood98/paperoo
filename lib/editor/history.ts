import type { HistorySnapshot } from "@/lib/editor/types";

export const MAX_HISTORY = 80;

export interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

export const emptyHistory = (): HistoryState => ({
  future: [],
  past: [],
});

export const cloneSnapshot = (snapshot: HistorySnapshot): HistorySnapshot =>
  structuredClone(snapshot);

export const pushHistory = (
  history: HistoryState,
  snapshot: HistorySnapshot
): HistoryState => ({
  future: [],
  past: [...history.past, cloneSnapshot(snapshot)].slice(-MAX_HISTORY),
});

export const undoHistory = (
  history: HistoryState,
  current: HistorySnapshot
): { history: HistoryState; snapshot: HistorySnapshot } | null => {
  const previous = history.past.at(-1);
  if (!previous) {
    return null;
  }

  return {
    history: {
      future: [cloneSnapshot(current), ...history.future],
      past: history.past.slice(0, -1),
    },
    snapshot: previous,
  };
};

export const redoHistory = (
  history: HistoryState,
  current: HistorySnapshot
): { history: HistoryState; snapshot: HistorySnapshot } | null => {
  const [next, ...rest] = history.future;
  if (!next) {
    return null;
  }

  return {
    history: {
      future: rest,
      past: [...history.past, cloneSnapshot(current)],
    },
    snapshot: next,
  };
};

export const snapshotsEqual = (
  left: HistorySnapshot,
  right: HistorySnapshot
): boolean =>
  left.currentPageId === right.currentPageId &&
  left.selectedObjectIds.length === right.selectedObjectIds.length &&
  left.selectedObjectIds.every(
    (id, index) => id === right.selectedObjectIds[index]
  ) &&
  JSON.stringify(left.document) === JSON.stringify(right.document);
