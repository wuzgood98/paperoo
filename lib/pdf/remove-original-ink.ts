import { decodePDFRawStream, PDFArray, PDFName, PDFRawStream } from "pdf-lib";
import type { PDFDocument, PDFPage, PDFRef } from "pdf-lib";

import type {
  EditorPage,
  PdfContentOpCounts,
  PdfPathRemovalTarget,
  PdfTextObject,
  PdfTextRemovalTarget,
  PdfVectorObject,
} from "@/lib/editor/types";
import { inkedSubpaths } from "@/lib/ocr/outline-text";
import {
  applyContentEdits,
  parseContentStream,
  PATH_PAINT_OPERATORS,
  TEXT_SHOW_OPERATORS,
} from "@/lib/pdf/content-stream";
import type {
  ContentEdit,
  ContentOperation,
  ContentToken,
} from "@/lib/pdf/content-stream";

/** Lines of an outline-only label that stay as they were after its path was unpainted. */
export interface KeptOutlineLines {
  subpaths: readonly number[];
  vectorId: string;
}

export interface InkRemovalResult {
  /** Runs whose original ink is gone from the page: no cover needed. */
  inkRemoved: ReadonlySet<string>;
  /**
   * Unpainted outline-only labels whose other lines were not edited: export
   * redraws these subpaths as they were.
   */
  keptOutlineLines: readonly KeptOutlineLines[];
  /**
   * Runs whose text-showing operator was emptied (no longer searchable), or
   * outline-only runs, which have none.
   */
  textRemoved: ReadonlySet<string>;
}

const NOTHING_REMOVED: InkRemovalResult = {
  inkRemoved: new Set(),
  keptOutlineLines: [],
  textRemoved: new Set(),
};

const MAX_OCTAL_DIGITS = 3;
const OCTAL_DIGIT = /[0-7]/u;
const HEX_DIGIT = /[0-9A-Fa-f]/gu;
const PATH_BUILD_OPERATORS = new Set([
  "m",
  "l",
  "c",
  "v",
  "y",
  "h",
  "re",
  "W",
  "W*",
]);
/** pdf.js path bounds are Float32; allow that much slack. */
const BOX_SLACK = 0.01;
const BOX_RELATIVE_SLACK = 1e-4;
/** Text rendering modes that paint no glyph ink. */
const INVISIBLE_RENDER_MODES = new Set([3, 7]);
/** Text rendering modes that add the glyphs to the clip path. */
const CLIP_RENDER_MODES = new Set([4, 5, 6, 7]);

const latin1 = (bytes: Uint8Array): string => {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCodePoint(byte);
  }
  return text;
};

/** Inverse of `latin1`: every char came from one byte, so fits in one. */
const fromLatin1 = (text: string): Uint8Array =>
  Uint8Array.from(text, (char) => char.codePointAt(0) ?? 0);

/** The page's content streams decoded and joined, or null if any can't be. */
const readPageContent = (page: PDFPage): string | null => {
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFArray) {
    for (const [index] of contents.asArray().entries()) {
      const stream = contents.lookup(index);
      if (!(stream instanceof PDFRawStream)) {
        return null;
      }
      streams.push(stream);
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents);
  } else {
    return null;
  }
  try {
    return streams
      .map((stream) => latin1(decodePDFRawStream(stream).decode()))
      .join("\n");
  } catch {
    return null;
  }
};

/** Bytes a literal string token decodes to (ISO 32000-1 §7.3.4.2). */
const literalStringBytes = (token: string): number => {
  const body = token.slice(1, -1);
  let bytes = 0;
  let index = 0;
  while (index < body.length) {
    if (body[index] !== "\\") {
      bytes += 1;
      index += 1;
      continue;
    }
    const next = body[index + 1] ?? "";
    if (next === "\r" || next === "\n") {
      // Line continuation: no byte.
      index += next === "\r" && body[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (OCTAL_DIGIT.test(next)) {
      let digits = 1;
      while (
        digits < MAX_OCTAL_DIGITS &&
        OCTAL_DIGIT.test(body[index + 1 + digits] ?? "")
      ) {
        digits += 1;
      }
      bytes += 1;
      index += 1 + digits;
      continue;
    }
    bytes += 1;
    index += 2;
  }
  return bytes;
};

const stringBytes = (token: ContentToken): number =>
  token.kind === "hex-string"
    ? Math.ceil((token.text.match(HEX_DIGIT)?.length ?? 0) / 2)
    : literalStringBytes(token.text);

const isStringToken = (token: ContentToken): boolean =>
  token.kind === "string" || token.kind === "hex-string";

/** The string operands a text-showing operation draws. */
const shownStrings = (operation: ContentOperation): ContentToken[] => {
  if (operation.operator === "TJ") {
    return operation.operands.filter(isStringToken);
  }
  const last = operation.operands.at(-1);
  return last && isStringToken(last) ? [last] : [];
};

/** pdf.js decodes simple fonts 1 byte per glyph, most CID fonts 2. */
const BYTES_PER_GLYPH = [1, 2];

const showMatches = (
  operation: ContentOperation,
  target: PdfTextRemovalTarget
): boolean => {
  const strings = shownStrings(operation);
  if (strings.length === 0 || target.glyphCount <= 0) {
    return false;
  }
  const bytes = strings.reduce((sum, token) => sum + stringBytes(token), 0);
  return BYTES_PER_GLYPH.some((width) => bytes === target.glyphCount * width);
};

const emptyShow = (operation: ContentOperation): ContentEdit | null => {
  if (operation.operator === "TJ") {
    const open = operation.operands.find(
      (token) => token.kind === "array-open"
    );
    const close = operation.operands.findLast(
      (token) => token.kind === "array-close"
    );
    return open && close
      ? { end: close.end, replacement: "[]", start: open.start }
      : null;
  }
  const [string] = shownStrings(operation);
  return string
    ? { end: string.end, replacement: "()", start: string.start }
    : null;
};

interface Bounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

const emptyBounds = (): Bounds => ({
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
});

const addPoint = (bounds: Bounds, x: number, y: number): void => {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
};

/**
 * Bounds of the path built before a paint operation: `ends` holds on-curve
 * points only, `hull` adds every control point. pdf.js's exact curve bounds
 * always lie between the two.
 */
const pathBounds = (
  operations: readonly ContentOperation[],
  paintIndex: number
): { ends: Bounds; hull: Bounds } | null => {
  let first = paintIndex;
  while (
    first > 0 &&
    PATH_BUILD_OPERATORS.has(operations[first - 1]?.operator ?? "")
  ) {
    first -= 1;
  }
  const ends = emptyBounds();
  const hull = emptyBounds();
  let current: [number, number] = [0, 0];
  for (const operation of operations.slice(first, paintIndex)) {
    const values = operation.operands.map((token) => Number(token.text));
    if (values.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const point = (x: number, y: number, onCurve: boolean): void => {
      addPoint(hull, x, y);
      if (onCurve) {
        addPoint(ends, x, y);
      }
    };
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
    switch (operation.operator) {
      case "m":
      case "l": {
        point(a, b, true);
        current = [a, b];
        break;
      }
      case "c": {
        point(a, b, false);
        point(c, d, false);
        point(e, f, true);
        current = [e, f];
        break;
      }
      case "v": {
        point(current[0], current[1], false);
        point(a, b, false);
        point(c, d, true);
        current = [c, d];
        break;
      }
      case "y": {
        point(a, b, false);
        point(c, d, true);
        current = [c, d];
        break;
      }
      case "re": {
        point(a, b, true);
        point(a + c, b + d, true);
        current = [a, b];
        break;
      }
      default: {
        break;
      }
    }
  }
  return Number.isFinite(ends.minX) ? { ends, hull } : null;
};

const slack = (limit: number): number =>
  BOX_SLACK + Math.abs(limit) * BOX_RELATIVE_SLACK;

const within = (inner: Bounds, outer: Bounds): boolean =>
  inner.minX >= outer.minX - slack(outer.minX) &&
  inner.minY >= outer.minY - slack(outer.minY) &&
  inner.maxX <= outer.maxX + slack(outer.maxX) &&
  inner.maxY <= outer.maxY + slack(outer.maxY);

const pathMatches = (
  operations: readonly ContentOperation[],
  paintIndex: number,
  target: PdfPathRemovalTarget
): boolean => {
  const bounds = pathBounds(operations, paintIndex);
  if (!bounds) {
    return false;
  }
  const [minX, minY, maxX, maxY] = target.box;
  const stored: Bounds = { maxX, maxY, minX, minY };
  return within(bounds.ends, stored) && within(stored, bounds.hull);
};

/** Turn a path-painting operator into `n`: the path is built, nothing paints. */
const unpaintPath = (operation: ContentOperation): ContentEdit => ({
  end: operation.end,
  replacement: "n",
  start: operation.end - operation.operator.length,
});

const runPaintsOwnInk = (run: PdfTextObject): boolean =>
  run.invisibleGlyphs !== true &&
  !INVISIBLE_RENDER_MODES.has(run.originalTextRenderingMode);

/** A page's raw content, parsed, with its top-level paint and show ops. */
interface RawContent {
  operations: ContentOperation[];
  /** Operation indexes of path-painting operators, in content order. */
  paints: number[];
  /** Operation indexes of text-showing operators, in content order. */
  shows: number[];
  source: string;
}

/** Parse the page's content, or null when it can't be matched to pdf.js. */
const readRawContent = (
  page: PDFPage,
  counts: PdfContentOpCounts
): RawContent | null => {
  const source = readPageContent(page);
  if (source === null) {
    return null;
  }
  let operations: ContentOperation[];
  try {
    operations = parseContentStream(source);
  } catch {
    return null;
  }
  const shows: number[] = [];
  const paints: number[] = [];
  for (const [index, operation] of operations.entries()) {
    if (TEXT_SHOW_OPERATORS.has(operation.operator)) {
      shows.push(index);
    } else if (PATH_PAINT_OPERATORS.has(operation.operator)) {
      paints.push(index);
    }
  }
  // When pdf.js and the raw stream disagree, editing by position is unsafe.
  return shows.length === counts.shows && paints.length === counts.paths
    ? { operations, paints, shows, source }
    : null;
};

/** The edit that empties the run's own text-showing operator, if verified. */
const planShowEdit = (
  raw: RawContent,
  run: PdfTextObject
): ContentEdit | null => {
  const target = run.removalTarget;
  const showIndex = target ? raw.shows[target.showOrdinal] : undefined;
  const show = showIndex === undefined ? undefined : raw.operations[showIndex];
  return target && show && showMatches(show, target) ? emptyShow(show) : null;
};

/** The edit that stops a run's own outline painting, if verified. */
const planOutlineEdit = (
  raw: RawContent,
  run: PdfTextObject,
  vectors: ReadonlyMap<string, PdfVectorObject>
): ContentEdit | null => {
  if (!run.inkVectorId || run.inkShared === true) {
    return null;
  }
  const target = vectors.get(run.inkVectorId)?.removalTarget;
  const paintIndex = target ? raw.paints[target.pathOrdinal] : undefined;
  const paint =
    paintIndex === undefined ? undefined : raw.operations[paintIndex];
  return target &&
    paint &&
    paintIndex !== undefined &&
    pathMatches(raw.operations, paintIndex, target)
    ? unpaintPath(paint)
    : null;
};

/** The edit that stops an outline-only label's whole path painting, if verified. */
const planLabelEdit = (
  raw: RawContent,
  vector: PdfVectorObject | undefined
): ContentEdit | null => {
  const target = vector?.removalTarget;
  const paintIndex = target ? raw.paints[target.pathOrdinal] : undefined;
  const paint =
    paintIndex === undefined ? undefined : raw.operations[paintIndex];
  return target &&
    paint &&
    paintIndex !== undefined &&
    pathMatches(raw.operations, paintIndex, target)
    ? unpaintPath(paint)
    : null;
};

/** Dirty outline-only runs, grouped by the label path they share. */
const groupByLabel = (
  runs: readonly PdfTextObject[]
): Map<string, PdfTextObject[]> => {
  const groups = new Map<string, PdfTextObject[]>();
  for (const run of runs) {
    if (run.outlineText && run.inkVectorId) {
      groups.set(run.inkVectorId, [
        ...(groups.get(run.inkVectorId) ?? []),
        run,
      ]);
    }
  }
  return groups;
};

/**
 * Remove dirty runs' original ink from the page's own content: empty each
 * run's text-showing operator and, for an outline-backed run, stop its
 * outline painting. An outline-only label's path stops painting once for all
 * its edited lines; its other lines are reported for redrawing. Every target
 * is verified against what pdf.js reported at load; anything that does not
 * match is left alone and gets a cover.
 */
// oxlint-disable-next-line eslint/complexity -- one pass per kind of original ink
export const removeOriginalInk = (
  doc: PDFDocument,
  page: PDFPage,
  editorPage: EditorPage,
  runs: readonly PdfTextObject[]
): InkRemovalResult => {
  const counts = editorPage.contentOpCounts;
  if (!counts || runs.every((run) => !(run.removalTarget || run.outlineText))) {
    return NOTHING_REMOVED;
  }
  const raw = readRawContent(page, counts);
  if (!raw) {
    return NOTHING_REMOVED;
  }

  const vectors = new Map(
    editorPage.pdfVectorObjects.map((vector) => [vector.id, vector])
  );
  const edits: ContentEdit[] = [];
  const textRemoved = new Set<string>();
  const inkRemoved = new Set<string>();
  const keptOutlineLines: KeptOutlineLines[] = [];
  for (const [vectorId, labelRuns] of groupByLabel(runs)) {
    const vector = vectors.get(vectorId);
    const labelEdit = planLabelEdit(raw, vector);
    if (!(vector && labelEdit)) {
      continue;
    }
    edits.push(labelEdit);
    const edited = new Set<number>();
    for (const run of labelRuns) {
      inkRemoved.add(run.id);
      textRemoved.add(run.id);
      for (const subpath of run.inkSubpaths ?? []) {
        edited.add(subpath);
      }
    }
    const kept: number[] = [];
    for (const { index } of inkedSubpaths(vector.commands)) {
      if (!edited.has(index)) {
        kept.push(index);
      }
    }
    if (kept.length > 0) {
      keptOutlineLines.push({ subpaths: kept, vectorId });
    }
  }
  for (const run of runs) {
    // Emptying a clip-mode show op drops the clip later paint depends on.
    if (
      run.outlineText ||
      CLIP_RENDER_MODES.has(run.originalTextRenderingMode)
    ) {
      continue;
    }
    const showEdit = planShowEdit(raw, run);
    if (!showEdit) {
      continue;
    }
    edits.push(showEdit);
    textRemoved.add(run.id);
    const outlineEdit = runPaintsOwnInk(run)
      ? null
      : planOutlineEdit(raw, run, vectors);
    if (outlineEdit) {
      edits.push(outlineEdit);
    }
    if (runPaintsOwnInk(run) || outlineEdit) {
      inkRemoved.add(run.id);
    }
  }
  if (edits.length === 0) {
    return NOTHING_REMOVED;
  }

  const updated = applyContentEdits(raw.source, edits);
  const stream = doc.context.flateStream(fromLatin1(updated));
  const ref: PDFRef = doc.context.register(stream);
  page.node.set(PDFName.of("Contents"), ref);
  return { inkRemoved, keptOutlineLines, textRemoved };
};
