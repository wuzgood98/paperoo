import { useSyncExternalStore } from "react";

import type { EditorPage } from "@/lib/editor/types";
import { createOcrController } from "@/lib/ocr/controller";
import type { OcrController, OcrControllerState } from "@/lib/ocr/controller";
import { renderPageForOcr } from "@/lib/ocr/render-page";
import { createOcrService } from "@/lib/ocr/service";
import { createTesseractEngine } from "@/lib/ocr/tesseract-engine";
import { pdfSession } from "@/lib/pdf/session";

const createBrowserService = () => createOcrService(createTesseractEngine());

const renderEditorPage = async (page: EditorPage) => {
  const pdfPage = await pdfSession.retainPage(page.sourceIndex);
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
    pdfSession.releasePageRef(page.sourceIndex);
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
