import {
  AnnotationMode,
  CANVAS_AREA_FACTOR,
  MAX_CANVAS_DIM,
  MAX_CANVAS_PIXELS,
  OutputScale,
  RenderingCancelledException,
  THUMBNAIL_WIDTH,
} from "@/lib/pdf/pdfjs";
import type { PDFPageProxy, RenderTask } from "@/lib/pdf/pdfjs";

export type CanvasTransform = [number, number, number, number, number, number];

export interface CanvasBackingSize {
  cssHeight: number;
  cssWidth: number;
  height: number;
  transform: CanvasTransform | null;
  width: number;
}

export const canvasBackingSize = (
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number
): CanvasBackingSize => {
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  const sx = width / cssWidth;
  const sy = height / cssHeight;
  return {
    cssHeight,
    cssWidth,
    height,
    transform: sx === 1 && sy === 1 ? null : [sx, 0, 0, sy, 0, 0],
    width,
  };
};

export const sizeCanvas = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio = OutputScale.pixelRatio
): CanvasTransform | null => {
  const scale = new OutputScale();
  scale.sx = pixelRatio;
  scale.sy = pixelRatio;
  scale.limitCanvas(
    width,
    height,
    MAX_CANVAS_PIXELS,
    MAX_CANVAS_DIM,
    CANVAS_AREA_FACTOR
  );
  const backing = canvasBackingSize(width, height, scale.sx);
  canvas.width = backing.width;
  canvas.height = backing.height;
  canvas.style.width = `${backing.cssWidth}px`;
  canvas.style.height = `${backing.cssHeight}px`;
  return backing.transform;
};

export const releaseCanvas = (canvas: HTMLCanvasElement): void => {
  canvas.width = 0;
  canvas.height = 0;
};

const settleTask = async (
  task: RenderTask | null | undefined
): Promise<void> => {
  if (!task) {
    return;
  }
  try {
    await task.promise;
  } catch {
    // Cancelled or failed previous paints must not block the next one.
  }
};

const canvasQueue = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

const holdQueue = (): void => {
  // Replaced with the resolver for the canvas paint queue.
};

export const renderPdfPage = async (
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  options: {
    annotationMode?: number;
    pixelRatio?: number;
    previous?: RenderTask | null;
    rotation?: number;
  } = {}
): Promise<RenderTask | null> => {
  const previousWork = canvasQueue.get(canvas) ?? Promise.resolve();
  let release = holdQueue;
  // oxlint-disable-next-line promise/avoid-new -- the canvas queue is a manually settled lock
  const currentWork = new Promise<void>((resolve) => {
    release = resolve;
  });
  canvasQueue.set(canvas, currentWork);

  try {
    await previousWork;
    options.previous?.cancel();
    await settleTask(options.previous);
    const viewport = page.getViewport({
      rotation: options.rotation,
      scale,
    });
    const transform = sizeCanvas(
      canvas,
      viewport.width,
      viewport.height,
      options.pixelRatio
    );
    const task = page.render({
      annotationMode: options.annotationMode ?? AnnotationMode.ENABLE,
      canvas,
      transform: transform ?? undefined,
      viewport,
    });

    try {
      await task.promise;
      return task;
    } catch (error) {
      if (error instanceof RenderingCancelledException) {
        return null;
      }
      throw error;
    }
  } finally {
    release();
  }
};

/**
 * Render one displayed-space rect of a page at `scale` pixels per point, at
 * device ratio 1, into a canvas sized to that rect. Pixel row 0 is exactly
 * `rect.y`, so sampled offsets need no rounding correction.
 */
export const renderPdfPageRegion = async (
  page: PDFPageProxy,
  rect: { height: number; width: number; x: number; y: number },
  scale: number,
  rotation?: number
): Promise<HTMLCanvasElement> => {
  const viewport = page.getViewport({
    offsetX: -rect.x * scale,
    offsetY: -rect.y * scale,
    rotation,
    scale,
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(rect.width * scale));
  canvas.height = Math.max(1, Math.ceil(rect.height * scale));
  await page.render({
    annotationMode: AnnotationMode.DISABLE,
    canvas,
    viewport,
  }).promise;
  return canvas;
};

export const thumbnailScale = (pageWidth: number): number =>
  THUMBNAIL_WIDTH / Math.max(pageWidth, 1);
