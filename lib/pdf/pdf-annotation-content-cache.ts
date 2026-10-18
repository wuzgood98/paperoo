import { displayedCanvasRotation } from "@/lib/editor/coordinates";
import { pageKeyOf, pageKeyString } from "@/lib/editor/page-source";
import type { PageKey } from "@/lib/editor/page-source";
import type { EditorPage } from "@/lib/editor/types";
import { AnnotationMode } from "@/lib/pdf/pdfjs";
import { renderPdfPage } from "@/lib/pdf/render-page";
import { pdfSession } from "@/lib/pdf/session";

/** Full-page canvases are large; keep a few pages and zoom levels, oldest out. */
export const MAX_CACHED_PAGE_CANVASES = 6;

export interface PageCanvasCacheDeps<TCanvas> {
  /** Generation of the open PDFs; a change drops every cached canvas. */
  currentDocument: () => number;
  render: (
    page: PageKey,
    scale: number,
    rotation: number | undefined
  ) => Promise<TCanvas | null>;
}

export type PageCanvasCache<TCanvas> = (
  page: PageKey,
  scale: number,
  rotation?: number
) => Promise<TCanvas | null>;

const cacheKey = (
  page: PageKey,
  scale: number,
  rotation: number | undefined
): string => `${pageKeyString(page)}:${scale}:${rotation ?? 0}`;

/**
 * LRU of rendered page canvases, keyed by page, scale and rotation. In-flight
 * renders are shared. Keys are page indexes, which repeat across files, so
 * the cache empties when the open document changes; otherwise a new PDF
 * could sample the previous file's page as its cover background.
 */
export const createPageCanvasCache = <TCanvas>({
  currentDocument,
  render,
}: PageCanvasCacheDeps<TCanvas>): PageCanvasCache<TCanvas> => {
  const cache = new Map<string, Promise<TCanvas | null>>();
  let cacheDocument: number | null = null;

  return async (page, scale, rotation) => {
    const current = currentDocument();
    if (current !== cacheDocument) {
      cache.clear();
      cacheDocument = current;
    }
    const key = cacheKey(page, scale, rotation);
    const existing = cache.get(key);
    if (existing) {
      // Re-insert so the Map's order stays least-recently-used first.
      cache.delete(key);
      cache.set(key, existing);
      return await existing;
    }
    const rendering = render(page, scale, rotation);
    cache.set(key, rendering);
    for (const oldKey of cache.keys()) {
      if (cache.size <= MAX_CACHED_PAGE_CANVASES) {
        break;
      }
      // Dropped, not zeroed: a caller may still be drawing from it.
      cache.delete(oldKey);
    }
    try {
      const canvas = await rendering;
      if (!canvas && cache.get(key) === rendering) {
        cache.delete(key);
      }
      return canvas;
    } catch (error) {
      if (cache.get(key) === rendering) {
        cache.delete(key);
      }
      throw error;
    }
  };
};

const renderContentCanvas = async (
  key: PageKey,
  scale: number,
  rotation: number | undefined,
  pixelRatio?: number
): Promise<HTMLCanvasElement | null> => {
  const page = await pdfSession.retainPage(key);
  if (!page) {
    return null;
  }
  const canvas = document.createElement("canvas");
  try {
    await renderPdfPage(page, canvas, scale, {
      annotationMode: AnnotationMode.DISABLE,
      pixelRatio,
      rotation,
    });
    return canvas;
  } finally {
    pdfSession.releasePageRef(key);
  }
};

/** Shown on screen under edited annotations, so at device resolution. */
export const getPageContentCanvas = createPageCanvasCache({
  currentDocument: () => pdfSession.generation,
  render: (key, scale, rotation) => renderContentCanvas(key, scale, rotation),
});

/**
 * Only read for colors, so at CSS resolution: a quarter of the pixels (and
 * memory) on a 2x display. Samplers map rects by the canvas's own width.
 */
const getPageSampleCanvas = createPageCanvasCache({
  currentDocument: () => pdfSession.generation,
  render: (key, scale, rotation) =>
    renderContentCanvas(key, scale, rotation, 1),
});

/** Page content canvas in displayed space, so displayed rects map by scale only. */
export const getDisplayedPageContentCanvas = (
  page: Pick<EditorPage, "docId" | "sourceIndex" | "sourceRotate">,
  scale: number
): Promise<HTMLCanvasElement | null> =>
  getPageContentCanvas(pageKeyOf(page), scale, displayedCanvasRotation(page));

/** Page content in displayed space at CSS resolution, for color sampling. */
export const getDisplayedPageSampleCanvas = (
  page: Pick<EditorPage, "docId" | "sourceIndex" | "sourceRotate">,
  scale: number
): Promise<HTMLCanvasElement | null> =>
  getPageSampleCanvas(pageKeyOf(page), scale, displayedCanvasRotation(page));
