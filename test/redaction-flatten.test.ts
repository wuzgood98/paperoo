import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  StandardFonts,
} from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { createRedactionObject, pinObject } from "@/lib/editor/object-utils";
import { TOOL_KEYS } from "@/lib/editor/tool-keys";
import type { EditorDocument, EditorPage, Rect } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import { exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import { redactionPlan } from "@/lib/pdf/output-pages";
import { pdfSession } from "@/lib/pdf/session";
import { migrateMeta, SESSION_SCHEMA_VERSION } from "@/lib/session/schema";
import type { PersistedMeta } from "@/lib/session/schema";

import { buildPdfFormFixture, FORM_FIELD } from "./pdf-form-fixture";
import { allPageDictRefs, pdfContainsText } from "./pdf-scan";
import {
  center,
  infoKeys,
  near,
  openPages,
  pageTexts,
  pixelAt,
  redactingExport as redactWith,
  withBoxes,
} from "./redaction-pipeline";

afterEach(async () => {
  await pdfSession.close();
});

const LETTER: [number, number] = [612, 792];

/** "SECRET" above "PUBLIC" on each page. */
const secretPdf = async (pageCount = 1): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage(LETTER);
    page.drawText("SECRET", { font, size: 18, x: 72, y: 700 });
    page.drawText(`PUBLIC ${index + 1}`, { font, size: 18, x: 72, y: 600 });
  }
  return new Uint8Array(await doc.save());
};

/** Over "SECRET" at 72,700 (18pt), in displayed coordinates. */
const SECRET_BOX: Rect = { height: 30, width: 120, x: 64, y: 70 };

/** R1 behaviour: every redacted page is flattened. */
const redactingExport = (
  bytes: Uint8Array,
  document: EditorDocument,
  options: Parameters<typeof redactWith>[2] = {}
) => redactWith(bytes, document, { ...options, mode: "skip" });

test("redacted text is gone from the file; text outside stays searchable", async () => {
  const bytes = await secretPdf();
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: SECRET_BOX })],
  });

  expect(result.flattened).toBe(1);
  const [text] = await pageTexts(result.bytes);
  expect(text).toContain("PUBLIC 1");
  expect(text).not.toContain("SECRET");
  expect(await pdfContainsText(result.bytes, "SECRET")).toBe(false);
  expect(await allPageDictRefs(result.bytes)).toHaveLength(1);
});

test("the box is painted in its fill, black by default", async () => {
  const bytes = await secretPdf();
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }
  const redBox: Rect = { height: 40, width: 100, x: 300, y: 300 };

  const result = await redactingExport(bytes, {
    pages: [
      withBoxes(page, { rect: SECRET_BOX }, { fill: "#ff0000", rect: redBox }),
    ],
  });

  const [black, red, paper] = await pixelAt(result.bytes, 1, 0, [
    center(SECRET_BOX),
    center(redBox),
    { x: 500, y: 700 },
  ]);
  expect(black && near(black, [0, 0, 0])).toBe(true);
  expect(red && near(red, [255, 0, 0])).toBe(true);
  expect(paper && near(paper, [255, 255, 255])).toBe(true);
});

test("a box lands where it was drawn on a rotated, cropped page", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const source = doc.addPage(LETTER);
  source.setCropBox(50, 100, 500, 600);
  source.setRotation(degrees(90));
  source.drawText("SECRET", { font, size: 18, x: 100, y: 400 });
  const bytes = new Uint8Array(await doc.save());
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }
  expect(page.sourceRotate).toBe(90);
  // Displayed (rotated 90) frame: 600 wide, 500 tall.
  const box: Rect = { height: 60, width: 120, x: 200, y: 150 };

  const result = await redactingExport(bytes, {
    pages: [{ ...withBoxes(page, { rect: box }), rotation: 90 }],
  });

  const output = await PDFDocument.load(result.bytes);
  expect(output.getPage(0).getRotation().angle).toBe(180);
  const [inside, outside] = await pixelAt(result.bytes, 1, 90, [
    center(box),
    { x: box.x + box.width + 40, y: center(box).y },
  ]);
  expect(inside && near(inside, [0, 0, 0])).toBe(true);
  expect(outside && near(outside, [255, 255, 255])).toBe(true);
});

test("an OCR word under a box is dropped; one outside stays", async () => {
  const bytes = await secretPdf();
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }
  const word = (id: string, text: string, y: number): OcrTextObject => ({
    baselineY: y + 14,
    confidence: 95,
    height: 16,
    id,
    lineId: `line-${id}`,
    pageId: page.id,
    source: "ocr",
    text,
    type: "ocr-text",
    width: 80,
    x: 72,
    y,
  });

  const result = await redactingExport(
    bytes,
    { pages: [withBoxes(page, { rect: SECRET_BOX })] },
    {
      ocrWordsByPage: {
        [page.id]: [word("in", "Hiddenword", 76), word("out", "Seenword", 400)],
      },
    }
  );

  const [text] = await pageTexts(result.bytes);
  expect(text).toContain("Seenword");
  expect(text).not.toContain("Hiddenword");
  expect(await pdfContainsText(result.bytes, "Hiddenword")).toBe(false);
});

test("a field under a box is removed everywhere; others keep working", async () => {
  const bytes = await buildPdfFormFixture();
  const pages = await openPages(bytes);
  const [first, second] = pages;
  if (!(first && second)) {
    throw new Error("No pages");
  }
  // person.name's widget sits at 72,720 (200×20) on page 1.
  const nameBox: Rect = { height: 28, width: 210, x: 68, y: 48 };

  const result = await redactingExport(bytes, {
    pages: [withBoxes(first, { rect: nameBox }), second],
  });

  expect(result.removedFieldNames).toEqual([FORM_FIELD.name]);
  expect(await pdfContainsText(result.bytes, "Gideon")).toBe(false);
  const exported = await PDFDocument.load(result.bytes);
  const form = exported.getForm();
  const names = form.getFields().map((field) => field.getName());
  expect(names).not.toContain(FORM_FIELD.name);
  // The shared field also has a widget on unredacted page 2.
  expect(names).toContain(FORM_FIELD.shared);
  expect(form.getTextField(FORM_FIELD.shared).getText()).toBe("Same field");
});

test("a link inside a box is dropped; one outside is kept and resolves", async () => {
  const doc = await PDFDocument.load(await secretPdf(2));
  const [first, last] = doc.getPages();
  if (!(first && last)) {
    throw new Error("No pages");
  }
  const link = (rect: number[]) =>
    doc.context.register(
      doc.context.obj({
        Dest: [last.ref, PDFName.of("Fit")],
        Rect: rect,
        Subtype: "Link",
        Type: "Annot",
      })
    );
  first.node.set(
    PDFName.of("Annots"),
    doc.context.obj([link([72, 700, 150, 718]), link([72, 100, 150, 130])])
  );
  const bytes = new Uint8Array(await doc.save());
  const pages = await openPages(bytes);
  const [page1, page2] = pages;
  if (!(page1 && page2)) {
    throw new Error("No pages");
  }

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page1, { rect: SECRET_BOX }), page2],
  });

  const output = await PDFDocument.load(result.bytes);
  const annots = output.getPage(0).node.Annots()?.asArray() ?? [];
  expect(annots).toHaveLength(1);
  const [entry] = annots;
  const dict = entry ? output.context.lookup(entry) : undefined;
  const dest =
    dict instanceof PDFDict ? dict.lookup(PDFName.of("Dest")) : undefined;
  const target = dest instanceof PDFArray ? dest.get(0) : undefined;
  expect(target instanceof PDFRef ? target : null).toBe(output.getPage(1).ref);
  expect(await allPageDictRefs(result.bytes)).toHaveLength(2);
});

test("a redacting export keeps only the producer in Info", async () => {
  const bytes = await secretPdf();
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }
  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: SECRET_BOX })],
  });
  expect(await infoKeys(result.bytes)).toEqual(["Producer"]);
});

test("extracting only unredacted pages is one pass, still scrubbed", async () => {
  const bytes = await secretPdf(2);
  const [page1, page2] = await openPages(bytes);
  if (!(page1 && page2)) {
    throw new Error("No pages");
  }

  const result = await redactingExport(
    bytes,
    { pages: [withBoxes(page1, { rect: SECRET_BOX }), page2] },
    { pageIds: [page2.id] }
  );

  expect(result.flattened).toBe(0);
  expect(await pageTexts(result.bytes)).toEqual(["SECRET PUBLIC 2"]);
  expect(await infoKeys(result.bytes)).toEqual(["Producer"]);
});

test("a duplicate of a redacted page keeps its text", async () => {
  const bytes = await secretPdf();
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: SECRET_BOX }), { ...page, id: "copy" }],
  });

  const [redacted, copy] = await pageTexts(result.bytes);
  expect(redacted).not.toContain("SECRET");
  expect(copy).toContain("SECRET");
});

test("a redaction is never drawn as a plain box", async () => {
  const bytes = await secretPdf();
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }
  await expect(
    exportDocumentWithReport({
      assets: {},
      bytes,
      document: { pages: [withBoxes(page, { rect: SECRET_BOX })] },
      fontBytes: {},
    })
  ).rejects.toThrow("flattened");
});

test("the plan puts boxes in user space for every source rotation", () => {
  const crop = { height: 200, width: 100, x: 10, y: 20 };
  const box: Rect = { height: 20, width: 30, x: 5, y: 7 };
  const planFor = (sourceRotate: 0 | 90 | 180 | 270) => {
    const turned = sourceRotate === 90 || sourceRotate === 270;
    const page: EditorPage = {
      cropBox: crop,
      height: turned ? crop.width : crop.height,
      id: "p",
      objects: [createRedactionObject(box)],
      pdfAnnotationObjects: [],
      pdfImageObjects: [],
      pdfTextObjects: [],
      pdfVectorObjects: [],
      rotation: 0,
      skippedPdfAnnotationSubtypes: [],
      sourceIndex: 0,
      sourceRotate,
      width: turned ? crop.height : crop.width,
    };
    return redactionPlan({ pages: [page] })[0]?.boxes[0];
  };

  expect(planFor(0)).toEqual({
    fill: "#000000",
    height: 20,
    width: 30,
    x: 15,
    y: 193,
  });
  expect(planFor(90)).toEqual({
    fill: "#000000",
    height: 30,
    width: 20,
    x: 17,
    y: 25,
  });
  expect(planFor(180)).toEqual({
    fill: "#000000",
    height: 20,
    width: 30,
    x: 75,
    y: 27,
  });
  expect(planFor(270)).toEqual({
    fill: "#000000",
    height: 30,
    width: 20,
    x: 83,
    y: 185,
  });
});

test("redactions stay unrotated and opaque, and have the X key", () => {
  const box = createRedactionObject({ height: 10, width: 10, x: 0, y: 0 });
  expect(pinObject({ ...box, opacity: 0.3, rotation: 45 })).toEqual(box);
  expect(TOOL_KEYS).toContainEqual({ key: "x", tool: "redact" });
});

test("a version 1 session without a form migrates unchanged", () => {
  const meta: PersistedMeta = {
    assetIds: [],
    currentPageId: null,
    fileName: "a.pdf",
    ocrWordsByPage: {},
    pageOrder: ["page-1"],
    savedAt: 0,
    schemaVersion: 1,
    sessionId: "s",
    sources: [],
  };
  expect(migrateMeta(meta)).toEqual({
    ...meta,
    schemaVersion: SESSION_SCHEMA_VERSION,
  });
});
