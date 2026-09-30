import { PDFDocument, StandardFonts } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { displayedToUserSpace } from "@/lib/editor/coordinates";
import {
  PDF_IMAGE_COVER_BLEED,
  pdfImageCoverBox,
  pdfImageOriginalBox,
} from "@/lib/editor/object-utils";
import type { EditorDocument, PdfImageObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  extractPdfImageObjects,
  toPdfImageOps,
} from "@/lib/pdf/extract-images";

import { loadPdfJsDocument } from "./pdfjs-node";

const png1x1 = (): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );

const LETTER_CROP = { height: 792, width: 612, x: 0, y: 0 };

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
  sourceId: "Im0",
  sourceIndex: 0,
  type: "pdf-image",
  width: 80,
  x: 72,
  y: 152,
  ...overrides,
});

const documentWith = (
  object: PdfImageObject,
  extras: Partial<EditorDocument["pages"][number]> = {}
): EditorDocument => ({
  pages: [
    {
      cropBox: LETTER_CROP,
      height: 792,
      id: "page-1",
      objects: [],
      pdfImageObjects: [object],
      pdfTextObjects: [],
      rotation: 0,
      sourceIndex: 0,
      sourceRotate: 0,
      width: 612,
      ...extras,
    },
  ],
});

const countImagePaints = async (bytes: Uint8Array): Promise<number> => {
  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const page = await document.getPage(1);
  const list = await page.getOperatorList();
  const imageOps = toPdfImageOps(OPS);
  const paint = imageOps.paintImageXObject;
  const inline = imageOps.paintInlineImageXObject;
  const count = list.fnArray.filter(
    (fn) => fn === paint || fn === inline
  ).length;
  await task.destroy();
  return count;
};

const collectTransforms = async (
  bytes: Uint8Array
): Promise<readonly (readonly number[])[]> => {
  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const page = await document.getPage(1);
  const list = await page.getOperatorList();
  const transforms: number[][] = [];
  for (const [index, fn] of list.fnArray.entries()) {
    if (fn !== OPS.transform) {
      continue;
    }
    const args = list.argsArray[index];
    if (!Array.isArray(args) || args.length < 6) {
      continue;
    }
    transforms.push(args.slice(0, 6).map(Number));
  }
  await task.destroy();
  return transforms;
};

const hasCoverTranslation = (
  transforms: readonly (readonly number[])[],
  object: PdfImageObject
): boolean => {
  const cover = displayedToUserSpace(pdfImageCoverBox(object), LETTER_CROP, 0);
  return transforms.some(
    (ctm) =>
      Math.abs(ctm[0] - 1) < 1e-6 &&
      Math.abs(ctm[1] ?? 0) < 1e-6 &&
      Math.abs(ctm[2] ?? 0) < 1e-6 &&
      Math.abs(ctm[3] - 1) < 1e-6 &&
      Math.abs((ctm[4] ?? 0) - cover.x) < 0.01 &&
      Math.abs((ctm[5] ?? 0) - cover.y) < 0.01
  );
};

test("export leaves source bytes unchanged and redraws a replacement image", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const image = await source.embedPng(png1x1());
  page.drawImage(image, { height: 40, width: 80, x: 72, y: 600 });
  const bytes = await source.save();
  const original = Uint8Array.from(bytes);

  const output = await exportDocument({
    assets: {
      replace: { bytes: png1x1(), mimeType: "image/png" },
    },
    bytes,
    document: documentWith(
      pdfImage({ replacementAssetId: "replace", x: 90, y: 160 })
    ),
    fontBytes: {},
  });

  expect(bytes).toEqual(original);
  expect(await countImagePaints(output)).toBeGreaterThan(
    await countImagePaints(bytes)
  );

  const task = loadPdfJsDocument(output);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const list = await pdfPage.getOperatorList();
  const extracted = extractPdfImageObjects(
    list,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    toPdfImageOps(OPS)
  );
  const moved = extracted.find(
    (item) => Math.abs(item.x - 90) < 2 && Math.abs(item.y - 160) < 2
  );
  expect(moved).toBeDefined();
  await task.destroy();
});

test("export of a deleted image does not add a replacement paint", async () => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const page = source.addPage([612, 792]);
  const image = await source.embedPng(png1x1());
  page.drawImage(image, { height: 40, width: 80, x: 72, y: 600 });
  page.drawText("Nearby text", { font, size: 12, x: 72, y: 540 });
  const bytes = await source.save();
  const before = await countImagePaints(bytes);

  const output = await exportDocument({
    assets: {},
    bytes: Uint8Array.from(bytes),
    document: documentWith(pdfImage({ deleted: true })),
    fontBytes: {},
  });

  expect(await countImagePaints(output)).toBe(before);
});

test("export leaves an unmodified image without an extra paint", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const image = await source.embedPng(png1x1());
  page.drawImage(image, { height: 40, width: 80, x: 72, y: 600 });
  const bytes = await source.save();
  const before = await countImagePaints(bytes);

  const output = await exportDocument({
    assets: {},
    bytes: Uint8Array.from(bytes),
    document: documentWith(pdfImage()),
    fontBytes: {},
  });

  expect(await countImagePaints(output)).toBe(before);
});

test("export white cover outsets the original box past image edges", async () => {
  const object = pdfImage({ deleted: true });
  const original = displayedToUserSpace(
    pdfImageOriginalBox(object),
    LETTER_CROP,
    0
  );
  const cover = displayedToUserSpace(pdfImageCoverBox(object), LETTER_CROP, 0);

  expect(cover.x).toBeLessThan(original.x);
  expect(cover.y).toBeLessThan(original.y);
  expect(cover.x + cover.width).toBeGreaterThan(original.x + original.width);
  expect(cover.y + cover.height).toBeGreaterThan(original.y + original.height);
  expect(cover.width - original.width).toBe(PDF_IMAGE_COVER_BLEED * 2);
  expect(cover.height - original.height).toBe(PDF_IMAGE_COVER_BLEED * 2);

  const edgeSamples = [
    { x: original.x, y: original.y + original.height / 2 },
    { x: original.x + original.width, y: original.y + original.height / 2 },
    { x: original.x + original.width / 2, y: original.y },
    { x: original.x + original.width / 2, y: original.y + original.height },
  ];
  for (const point of edgeSamples) {
    expect(point.x).toBeGreaterThanOrEqual(cover.x);
    expect(point.x).toBeLessThanOrEqual(cover.x + cover.width);
    expect(point.y).toBeGreaterThanOrEqual(cover.y);
    expect(point.y).toBeLessThanOrEqual(cover.y + cover.height);
  }

  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const image = await source.embedPng(png1x1());
  page.drawImage(image, {
    height: original.height,
    width: original.width,
    x: original.x,
    y: original.y,
  });
  const bytes = await source.save();

  const deletedOutput = await exportDocument({
    assets: {},
    bytes: Uint8Array.from(bytes),
    document: documentWith(object),
    fontBytes: {},
  });
  expect(
    hasCoverTranslation(await collectTransforms(deletedOutput), object)
  ).toBe(true);

  const movedOutput = await exportDocument({
    assets: {
      preview: { bytes: png1x1(), mimeType: "image/png" },
    },
    bytes: Uint8Array.from(bytes),
    document: documentWith(
      pdfImage({ previewAssetId: "preview", x: 120, y: 200 })
    ),
    fontBytes: {},
  });
  expect(
    hasCoverTranslation(await collectTransforms(movedOutput), pdfImage())
  ).toBe(true);
});
