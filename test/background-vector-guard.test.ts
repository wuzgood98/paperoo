import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, expect, test } from "vitest";

import { requestDeleteSelection } from "@/components/editor/large-delete";
import { hitTestPdfVector, pdfVectorIsLarge } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfVectorObject } from "@/lib/editor/types";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { loadPdfJsDocument } from "./pdfjs-node";

const PAGE = { height: 792, width: 612 };
const CROP = { ...PAGE, x: 0, y: 0 };

/**
 * A white page background, a half-page panel, some text, then a full-page
 * tint drawn after the text (artwork, not background).
 */
const buildPage = async (): Promise<PdfVectorObject[]> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of("F1"), font.ref);
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(
      doc.context.flateStream(
        [
          "1 1 1 rg 0 0 612 792 re f",
          "0.9 0.9 0.9 rg 0 0 612 400 re f",
          "BT /F1 12 Tf 72 700 Td (Hello) Tj ET",
          "0 0 1 rg 0 0 612 792 re f",
        ].join("\n")
      )
    )
  );
  const pdf = await loadPdfJsDocument(await doc.save()).promise;
  const pdfPage = await pdf.getPage(1);
  return extractPdfVectorObjects(
    await pdfPage.getOperatorList(),
    { cropBox: CROP, id: "page-1", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
};

test("only a full-page fill drawn before any text is the page background", async () => {
  const vectors = await buildPage();

  expect(vectors.map((vector) => vector.pageBackground === true)).toEqual([
    true,
    false,
    false,
  ]);
});

test("a click on bare background selects nothing", async () => {
  const [background] = await buildPage();
  const point = { x: 300, y: 100 };

  expect(
    background && hitTestPdfVector([background], point, CROP, 0)
  ).toBeUndefined();
});

test("shapes drawn over the background are still selectable", async () => {
  const vectors = await buildPage();
  const [background, panel] = vectors;

  // The half-page panel covers the lower half of the displayed page.
  expect(
    background &&
      panel &&
      hitTestPdfVector([background, panel], { x: 300, y: 600 }, CROP, 0)?.id
  ).toBe(panel?.id);
});

test("a shape is large when it covers more than half the page", () => {
  const page = { cropBox: CROP };

  expect(pdfVectorIsLarge({ height: 792, width: 612 }, page)).toBe(true);
  expect(pdfVectorIsLarge({ height: 400, width: 612 }, page)).toBe(true);
  expect(pdfVectorIsLarge({ height: 390, width: 612 }, page)).toBe(false);
});

const editorPage = (vectors: PdfVectorObject[]): EditorPage => ({
  cropBox: CROP,
  height: PAGE.height,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: vectors,
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: PAGE.width,
});

const vectorAt = (
  vectors: readonly PdfVectorObject[],
  index: number
): PdfVectorObject => {
  const vector = vectors[index];
  if (!vector) {
    throw new Error(`No vector at ${index}.`);
  }
  return vector;
};

const deletedIds = (): string[] =>
  editorStore
    .getState()
    .document.pages[0]?.pdfVectorObjects.filter((vector) => vector.deleted)
    .map((vector) => vector.id) ?? [];

afterEach(() => {
  editorStore.clearDocument();
});

test("deleting a small shape happens at once", async () => {
  const vectors = await buildPage();
  const small = {
    ...vectorAt(vectors, 1),
    height: 100,
    id: "small",
  };
  editorStore.resetDocument([editorPage([small])], "demo.pdf");
  editorStore.selectPdfVector("small");

  requestDeleteSelection();

  expect(deletedIds()).toEqual(["small"]);
});

test("deleting a large shape waits for confirmation", async () => {
  const panel = vectorAt(await buildPage(), 1);
  editorStore.resetDocument([editorPage([panel])], "demo.pdf");
  editorStore.selectPdfVector(panel.id);

  requestDeleteSelection();

  expect(deletedIds()).toEqual([]);
});
