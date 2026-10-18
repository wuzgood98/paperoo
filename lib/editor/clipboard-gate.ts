import { getTargetKind } from "@/lib/hotkeys";

/** Popups whose own content owns the clipboard. */
const POPUP_SELECTOR = "[role='dialog'], [role='alertdialog'], [role='menu']";

/**
 * Whether a copy, cut or paste belongs to the editor. Text fields, a text
 * selection (page text, search results) and open dialogs keep the browser's
 * own clipboard behavior.
 */
export const shouldHandleClipboardEvent = (
  target: EventTarget | null,
  selection: Pick<Selection, "isCollapsed" | "rangeCount"> | null
): boolean => {
  if (getTargetKind(target) === "text") {
    return false;
  }
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    return false;
  }
  if (target instanceof HTMLElement && target.closest(POPUP_SELECTOR)) {
    return false;
  }
  return true;
};
