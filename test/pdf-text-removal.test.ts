import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { pdfTextEditable, pdfTextRemovable } from "@/lib/editor/object-utils";
import type {
  EditorPage,
  PdfTextObject,
  PdfVectorObject,
} from "@/lib/editor/types";
import { exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";
import { indexPageRemovals } from "@/lib/pdf/removal-targets";

import { extractFigmaPage } from "./figma-extract";
import { buildFigmaType3Fixture, FIGMA_HEADING } from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const twoLinePdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Old line", { font, size: 14, x: 72, y: 700 });
  page.drawText("Keep line", { font, size: 14, x: 72, y: 660 });
  return doc.save();
};

/** What the browser measures before export (Node has no canvas). */
const withCover = (run: PdfTextObject): PdfTextObject => ({
  ...run,
  coverRects: [{ height: run.height, width: run.width, x: run.x, y: run.y }],
});

const editRun = (
  page: EditorPage,
  original: string,
  text: string,
  patch: Partial<PdfTextObject> = {}
): EditorPage => ({
  ...page,
  pdfTextObjects: page.pdfTextObjects.map((run) =>
    run.originalText === original ? { ...withCover(run), text, ...patch } : run
  ),
});

const runId = (page: EditorPage, text: string): string | undefined =>
  page.pdfTextObjects.find((run) => run.originalText === text)?.id;

/** Export one page and read back its text and painted vectors. */
const exportAndRead = async (bytes: Uint8Array, page: EditorPage) => {
  const report = await exportDocumentWithReport({
    assets: {},
    bytes,
    document: { pages: [page] },
    fontBytes: {},
  });
  const pdf = await loadPdfJsDocument(report.bytes).promise;
  const exported = await pdf.getPage(1);
  const [content, operatorList] = await Promise.all([
    exported.getTextContent(),
    exported.getOperatorList(),
  ]);
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .filter((value) => value.trim() !== "");
  const vectors: PdfVectorObject[] = extractPdfVectorObjects(
    operatorList,
    { cropBox: page.cropBox, id: "out", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
  return { report, text, vectors };
};

const whiteFills = (vectors: readonly PdfVectorObject[]) =>
  vectors.filter((vector) => vector.fill?.color === "#ffffff");

test("an edited run's old text is removed, not covered", async () => {
  const bytes = await twoLinePdf();
  const { page } = await extractFigmaPage(bytes);

  const { report, text, vectors } = await exportAndRead(
    bytes,
    editRun(page, "Old line", "New line")
  );

  expect(text).toContain("New line");
  expect(text).toContain("Keep line");
  expect(text).not.toContain("Old line");
  expect(whiteFills(vectors)).toHaveLength(0);
  expect(report.coverOnlyRunIds).toEqual([]);
});

test("a Figma run loses both its invisible text and its outline", async () => {
  const bytes = await buildFigmaType3Fixture();
  const { page } = await extractFigmaPage(bytes);

  const { report, text, vectors } = await exportAndRead(
    bytes,
    editRun(page, FIGMA_HEADING.text, "Structuring Info")
  );

  expect(text).not.toContain(FIGMA_HEADING.text);
  expect(text).toContain("Structuring Info");
  // The heading outline (#1a1a1a) no longer paints; the body's (#737373) does.
  const fills = vectors.map((vector) => vector.fill?.color);
  expect(fills).not.toContain("#1a1a1a");
  expect(fills).toContain("#737373");
  expect(whiteFills(vectors)).toHaveLength(0);
  expect(report.coverOnlyRunIds).toEqual([]);
});

test("a target that fails verification falls back to a cover", async () => {
  const bytes = await twoLinePdf();
  const { page } = await extractFigmaPage(bytes);
  const run = page.pdfTextObjects.find(
    (item) => item.originalText === "Old line"
  );
  const target = run?.removalTarget;
  const corrupted = editRun(page, "Old line", "New line", {
    removalTarget: target && { ...target, glyphCount: target.glyphCount + 1 },
  });

  const { report, text, vectors } = await exportAndRead(bytes, corrupted);

  expect(text).toContain("Old line");
  expect(whiteFills(vectors).length).toBeGreaterThan(0);
  expect(report.coverOnlyRunIds).toEqual([runId(page, "Old line")]);
});

test("a run sharing its outline loses its text but keeps a cover", async () => {
  const bytes = await buildFigmaType3Fixture();
  const { page } = await extractFigmaPage(bytes);

  const { report, text, vectors } = await exportAndRead(
    bytes,
    editRun(page, FIGMA_HEADING.text, "Structuring Info", { inkShared: true })
  );

  expect(text).not.toContain(FIGMA_HEADING.text);
  expect(whiteFills(vectors).length).toBeGreaterThan(0);
  expect(report.coverOnlyRunIds).toEqual([runId(page, FIGMA_HEADING.text)]);
});

test("a page whose content counts disagree is never edited", async () => {
  const bytes = await twoLinePdf();
  const { page } = await extractFigmaPage(bytes);
  const counts = page.contentOpCounts;
  const skewed: EditorPage = {
    ...editRun(page, "Old line", "New line"),
    contentOpCounts: counts && { ...counts, shows: counts.shows + 1 },
  };

  const { report, text } = await exportAndRead(bytes, skewed);

  expect(text).toContain("Old line");
  expect(report.coverOnlyRunIds).toHaveLength(1);
});

test("text inside a form XObject gets no removal target", async () => {
  const inner = await PDFDocument.load(await twoLinePdf());
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const [form] = await doc.embedPages([inner.getPage(0)]);
  if (form) {
    page.drawPage(form, { x: 0, y: 0 });
  }
  const bytes = await doc.save();

  const { page: extracted } = await extractFigmaPage(bytes);
  const run = extracted.pdfTextObjects.find(
    (item) => item.originalText === "Old line"
  );

  expect(run).toBeDefined();
  expect(run?.removalTarget).toBeUndefined();
  expect(run && pdfTextRemovable(run, extracted)).toBe(false);
});

test("a show whose advance positions the next show is not safe to empty", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of("F1"), font.ref);
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(
      doc.context.flateStream(
        "BT /F1 12 Tf 72 700 Td (Hello) Tj (World) Tj ET BT /F1 12 Tf 72 600 Td (Alone) Tj ET"
      )
    )
  );
  const pdf = await loadPdfJsDocument(await doc.save()).promise;
  const firstPage = await pdf.getPage(1);
  const operatorList = await firstPage.getOperatorList();

  const index = indexPageRemovals(operatorList, OPS);

  expect(index.shows.map((show) => [show.text, show.safe])).toEqual([
    ["Hello", false],
    ["World", true],
    ["Alone", true],
  ]);
});

test("Figma runs and ordinary runs are removable at load", async () => {
  const figma = await extractFigmaPage(await buildFigmaType3Fixture());
  const plain = await extractFigmaPage(await twoLinePdf());

  for (const { page } of [figma, plain]) {
    expect(
      page.pdfTextObjects.every((run) => pdfTextRemovable(run, page))
    ).toBe(true);
  }
});

test("a clip-mode run is neither editable nor emptied on export", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of("F1"), font.ref);
  // The 7 Tr run is a clip mask the red fill paints through.
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(
      doc.context.flateStream(
        "q BT /F1 48 Tf 7 Tr 72 700 Td (Mask) Tj ET 1 0 0 rg 0 0 612 792 re f Q " +
          "BT /F1 12 Tf 3 Tr 72 600 Td (Hidden) Tj ET " +
          "BT /F1 12 Tf 0 Tr 72 500 Td (Plain) Tj ET"
      )
    )
  );
  const bytes = await doc.save();
  const { page: extracted } = await extractFigmaPage(bytes, { paints: true });
  const run = (text: string) =>
    extracted.pdfTextObjects.find((item) => item.originalText === text);

  expect(run("Mask")?.originalTextRenderingMode).toBe(7);
  expect(run("Hidden")?.originalTextRenderingMode).toBe(3);
  expect(run("Plain")?.originalTextRenderingMode).toBe(0);
  const mask = run("Mask");
  expect(mask && pdfTextEditable(mask)).toBe(false);
  expect(mask && pdfTextRemovable(mask, extracted)).toBe(false);
  const plain = run("Plain");
  expect(plain && pdfTextEditable(plain)).toBe(true);

  const { text, vectors } = await exportAndRead(
    bytes,
    editRun(extracted, "Mask", "Edit")
  );

  expect(text).toContain("Mask");
  expect(vectors.some((vector) => vector.fill?.color === "#ff0000")).toBe(true);
});
