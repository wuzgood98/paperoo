import {
  DEFAULT_ASCENT_RATIO,
  textItemToDisplayedBox,
} from "@/lib/editor/coordinates";
import { createId as defaultCreateId } from "@/lib/editor/ids";
import type {
  EditorPage,
  PdfTextAnchor,
  PdfTextObject,
  PdfTextTransform,
  PdfVectorObject,
} from "@/lib/editor/types";
import {
  DEFAULT_PDF_TEXT_RENDERING_MODE,
  DEFAULT_PDF_TEXT_STROKE_COLOR,
  DEFAULT_PDF_TEXT_STROKE_WIDTH,
} from "@/lib/editor/types";
import {
  estimateOutlineSize,
  estimateOutlineWeight,
  matchOutlineFace,
  outlineLineGeometry,
} from "@/lib/ocr/outline-face";
import type { OutlineLineGeometry } from "@/lib/ocr/outline-face";
import type { OutlineLine } from "@/lib/ocr/outline-text";

/** Descenders reach about this far below the baseline, in em. */
const DESCENT_RATIO = 0.2;
/** Line edges within this share of the size count as aligned. */
const ALIGN_TOLERANCE_EM = 0.15;

const spread = (values: readonly number[]): number =>
  Math.max(...values) - Math.min(...values);

/**
 * Which point of each line stays put: lines sharing a middle but not a start
 * are centered, sharing an end but not a start are right-aligned.
 */
export const outlineAnchor = (
  lines: readonly OutlineLineGeometry[],
  size: number
): PdfTextAnchor => {
  if (lines.length < 2) {
    return "start";
  }
  const tolerance = size * ALIGN_TOLERANCE_EM;
  const starts = lines.map((line) => line.originX);
  if (spread(starts) <= tolerance) {
    return "start";
  }
  if (spread(lines.map((line) => line.originX + line.width / 2)) <= tolerance) {
    return "center";
  }
  if (spread(lines.map((line) => line.originX + line.width)) <= tolerance) {
    return "end";
  }
  return "start";
};

export const anchorX = (
  anchor: PdfTextAnchor,
  originX: number,
  width: number
): number => {
  if (anchor === "center") {
    return originX + width / 2;
  }
  return anchor === "end" ? originX + width : originX;
};

/**
 * Text runs for an outline-only label, one per recognized line, set in the
 * matched document face when there is one. The runs own the outline as
 * their original ink; each names the subpaths that draw it.
 */
export const outlineTextRuns = (
  pages: readonly EditorPage[],
  page: Pick<EditorPage, "cropBox" | "id" | "sourceRotate">,
  vector: PdfVectorObject,
  lines: readonly OutlineLine[],
  createId: () => string = defaultCreateId
): PdfTextObject[] => {
  const match = matchOutlineFace(pages, lines);
  const size = match?.size ?? estimateOutlineSize(lines);
  const texts = match?.texts ?? lines.map((line) => line.text);
  const geometry = lines.map((line, index) =>
    outlineLineGeometry(line, texts[index] ?? line.text, match, size)
  );
  const anchor = outlineAnchor(geometry, size);
  const fontWeight = match ? 400 : estimateOutlineWeight(lines, size);
  const color = vector.fill?.color ?? "#000000";
  const fillOpacity = vector.fill?.opacity;
  return lines.map((line, index): PdfTextObject => {
    const text = texts[index] ?? line.text;
    const { baseline, originX, width } = geometry[index] ?? {
      baseline: 0,
      originX: 0,
      width: 0,
    };
    const transform: PdfTextTransform = [size, 0, 0, size, originX, baseline];
    const box = textItemToDisplayedBox(
      transform,
      width,
      size,
      DEFAULT_ASCENT_RATIO,
      page.cropBox,
      page.sourceRotate,
      DESCENT_RATIO
    );
    const run: PdfTextObject = {
      ascentRatio: DEFAULT_ASCENT_RATIO,
      color,
      descentRatio: DESCENT_RATIO,
      dir: "ltr",
      embeddedFontUnavailable: true,
      fontFamily: "sans",
      fontName: "",
      fontSize: box.fontSize,
      fontWeight,
      hasEOL: false,
      height: box.height,
      id: createId(),
      inkShared: lines.length > 1,
      inkSubpaths: line.subpaths,
      inkVectorId: vector.id,
      invisibleGlyphs: true,
      originalColor: color,
      originalFontFamily: "sans",
      originalFontSize: box.fontSize,
      originalStrokeColor: DEFAULT_PDF_TEXT_STROKE_COLOR,
      originalStrokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
      originalText: text,
      originalTextRenderingMode: DEFAULT_PDF_TEXT_RENDERING_MODE,
      outlineText: {
        anchor,
        anchorX: anchorX(anchor, originX, width),
        confidence: line.confidence,
        lineWidth: width,
        originX,
      },
      pageId: page.id,
      rotation: box.rotation,
      sourceIndex: vector.sourceIndex,
      strokeColor: DEFAULT_PDF_TEXT_STROKE_COLOR,
      strokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
      text,
      textRenderingMode: DEFAULT_PDF_TEXT_RENDERING_MODE,
      transform,
      type: "pdf-text",
      width: box.width,
      x: box.x,
      y: box.y,
    };
    if (fillOpacity !== undefined) {
      run.fillOpacity = fillOpacity;
    }
    if (match) {
      run.glyphFace = match.ref;
    }
    return run;
  });
};

/**
 * Move a recognized line so its anchor stays put at `width` (user units),
 * the new text's advance. Other runs are returned unchanged.
 */
export const anchorOutlineRun = (
  run: PdfTextObject,
  page: Pick<EditorPage, "cropBox" | "sourceRotate">,
  width: number
): PdfTextObject => {
  const source = run.outlineText;
  if (!source) {
    return run;
  }
  const originX =
    run.text === run.originalText || source.anchor === "start"
      ? source.originX
      : source.anchorX - (source.anchor === "center" ? width / 2 : width);
  if (originX === run.transform[4]) {
    return run;
  }
  const [a, b, c, d, , f] = run.transform;
  const transform: PdfTextTransform = [a, b, c, d, originX, f];
  const box = textItemToDisplayedBox(
    transform,
    source.lineWidth,
    run.fontSize ?? run.height,
    run.ascentRatio ?? DEFAULT_ASCENT_RATIO,
    page.cropBox,
    page.sourceRotate,
    run.descentRatio ?? DESCENT_RATIO
  );
  return { ...run, transform, x: box.x, y: box.y };
};

/**
 * The run as the inline editor shows it while `text` is typed: same run,
 * moved so its anchor stays put. Other runs are returned unchanged.
 */
export const placeOutlineDraft = (
  run: PdfTextObject,
  page: Pick<EditorPage, "cropBox" | "sourceRotate">,
  text: string,
  width: number
): PdfTextObject => {
  if (!run.outlineText) {
    return run;
  }
  const anchored = anchorOutlineRun({ ...run, text }, page, width);
  return {
    ...run,
    transform: anchored.transform,
    x: anchored.x,
    y: anchored.y,
  };
};
