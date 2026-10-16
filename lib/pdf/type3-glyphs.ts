/* oxlint-disable anti-slop/no-runtime-typeof -- PDF.js operator-list I/O: showText glyphs are plain objects */
import { IDENTITY_CTM, multiplyCtm } from "@/lib/editor/coordinates";
import type { Ctm } from "@/lib/editor/coordinates";
import type {
  PdfGlyphShape,
  PdfPathCommand,
  PdfType3Glyphs,
} from "@/lib/editor/types";
import type {
  ExtractableOperatorList,
  OperatorArg,
} from "@/lib/pdf/extract-images";
import type { PdfFontFaceMeta, Type3GlyphBox } from "@/lib/pdf/extract-text";
import { decodeDrawOps } from "@/lib/pdf/extract-vectors";

/** pdf.js OPS ids the slicer needs; pass `OPS`. */
export interface PdfGlyphSliceOps {
  beginAnnotation: number;
  beginText: number;
  constructPath: number;
  endAnnotation: number;
  eoFill: number;
  fill: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  restore: number;
  save: number;
  setCharSpacing: number;
  setFont: number;
  setTextMatrix: number;
  showText: number;
  transform: number;
}

const CTM_EPSILON = 1e-6;
const KEY_DIGITS = 4;
const TJ_UNITS_PER_EM = 1000;
/** A text matrix with a skew or rotation this large is not sliced. */
const SKEW_EPSILON = 1e-6;

interface DrawnGlyph {
  box: Type3GlyphBox;
  /** Pen position in em when the glyph is drawn. */
  origin: number;
  unicode: string;
  width: number;
}

const sameCtm = (left: Ctm, right: Ctm): boolean =>
  left.every((value, index) => {
    const other = right[index];
    return other !== undefined && Math.abs(value - other) <= CTM_EPSILON;
  });

const isNumberList = (value: OperatorArg): value is ArrayLike<number> =>
  Array.isArray(value) ||
  (ArrayBuffer.isView(value) && !(value instanceof DataView));

/** pdf.js passes `cm` spread and `Tm` as one typed array. */
const readMatrix = (args: OperatorArg): Ctm | null => {
  if (!Array.isArray(args)) {
    return null;
  }
  const [first] = args;
  const source: ArrayLike<unknown> =
    isNumberList(first) && !Array.isArray(first) ? first : args;
  const values = Array.from({ length: 6 }, (_unused, index) =>
    Number(source[index])
  );
  return values.every(Number.isFinite)
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

const readNumber = (args: OperatorArg, index: number): number | null => {
  const value = Array.isArray(args) ? Number(args[index]) : Number.NaN;
  return Number.isFinite(value) ? value : null;
};

/** The DrawOPS buffer of a filled path, or null for other paints. */
const readFillBuffer = (
  args: OperatorArg,
  ops: PdfGlyphSliceOps
): ArrayLike<number> | null => {
  if (!Array.isArray(args)) {
    return null;
  }
  const [paint, wrapped] = args;
  if (paint !== ops.fill && paint !== ops.eoFill) {
    return null;
  }
  const buffer: OperatorArg = Array.isArray(wrapped) ? wrapped[0] : wrapped;
  return buffer !== undefined && buffer !== null && isNumberList(buffer)
    ? buffer
    : null;
};

/** Pen positions of a pdf.js showText argument, in em (Tf × FontMatrix 1). */
const layoutGlyphs = (
  args: OperatorArg,
  boxes: ReadonlyMap<string, Type3GlyphBox>,
  fontSize: number,
  charSpacing: number
): { drawn: DrawnGlyph[]; kerning: number[] } | null => {
  const items: unknown = Array.isArray(args) ? args[0] : undefined;
  if (!Array.isArray(items) || fontSize === 0) {
    return null;
  }
  const drawn: DrawnGlyph[] = [];
  const kerning: number[] = [];
  let pen = 0;
  let pending = 0;
  for (const item of items) {
    if (typeof item === "number") {
      pen -= (item * fontSize) / TJ_UNITS_PER_EM;
      pending += item;
      continue;
    }
    if (item === null || typeof item !== "object") {
      return null;
    }
    // SAFETY: pdf.js showText glyphs carry width, unicode and operatorListId.
    const glyph = item as {
      operatorListId?: unknown;
      unicode?: unknown;
      width?: unknown;
    };
    const width = Number(glyph.width);
    const id =
      typeof glyph.operatorListId === "string" ? glyph.operatorListId : "";
    if (!Number.isFinite(width)) {
      return null;
    }
    drawn.push({
      box: boxes.get(id) ?? [0, 0, 0, 0],
      origin: pen / fontSize,
      unicode: typeof glyph.unicode === "string" ? glyph.unicode : "",
      width,
    });
    kerning.push(pending);
    pending = 0;
    pen += width * fontSize + charSpacing;
  }
  return { drawn, kerning };
};

/** Split commands at each moveTo. */
const subpaths = (commands: readonly PdfPathCommand[]): PdfPathCommand[][] => {
  const result: PdfPathCommand[][] = [];
  for (const command of commands) {
    if (command.type === "moveTo" || result.length === 0) {
      result.push([]);
    }
    result.at(-1)?.push(command);
  }
  return result;
};

const commandXs = (command: PdfPathCommand): number[] => {
  switch (command.type) {
    case "moveTo":
    case "lineTo": {
      return [command.x];
    }
    case "curveTo": {
      return [command.x1, command.x2, command.x3];
    }
    default: {
      return [];
    }
  }
};

const centerX = (path: readonly PdfPathCommand[]): number => {
  const xs = path.flatMap(commandXs);
  return xs.length === 0 ? 0 : (Math.min(...xs) + Math.max(...xs)) / 2;
};

/** The glyph a subpath belongs to: its center inside the glyph's box. */
const owningGlyph = (drawn: readonly DrawnGlyph[], center: number): number => {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, glyph] of drawn.entries()) {
    const left = glyph.origin + glyph.box[0];
    const right = glyph.origin + glyph.box[2];
    if (right <= left) {
      continue;
    }
    const distance = Math.max(left - center, center - right, 0);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
};

const shiftCommand = (command: PdfPathCommand, dx: number): PdfPathCommand => {
  switch (command.type) {
    case "moveTo":
    case "lineTo": {
      return { ...command, x: command.x - dx };
    }
    case "curveTo": {
      return {
        ...command,
        x1: command.x1 - dx,
        x2: command.x2 - dx,
        x3: command.x3 - dx,
      };
    }
    default: {
      return command;
    }
  }
};

/**
 * One glyph of one face. Figma re-registers a glyph per occurrence with the
 * same unicode, width and box; another face differs in width or box.
 */
export const glyphShapeKey = (
  unicode: string,
  width: number,
  box: Type3GlyphBox
): string =>
  [unicode, ...[width, ...box].map((value) => value.toFixed(KEY_DIGITS))].join(
    "|"
  );

/**
 * Cut one Figma outline into glyphs. `toEm` maps the outline's own (cm)
 * coordinates into the text's em space.
 */
const sliceOutline = (
  buffer: ArrayLike<number>,
  toEm: Ctm,
  drawn: readonly DrawnGlyph[]
): PdfGlyphShape[] | null => {
  const commands = decodeDrawOps(buffer, toEm);
  if (!commands) {
    return null;
  }
  const owned: PdfPathCommand[][] = drawn.map(() => []);
  for (const path of subpaths(commands)) {
    const index = owningGlyph(drawn, centerX(path));
    const glyph = drawn[index];
    if (glyph) {
      owned[index]?.push(
        ...path.map((command) => shiftCommand(command, glyph.origin))
      );
    }
  }
  return drawn.map((glyph, index) => ({
    box: glyph.box,
    commands: owned[index] ?? [],
    key: glyphShapeKey(glyph.unicode, glyph.width, glyph.box),
    unicode: glyph.unicode,
    width: glyph.width,
  }));
};

/** Inverse of an unskewed text matrix, scaled from text space to em. */
const textToEm = (tm: Ctm, fontSize: number): Ctm | null => {
  const [a, b, c, d, e, f] = tm;
  if (
    Math.abs(b) > SKEW_EPSILON ||
    Math.abs(c) > SKEW_EPSILON ||
    a === 0 ||
    d === 0
  ) {
    return null;
  }
  const sx = a * fontSize;
  const sy = d * fontSize;
  return [1 / sx, 0, 0, 1 / sy, -e / sx, -f / sy];
};

interface SliceState {
  charSpacing: number;
  ctm: Ctm;
  ctmStack: Ctm[];
  font: string | null;
  fontSize: number;
  freshMatrix: Ctm | null;
  lastFill: { buffer: ArrayLike<number>; ctm: Ctm } | null;
  showCount: number;
  textCtm: Ctm | null;
}

const recordShow = (
  state: SliceState,
  args: OperatorArg,
  faces: Readonly<Record<string, PdfFontFaceMeta>>,
  result: PdfType3Glyphs
): void => {
  const showOrdinal = state.showCount;
  state.showCount += 1;
  const { font, freshMatrix, lastFill, textCtm } = state;
  state.lastFill = null;
  state.freshMatrix = null;
  const face = font === null ? undefined : faces[font];
  if (
    !(
      face?.paintsNothing &&
      face.charBoxes &&
      lastFill &&
      freshMatrix &&
      textCtm
    ) ||
    !sameCtm(lastFill.ctm, textCtm)
  ) {
    return;
  }
  const layout = layoutGlyphs(
    args,
    face.charBoxes,
    state.fontSize,
    state.charSpacing
  );
  const toEm = textToEm(freshMatrix, state.fontSize);
  if (!(layout && toEm)) {
    return;
  }
  const shapes = sliceOutline(lastFill.buffer, toEm, layout.drawn);
  if (!shapes) {
    return;
  }
  for (const shape of shapes) {
    const known = result.shapes[shape.key];
    // Keep the first slice with ink; a later one may be clipped by a neighbour.
    if (!known || (known.commands.length === 0 && shape.commands.length > 0)) {
      result.shapes[shape.key] = shape;
    }
  }
  result.shows.push({
    glyphs: shapes.map((shape) => shape.key),
    kerning: layout.kerning,
    showOrdinal,
  });
};

const walkSliceOp = (
  state: SliceState,
  fn: number,
  args: OperatorArg,
  ops: PdfGlyphSliceOps,
  faces: Readonly<Record<string, PdfFontFaceMeta>>,
  result: PdfType3Glyphs
): void => {
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
    const buffer = readFillBuffer(args, ops);
    if (buffer) {
      state.lastFill = { buffer, ctm: state.ctm };
    }
  } else if (fn === ops.beginText) {
    state.textCtm = state.ctm;
    state.freshMatrix = null;
    state.charSpacing = 0;
  } else if (fn === ops.setFont) {
    const [name] = Array.isArray(args) ? args : [];
    state.font = typeof name === "string" ? name : null;
    state.fontSize = readNumber(args, 1) ?? 1;
  } else if (fn === ops.setCharSpacing) {
    state.charSpacing = readNumber(args, 0) ?? 0;
  } else if (fn === ops.setTextMatrix) {
    state.freshMatrix = readMatrix(args);
  } else if (fn === ops.showText) {
    recordShow(state, args, faces, result);
  }
};

/**
 * Cut each Figma text outline into per-glyph shapes using the invisible
 * Type3 text drawn under it: pen positions come from the glyph widths and TJ
 * adjustments, glyph extents from each `d1` box.
 */
export const sliceType3Glyphs = (
  list: ExtractableOperatorList,
  ops: PdfGlyphSliceOps,
  faces: Readonly<Record<string, PdfFontFaceMeta>>
): PdfType3Glyphs | undefined => {
  if (!Object.values(faces).some((face) => face.paintsNothing)) {
    return undefined;
  }
  const result: PdfType3Glyphs = { shapes: {}, shows: [] };
  const state: SliceState = {
    charSpacing: 0,
    ctm: IDENTITY_CTM,
    ctmStack: [],
    font: null,
    fontSize: 1,
    freshMatrix: null,
    lastFill: null,
    showCount: 0,
    textCtm: null,
  };
  let nested = 0;
  for (const [index, fn] of list.fnArray.entries()) {
    if (fn === ops.paintFormXObjectBegin || fn === ops.beginAnnotation) {
      nested += 1;
    } else if (fn === ops.paintFormXObjectEnd || fn === ops.endAnnotation) {
      nested = Math.max(0, nested - 1);
    } else if (nested === 0) {
      walkSliceOp(state, fn, list.argsArray[index], ops, faces, result);
    }
  }
  return result.shows.length > 0 ? result : undefined;
};
