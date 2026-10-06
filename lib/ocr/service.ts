import { ocrWordsFromEngine } from "@/lib/ocr/from-engine";
import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import type {
  OcrImage,
  OcrOptions,
  OcrProgress,
  OcrResult,
} from "@/lib/ocr/types";

export interface OcrEngine {
  recognize: (
    image: OcrImage,
    options: OcrOptions,
    onProgress?: (progress: OcrProgress) => void
  ) => Promise<EngineOcrPage>;
  terminate?: () => Promise<void>;
}

export interface OcrService {
  recognize: (
    image: OcrImage,
    options: OcrOptions,
    onProgress?: (progress: OcrProgress) => void
  ) => Promise<OcrResult>;
  terminate: () => Promise<void>;
}

export const createOcrService = (engine: OcrEngine): OcrService => ({
  recognize: async (image, options, onProgress) => {
    const page = await engine.recognize(image, options, onProgress);
    return {
      words: ocrWordsFromEngine(page, {
        pageId: options.pageId,
        scale: options.scale,
      }),
    };
  },
  terminate: async () => {
    await engine.terminate?.();
  },
});
