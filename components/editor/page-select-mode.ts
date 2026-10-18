import { useSyncExternalStore } from "react";

import { editorStore } from "@/lib/editor/store";

/**
 * Whether a plain click in the page list picks pages instead of opening
 * them: the touch-friendly way to select, beside Ctrl/⌘ and Shift clicks.
 */
let selecting = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setPageSelectMode = (next: boolean): void => {
  selecting = next;
  if (!next) {
    editorStore.clearPageSelection();
  }
  for (const listener of listeners) {
    listener();
  }
};

export const usePageSelectMode = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => selecting,
    () => false
  );
