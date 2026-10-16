/* oxlint-disable anti-slop/no-runtime-typeof -- PDF.js operator-list I/O: showText glyphs are plain objects */
import { IDENTITY_CTM, multiplyCtm } from "@/lib/editor/coordinates";
import type { Ctm } from "@/lib/editor/coordinates";
import type {
  PdfContentOpCounts,
  PdfTextObject,
  PdfVectorObject,
} from "@/lib/editor/types";
import type {
  ExtractableOperatorList,
  OperatorArg,
} from "@/lib/pdf/extract-images";

/** pdf.js OPS ids the walk needs; pass `OPS`. */
export interface PdfRemovalOps {
  beginAnnotation: number;
  beginText: number;
  constructPath: number;
  endAnnotation: number;
  endText: number;
  moveText: number;
  nextLine: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  restore: number;
  save: number;
  setLeadingMoveText: number;
  setTextMatrix: number;
  showText: number;
  transform: number;
}

export interface ShowRecord {
  glyphCount: number;
  ordinal: number;
  /** Text origin in user space, when the show follows a fresh `Tm`. */
  origin: { x: number; y: number } | null;
  /** Emptying it would not move later text in the same BT block. */
  safe: boolean;
  /** Decoded text with whitespace removed. */
  text: string;
}

interface PathRecord {
  box: readonly [number, number, number, number];
  ordinal: number;
}

export interface PageRemovalIndex {
  counts: PdfContentOpCounts;
  paths: ReadonlyMap<number, PathRecord>;
  shows: readonly ShowRecord[];
}

export interface RemovalTargetsResult {
  runs: PdfTextObject[];
  vectors: PdfVectorObject[];
}

interface GlyphText {
  count: number;
  text: string;
}

const isNumberList = (value: OperatorArg): value is ArrayLike<number> =>
  Array.isArray(value) ||
  (ArrayBuffer.isView(value) && !(value instanceof DataView));

const numbersAt = (
  source: ArrayLike<unknown>,
  length: number
): number[] | null => {
  const values = Array.from({ length }, (_unused, index) =>
    Number(source[index])
  );
  return values.every(Number.isFinite) ? values : null;
};

/** pdf.js passes `cm` spread and `Tm` as one typed array. */
const readMatrix = (args: OperatorArg): Ctm | null => {
  if (!Array.isArray(args)) {
    return null;
  }
  const [first] = args;
  const source = isNumberList(first) && !Array.isArray(first) ? first : args;
  const values = numbersAt(source, 6);
  return values
    ? [
        values[0] ?? 0,
        values[1] ?? 0,
        values[2] ?? 0,
        values[3] ?? 0,
        values[4] ?? 0,
        values[5] ?? 0,
      ]
    : null;
};

const readBox = (
  args: OperatorArg
): readonly [number, number, number, number] | null => {
  if (!Array.isArray(args)) {
    return null;
  }
  // oxlint-disable-next-line eslint/prefer-destructuring -- index 2 is the pathMinMax slot
  const minMax = args[2];
  if (minMax === undefined || minMax === null || !isNumberList(minMax)) {
    return null;
  }
  const values = numbersAt(minMax, 4);
  return values
    ? [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0]
    : null;
};

/** Glyph count and text of a pdf.js showText argument. */
const readGlyphs = (args: OperatorArg): GlyphText => {
  const glyphs: unknown = Array.isArray(args) ? args[0] : undefined;
  const result: GlyphText = { count: 0, text: "" };
  if (!Array.isArray(glyphs)) {
    return result;
  }
  for (const glyph of glyphs) {
    // Spacing adjustments are numbers; glyphs are objects.
    if (glyph !== null && typeof glyph === "object") {
      result.count += 1;
      // SAFETY: pdf.js glyph objects carry an optional `unicode` string.
      const { unicode } = glyph as { unicode?: unknown };
      result.text += typeof unicode === "string" ? unicode : "";
    }
  }
  return result;
};

const WHITESPACE = /\s+/gu;
const normalizeText = (text: string): string => text.replaceAll(WHITESPACE, "");

interface WalkState {
  /** Shows in the current BT block, oldest first. */
  blockShows: ShowRecord[];
  ctm: Ctm;
  ctmStack: Ctm[];
  /** The matrix from the last Tm, while no show has used it yet. */
  freshMatrix: Ctm | null;
  pathCount: number;
  paths: Map<number, PathRecord>;
  /** A Tm/Td/TD/T* came after the last show in this block. */
  repositioned: boolean;
  shows: ShowRecord[];
}

/** Graphics-state and path ops; returns false when `fn` is not one. */
const walkGraphics = (
  state: WalkState,
  fn: number,
  args: OperatorArg,
  sourceIndex: number,
  ops: PdfRemovalOps
): boolean => {
  if (fn === ops.save) {
    state.ctmStack.push(state.ctm);
  } else if (fn === ops.restore) {
    state.ctm = state.ctmStack.pop() ?? IDENTITY_CTM;
  } else if (fn === ops.transform) {
    const matrix = readMatrix(args);
    if (matrix) {
      state.ctm = multiplyCtm(state.ctm, matrix);
    }
  } else if (fn === ops.constructPath) {
    const box = readBox(args);
    if (box) {
      state.paths.set(sourceIndex, { box, ordinal: state.pathCount });
    }
    state.pathCount += 1;
  } else {
    return false;
  }
  return true;
};

const recordShow = (state: WalkState, args: OperatorArg): void => {
  const previous = state.blockShows.at(-1);
  if (previous && !state.repositioned) {
    // This show starts where the previous one's advance ended.
    previous.safe = false;
  }
  const { count, text } = readGlyphs(args);
  const tm = state.freshMatrix;
  const { ctm } = state;
  const record: ShowRecord = {
    glyphCount: count,
    ordinal: state.shows.length,
    origin: tm
      ? {
          x: tm[4] * ctm[0] + tm[5] * ctm[2] + ctm[4],
          y: tm[4] * ctm[1] + tm[5] * ctm[3] + ctm[5],
        }
      : null,
    safe: true,
    text: normalizeText(text),
  };
  state.shows.push(record);
  state.blockShows.push(record);
  state.repositioned = false;
  state.freshMatrix = null;
};

/** Text-object ops. */
const walkText = (
  state: WalkState,
  fn: number,
  args: OperatorArg,
  ops: PdfRemovalOps
): void => {
  if (fn === ops.beginText) {
    state.blockShows = [];
    state.repositioned = true;
    state.freshMatrix = null;
  } else if (fn === ops.setTextMatrix) {
    state.repositioned = true;
    state.freshMatrix = readMatrix(args);
  } else if (
    fn === ops.moveText ||
    fn === ops.setLeadingMoveText ||
    fn === ops.nextLine
  ) {
    state.repositioned = true;
    state.freshMatrix = null;
  } else if (fn === ops.showText) {
    recordShow(state, args);
  } else if (fn === ops.endText) {
    state.blockShows = [];
  }
};

/**
 * Index a page's top-level path and text-showing operators, in raw content
 * order, so export can find and verify them in the content stream. Form
 * XObject and annotation content is skipped: it lives in other streams.
 */
export const indexPageRemovals = (
  list: ExtractableOperatorList,
  ops: PdfRemovalOps
): PageRemovalIndex => {
  const state: WalkState = {
    blockShows: [],
    ctm: IDENTITY_CTM,
    ctmStack: [],
    freshMatrix: null,
    pathCount: 0,
    paths: new Map(),
    repositioned: true,
    shows: [],
  };
  let nested = 0;

  for (const [sourceIndex, fn] of list.fnArray.entries()) {
    if (fn === ops.paintFormXObjectBegin || fn === ops.beginAnnotation) {
      nested += 1;
    } else if (fn === ops.paintFormXObjectEnd || fn === ops.endAnnotation) {
      nested = Math.max(0, nested - 1);
    } else if (nested === 0) {
      const args = list.argsArray[sourceIndex];
      if (!walkGraphics(state, fn, args, sourceIndex, ops)) {
        walkText(state, fn, args, ops);
      }
    }
  }

  return {
    counts: { paths: state.pathCount, shows: state.shows.length },
    paths: state.paths,
    shows: state.shows,
  };
};

/** Text origins further apart than this (user space) are different shows. */
const ORIGIN_TOLERANCE = 1;

const originMatches = (
  show: ShowRecord,
  run: Pick<PdfTextObject, "transform">
): boolean =>
  show.origin !== null &&
  Math.abs(show.origin.x - run.transform[4]) <= ORIGIN_TOLERANCE &&
  Math.abs(show.origin.y - run.transform[5]) <= ORIGIN_TOLERANCE;

/**
 * Pick the run's show: same text, and either the same origin or the only
 * show and run with that text on the page. Anything ambiguous gets no target.
 */
const matchShow = (
  run: PdfTextObject,
  candidates: readonly ShowRecord[],
  used: ReadonlySet<number>,
  runsWithText: number
): ShowRecord | null => {
  const byOrigin = candidates.find(
    (show) => !used.has(show.ordinal) && originMatches(show, run)
  );
  if (byOrigin) {
    return byOrigin;
  }
  const [only] = candidates;
  const unique = candidates.length === 1 && runsWithText === 1;
  return unique && only && !used.has(only.ordinal) ? only : null;
};

const groupShowsByText = (
  shows: readonly ShowRecord[]
): Map<string, ShowRecord[]> => {
  const groups = new Map<string, ShowRecord[]>();
  for (const show of shows) {
    if (show.text !== "") {
      groups.set(show.text, [...(groups.get(show.text) ?? []), show]);
    }
  }
  return groups;
};

/**
 * Give runs and vectors their raw-content targets. A run qualifies only when
 * exactly one whole text-showing operator draws it and emptying that
 * operator cannot move other text.
 */
export const attachRemovalTargets = (
  index: PageRemovalIndex,
  runs: readonly PdfTextObject[],
  vectors: readonly PdfVectorObject[]
): RemovalTargetsResult => {
  const showsByText = groupShowsByText(index.shows);
  const runTextCounts = new Map<string, number>();
  for (const run of runs) {
    const text = normalizeText(run.originalText);
    runTextCounts.set(text, (runTextCounts.get(text) ?? 0) + 1);
  }

  const used = new Set<number>();
  const targetedRuns = runs.map((run) => {
    const text = normalizeText(run.originalText);
    const candidates = showsByText.get(text);
    const show = candidates
      ? matchShow(run, candidates, used, runTextCounts.get(text) ?? 0)
      : null;
    if (!show) {
      return run;
    }
    used.add(show.ordinal);
    return show.safe
      ? {
          ...run,
          removalTarget: {
            glyphCount: show.glyphCount,
            showOrdinal: show.ordinal,
          },
        }
      : run;
  });

  const targetedVectors = vectors.map((vector) => {
    const path = index.paths.get(vector.sourceIndex);
    return path
      ? {
          ...vector,
          removalTarget: { box: path.box, pathOrdinal: path.ordinal },
        }
      : vector;
  });

  return { runs: targetedRuns, vectors: targetedVectors };
};
