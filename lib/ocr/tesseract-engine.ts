import { createWorker, PSM } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";

import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import type { OcrEngine } from "@/lib/ocr/service";
import type { OcrOptions, OcrProgress } from "@/lib/ocr/types";

const OEM_LSTM_ONLY = 1;
const OCR_WORKER_PATH = "/ocr/worker.min.js";
const OCR_CORE_PATH = "/ocr/core";
const OCR_LANG_PATH = "/ocr";

/**
 * Tesseract in its own worker. Whole pages use automatic segmentation;
 * a single outline label is one block of text.
 */
export const createTesseractEngine = (
  pageSegMode: PSM = PSM.AUTO
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
    await next.setParameters({ tessedit_pageseg_mode: pageSegMode });
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
