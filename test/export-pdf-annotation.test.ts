import { expect, test } from "vitest";

import type { EditorDocument, PdfAnnotationObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { extractPdfAnnotationObjects } from "@/lib/pdf/extract-annotations";

import {
  annotHasUri,
  buildPdfAnnotationFixture,
  countPageAnnotSubtypes,
  findAnnotContents,
} from "./pdf-annotation-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const editorDocumentFromBytes = async (
  bytes: Uint8Array
): Promise<EditorDocument> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const raw = await page.getAnnotations({ intent: "display" });
  const cropBox = { height: 792, width: 612, x: 0, y: 0 };
  const { objects } = extractPdfAnnotationObjects(raw, {
    cropBox,
    id: "page-1",
    sourceRotate: 0,
  });
  return {
    pages: [
      {
        cropBox,
        height: 792,
        id: "page-1",
        objects: [],
        pdfAnnotationObjects: objects,
        pdfImageObjects: [],
        pdfTextObjects: [],
        pdfVectorObjects: [],
        rotation: 0,
        skippedPdfAnnotationSubtypes: [],
        sourceIndex: 0,
        sourceRotate: 0,
        width: 612,
      },
    ],
  };
};

const mapAnnotations = (
  document: EditorDocument,
  mapper: (object: PdfAnnotationObject) => PdfAnnotationObject
): EditorDocument => ({
  pages: document.pages.map((page) => ({
    ...page,
    pdfAnnotationObjects: page.pdfAnnotationObjects.map(mapper),
  })),
});

test("export applies annotation deletes and content edits before copyPages", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const base = await editorDocumentFromBytes(bytes);

  const edited = mapAnnotations(base, (object) => {
    if (object.type === "pdf-highlight") {
      return { ...object, deleted: true };
    }
    if (object.type === "pdf-free-text") {
      return { ...object, contents: "Edited free text" };
    }
    if (object.type === "pdf-text-note") {
      return { ...object, contents: "Edited note" };
    }
    return object;
  });

  const output = await exportDocument({
    assets: {},
    bytes,
    document: edited,
    fontBytes: {},
  });

  const subtypes = await countPageAnnotSubtypes(output, 0);
  expect(subtypes.get("Highlight")).toBeUndefined();
  expect(subtypes.get("Popup")).toBe(1);
  expect(subtypes.get("Widget")).toBe(1);
  expect(await annotHasUri(output, "https://example.com/paperoo")).toBe(true);
  expect(await findAnnotContents(output, "FreeText", "Edited free text")).toBe(
    true
  );
  expect(await findAnnotContents(output, "Text", "Edited note")).toBe(true);

  const task = loadPdfJsDocument(output);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const raw = await page.getAnnotations({ intent: "display" });
  expect(raw.some((item) => item.subtype === "Highlight")).toBe(false);
  expect(raw.some((item) => item.subtype === "Text")).toBe(true);
});
