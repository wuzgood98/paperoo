import { useSyncExternalStore } from "react";

import { pageKeyOf } from "@/lib/editor/page-source";
import type { EditorPage } from "@/lib/editor/types";
import { createOcrController } from "@/lib/ocr/controller";
import type { OcrController, OcrControllerState } from "@/lib/ocr/controller";
import { createOcrService } from "@/lib/ocr/service";
import { createTesseractEngine } from "@/lib/ocr/tesseract-engine";

const createBrowserService = () => createOcrService(createTesseractEngine());

const renderEditorPage = async (page: EditorPage) => {
  // The toolbar and every page overlay read OCR state; keep pdf.js out of
  // that import graph until a page is actually recognized.
  const [{ pdfSession }, { renderPageForOcr }] = await Promise.all([
    import("@/lib/pdf/session"),
    import("@/lib/ocr/render-page"),
  ]);
  // OCR renders on the same pdf.js worker as the page view; let the page
  // paint first.
  await pdfSession.afterFirstPaint();
  const key = pageKeyOf(page);
  const pdfPage = await pdfSession.retainPage(key);
  if (!pdfPage) {
    throw new Error("This page is not open.");
  }
  try {
    return await renderPageForOcr(
      pdfPage,
      page.sourceRotate,
      page.width,
      page.height
    );
  } finally {
    pdfSession.releasePageRef(key);
  }
};

export const ocrSession: OcrController = createOcrController({
  createService: createBrowserService,
  renderPage: renderEditorPage,
});

export const useOcrSession = (): OcrControllerState =>
  useSyncExternalStore(
    ocrSession.subscribe,
    ocrSession.getState,
    ocrSession.getState
  );

/**
 * One derived value of the OCR state; the component re-renders only when it
 * changes. `select` must return a primitive or a reference held by the state.
 */
export const useOcrSelector = <T>(
  select: (state: OcrControllerState) => T
): T => {
  const read = (): T => select(ocrSession.getState());
  return useSyncExternalStore(ocrSession.subscribe, read, read);
};
