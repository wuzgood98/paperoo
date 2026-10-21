import { useSyncExternalStore } from "react";

const STORAGE_KEY = "paperoo.highlightFormFields";

const readStored = (): boolean => {
  try {
    // Unset means on: people open a form to fill it.
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};

let highlight: boolean | null = null;
const listeners = new Set<() => void>();

/** Whether fillable form fields get a tint, remembered across visits. */
export const highlightFormFields = (): boolean => {
  highlight ??= readStored();
  return highlight;
};

export const setHighlightFormFields = (next: boolean): void => {
  highlight = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Private windows may refuse storage; the choice lasts this visit.
  }
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useHighlightFormFields = (): boolean =>
  useSyncExternalStore(subscribe, highlightFormFields, () => true);
