import "@/lib/pdf/stream-iterator";
// The legacy build fills in newer features pdf.js 6 uses, like
// `Map.getOrInsertComputed` and `Math.sumPrecise`, that Safari 18 lacks.
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

export {
  AnnotationMode,
  getDocument,
  OPS,
  OutputScale,
  PasswordException,
  PixelsPerInch,
  RenderingCancelledException,
} from "pdfjs-dist/legacy/build/pdf.mjs";
export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";

let configured = false;

export const ensurePdfjsWorker = (): void => {
  if (configured || typeof window === "undefined") {
    return;
  }

  GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdf.worker.ts", import.meta.url),
    { type: "module" }
  );
  configured = true;
};

export const PDFJS_CMAP_URL = "/pdfjs/cmaps/";
export const PDFJS_STANDARD_FONT_URL = "/pdfjs/standard_fonts/";
export const PDFJS_WASM_URL = "/pdfjs/wasm/";
export const PDFJS_ICC_URL = "/pdfjs/iccs/";

/** How the app opens every pdf.js document; `data` is added per call. */
export const PDFJS_DOCUMENT_PARAMS = {
  cMapPacked: true,
  cMapUrl: PDFJS_CMAP_URL,
  iccUrl: PDFJS_ICC_URL,
  standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
  // System fonts leave standard-14 faces `missingFile`, and pdf.js only
  // builds glyph paths for clip render modes (4–7) from real font data.
  useSystemFonts: false,
  wasmUrl: PDFJS_WASM_URL,
} as const;

export const MAX_CANVAS_PIXELS = 2 ** 25;
export const MAX_CANVAS_DIM = 32_767;
export const CANVAS_AREA_FACTOR = 200;
export const THUMBNAIL_WIDTH = 140;
