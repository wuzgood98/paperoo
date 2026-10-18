import { toastManager } from "@/components/ui/toast-manager";
import { editorStore } from "@/lib/editor/store";
import { createOutlineTextController } from "@/lib/ocr/outline-controller";
import type { OutlineTextController } from "@/lib/ocr/outline-controller";
import { renderOutlineForOcr } from "@/lib/ocr/render-outline";
import {
  createTesseractEngine,
  PAGE_SEG_SINGLE_BLOCK,
} from "@/lib/ocr/tesseract-engine";

/** Outline-only text recognition for the open document. */
export const outlineTextSession: OutlineTextController =
  createOutlineTextController({
    apply: (pageId, vectorId, runs) => {
      editorStore.applyOutlineTextRuns(pageId, vectorId, runs);
    },
    createEngine: () => createTesseractEngine(PAGE_SEG_SINGLE_BLOCK),
    getPages: () => editorStore.getState().document.pages,
    onError: (message) => {
      toastManager.add({
        description: message,
        title: "Couldn't read this text",
        type: "error",
      });
    },
    render: (vector, frame) =>
      renderOutlineForOcr(
        vector.commands,
        frame,
        vector.paint === "eoFill" ? "evenodd" : "nonzero"
      ),
  });
