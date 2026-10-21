"use client";

import { useEffect } from "react";

import { requestDeleteSelection } from "@/components/editor/large-delete";
import { toastManager } from "@/components/ui/toast-manager";
import { duplicateSelection } from "@/lib/editor/clipboard";
import { confirmOutput } from "@/lib/editor/output-gate";
import { pendingSignature } from "@/lib/editor/pending";
import { editorStore } from "@/lib/editor/store";
import { TOOL_KEYS } from "@/lib/editor/tool-keys";
import {
  NUDGE_DISTANCE,
  NUDGE_DISTANCE_SHIFT,
  ZOOM_STEP,
} from "@/lib/editor/types";
import { bindHotkeys } from "@/lib/hotkeys";
import type { HotkeyDefinition } from "@/lib/hotkeys";
import { prewarmPdfOpen } from "@/lib/pdf/open-pdf";

const printEditedPdf = async (): Promise<void> => {
  const state = editorStore.getState();
  if (state.status !== "ready" || state.isExporting) {
    return;
  }

  try {
    if (!(await confirmOutput())) {
      return;
    }
    const { runPrint } = await import("@/lib/pdf/run-print");
    await runPrint();
  } catch (error) {
    toastManager.add({
      description: error instanceof Error ? error.message : "Print failed.",
      title: "Print failed",
      type: "error",
    });
  }
};

const nudgeSelected = (deltaX: number, deltaY: number): void => {
  if (editorStore.getState().selectedPdfImageId) {
    editorStore.patchPdfImage((object) => ({
      ...object,
      x: object.x + deltaX,
      y: object.y + deltaY,
    }));
    return;
  }
  editorStore.patchSelected((object) => ({
    ...object,
    x: object.x + deltaX,
    y: object.y + deltaY,
  }));
};

/** Escape leaves a creation tool (dropping a signature being placed) first, then clears the selection. */
const escapeEditor = (): void => {
  if (editorStore.getState().tool !== "select") {
    pendingSignature.set(null);
    editorStore.setTool("select");
    return;
  }
  editorStore.clearSelection();
};

const TOOL_HOTKEYS: HotkeyDefinition[] = TOOL_KEYS.map(({ key, tool }) => ({
  handler: () => {
    if (editorStore.getState().status !== "ready") {
      return;
    }
    editorStore.setTool(tool);
  },
  key,
}));

// Hidden by CSS, or cut off behind an open modal (Base UI hides the rest of
// the page from assistive tech while one is open).
const isReachable = (element: HTMLElement): boolean =>
  element.offsetParent !== null &&
  element.closest("[aria-hidden='true'], [inert]") === null;

const focusDocumentSearch = (): void => {
  // The toolbar input is hidden on small screens, where search lives in a
  // dialog behind a trigger button instead.
  const input = [
    ...document.querySelectorAll<HTMLInputElement>(
      "input[data-document-search]"
    ),
  ].find(isReachable);
  if (input) {
    input.focus();
    input.select();
    return;
  }

  const trigger = document.querySelector<HTMLButtonElement>(
    "[data-document-search-trigger]"
  );
  if (trigger && isReachable(trigger)) {
    trigger.click();
  }
};

export const EditorHotkeys = () => {
  useEffect(
    () =>
      bindHotkeys([
        {
          handler: () => editorStore.undo(),
          key: "z",
          meta: true,
          shift: false,
        },
        {
          handler: () => editorStore.redo(),
          key: "z",
          meta: true,
          shift: true,
        },
        { handler: () => editorStore.redo(), key: "y", meta: true },
        {
          // Also keeps ⌘D from opening the browser's bookmark dialog.
          handler: () => {
            if (editorStore.getState().status === "ready") {
              duplicateSelection();
            }
          },
          key: "d",
          meta: true,
        },
        {
          handler: requestDeleteSelection,
          key: "Delete",
        },
        {
          handler: requestDeleteSelection,
          key: "Backspace",
        },
        {
          handler: escapeEditor,
          key: "Escape",
        },
        ...TOOL_HOTKEYS,
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(0, -distance);
          },
          key: "ArrowUp",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(0, distance);
          },
          key: "ArrowDown",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(-distance, 0);
          },
          key: "ArrowLeft",
        },
        {
          handler: (event) => {
            const distance = event.shiftKey
              ? NUDGE_DISTANCE_SHIFT
              : NUDGE_DISTANCE;
            nudgeSelected(distance, 0);
          },
          key: "ArrowRight",
        },
        { handler: focusDocumentSearch, key: "/" },
        { handler: () => editorStore.zoomBy(ZOOM_STEP), key: "=", meta: true },
        { handler: () => editorStore.zoomBy(-ZOOM_STEP), key: "-", meta: true },
        {
          handler: () => {
            document
              .querySelector<HTMLInputElement>("#editor-open-input")
              ?.click();
            void prewarmPdfOpen();
          },
          key: "o",
          meta: true,
        },
        {
          handler: () => {
            void printEditedPdf();
          },
          key: "p",
          meta: true,
        },
        {
          handler: () => {
            if (editorStore.getState().status !== "ready") {
              return;
            }
            editorStore.stepCurrentPage(-1);
          },
          key: "PageUp",
          shift: false,
        },
        {
          handler: () => {
            if (editorStore.getState().status !== "ready") {
              return;
            }
            editorStore.stepCurrentPage(1);
          },
          key: "PageDown",
          shift: false,
        },
      ]),
    []
  );

  return null;
};
