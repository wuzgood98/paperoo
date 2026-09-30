import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfImageObject } from "@/lib/editor/types";
import type { PdfJsObjectStore } from "@/lib/pdf/pdf-image-preview";
import {
  pageBoxToCanvasCrop,
  resolvePdfJsImageFromStores,
} from "@/lib/pdf/pdf-image-preview";

const pdfImage = (overrides: Partial<PdfImageObject> = {}): PdfImageObject => ({
  deleted: false,
  height: 40,
  id: "img-1",
  originalHeight: 40,
  originalRotation: 0,
  originalWidth: 80,
  originalX: 72,
  originalY: 152,
  pageId: "page-1",
  previewAssetId: null,
  replacementAssetId: null,
  rotation: 0,
  sourceId: "img_p0_1",
  sourceIndex: 0,
  type: "pdf-image",
  width: 80,
  x: 72,
  y: 152,
  ...overrides,
});

const page = (image = pdfImage()): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfImageObjects: [image],
  pdfTextObjects: [],
  rotation: 0,
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

const createStore = (): PdfJsObjectStore & {
  resolve: (
    id: string,
    data: { data: Uint8Array; height: number; width: number }
  ) => void;
} => {
  const records = new Map<
    string,
    { data: Uint8Array; height: number; width: number }
  >();
  const listeners = new Map<
    string,
    (data: { data: Uint8Array; height: number; width: number }) => void
  >();
  return {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- mirrors PDFObjects.get
    get: (id, callback) => {
      const current = records.get(id);
      if (callback) {
        if (current) {
          // oxlint-disable-next-line promise/prefer-await-to-callbacks -- PDFObjects.get is callback-only
          callback(current);
          return;
        }
        listeners.set(id, callback);
        return;
      }
      if (!current) {
        throw new Error(`Requesting object that isn't resolved yet ${id}`);
      }
      return current;
    },
    has: (id) => records.has(id),
    resolve: (id, data) => {
      records.set(id, data);
      listeners.get(id)?.(data);
    },
  };
};

afterEach(() => {
  editorStore.clearDocument();
});

test("resolvePdfJsImageFromStores reads commonObjs without waiting on page.objs", async () => {
  const pageStore = createStore();
  const commonStore = createStore();
  const pixels = {
    data: new Uint8Array([1, 2, 3, 255]),
    height: 1,
    width: 1,
  };
  commonStore.resolve("img_p0_1", pixels);

  const resolved = await resolvePdfJsImageFromStores(
    pageStore,
    commonStore,
    "img_p0_1"
  );

  expect(resolved?.width).toBe(1);
  expect(resolved?.height).toBe(1);
});

test("resolvePdfJsImageFromStores takes the first store that posts pixels", async () => {
  const pageStore = createStore();
  const commonStore = createStore();
  const pending = resolvePdfJsImageFromStores(
    pageStore,
    commonStore,
    "img_p0_1"
  );
  commonStore.resolve("img_p0_1", {
    data: new Uint8Array([9, 8, 7, 255]),
    height: 1,
    width: 1,
  });

  const resolved = await pending;
  expect(resolved?.data).toBeDefined();
});

test("pageBoxToCanvasCrop maps page space through zoom and backing scale", () => {
  const crop = pageBoxToCanvasCrop(
    { height: 40, width: 80, x: 72, y: 152 },
    0.5,
    { cssHeight: 396, cssWidth: 306, height: 792, width: 612 }
  );
  expect(crop).toEqual({
    height: 40,
    width: 80,
    x: 72,
    y: 152,
  });
});

test("setPdfImagePreview replaces a provisional snapshot", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  const snapshot = editorStore.addAsset(new Uint8Array([1]), "image/png", {
    provisional: true,
  });
  editorStore.setPdfImagePreview("img-1", snapshot.id);
  expect(
    editorStore.getState().document.pages[0]?.pdfImageObjects[0]?.previewAssetId
  ).toBe(snapshot.id);

  const decoded = editorStore.addAsset(new Uint8Array([2, 3]), "image/png");
  editorStore.setPdfImagePreview("img-1", decoded.id);
  expect(
    editorStore.getState().document.pages[0]?.pdfImageObjects[0]?.previewAssetId
  ).toBe(decoded.id);
  expect(editorStore.getAsset(snapshot.id)).toBeUndefined();
  expect(editorStore.isProvisionalAsset(decoded.id)).toBe(false);
});
