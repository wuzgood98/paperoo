import { displayedCanvasRotation } from "@/lib/editor/coordinates";
import type { EditorPage } from "@/lib/editor/types";
import { AnnotationMode } from "@/lib/pdf/pdfjs";
import { renderPdfPage } from "@/lib/pdf/render-page";
import { pdfSession } from "@/lib/pdf/session";

const cache = new Map<string, HTMLCanvasElement>();

const cacheKey = (
  sourceIndex: number,
  scale: number,
  rotation: number | undefined
): string => `${sourceIndex}:${scale}:${rotation ?? 0}`;

export const getPageContentCanvas = async (
  sourceIndex: number,
  scale: number,
  rotation?: number
): Promise<HTMLCanvasElement | null> => {
  const key = cacheKey(sourceIndex, scale, rotation);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const page = await pdfSession.retainPage(sourceIndex);
  if (!page) {
    return null;
  }
  const canvas = document.createElement("canvas");
  try {
    await renderPdfPage(page, canvas, scale, {
      annotationMode: AnnotationMode.DISABLE,
      rotation,
    });
    cache.set(key, canvas);
    return canvas;
  } finally {
    pdfSession.releasePageRef(sourceIndex);
  }
};

/** Page content canvas in displayed space, so displayed rects map by scale only. */
export const getDisplayedPageContentCanvas = (
  page: Pick<EditorPage, "sourceIndex" | "sourceRotate">,
  scale: number
): Promise<HTMLCanvasElement | null> =>
  getPageContentCanvas(page.sourceIndex, scale, displayedCanvasRotation(page));

export const invalidatePageContentCanvas = (
  sourceIndex: number,
  scale: number,
  rotation?: number
): void => {
  cache.delete(cacheKey(sourceIndex, scale, rotation));
};

export const clearAnnotationContentCache = (): void => {
  cache.clear();
};
