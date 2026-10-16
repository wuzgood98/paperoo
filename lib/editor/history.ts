import type { HistorySnapshot } from "@/lib/editor/types";

export const MAX_HISTORY = 80;

/**
 * Snapshots hold the store's documents by reference. Store updates are
 * immutable, so untouched pages and objects are shared between snapshots
 * instead of being copied per undo step.
 */
export interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

export const emptyHistory = (): HistoryState => ({
  future: [],
  past: [],
});

export const pushHistory = (
  history: HistoryState,
  snapshot: HistorySnapshot
): HistoryState => ({
  future: [],
  past: [...history.past, snapshot].slice(-MAX_HISTORY),
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
      future: [current, ...history.future],
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
      past: [...history.past, current],
    },
    snapshot: next,
  };
};

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- generic walkers over the store's plain-data document graph */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Structural equality that returns early on shared references, so comparing
 * two snapshots only walks the subtrees an edit replaced. Missing and
 * `undefined` keys compare equal, matching JSON semantics.
 */
export const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (!(isPlainObject(left) && isPlainObject(right))) {
    return false;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) {
      return false;
    }
  }
  return true;
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
  sameValue(left.document, right.document);

/**
 * Freeze a document graph so accidental in-place mutation throws instead of
 * silently rewriting undo history. Stops at already-frozen nodes, so after
 * the first call only newly created objects are walked.
 */
export const deepFreeze = <T>(value: T): T => {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value) ||
    // Typed arrays with elements cannot be frozen.
    ArrayBuffer.isView(value)
  ) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
};
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */
