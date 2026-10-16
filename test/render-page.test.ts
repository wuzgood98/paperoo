import { afterEach, expect, test, vi } from "vitest";

import type { PageViewport } from "@/lib/pdf/pdfjs";
import { RenderingCancelledException } from "@/lib/pdf/pdfjs";
import { canvasBackingSize, renderPdfPage } from "@/lib/pdf/render-page";
import type { PdfPaintTask, RenderablePdfPage } from "@/lib/pdf/render-page";

const LAYOUT_WIDTH = 612;
const LAYOUT_HEIGHT = 792;

test("canvas backing store matches device pixel ratio", () => {
  for (const pixelRatio of [1, 1.25, 1.5, 2]) {
    const backing = canvasBackingSize(LAYOUT_WIDTH, LAYOUT_HEIGHT, pixelRatio);

    expect(backing.cssWidth).toBe(LAYOUT_WIDTH);
    expect(backing.cssHeight).toBe(LAYOUT_HEIGHT);
    expect(backing.width / backing.cssWidth).toBeCloseTo(pixelRatio);
    expect(backing.height / backing.cssHeight).toBeCloseTo(pixelRatio);
    expect(backing.width).toBe(Math.round(LAYOUT_WIDTH * pixelRatio));
    expect(backing.height).toBe(Math.round(LAYOUT_HEIGHT * pixelRatio));
  }
});

test("canvas backing transform is omitted at 1x", () => {
  expect(
    canvasBackingSize(LAYOUT_WIDTH, LAYOUT_HEIGHT, 1).transform
  ).toBeNull();
});

test("canvas backing transform maps one CSS pixel to one device pixel", () => {
  const backing = canvasBackingSize(LAYOUT_WIDTH, LAYOUT_HEIGHT, 2);
  expect(backing.transform).toEqual([2, 0, 0, 2, 0, 0]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A page whose paint stays in flight until it is cancelled. */
const pendingPage = () => {
  const paint = Promise.withResolvers<undefined>();
  const cancel = vi.fn(() => {
    paint.reject(new RenderingCancelledException("Rendering cancelled."));
  });
  const task: PdfPaintTask = { cancel, promise: paint.promise };
  const render = vi.fn(() => task);
  const page: RenderablePdfPage = {
    // SAFETY: sizing reads only the viewport's width and height.
    getViewport: () =>
      ({ height: LAYOUT_HEIGHT, width: LAYOUT_WIDTH }) as PageViewport,
    render,
  };
  return { cancel, page, render };
};

const fakeCanvas = (): HTMLCanvasElement =>
  // SAFETY: sizing writes width, height, and style only.
  ({ height: 0, style: {}, width: 0 }) as HTMLCanvasElement;

test("aborting cancels the paint still in flight", async () => {
  // pdf.js OutputScale reads the pixel ratio and screen size from window.
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    screen: { availHeight: 1080, availWidth: 1920 },
  });
  const { cancel, page, render } = pendingPage();
  const controller = new AbortController();

  const result = renderPdfPage(page, fakeCanvas(), 1, {
    pixelRatio: 1,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  controller.abort();

  await expect(result).resolves.toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
});

test("an already aborted signal skips the paint", async () => {
  const { page, render } = pendingPage();
  const controller = new AbortController();
  controller.abort();

  await expect(
    renderPdfPage(page, fakeCanvas(), 1, { signal: controller.signal })
  ).resolves.toBeNull();
  expect(render).not.toHaveBeenCalled();
});
