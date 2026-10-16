import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test, vi } from "vitest";

import {
  isPdfTextDirty,
  pdfTextInkOutline,
  pdfTextRemovable,
} from "@/lib/editor/object-utils";
import type {
  EditorPage,
  PdfTextObject,
  PdfVectorObject,
} from "@/lib/editor/types";
import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import { createOutlineTextController } from "@/lib/ocr/outline-controller";
import { outlineRasterFrame } from "@/lib/ocr/outline-ocr";
import type { OutlineRasterFrame } from "@/lib/ocr/outline-ocr";
import {
  anchorOutlineRun,
  outlineTextRuns,
  placeOutlineDraft,
} from "@/lib/ocr/outline-runs";
import {
  isOutlineTextCandidate,
  isOutlineTextCandidateOn,
  outlineSubpaths,
  recognizeOutlineLines,
} from "@/lib/ocr/outline-text";
import type { OcrOutlineLine } from "@/lib/ocr/outline-text";
import { exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { extractFigmaPage } from "./figma-extract";
import {
  buildFigmaType3Fixture,
  FIGMA_BODY,
  FIGMA_HEADING,
  figmaGlyph,
} from "./figma-type3-fixture";
import type { FigmaFace } from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

/** The body run also sets I and l, so the face can tell them apart. */
const BODY = { ...FIGMA_BODY, text: "Take raw text. Il" };

interface Label {
  center: number;
  face: FigmaFace;
  /** Baseline of the first line; later lines step down. */
  firstBaseline: number;
  gray: number;
  lines: readonly string[];
  size: number;
}

/** A centered two-line callout, set in the body face but drawn only as outlines. */
const CALLOUT: Label = {
  center: 400,
  face: "regular",
  firstBaseline: 300,
  gray: 0.2,
  lines: ["Take raw text.", "a tax"],
  size: 10,
};

const LINE_STEP_EM = 1.3;

const lineBaseline = (label: Label, index: number): number =>
  label.firstBaseline - index * label.size * LINE_STEP_EM;

const advanceEm = (face: FigmaFace, text: string): number =>
  [...text].reduce((sum, char) => sum + figmaGlyph(face, char).width, 0);

const lineStart = (label: Label, text: string): number =>
  label.center - (advanceEm(label.face, text) * label.size) / 2;

/** Rectangle glyphs like the fixture's outlines, in page coordinates. */
const labelContent = (label: Label): string => {
  const parts: string[] = [];
  for (const [index, text] of label.lines.entries()) {
    const baseline = lineBaseline(label, index);
    let pen = lineStart(label, text);
    for (const char of text) {
      const { box, width } = figmaGlyph(label.face, char);
      const [llx, lly, urx, ury] = box;
      if (urx > llx) {
        const x0 = pen + llx * label.size;
        const x1 = pen + urx * label.size;
        const y0 = baseline + lly * label.size;
        const y1 = baseline + ury * label.size;
        parts.push(`${x0} ${y0} m ${x1} ${y0} l ${x1} ${y1} l ${x0} ${y1} l h`);
      }
      pen += width * label.size;
    }
  }
  const ink = `${label.gray} ${label.gray} ${label.gray} rg`;
  return `q ${ink} ${parts.join(" ")} f Q`;
};

/** What Tesseract reports for the label: one box per line, in user space. */
const ocrLines = (
  label: Label,
  texts: readonly string[] = label.lines,
  confidence = 95
): OcrOutlineLine[] =>
  label.lines.map((text, index) => {
    const baseline = lineBaseline(label, index);
    const start = lineStart(label, text);
    return {
      box: {
        maxX: start + advanceEm(label.face, text) * label.size + 1,
        maxY: baseline + label.size,
        minX: start - 1,
        minY: baseline - label.size * 0.3,
      },
      confidence,
      text: texts[index] ?? text,
    };
  });

const LABEL_COLOR = "#333333";

const loadLabelPage = async (label: Label = CALLOUT) => {
  const bytes = await buildFigmaType3Fixture(
    [FIGMA_HEADING, BODY],
    labelContent(label)
  );
  const { page } = await extractFigmaPage(bytes);
  const vector = page.pdfVectorObjects.find(
    (item) => item.fill?.color === LABEL_COLOR
  );
  if (!vector) {
    throw new Error("The label path was not extracted.");
  }
  return { bytes, page, vector };
};

const recognize = (
  page: EditorPage,
  vector: PdfVectorObject,
  lines: readonly OcrOutlineLine[]
): PdfTextObject[] => {
  const recognized = recognizeOutlineLines(vector, lines);
  if (!recognized) {
    throw new Error("The label was not recognized.");
  }
  return outlineTextRuns([page], page, vector, recognized);
};

/** The page after recognition: the label path is now the runs' ink. */
const withRuns = (
  page: EditorPage,
  vector: PdfVectorObject,
  runs: readonly PdfTextObject[]
): EditorPage => ({
  ...page,
  pdfTextObjects: [...page.pdfTextObjects, ...runs],
  pdfVectorObjects: page.pdfVectorObjects.map((item) =>
    item.id === vector.id ? { ...item, textInk: true } : item
  ),
});

test("a label path is a text candidate; a plain shape is not", async () => {
  const { page, vector } = await loadLabelPage();

  expect(isOutlineTextCandidate(vector)).toBe(true);
  // The heading's and body's outlines are already owned by their Type3 text.
  expect(
    page.pdfVectorObjects.filter((item) => isOutlineTextCandidate(item))
  ).toEqual([vector]);
  expect(
    isOutlineTextCandidate({
      ...vector,
      commands: vector.commands.slice(0, 5),
    })
  ).toBe(false);
});

test("recognized lines take the matched document face, size and alignment", async () => {
  const { page, vector } = await loadLabelPage();
  const runs = recognize(page, vector, ocrLines(CALLOUT));
  const [first, second] = runs;

  expect(runs.map((run) => run.text)).toEqual(CALLOUT.lines);
  expect(first?.glyphFace).toBeDefined();
  expect(first?.fontSize).toBeCloseTo(CALLOUT.size, 4);
  expect(first?.outlineText?.anchor).toBe("center");
  expect(first?.color).toBe(LABEL_COLOR);
  expect(first?.transform[4]).toBeCloseTo(
    lineStart(CALLOUT, CALLOUT.lines[0] ?? ""),
    3
  );
  expect(first?.transform[5]).toBeCloseTo(lineBaseline(CALLOUT, 0), 3);
  expect(second?.transform[5]).toBeCloseTo(lineBaseline(CALLOUT, 1), 3);
  // Each line owns its own glyphs of the shared path.
  const all = outlineSubpaths(vector.commands).length;
  expect(
    (first?.inkSubpaths?.length ?? 0) + (second?.inkSubpaths?.length ?? 0)
  ).toBe(all);
  expect(runs.every((run) => run.inkShared === true)).toBe(true);
});

test("glyph shapes fix look-alike characters OCR confused", async () => {
  const label: Label = { ...CALLOUT, lines: ["tax Il"] };
  const { page, vector } = await loadLabelPage(label);

  const runs = recognize(page, vector, ocrLines(label, ["tax lI"]));

  expect(runs.map((run) => run.text)).toEqual(["tax Il"]);
});

test("doubtful OCR leaves the path a vector", async () => {
  const { vector } = await loadLabelPage();

  expect(recognizeOutlineLines(vector, ocrLines(CALLOUT, undefined, 60))).toBe(
    null
  );
  // One character too many: the outline is not exactly that text.
  expect(
    recognizeOutlineLines(
      vector,
      ocrLines(CALLOUT, ["Take raw texts.", "a tax"])
    )
  ).toBe(null);
});

test("a run's ink outline is only its own line", async () => {
  const { page, vector } = await loadLabelPage();
  const runs = recognize(page, vector, ocrLines(CALLOUT));
  const recognized = withRuns(page, vector, runs);
  const [, second] = runs;
  if (!second) {
    throw new Error("missing line");
  }

  const outline = pdfTextInkOutline(second, recognized);

  expect(outlineSubpaths(outline?.commands ?? [])).toHaveLength(
    second.inkSubpaths?.length ?? -1
  );
  expect(pdfTextRemovable({ ...second, text: "x" }, recognized)).toBe(true);
});

test("a centered line keeps its middle when its text changes", async () => {
  const { page, vector } = await loadLabelPage();
  const [first] = recognize(page, vector, ocrLines(CALLOUT));
  if (!first?.outlineText) {
    throw new Error("missing line");
  }
  const width = 30;

  const moved = anchorOutlineRun({ ...first, text: "Tax" }, page, width);
  const back = anchorOutlineRun(
    { ...moved, text: first.originalText },
    page,
    first.outlineText.lineWidth
  );

  expect(moved.transform[4] + width / 2).toBeCloseTo(CALLOUT.center, 3);
  expect(back.transform).toEqual(first.transform);
  expect(back.x).toBeCloseTo(first.x, 6);
});

test("the inline draft of a centered line stays centered as it grows", async () => {
  const { page, vector } = await loadLabelPage();
  const [first] = recognize(page, vector, ocrLines(CALLOUT));
  if (!first?.outlineText) {
    throw new Error("missing line");
  }
  const grown = first.outlineText.lineWidth + 20;

  const draft = placeOutlineDraft(first, page, `${first.text} more`, grown);

  // Same run and text (nothing committed); only its place moved.
  expect(draft.text).toBe(first.text);
  expect(draft.transform[4] + grown / 2).toBeCloseTo(CALLOUT.center, 3);
  expect(draft.x).toBeCloseTo(first.x - 10, 3);
  expect(draft.y).toBeCloseTo(first.y, 6);
  // Runs the PDF carries as text keep their place.
  const native = { ...first, outlineText: undefined };
  expect(placeOutlineDraft(native, page, "longer text", grown)).toBe(native);
});

test("editing one line removes the label path and redraws the other line", async () => {
  const { bytes, page, vector } = await loadLabelPage();
  const runs = recognize(page, vector, ocrLines(CALLOUT));
  const recognized = withRuns(page, vector, runs);
  const edited: EditorPage = {
    ...recognized,
    pdfTextObjects: recognized.pdfTextObjects.map((run) =>
      run.id === runs[0]?.id ? { ...run, text: "Take a tax." } : run
    ),
  };
  expect(edited.pdfTextObjects.filter(isPdfTextDirty)).toHaveLength(1);

  const report = await exportDocumentWithReport({
    assets: {},
    bytes,
    document: { pages: [edited] },
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
    .join("|");
  const labelFills = extractPdfVectorObjects(
    operatorList,
    { cropBox: page.cropBox, id: "out", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  ).filter((item) => item.fill?.color === LABEL_COLOR);

  expect(report.coverOnlyRunIds).toEqual([]);
  // The new line is real text; the untouched line is searchable too.
  expect(text).toContain("Take a tax.");
  expect(text).toContain("a tax");
  // Only the untouched line's outline still paints.
  expect(labelFills).toHaveLength(1);
  expect(labelFills[0]?.height).toBeCloseTo(
    figmaGlyph("regular", "a").box[3] * CALLOUT.size,
    3
  );
});

test("an exported label is not read again when the export is reopened", async () => {
  const { bytes, page, vector } = await loadLabelPage();
  const runs = recognize(page, vector, ocrLines(CALLOUT));
  const report = await exportDocumentWithReport({
    assets: {},
    bytes,
    document: { pages: [withRuns(page, vector, runs)] },
    fontBytes: {},
  });

  const reopened = await extractFigmaPage(report.bytes);
  const label = reopened.page.pdfVectorObjects.find(
    (item) => item.fill?.color === LABEL_COLOR
  );

  // The outline is still there, but the export's invisible text now covers it.
  expect(label && isOutlineTextCandidate(label)).toBe(true);
  expect(label && isOutlineTextCandidateOn(reopened.page, label)).toBe(false);
  expect(reopened.runs.map((run) => run.text)).toEqual(
    expect.arrayContaining([...CALLOUT.lines])
  );
});

const engineLines = (
  lines: readonly OcrOutlineLine[],
  frame: OutlineRasterFrame
): EngineOcrPage => ({
  blocks: [
    {
      paragraphs: [
        {
          lines: lines.map((line) => {
            const bbox = {
              x0: (line.box.minX - frame.left) * frame.scale,
              x1: (line.box.maxX - frame.left) * frame.scale,
              y0: (frame.top - line.box.maxY) * frame.scale,
              y1: (frame.top - line.box.minY) * frame.scale,
            };
            return {
              bbox,
              words: line.text.split(" ").map((word) => ({
                bbox,
                confidence: line.confidence,
                text: word,
              })),
            };
          }),
        },
      ],
    },
  ],
});

test("the controller recognizes each candidate once and stores its runs", async () => {
  const { page, vector } = await loadLabelPage();
  const frame = outlineRasterFrame(vector);
  if (!frame) {
    throw new Error("no frame");
  }
  const recognizeImage = vi.fn(() =>
    Promise.resolve(engineLines(ocrLines(CALLOUT), frame))
  );
  const apply = vi.fn();
  const controller = createOutlineTextController({
    apply,
    createEngine: () => ({ recognize: recognizeImage }),
    getPages: () => [page],
    render: () => new Blob(),
  });

  controller.enqueuePage(page);
  controller.enqueuePage(page);
  await vi.waitFor(() => {
    expect(apply).toHaveBeenCalledTimes(1);
  });

  expect(recognizeImage).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith(
    page.id,
    vector.id,
    expect.arrayContaining([
      expect.objectContaining({ text: CALLOUT.lines[0] }),
      expect.objectContaining({ text: CALLOUT.lines[1] }),
    ])
  );
});
