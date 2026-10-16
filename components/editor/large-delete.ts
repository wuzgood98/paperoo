import { pdfVectorIsLarge } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";

/** Whether the large-delete confirmation is open; one dialog for the editor. */
let confirming = false;
const listeners = new Set<() => void>();

export const setLargeDeleteConfirming = (next: boolean): void => {
  confirming = next;
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeLargeDelete = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isLargeDeleteConfirming = (): boolean => confirming;

/**
 * Delete the selection. A PDF vector covering more than half the page asks
 * first: removing a shape that size is rarely what a stray Delete meant.
 */
export const requestDeleteSelection = (): void => {
  const state = editorStore.getState();
  const vector = editorStore.selectedPdfVector();
  const page = state.document.pages.find(
    (item) => item.id === state.currentPageId
  );
  if (vector && page && pdfVectorIsLarge(vector, page)) {
    setLargeDeleteConfirming(true);
    return;
  }
  editorStore.deleteSelected();
};
