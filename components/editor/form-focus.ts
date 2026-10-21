import { editorStore } from "@/lib/editor/store";
import type { PdfFormWidget } from "@/lib/editor/types";

/** A page scrolled into view mounts its widgets within a few frames. */
const FOCUS_WIDGET_MAX_FRAMES = 30;

const widgetButton = (widgetId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-form-widget="${CSS.escape(widgetId)}"]`
  );

/**
 * Scroll a form widget's page into view and focus the widget once it has
 * mounted. Focus selects the field and opens it for typing.
 */
export const focusPdfFormWidget = (
  widget: Pick<PdfFormWidget, "id" | "pageId">
): void => {
  editorStore.setCurrentPage(widget.pageId, { syncFitZoom: false });
  let frames = 0;
  const tryFocus = (): void => {
    const node = widgetButton(widget.id);
    if (node) {
      node.focus();
      return;
    }
    frames += 1;
    if (frames < FOCUS_WIDGET_MAX_FRAMES) {
      window.requestAnimationFrame(tryFocus);
    }
  };
  tryFocus();
};
