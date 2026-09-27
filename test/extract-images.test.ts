import { PDFDocument, StandardFonts } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import {
  extractPdfImageObjects,
  toPdfImageOps,
} from "@/lib/pdf/extract-images";
import type { PdfImageOps } from "@/lib/pdf/extract-images";

import { loadPdfJsDocument } from "./pdfjs-node";

const FAKE_OPS = {
  clip: 10,
  eoClip: 11,
  paintFormXObjectBegin: 20,
  paintFormXObjectEnd: 21,
  paintImageMaskXObject: 30,
  paintImageMaskXObjectGroup: 31,
  paintImageMaskXObjectRepeat: 32,
  paintImageXObject: 40,
  paintImageXObjectRepeat: 41,
  paintInlineImageXObject: 42,
  paintSolidColorImageMask: 33,
  restore: 2,
  save: 1,
  transform: 3,
} satisfies PdfImageOps;

const pageMeta = {
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  id: "page-1",
  sourceRotate: 0 as const,
};

const PNG_1X1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
);

test("extractPdfImageObjects reads an axis-aligned paint CTM", () => {
  const objects = extractPdfImageObjects(
    {
      argsArray: [undefined, [80, 0, 0, 40, 72, 600], "Im0", undefined],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.transform,
        FAKE_OPS.paintImageXObject,
        FAKE_OPS.restore,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects).toHaveLength(1);
  expect(objects[0]?.pageId).toBe("page-1");
  expect(objects[0]?.sourceId).toBe("Im0");
  expect(objects[0]?.x).toBeCloseTo(72);
  expect(objects[0]?.y).toBeCloseTo(152);
  expect(objects[0]?.width).toBeCloseTo(80);
  expect(objects[0]?.height).toBeCloseTo(40);
  expect(objects[0]?.rotation).toBeCloseTo(0);
});

test("extractPdfImageObjects skips masks, clips, repeats, and skewed CTMs", () => {
  const objects = extractPdfImageObjects(
    {
      argsArray: [
        undefined,
        [80, 0, 0, 40, 72, 600],
        "Mask",
        undefined,
        undefined,
        [80, 0, 0, 40, 100, 100],
        "Clipped",
        undefined,
        [80, 20, 10, 40, 72, 400],
        "Skew",
        [40, 0, 0, 40, 10, 10],
        "Tile",
      ],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.transform,
        FAKE_OPS.paintImageMaskXObject,
        FAKE_OPS.restore,
        FAKE_OPS.save,
        FAKE_OPS.clip,
        FAKE_OPS.paintImageXObject,
        FAKE_OPS.restore,
        FAKE_OPS.transform,
        FAKE_OPS.paintImageXObject,
        FAKE_OPS.transform,
        FAKE_OPS.paintImageXObjectRepeat,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects).toHaveLength(0);
});

test("extracts images from a pdf-lib fixture onto the correct pages", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(PNG_1X1);
  const first = pdf.addPage([612, 792]);
  first.drawImage(image, { height: 40, width: 80, x: 72, y: 600 });
  first.drawText("Hello around the image", { font, size: 12, x: 72, y: 540 });
  first.drawImage(image, { height: 120, width: 200, x: 200, y: 200 });
  const second = pdf.addPage([612, 792]);
  second.drawImage(image, { height: 24, width: 24, x: 36, y: 700 });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pageOne = await document.getPage(1);
  const pageTwo = await document.getPage(2);
  const [listOne, listTwo] = await Promise.all([
    pageOne.getOperatorList(),
    pageTwo.getOperatorList(),
  ]);

  const firstImages = extractPdfImageObjects(
    listOne,
    pageMeta,
    toPdfImageOps(OPS)
  );
  const secondImages = extractPdfImageObjects(
    listTwo,
    { ...pageMeta, id: "page-2" },
    toPdfImageOps(OPS)
  );

  expect(firstImages.length).toBeGreaterThanOrEqual(2);
  expect(secondImages.length).toBeGreaterThanOrEqual(1);

  const small = firstImages.find(
    (object) =>
      Math.abs(object.width - 80) < 2 && Math.abs(object.height - 40) < 2
  );
  const large = firstImages.find(
    (object) =>
      Math.abs(object.width - 200) < 2 && Math.abs(object.height - 120) < 2
  );
  expect(small?.x).toBeCloseTo(72, 0);
  expect(small?.y).toBeCloseTo(152, 0);
  expect(large?.x).toBeCloseTo(200, 0);
  expect(large?.y).toBeCloseTo(472, 0);
  expect(secondImages[0]?.pageId).toBe("page-2");
  expect(secondImages[0]?.width).toBeCloseTo(24, 0);

  await task.destroy();
});
