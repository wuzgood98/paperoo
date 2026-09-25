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

export const sizeCanvas = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): [number, number, number, number, number, number] | null => {
  const scale = new OutputScale();
  scale.limitCanvas(
    width,
    height,
    MAX_CANVAS_PIXELS,
    MAX_CANVAS_DIM,
    CANVAS_AREA_FACTOR
  );

  canvas.width = Math.floor(width * scale.sx);
  canvas.height = Math.floor(height * scale.sy);
  canvas.style.width = `${Math.floor(width)}px`;
  canvas.style.height = `${Math.floor(height)}px`;

  const sx = canvas.width / width;
  const sy = canvas.height / height;
  return sx !== 1 || sy !== 1 ? [sx, 0, 0, sy, 0, 0] : null;
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
  options: { annotationMode?: number; previous?: RenderTask | null } = {}
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
    const viewport = page.getViewport({ scale });
    const transform = sizeCanvas(canvas, viewport.width, viewport.height);
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

export const thumbnailScale = (pageWidth: number): number =>
  THUMBNAIL_WIDTH / Math.max(pageWidth, 1);
