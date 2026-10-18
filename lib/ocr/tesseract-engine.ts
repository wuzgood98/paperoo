import type { PSM, Worker as TesseractWorker } from "tesseract.js";

import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import type { OcrEngine } from "@/lib/ocr/service";
import type { OcrOptions, OcrProgress } from "@/lib/ocr/types";

const OEM_LSTM_ONLY = 1;
const OCR_WORKER_PATH = "/ocr/worker.min.js";
const OCR_CORE_PATH = "/ocr/core";
const OCR_LANG_PATH = "/ocr";

/** Tesseract page segmentation modes this app uses (values of its `PSM`). */
export const PAGE_SEG_AUTO = "3" satisfies `${PSM}`;
export const PAGE_SEG_SINGLE_BLOCK = "6" satisfies `${PSM}`;
type PageSegMode = typeof PAGE_SEG_AUTO | typeof PAGE_SEG_SINGLE_BLOCK;

/**
 * Tesseract in its own worker. Whole pages use automatic segmentation;
 * a single outline label is one block of text.
 */
export const createTesseractEngine = (
  pageSegMode: PageSegMode = PAGE_SEG_AUTO
): OcrEngine => {
  let language: string | null = null;
  let worker: TesseractWorker | null = null;

  const ensureWorker = async (
    nextLanguage: string,
    onProgress?: (progress: OcrProgress) => void
  ): Promise<TesseractWorker> => {
    if (worker && language === nextLanguage) {
      return worker;
    }
    if (worker) {
      await worker.terminate();
      worker = null;
      language = null;
    }
    // Loaded with the first recognition, not with the editor.
    const { createWorker } = await import("tesseract.js");
    const next = await createWorker(nextLanguage, OEM_LSTM_ONLY, {
      corePath: OCR_CORE_PATH,
      langPath: OCR_LANG_PATH,
      logger: (message) => {
        onProgress?.({
          progress: message.progress,
          status: message.status,
        });
      },
      workerBlobURL: false,
      workerPath: OCR_WORKER_PATH,
    });
    await next.setParameters({
      // SAFETY: PageSegMode only holds values of tesseract.js's string enum
      // PSM, which is not importable as a value without loading the library.
      tessedit_pageseg_mode: pageSegMode as PSM,
    });
    worker = next;
    language = nextLanguage;
    return next;
  };

  return {
    recognize: async (image, options: OcrOptions, onProgress) => {
      const active = await ensureWorker(options.language, onProgress);
      const { data } = await active.recognize(image, {}, { blocks: true });
      const page: EngineOcrPage = { blocks: data.blocks ?? [] };
      return page;
    },
    terminate: async () => {
      if (!worker) {
        return;
      }
      await worker.terminate();
      worker = null;
      language = null;
    },
  };
};
