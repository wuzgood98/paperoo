import type { FlattenDeps } from "@/lib/pdf/flatten-redacted-pages";
import {
  ensurePdfjsWorker,
  getDocument,
  OPS,
  PDFJS_DOCUMENT_PARAMS,
} from "@/lib/pdf/pdfjs";
import type { VerifyOps } from "@/lib/pdf/verify-redaction";

/** The pdf.js operator codes the redaction safety net follows. */
export const browserVerifyOps: VerifyOps = {
  paintImageMaskXObject: OPS.paintImageMaskXObject,
  paintImageXObject: OPS.paintImageXObject,
  paintInlineImageXObject: OPS.paintInlineImageXObject,
  restore: OPS.restore,
  save: OPS.save,
  transform: OPS.transform,
};

/** JPEG quality for flattened pages: text edges stay crisp at 144 dpi. */
const JPEG_QUALITY = 0.92;

const canvasJpeg = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  // oxlint-disable-next-line promise/avoid-new -- toBlob reports through a callback
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) {
    throw new Error("Could not encode a redacted page.");
  }
  const buffer = await blob.arrayBuffer();
  // Free the page's pixels before the next one renders.
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(buffer);
};

/** RGBA pixels of a bitmap pdf.js decoded, read back through a canvas. */
export const readBitmap = (
  bitmap: ImageBitmap,
  width: number,
  height: number
): Uint8ClampedArray | null => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(bitmap, 0, 0, width, height);
    return context?.getImageData(0, 0, width, height).data ?? null;
  } catch {
    // An unreadable image fails the check; the page is flattened.
    return null;
  }
};

/** Flatten with the page's own pdf.js, canvas and JPEG encoder. */
export const browserFlattenDeps = (): FlattenDeps<HTMLCanvasElement> => ({
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("This browser cannot draw redacted pages.");
    }
    return { canvas, context };
  },
  encodeJpeg: canvasJpeg,
  open: async (bytes) => {
    ensurePdfjsWorker();
    const task = getDocument({
      ...PDFJS_DOCUMENT_PARAMS,
      data: bytes,
      // Keep decoded images as samples, so the safety net can read them.
      isOffscreenCanvasSupported: false,
    });
    const doc = await task.promise;
    return {
      destroy: () => task.destroy(),
      getPage: (pageNumber) => doc.getPage(pageNumber),
    };
  },
});
