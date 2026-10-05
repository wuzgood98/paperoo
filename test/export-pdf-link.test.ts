import { expect, test } from "vitest";

import { pdfLinkActionsEqual } from "@/lib/editor/object-utils";
import type { EditorDocument, PdfLinkAnnotation } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { extractPdfAnnotationObjects } from "@/lib/pdf/extract-annotations";
import {
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";

import {
  annotHasUri,
  buildPdfAnnotationFixture,
  countPageAnnotSubtypes,
} from "./pdf-annotation-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const editorDocumentFromBytes = async (
  bytes: Uint8Array
): Promise<EditorDocument> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const rawAnnotations = await page.getAnnotations({ intent: "display" });
  const textContent = await page.getTextContent();
  const cropBox = { height: 792, width: 612, x: 0, y: 0 };
  const extractPage = { cropBox, id: "page-1", sourceRotate: 0 as const };
  const { objects } = extractPdfAnnotationObjects(rawAnnotations, extractPage);
  const pdfTextObjects = extractPdfTextObjects(
    toExtractableTextContent(textContent),
    extractPage
  );
  return {
    pages: [
      {
        cropBox,
        height: 792,
        id: "page-1",
        objects: [],
        pdfAnnotationObjects: objects,
        pdfImageObjects: [],
        pdfTextObjects,
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

test("extract stores originalAction on URI links", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const document = await editorDocumentFromBytes(bytes);
  const link = document.pages[0]?.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  expect(link).toBeDefined();
  if (!link) {
    return;
  }
  expect(pdfLinkActionsEqual(link.action, link.originalAction)).toBe(true);
});

test("export writes edited URL and label text", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const base = await editorDocumentFromBytes(bytes);
  const [page] = base.pages;
  if (!page) {
    throw new Error("missing page");
  }
  const link = page.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  if (!link) {
    throw new Error("missing uri link");
  }

  const editedLink: PdfLinkAnnotation = {
    ...link,
    action: { kind: "url", url: "https://example.com/updated" },
    label: "New label",
  };
  const textRuns = page.pdfTextObjects.map((object) =>
    object.text.includes("Click") ? { ...object, text: "New label" } : object
  );

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      pages: [
        {
          ...page,
          pdfAnnotationObjects: page.pdfAnnotationObjects.map((object) =>
            object.id === link.id ? editedLink : object
          ),
          pdfTextObjects: textRuns,
        },
      ],
    },
    fontBytes: {},
  });

  expect(await annotHasUri(output, "https://example.com/updated")).toBe(true);
  const subtypes = await countPageAnnotSubtypes(output, 0);
  expect(subtypes.get("Widget")).toBe(1);

  const task = loadPdfJsDocument(output);
  const pdf = await task.promise;
  const exportedPage = await pdf.getPage(1);
  const text = await exportedPage.getTextContent();
  const combined = text.items
    .map((item) => ("str" in item ? item.str : ""))
    .join("");
  expect(combined).toContain("New label");
});
