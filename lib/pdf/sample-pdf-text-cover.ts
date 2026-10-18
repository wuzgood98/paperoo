import {
  pdfTextCoverRects,
  pdfTextFrameBounds,
  neighbourReachBox,
  pdfTextOriginalInkBox,
  rectsIntersect,
  unionRects,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject, Rect } from "@/lib/editor/types";
import { displayedRectToCanvasPixels } from "@/lib/pdf/canvas-pixels";
import { getDisplayedPageSampleCanvas } from "@/lib/pdf/pdf-annotation-content-cache";
import {
  COVER_SAMPLE_RING_PX,
  sampleBackground,
  toCoverSample,
} from "@/lib/pdf/sample-background";
import type { PdfTextCoverSample } from "@/lib/pdf/sample-background";

/** Facts about a run's original ink and font, measured once when editing starts. */
export type PdfTextMeasurement = Pick<
  PdfTextObject,
  "coverColor" | "coverColorUncertain" | "coverRects" | "reusableFontGlyphs"
>;

export const isPdfTextMeasured = (object: PdfTextObject): boolean =>
  object.coverRects !== undefined && object.reusableFontGlyphs !== undefined;

const clampCanvasRect = (
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number
): Rect | null => {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(canvasWidth, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(canvasHeight, Math.ceil(rect.y + rect.height));
  if (right <= x || bottom <= y) {
    return null;
  }
  return { height: bottom - y, width: right - x, x, y };
};

/** Neighbours whose metric reach misses the sampled ring skip per-glyph ink measuring. */
const mayReachRect = (
  run: PdfTextObject,
  page: EditorPage,
  canvas: HTMLCanvasElement,
  zoom: number,
  target: Rect
): boolean =>
  rectsIntersect(
    displayedRectToCanvasPixels(
      neighbourReachBox(run, page),
      page,
      canvas,
      zoom
    ),
    target
  );

const toLocalRect = (rect: Rect, origin: Rect): Rect => ({
  height: rect.height,
  width: rect.width,
  x: rect.x - origin.x,
  y: rect.y - origin.y,
});

/** The browser I/O a measurement needs; tests pass their own. */
export interface PdfTextMeasureEnv {
  /** The page content canvas in displayed space, or null when unavailable. */
  loadPageCanvas: (
    page: EditorPage,
    zoom: number
  ) => Promise<HTMLCanvasElement | null>;
  /** Characters the export can encode in this font; see `probe-pdf-font`. */
  probeFontGlyphs: (
    sourceIndex: number,
    baseFontName: string | undefined
  ) => Promise<string>;
}

const browserMeasureEnv: PdfTextMeasureEnv = {
  loadPageCanvas: getDisplayedPageSampleCanvas,
  probeFontGlyphs: async (sourceIndex, baseFontName) => {
    // Loaded on first edit so pdf-lib stays out of the initial bundle.
    const { probeReusableFontGlyphs } =
      await import("@/lib/pdf/probe-pdf-font");
    return await probeReusableFontGlyphs(sourceIndex, baseFontName);
  },
};

/** Sample the page around a run's cover rects for the cover color. */
const samplePdfTextCoverFromPage = async (
  page: EditorPage,
  object: PdfTextObject,
  zoom: number,
  covers: readonly Rect[],
  env: PdfTextMeasureEnv
): Promise<PdfTextCoverSample | null> => {
  const canvas = await env.loadPageCanvas(page, zoom);
  if (!canvas) {
    return null;
  }
  const cover = unionRects(covers);
  if (!cover) {
    return null;
  }
  const coverPx = displayedRectToCanvasPixels(cover, page, canvas, zoom);
  const ring = {
    height: coverPx.height + COVER_SAMPLE_RING_PX * 2,
    width: coverPx.width + COVER_SAMPLE_RING_PX * 2,
    x: coverPx.x - COVER_SAMPLE_RING_PX,
    y: coverPx.y - COVER_SAMPLE_RING_PX,
  };
  const imageRect = clampCanvasRect(ring, canvas.width, canvas.height);
  if (!imageRect) {
    return null;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  const image = ctx.getImageData(
    imageRect.x,
    imageRect.y,
    imageRect.width,
    imageRect.height
  );
  const excludeRects = covers.map((rect) =>
    toLocalRect(
      displayedRectToCanvasPixels(rect, page, canvas, zoom),
      imageRect
    )
  );
  for (const neighbour of page.pdfTextObjects) {
    if (
      neighbour.id === object.id ||
      !mayReachRect(neighbour, page, canvas, zoom, imageRect)
    ) {
      continue;
    }
    const box = pdfTextOriginalInkBox(neighbour, page);
    const pixels = displayedRectToCanvasPixels(box, page, canvas, zoom);
    excludeRects.push(toLocalRect(pixels, imageRect));
  }
  const sampled = sampleBackground(
    { data: image.data, height: image.height, width: image.width },
    { height: image.height, width: image.width, x: 0, y: 0 },
    excludeRects
  );
  return sampled ? toCoverSample(sampled) : null;
};

const sampleCoverSafely = async (
  page: EditorPage,
  object: PdfTextObject,
  zoom: number,
  covers: readonly Rect[],
  env: PdfTextMeasureEnv
): Promise<PdfTextCoverSample | null> => {
  try {
    return await samplePdfTextCoverFromPage(page, object, zoom, covers, env);
  } catch {
    return null;
  }
};

const probeFontSafely = async (
  page: EditorPage,
  object: PdfTextObject,
  env: PdfTextMeasureEnv
): Promise<string> => {
  try {
    // The run's own sourceIndex is its text item; the font lives on the page.
    return await env.probeFontGlyphs(page.sourceIndex, object.baseFontName);
  } catch {
    return "";
  }
};

/**
 * Measure a run before it is edited: cover rects from the original glyph ink
 * (main thread only), the page color behind them, and which characters the
 * export can encode in the run's own font. Never rejects; failed parts fall
 * back to white and the bundled font.
 */
export const measurePdfTextForEdit = async (
  page: EditorPage,
  object: PdfTextObject,
  zoom: number,
  env: PdfTextMeasureEnv = browserMeasureEnv
): Promise<PdfTextMeasurement> => {
  const coverRects = object.coverRects ?? pdfTextCoverRects(object, page);
  const [sample, reusableFontGlyphs] = await Promise.all([
    object.coverColor
      ? null
      : sampleCoverSafely(
          page,
          object,
          zoom,
          // A turned run's covers are in its own frame; sample around them.
          coverRects.map((cover) => pdfTextFrameBounds(object, cover)),
          env
        ),
    object.reusableFontGlyphs ?? probeFontSafely(page, object, env),
  ]);
  const measurement: PdfTextMeasurement = { coverRects, reusableFontGlyphs };
  if (sample) {
    measurement.coverColor = sample.color;
    measurement.coverColorUncertain = sample.uncertain;
  }
  return measurement;
};

const inFlight = new Map<string, Promise<void>>();

/**
 * Measure a run once and store the result by id. Call it when editing starts
 * or a run first turns dirty. The store stays synchronous and canvas-free (the
 * export worker shares it), so measuring lives here rather than in a commit.
 * Concurrent calls for one run share a promise; the promise never rejects.
 */
export const ensurePdfTextMeasured = (
  page: EditorPage,
  object: PdfTextObject,
  zoom: number,
  env: PdfTextMeasureEnv = browserMeasureEnv
): Promise<void> => {
  if (isPdfTextMeasured(object)) {
    return Promise.resolve();
  }
  const key = `${page.id}:${object.id}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const measure = async (): Promise<void> => {
    try {
      const measurement = await measurePdfTextForEdit(page, object, zoom, env);
      editorStore.applyPdfTextMeasurement(page.id, object.id, measurement);
    } finally {
      inFlight.delete(key);
    }
  };
  const started = measure();
  inFlight.set(key, started);
  return started;
};
