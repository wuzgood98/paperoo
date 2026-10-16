import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "vitest";

import {
  DEFAULT_ASCENT_RATIO,
  DEFAULT_DESCENT_FLOOR,
} from "@/lib/editor/coordinates";
import type { TextItemTransform } from "@/lib/editor/coordinates";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  textItemEmSize,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";

import {
  buildFigmaType3Fixture,
  FIGMA_BODY,
  FIGMA_HEADING,
} from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const SIZE_DIGITS = 4;

const extractRuns = async (bytes: Uint8Array) => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  // Fonts reach commonObjs during operator-list translation (as in PdfSession).
  const [content] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const fontFaces = await collectPdfFontFaces(
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    page.commonObjs as PdfJsFontObjectStore,
    extractable.items
  );
  const [x0, y0, x1, y1] = page.view;
  const runs = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: y1 - y0, width: x1 - x0, x: x0, y: y0 },
      id: "page-1",
      sourceRotate: 0,
    },
    fontFaces
  );
  await task.destroy();
  return runs;
};

test("Figma Type3 runs take their size from Tm, not the inflated height", async () => {
  const runs = await extractRuns(await buildFigmaType3Fixture());
  const heading = runs.find((run) => run.text === FIGMA_HEADING.text);
  const body = runs.find((run) => run.text === FIGMA_BODY.text);

  expect(heading?.fontSize).toBeCloseTo(FIGMA_HEADING.size, SIZE_DIGITS);
  expect(heading?.originalFontSize).toBeCloseTo(
    FIGMA_HEADING.size,
    SIZE_DIGITS
  );
  expect(body?.fontSize).toBeCloseTo(FIGMA_BODY.size, SIZE_DIGITS);
});

test("Figma Type3 run boxes shrink with the true size", async () => {
  const runs = await extractRuns(await buildFigmaType3Fixture());
  const heading = runs.find((run) => run.text === FIGMA_HEADING.text);

  // Type3 styles report no ascent or descent, so the defaults apply.
  expect(heading?.height).toBeCloseTo(
    FIGMA_HEADING.size * (DEFAULT_ASCENT_RATIO + DEFAULT_DESCENT_FLOOR),
    2
  );
});

test("an edited Figma Type3 run exports at its true size", async () => {
  const bytes = await buildFigmaType3Fixture();
  const runs = await extractRuns(bytes);
  const edited = runs.map((run) =>
    run.text === FIGMA_HEADING.text
      ? {
          ...run,
          // Measured in the browser before export; Node has no canvas.
          coverRects: [
            { height: run.height, width: run.width, x: run.x, y: run.y },
          ],
          text: "Structuring Info",
        }
      : run
  );

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      pages: [
        {
          cropBox: { height: 612, width: 792, x: 0, y: 0 },
          height: 612,
          id: "page-1",
          objects: [],
          pdfAnnotationObjects: [],
          pdfImageObjects: [],
          pdfTextObjects: edited,
          pdfVectorObjects: [],
          rotation: 0,
          skippedPdfAnnotationSubtypes: [],
          sourceIndex: 0,
          sourceRotate: 0,
          width: 792,
        },
      ],
    },
    fontBytes: {},
  });

  const pdf = await loadPdfJsDocument(output).promise;
  const exportedPage = await pdf.getPage(1);
  const content = await exportedPage.getTextContent();
  const replacement = content.items.find(
    (item) => "str" in item && item.str === "Structuring Info"
  );
  const [scaleX] =
    replacement && "transform" in replacement ? replacement.transform : [];
  expect(scaleX).toBeCloseTo(FIGMA_HEADING.size, 2);
});

test("non-Type3 runs keep the reported height as their size", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Helvetica Run", { font, size: 18, x: 72, y: 700 });

  const runs = await extractRuns(await pdf.save());

  expect(runs[0]?.fontSize).toBeCloseTo(18, SIZE_DIGITS);
});

test("textItemEmSize only corrects Type3 items", () => {
  const inflated: TextItemTransform = [14.25, 0, 0, 18.6, 32, 502];

  expect(textItemEmSize(inflated, 18.6, true)).toBeCloseTo(14.25);
  expect(textItemEmSize(inflated, 18.6, false)).toBe(18.6);
});

test("textItemEmSize measures rotated Type3 runs along the baseline", () => {
  // 90° rotation: the advance runs along y.
  const rotated: TextItemTransform = [0, 10, -13, 0, 100, 100];

  expect(textItemEmSize(rotated, 13, true)).toBeCloseTo(10);
});

test("textItemEmSize falls back to height for a degenerate matrix", () => {
  const flat: TextItemTransform = [0, 0, 0, 12, 0, 0];

  expect(textItemEmSize(flat, 12, true)).toBe(12);
});
