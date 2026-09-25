import { GlobalWorkerOptions } from "pdfjs-dist";

export {
  AnnotationMode,
  getDocument,
  OutputScale,
  PasswordException,
  PixelsPerInch,
  RenderingCancelledException,
} from "pdfjs-dist";
export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from "pdfjs-dist";

let configured = false;

export const ensurePdfjsWorker = (): void => {
  if (configured || typeof window === "undefined") {
    return;
  }

  GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url),
    { type: "module" }
  );
  configured = true;
};

export const PDFJS_CMAP_URL = "/pdfjs/cmaps/";
export const PDFJS_STANDARD_FONT_URL = "/pdfjs/standard_fonts/";
export const PDFJS_WASM_URL = "/pdfjs/wasm/";
export const PDFJS_ICC_URL = "/pdfjs/iccs/";

export const MAX_CANVAS_PIXELS = 2 ** 25;
export const MAX_CANVAS_DIM = 32_767;
export const CANVAS_AREA_FACTOR = 200;
export const THUMBNAIL_WIDTH = 140;
