import {
  measurePdfTextWidth,
  pdfTextOverlayBox,
} from "@/lib/editor/object-utils";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { displayedRectToCanvasPixels } from "@/lib/pdf/canvas-pixels";
import { getDisplayedPageContentCanvas } from "@/lib/pdf/pdf-annotation-content-cache";
import {
  sampleCaptionInk,
  scaleCaptionInkToDisplayedBox,
} from "@/lib/pdf/sample-caption-ink";
import type { SampledCaptionInk } from "@/lib/pdf/sample-caption-ink";

/** Read caption fill and underline from the rendered page before a label edit. */
export const sampleLinkCaptionFromPage = async (
  page: EditorPage,
  primary: PdfTextObject,
  zoom: number
): Promise<SampledCaptionInk | null> => {
  const canvas = await getDisplayedPageContentCanvas(page, zoom);
  if (!canvas) {
    return null;
  }
  const runBox = pdfTextOverlayBox(primary, measurePdfTextWidth(primary));
  const pixelRect = displayedRectToCanvasPixels(runBox, page, canvas, zoom);
  const ctx = canvas.getContext("2d");
  if (!ctx || pixelRect.width <= 0 || pixelRect.height <= 0) {
    return null;
  }
  const image = ctx.getImageData(
    pixelRect.x,
    pixelRect.y,
    pixelRect.width,
    pixelRect.height
  );
  const ink = sampleCaptionInk(
    { data: image.data, height: image.height, width: image.width },
    { height: image.height, width: image.width, x: 0, y: 0 }
  );
  if (!ink) {
    return null;
  }
  return scaleCaptionInkToDisplayedBox(ink, image.height, runBox.height);
};
