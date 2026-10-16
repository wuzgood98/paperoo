import { expect, test } from "vitest";

import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";
import {
  glyphLayoutSvgPath,
  glyphSourceMessage,
  layoutGlyphText,
  missingGlyphs,
  rebuiltGlyphLayout,
  resolveGlyphFace,
} from "@/lib/pdf/glyph-face";

import { extractFigmaPage } from "./figma-extract";
import {
  buildFigmaType3Fixture,
  FIGMA_BODY,
  FIGMA_HEADING,
  figmaGlyph,
} from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const fixturePage = async (): Promise<EditorPage> => {
  const { page } = await extractFigmaPage(await buildFigmaType3Fixture());
  return page;
};

const runWithText = (page: EditorPage, text: string): PdfTextObject => {
  const run = page.pdfTextObjects.find((item) => item.originalText === text);
  if (!run) {
    throw new Error(`No run "${text}" in the fixture.`);
  }
  return run;
};

test("each glyph of an outline is cut out on its own", async () => {
  const page = await fixturePage();
  const shapes = Object.values(page.type3Glyphs?.shapes ?? {});
  const distinct = new Set([
    ...[...FIGMA_HEADING.text].map((char) => `semibold:${char}`),
    ...[...FIGMA_BODY.text].map((char) => `regular:${char}`),
  ]);

  // Spaces share one shape across faces (no ink, same width and box).
  expect(shapes).toHaveLength(distinct.size - 1);
  for (const shape of shapes) {
    const xs = shape.commands.flatMap((command) =>
      command.type === "moveTo" || command.type === "lineTo" ? [command.x] : []
    );
    if (xs.length === 0) {
      continue;
    }
    expect(Math.min(...xs)).toBeCloseTo(shape.box[0], 3);
    expect(Math.max(...xs)).toBeCloseTo(shape.box[2], 3);
  }
});

test("a run's face holds only glyphs set in that face", async () => {
  const page = await fixturePage();
  const heading = resolveGlyphFace(
    [page],
    page.id,
    runWithText(page, FIGMA_HEADING.text)
  );
  const body = resolveGlyphFace(
    [page],
    page.id,
    runWithText(page, FIGMA_BODY.text)
  );

  expect([...(heading?.glyphs.keys() ?? [])].toSorted()).toEqual(
    [...new Set(FIGMA_HEADING.text)].toSorted()
  );
  expect(heading?.glyphs.get("a")?.width).toBeCloseTo(
    figmaGlyph("semibold", "a").width
  );
  expect(body?.glyphs.get("a")?.width).toBeCloseTo(
    figmaGlyph("regular", "a").width
  );
});

test("missing characters are named, each once", async () => {
  const page = await fixturePage();
  const face = resolveGlyphFace(
    [page],
    page.id,
    runWithText(page, FIGMA_HEADING.text)
  );

  expect(face && missingGlyphs(face, "Take take")).toEqual(["T", "k", "e"]);
});

test("new text is laid out on the face's own advances", async () => {
  const page = await fixturePage();
  const face = resolveGlyphFace(
    [page],
    page.id,
    runWithText(page, FIGMA_HEADING.text)
  );
  const layout = face && layoutGlyphText(face, "Strung");

  const widths = [..."Strung"].map(
    (char) => figmaGlyph("semibold", char).width
  );
  const expected = widths.map((_width, index) =>
    widths.slice(0, index).reduce((sum, width) => sum + width, 0)
  );
  expect(layout?.glyphs.map((glyph) => glyph.x)).toEqual(
    expected.map((value) => expect.closeTo(value, 6))
  );
});

test("a glyph missing anywhere in the text means no rebuilt layout", async () => {
  const page = await fixturePage();
  const run = runWithText(page, FIGMA_HEADING.text);

  expect(
    rebuiltGlyphLayout([page], page, { ...run, text: "Strung Data" })
  ).not.toBeNull();
  expect(
    rebuiltGlyphLayout([page], page, { ...run, text: "Strung Kata" })
  ).toBeNull();
});

/** Export one edit and read back the replacement's text item and font. */
const exportEdit = async (text: string) => {
  const bytes = await buildFigmaType3Fixture();
  const { page } = await extractFigmaPage(bytes);
  const edited: EditorPage = {
    ...page,
    pdfTextObjects: page.pdfTextObjects.map((run) =>
      run.originalText === FIGMA_HEADING.text ? { ...run, text } : run
    ),
  };
  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages: [edited] },
    fontBytes: {},
  });
  const pdf = await loadPdfJsDocument(output).promise;
  const exported = await pdf.getPage(1);
  const [content] = await Promise.all([
    exported.getTextContent(),
    exported.getOperatorList(),
  ]);
  const item = content.items.find(
    (entry) => "str" in entry && entry.str === text
  );
  const fontName = item && "fontName" in item ? item.fontName : "";
  // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
  const fonts = exported.commonObjs as PdfJsFontObjectStore;
  const font =
    fontName && fonts.has(fontName) ? fonts.get(fontName) : undefined;
  return { font, item };
};

test("an edit spelled from the document's glyphs exports in a rebuilt Type3 font", async () => {
  const { font, item } = await exportEdit("Strung Data");

  expect(item).toBeDefined();
  expect(font?.isType3Font).toBe(true);
  expect(item && "transform" in item ? item.transform[0] : 0).toBeCloseTo(
    FIGMA_HEADING.size,
    2
  );
});

test("an edit with a missing glyph exports in the substitute font instead", async () => {
  const { font, item } = await exportEdit("Strung Kata");

  expect(item).toBeDefined();
  expect(font?.isType3Font).not.toBe(true);
});

test("the preview path draws each glyph at its pen position, y down", async () => {
  const page = await fixturePage();
  const face = resolveGlyphFace(
    [page],
    page.id,
    runWithText(page, FIGMA_HEADING.text)
  );
  const layout = face && layoutGlyphText(face, "St");
  const size = 10;

  const d = layout ? glyphLayoutSvgPath(layout, size) : "";

  const sWidth = figmaGlyph("semibold", "S").width;
  const tBox = figmaGlyph("semibold", "t").box;
  // "t" starts one advance of "S" right; its top is above the baseline (negative y).
  expect(d).toContain(`M${(sWidth + tBox[0]) * size} 0`);
  expect(d).toContain(`-${tBox[3] * size}`);
});

test("the inspector names missing glyphs or confirms the document's own", async () => {
  const page = await fixturePage();
  const run = runWithText(page, FIGMA_HEADING.text);
  const face = resolveGlyphFace([page], page.id, run);

  expect(
    glyphSourceMessage(
      face,
      rebuiltGlyphLayout([page], page, { ...run, text: "Data" }),
      "Data"
    )
  ).toBe("Using the document's own glyphs.");
  expect(glyphSourceMessage(face, null, "Kata!")).toBe(
    "Original glyphs missing for “K”, “!”; using a substitute."
  );
  expect(glyphSourceMessage(null, null, "Data")).toBe(
    "The document's own glyphs can't be used here; using a substitute."
  );
});
