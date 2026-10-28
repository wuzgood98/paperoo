import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { expect, test } from "vitest";

import type {
  PdfLinkAnnotation,
  PdfMarkupAnnotation,
} from "@/lib/editor/types";
import { extractPdfAnnotationObjects } from "@/lib/pdf/extract-annotations";

import { buildPdfAnnotationFixture } from "./pdf-annotation-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

test("extracts display annotations and skips widgets and popups", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const raw = await page.getAnnotations({ intent: "display" });
  const cropBox = { height: 792, width: 612, x: 0, y: 0 };
  const { objects, skippedSubtypes } = extractPdfAnnotationObjects(raw, {
    cropBox,
    id: "page-1",
    sourceRotate: 0,
  });

  const types = objects.map((object) => object.type).toSorted();
  expect(types).toEqual(
    [
      "pdf-free-text",
      "pdf-highlight",
      "pdf-link",
      "pdf-link",
      "pdf-squiggly",
      "pdf-stamp",
      "pdf-strikeout",
      "pdf-text-note",
      "pdf-underline",
    ].toSorted()
  );

  const highlight = objects.find(
    (object): object is PdfMarkupAnnotation => object.type === "pdf-highlight"
  );
  expect(highlight?.quads.length).toBeGreaterThan(1);

  expect(objects.some((object) => object.subtype === "Widget")).toBe(false);
  expect(objects.some((object) => object.subtype === "Popup")).toBe(false);

  expect(skippedSubtypes).toEqual([]);

  const uriLink = objects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  expect(uriLink?.action).toEqual({
    kind: "url",
    url: "https://example.com/paperoo",
  });

  const note = objects.find((object) => object.type === "pdf-text-note");
  expect(note?.popupRef).toBeTruthy();
});

test("an annotation written inline in /Annots is not offered for editing", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const note = (text: string) =>
    doc.context.obj({
      Contents: PDFString.of(text),
      Rect: [100, 700, 120, 720],
      Subtype: "Text",
      Type: "Annot",
    });
  page.node.set(
    PDFName.of("Annots"),
    doc.context.obj([doc.context.register(note("Stored")), note("Inline")])
  );
  const task = loadPdfJsDocument(new Uint8Array(await doc.save()));
  const pdf = await task.promise;
  const pdfPage = await pdf.getPage(1);
  const raw = await pdfPage.getAnnotations({ intent: "display" });
  const { objects } = extractPdfAnnotationObjects(raw, {
    cropBox: { height: 792, width: 612, x: 0, y: 0 },
    id: "page-1",
    sourceRotate: 0,
  });

  expect(raw).toHaveLength(2);
  expect(
    objects.map((object) => ("contents" in object ? object.contents : null))
  ).toEqual(["Stored"]);
});
