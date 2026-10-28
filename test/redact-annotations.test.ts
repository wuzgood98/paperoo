import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { expect, test } from "vitest";

import { saveSwept } from "@/lib/pdf/output-gc";
import { removeAnnotationsUnderBoxes } from "@/lib/pdf/redact-page";

import { pdfContainsText } from "./pdf-scan";

const box = { height: 100, width: 100, x: 100, y: 600 };

const note = (doc: PDFDocument, text: string, x: number) =>
  doc.context.obj({
    Contents: PDFString.of(text),
    Rect: [x, 650, x + 20, 670],
    Subtype: "Text",
    Type: "Annot",
  });

test("annotations under a box go, inline ones and ones a kept reply points at too", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const { context } = doc;
  const stored = context.register(note(doc, "Stored secret", 150));
  const reply = note(doc, "Kept reply", 400);
  reply.set(PDFName.of("IRT"), stored);
  page.node.set(
    PDFName.of("Annots"),
    context.obj([
      stored,
      note(doc, "Inline secret", 120),
      context.register(reply),
      note(doc, "Kept inline", 450),
    ])
  );

  removeAnnotationsUnderBoxes(doc, page, [box]);
  const bytes = await saveSwept(doc);

  expect(page.node.Annots()?.size()).toBe(2);
  expect(await pdfContainsText(bytes, "Stored secret")).toBe(false);
  expect(await pdfContainsText(bytes, "Inline secret")).toBe(false);
  expect(await pdfContainsText(bytes, "Kept reply")).toBe(true);
  expect(await pdfContainsText(bytes, "Kept inline")).toBe(true);
});
