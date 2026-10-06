import { setTimeout as delay } from "node:timers/promises";

import { expect, test, vi } from "vitest";

import type { EditorPage, PdfImageObject } from "@/lib/editor/types";
import { createOcrController } from "@/lib/ocr/controller";
import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import { createOcrService } from "@/lib/ocr/service";

const page = (): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [
    {
      deleted: false,
      height: 792,
      id: "img-1",
      originalHeight: 792,
      originalRotation: 0,
      originalWidth: 612,
      originalX: 0,
      originalY: 0,
      pageId: "page-1",
      previewAssetId: null,
      replacementAssetId: null,
      rotation: 0,
      sourceId: "Im1",
      sourceIndex: 0,
      type: "pdf-image",
      width: 612,
      x: 0,
      y: 0,
    } satisfies PdfImageObject,
  ],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

const enginePage = (): EngineOcrPage => ({
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              baseline: { x0: 0, x1: 40, y0: 8, y1: 8 },
              bbox: { x0: 0, x1: 40, y0: 0, y1: 10 },
              words: [
                {
                  bbox: { x0: 0, x1: 40, y0: 0, y1: 10 },
                  confidence: 90,
                  text: "Scan",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

test("caches recognized words outside the editor document", async () => {
  const controller = createOcrController({
    createService: () =>
      createOcrService({
        recognize: () => Promise.resolve(enginePage()),
      }),
    renderPage: () => Promise.resolve({ image: new Blob(), scale: 2 }),
  });
  controller.start(page(), { pageCount: 8, pageNumber: 2 });
  await vi.waitFor(() => {
    expect(controller.getState().wordsByPage["page-1"]?.length).toBeGreaterThan(
      0
    );
  });
  expect(controller.getState().wordsByPage["page-1"]?.[0]?.text).toBe("Scan");
  expect(controller.getState().status).toBe("idle");
});

test("cancel drops an in-flight page result", async () => {
  const pending = Promise.withResolvers<EngineOcrPage>();
  const controller = createOcrController({
    createService: () =>
      createOcrService({
        recognize: () => pending.promise,
        terminate: () => Promise.resolve(),
      }),
    renderPage: () => Promise.resolve({ image: new Blob(), scale: 2 }),
  });
  controller.start(page(), { pageCount: 1, pageNumber: 1 });
  await vi.waitFor(() => {
    expect(controller.getState().status).toBe("recognizing");
  });
  await controller.cancel();
  pending.resolve(enginePage());
  await delay(20);
  expect(controller.getState().wordsByPage["page-1"]).toBeUndefined();
  expect(controller.getState().status).toBe("idle");
});

test("does not auto-enqueue a page the user cancelled", async () => {
  const pending = Promise.withResolvers<EngineOcrPage>();
  const scanned = page();
  const controller = createOcrController({
    createService: () =>
      createOcrService({
        recognize: () => pending.promise,
        terminate: () => Promise.resolve(),
      }),
    renderPage: () => Promise.resolve({ image: new Blob(), scale: 2 }),
  });
  controller.enqueueVisible(scanned, { pageCount: 1, pageNumber: 1 });
  await vi.waitFor(() => {
    expect(controller.getState().status).toBe("recognizing");
  });
  await controller.cancel();
  pending.resolve(enginePage());
  controller.enqueueVisible(scanned, { pageCount: 1, pageNumber: 1 });
  await delay(20);
  expect(controller.getState().runningPageId).toBeNull();
  expect(controller.getState().wordsByPage["page-1"]).toBeUndefined();
});
