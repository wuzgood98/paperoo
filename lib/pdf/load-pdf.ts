import { editorStore } from "@/lib/editor/store";
import { EMPTY_PDF_FORM } from "@/lib/editor/types";
import type { EditorPage, PdfFormModel } from "@/lib/editor/types";
import { outlineTextSession } from "@/lib/ocr/outline-session";
import { ocrSession } from "@/lib/ocr/session";
import { isPdfBytes, pdfSession, readFileBytes } from "@/lib/pdf/session";

/** Guards background hydration when a newer file is selected mid-load. */
let loadGeneration = 0;

export const loadPdfFile = async (file: File): Promise<void> => {
  loadGeneration += 1;
  const generation = loadGeneration;
  const isStale = (): boolean => generation !== loadGeneration;

  editorStore.setStatus("loading");
  editorStore.setFileName(file.name);

  try {
    if (file.type && file.type !== "application/pdf") {
      throw new Error("That file is not a PDF.");
    }

    const bytes = await readFileBytes(file);
    if (isStale()) {
      return;
    }
    if (!isPdfBytes(bytes)) {
      throw new Error("This file does not look like a valid PDF.");
    }

    await Promise.all([ocrSession.reset(), outlineTextSession.reset()]);
    if (isStale()) {
      return;
    }

    // First window paints immediately; the rest hydrates in the background
    // so time-to-edit drops from O(pages) to O(1).
    let firstPainted = false;
    await pdfSession.openProgressive(bytes, {
      isCancelled: isStale,
      onFirstPages: (pages) => {
        if (isStale()) {
          return;
        }
        if (pages.length === 0) {
          return;
        }
        firstPainted = true;
        editorStore.resetDocument(pages, file.name, EMPTY_PDF_FORM);
      },
      onForm: (form) => {
        if (isStale()) {
          return;
        }
        editorStore.setDocumentForm(form);
      },
      onMorePages: (pages) => {
        if (isStale()) {
          return;
        }
        editorStore.appendPages(pages);
      },
    });
    if (isStale()) {
      return;
    }
    if (!firstPainted) {
      throw new Error("This PDF has no pages.");
    }
    editorStore.markHydrated();
  } catch (error) {
    if (isStale()) {
      return;
    }
    await pdfSession.close();
    await Promise.all([ocrSession.reset(), outlineTextSession.reset()]);
    const message =
      error instanceof Error ? error.message : "Could not open this PDF.";
    editorStore.clearDocument();
    editorStore.setStatus("error", message);
    throw error;
  }
};

/**
 * Open saved PDF bytes for a restored session and extract every page in
 * full; the caller replaces the fresh pages with the saved ones. Null when
 * a newer open superseded this one.
 */
export const openRestoredPdf = async (
  bytes: Uint8Array,
  fileName: string
): Promise<{ form: PdfFormModel; pages: EditorPage[] } | null> => {
  loadGeneration += 1;
  const generation = loadGeneration;
  const isStale = (): boolean => generation !== loadGeneration;

  editorStore.setStatus("loading");
  editorStore.setFileName(fileName);
  try {
    await Promise.all([ocrSession.reset(), outlineTextSession.reset()]);
    if (isStale()) {
      return null;
    }
    const opened = await pdfSession.open(bytes);
    return isStale() ? null : opened;
  } catch (error) {
    if (isStale()) {
      return null;
    }
    await pdfSession.close();
    editorStore.clearDocument();
    throw error;
  }
};
