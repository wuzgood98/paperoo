import type { PageRotation } from "@/lib/editor/types";
import { ocrRenderScale } from "@/lib/ocr/render-scale";
import { AnnotationMode } from "@/lib/pdf/pdfjs";
import type { PDFPageProxy } from "@/lib/pdf/pdfjs";
import { renderPdfPage } from "@/lib/pdf/render-page";

export const renderPageForOcr = async (
  page: PDFPageProxy,
  sourceRotate: PageRotation,
  displayedWidth: number,
  displayedHeight: number
): Promise<{ image: HTMLCanvasElement; scale: number }> => {
  const scale = ocrRenderScale(displayedWidth, displayedHeight);
  const canvas = document.createElement("canvas");
  await renderPdfPage(page, canvas, scale, {
    annotationMode: AnnotationMode.DISABLE,
    pixelRatio: 1,
    rotation: sourceRotate,
  });
  return { image: canvas, scale };
};
