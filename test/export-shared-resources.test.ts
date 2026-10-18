import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { expect, test } from "vitest";

import type {
  EditorDocument,
  EditorPage,
  ImageObject,
  TextObject,
} from "@/lib/editor/types";
import { EDITOR_OBJECT_SOURCE } from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { exportDocument } from "@/lib/pdf/export-pdf";

const LETTER_CROP = { height: 792, width: 612, x: 0, y: 0 };
const PAGE_COUNT = 2;

const png1x1 = (): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );

const text = (id: string): TextObject => ({
  align: "left",
  color: "#111827",
  content: "Shared face",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 40,
  id,
  italic: false,
  opacity: 1,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "text",
  width: 200,
  x: 72,
  y: 72,
});

const signature = (id: string): ImageObject => ({
  assetId: "signature",
  height: 40,
  id,
  mimeType: "image/png",
  opacity: 1,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "image",
  width: 80,
  x: 72,
  y: 200,
});

const editorPage = (index: number): EditorPage => ({
  cropBox: LETTER_CROP,
  height: 792,
  id: `page-${index + 1}`,
  objects: [text(`text-${index}`), signature(`image-${index}`)],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: index,
  sourceRotate: 0,
  width: 612,
});

const countObjects = (
  doc: PDFDocument,
  matches: (dict: PDFDict) => boolean
): number => {
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object;
    if (dict instanceof PDFDict && matches(dict)) {
      count += 1;
    }
  }
  return count;
};

test("export embeds a font and an image used on two pages once", async () => {
  const source = await PDFDocument.create();
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    source.addPage([612, 792]);
  }
  const bytes = await source.save();
  const document: EditorDocument = {
    pages: Array.from({ length: PAGE_COUNT }, (_, index) => editorPage(index)),
  };
  const sans = new Uint8Array(
    await readFile(
      path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
    )
  );

  const output = await exportDocument({
    assets: { signature: { bytes: png1x1(), mimeType: "image/png" } },
    bytes,
    document,
    fontBytes: { [FONT_FILES.sans[400]]: sans },
  });

  const exported = await PDFDocument.load(output);
  const fontFiles = countObjects(exported, (dict) =>
    dict.has(PDFName.of("FontFile2"))
  );
  // A PNG with alpha is one image plus its soft mask; count the masks too.
  const images = countObjects(
    exported,
    (dict) =>
      dict.get(PDFName.of("Subtype")) === PDFName.of("Image") &&
      dict.has(PDFName.of("SMask"))
  );
  const masks = countObjects(
    exported,
    (dict) =>
      dict.get(PDFName.of("Subtype")) === PDFName.of("Image") &&
      !dict.has(PDFName.of("SMask"))
  );
  expect(exported.getPageCount()).toBe(PAGE_COUNT);
  expect(fontFiles).toBe(1);
  expect(images).toBe(1);
  expect(masks).toBe(1);
});
