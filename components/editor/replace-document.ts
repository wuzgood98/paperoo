import { editorStore } from "@/lib/editor/store";

export type ReplaceChoice = "cancel" | "discard" | "export";

/** The open confirmation's resolver; one dialog for the editor. */
let pending: ((choice: ReplaceChoice) => void) | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeReplaceDocument = (
  listener: () => void
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isReplaceDocumentConfirming = (): boolean => pending !== null;

export const resolveReplaceDocument = (choice: ReplaceChoice): void => {
  const resolve = pending;
  pending = null;
  notify();
  resolve?.(choice);
};

/**
 * Ask before a newly opened file replaces unsaved edits. Resolves at once
 * when there is nothing to lose.
 */
export const confirmReplaceDocument = async (): Promise<ReplaceChoice> => {
  if (!editorStore.isDirty()) {
    return "discard";
  }
  // A second open while the dialog is up cancels the first request.
  pending?.("cancel");
  // oxlint-disable-next-line promise/avoid-new -- the dialog resolves it
  const choice = await new Promise<ReplaceChoice>((resolve) => {
    pending = resolve;
    notify();
  });
  return choice;
};
