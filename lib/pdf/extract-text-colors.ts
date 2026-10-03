import {
  DEFAULT_PDF_TEXT_COLOR,
  DEFAULT_PDF_TEXT_STROKE_COLOR,
  DEFAULT_PDF_TEXT_STROKE_WIDTH,
} from "@/lib/editor/types";
import type {
  ExtractableOperatorList,
  OperatorArg,
} from "@/lib/pdf/extract-images";
import type { ExtractableTextItem } from "@/lib/pdf/extract-text";

/** TextRenderingMode low bits: FILL=0, STROKE=1, FILL_STROKE=2, INVISIBLE=3 (and +4 add-to-path). */
const TEXT_RENDERING_MODE_COUNT = 4;
const TEXT_RENDERING_FILL = 0;
const TEXT_RENDERING_STROKE = 1;
const TEXT_RENDERING_FILL_STROKE = 2;

export interface PdfTextColorOps {
  nextLineSetSpacingShowText: number;
  nextLineShowText: number;
  restore: number;
  save: number;
  setFillCMYKColor: number;
  setFillColor: number;
  setFillColorN: number;
  setFillGray: number;
  setFillRGBColor: number;
  setFillTransparent: number;
  setLineWidth: number;
  setStrokeCMYKColor: number;
  setStrokeColor: number;
  setStrokeColorN: number;
  setStrokeGray: number;
  setStrokeRGBColor: number;
  setStrokeTransparent: number;
  setTextRenderingMode: number;
  showSpacedText: number;
  showText: number;
}

export const toPdfTextColorOps = (ops: PdfTextColorOps): PdfTextColorOps => ({
  ...ops,
});

/** One showText* sample; null means unsupported ink for the active Tr. */
export interface PdfTextPaint {
  color: string | null;
  strokeColor: string | null;
  strokeWidth: number;
  textRenderingMode: number;
}

/** Per getTextContent item after zip (always concrete defaults). */
export interface PdfTextItemPaint {
  color: string;
  strokeColor: string;
  strokeWidth: number;
  textRenderingMode: number;
}

export interface ZipPdfTextItemPaintsResult {
  aligned: boolean;
  paints: PdfTextItemPaint[];
}

/** @deprecated Prefer ZipPdfTextItemPaintsResult; kept for color-only callers. */
export interface ZipPdfTextItemColorsResult {
  aligned: boolean;
  colors: string[];
}

interface GraphicsState {
  fill: string;
  fillOk: boolean;
  lineWidth: number;
  stroke: string;
  strokeOk: boolean;
  textRenderingMode: number;
}

const finiteNumber = (value: OperatorArg): number | null =>
  Number.isFinite(value) ? Number(value) : null;

const channelToHex = (value: number): string => {
  const clamped = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return clamped.toString(16).padStart(2, "0");
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;

const grayToHex = (gray: number): string => rgbToHex(gray, gray, gray);

const HEX6 = /^#[0-9a-fA-F]{6}$/u;
const HEX3 = /^#[0-9a-fA-F]{3}$/u;

const isStringArg = (value: OperatorArg): value is string =>
  Object.prototype.toString.call(value) === "[object String]";

const parseHexColor = (value: string): string | null => {
  const hex = value.trim();
  if (HEX6.test(hex)) {
    return hex.toLowerCase();
  }
  if (HEX3.test(hex)) {
    const [r, g, b] = hex.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
};

const readRgb = (args: OperatorArg): string | null => {
  if (isStringArg(args)) {
    return parseHexColor(args);
  }
  if (Array.isArray(args) && args.length === 1) {
    const [only] = args;
    // SAFETY: PDF.js color args are either a hex string or nested one-element arrays of the same.
    return readRgb(only as OperatorArg);
  }
  if (!Array.isArray(args) || args.length < 3) {
    return null;
  }
  const r = finiteNumber(args[0]);
  const g = finiteNumber(args[1]);
  const b = finiteNumber(args[2]);
  if (r === null || g === null || b === null) {
    return null;
  }
  return rgbToHex(r, g, b);
};

const readGray = (args: OperatorArg): string | null => {
  if (isStringArg(args)) {
    return parseHexColor(args);
  }
  const gray = Array.isArray(args) ? finiteNumber(args[0]) : finiteNumber(args);
  if (gray === null) {
    return null;
  }
  return grayToHex(gray);
};

const normalizeMode = (textRenderingMode: number): number =>
  ((textRenderingMode % TEXT_RENDERING_MODE_COUNT) +
    TEXT_RENDERING_MODE_COUNT) %
  TEXT_RENDERING_MODE_COUNT;

const needsFill = (textRenderingMode: number): boolean => {
  const mode = normalizeMode(textRenderingMode);
  return mode === TEXT_RENDERING_FILL || mode === TEXT_RENDERING_FILL_STROKE;
};

const needsStroke = (textRenderingMode: number): boolean => {
  const mode = normalizeMode(textRenderingMode);
  return mode === TEXT_RENDERING_STROKE || mode === TEXT_RENDERING_FILL_STROKE;
};

const defaultState = (): GraphicsState => ({
  fill: "#000000",
  fillOk: true,
  lineWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
  stroke: DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeOk: true,
  textRenderingMode: TEXT_RENDERING_FILL,
});

const patchState = (
  current: GraphicsState,
  patch: Partial<GraphicsState>
): GraphicsState => ({ ...current, ...patch });

const isShowTextOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.showText ||
  fn === ops.showSpacedText ||
  fn === ops.nextLineShowText ||
  fn === ops.nextLineSetSpacingShowText;

const samplePaint = (state: GraphicsState): PdfTextPaint | null => {
  const mode = normalizeMode(state.textRenderingMode);
  const fillNeeded = needsFill(mode);
  const strokeNeeded = needsStroke(mode);
  if (!(fillNeeded || strokeNeeded)) {
    return null;
  }
  if (fillNeeded && !state.fillOk) {
    return null;
  }
  if (strokeNeeded && !state.strokeOk) {
    return null;
  }
  return {
    color: fillNeeded ? state.fill : null,
    strokeColor: strokeNeeded ? state.stroke : null,
    strokeWidth: state.lineWidth,
    textRenderingMode: mode,
  };
};

const readScalar = (args: OperatorArg): number | null =>
  Array.isArray(args) ? finiteNumber(args[0]) : finiteNumber(args);

const applyFillColor = (
  current: GraphicsState,
  args: OperatorArg,
  reader: (value: OperatorArg) => string | null
): GraphicsState => {
  const color = reader(args);
  return color
    ? patchState(current, { fill: color, fillOk: true })
    : patchState(current, { fillOk: false });
};

const applyStrokeColor = (
  current: GraphicsState,
  args: OperatorArg,
  reader: (value: OperatorArg) => string | null
): GraphicsState => {
  const color = reader(args);
  return color
    ? patchState(current, { stroke: color, strokeOk: true })
    : patchState(current, { strokeOk: false });
};

const isUnsupportedFillOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.setFillCMYKColor ||
  fn === ops.setFillColorN ||
  fn === ops.setFillColor ||
  fn === ops.setFillTransparent;

const isUnsupportedStrokeOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.setStrokeCMYKColor ||
  fn === ops.setStrokeColorN ||
  fn === ops.setStrokeColor ||
  fn === ops.setStrokeTransparent;

/** Apply a non-show op; returns null when the op is ignored. */
const applyStateOp = (
  current: GraphicsState,
  fn: number,
  args: OperatorArg,
  ops: PdfTextColorOps
): GraphicsState | null => {
  if (fn === ops.setTextRenderingMode) {
    const mode = readScalar(args);
    return mode === null
      ? current
      : patchState(current, { textRenderingMode: mode });
  }
  if (fn === ops.setLineWidth) {
    const width = readScalar(args);
    return width === null || width < 0
      ? current
      : patchState(current, { lineWidth: width });
  }
  if (fn === ops.setFillRGBColor) {
    return applyFillColor(current, args, readRgb);
  }
  if (fn === ops.setFillGray) {
    return applyFillColor(current, args, readGray);
  }
  if (fn === ops.setStrokeRGBColor) {
    return applyStrokeColor(current, args, readRgb);
  }
  if (fn === ops.setStrokeGray) {
    return applyStrokeColor(current, args, readGray);
  }
  if (isUnsupportedFillOp(fn, ops)) {
    return patchState(current, { fillOk: false });
  }
  if (isUnsupportedStrokeOp(fn, ops)) {
    return patchState(current, { strokeOk: false });
  }
  return null;
};

/** Walk showText* ops and sample fill/stroke ink at each paint. */
export const extractPdfTextPaints = (
  list: ExtractableOperatorList,
  ops: PdfTextColorOps
): (PdfTextPaint | null)[] => {
  const paints: (PdfTextPaint | null)[] = [];
  const stack: GraphicsState[] = [];
  let current = defaultState();

  for (const [sourceIndex, fn] of list.fnArray.entries()) {
    const args = list.argsArray[sourceIndex];

    if (fn === ops.save) {
      stack.push(current);
      current = patchState(current, {});
      continue;
    }

    if (fn === ops.restore) {
      current = stack.pop() ?? defaultState();
      continue;
    }

    const next = applyStateOp(current, fn, args, ops);
    if (next !== null) {
      current = next;
      continue;
    }

    if (!isShowTextOp(fn, ops)) {
      continue;
    }

    paints.push(samplePaint(current));
  }

  return paints;
};

/**
 * Fill-only view of paints (null when fill is unused or unsupported).
 * Prefer `extractPdfTextPaints` for stroke-aware callers.
 */
export const extractPdfTextFillPaints = (
  list: ExtractableOperatorList,
  ops: PdfTextColorOps
): (string | null)[] =>
  extractPdfTextPaints(list, ops).map((paint) => paint?.color ?? null);

const isPaintableItem = (item: ExtractableTextItem): boolean =>
  item.str !== undefined && item.str !== " " && item.str !== "";

/** Primary ink used for same-color merge recovery: fill if present, else stroke. */
const primaryInk = (paint: PdfTextPaint | null): string | null => {
  if (paint === null) {
    return null;
  }
  return paint.color ?? paint.strokeColor;
};

const allPaintsSamePrimaryInk = (
  paints: readonly (PdfTextPaint | null)[]
): string | null => {
  let shared: string | null = null;
  for (const paint of paints) {
    const ink = primaryInk(paint);
    if (ink === null) {
      return null;
    }
    if (shared === null) {
      shared = ink;
      continue;
    }
    if (ink !== shared) {
      return null;
    }
  }
  return shared;
};

const paintsShareModeAndStroke = (
  paints: readonly (PdfTextPaint | null)[]
): {
  strokeColor: string;
  strokeWidth: number;
  textRenderingMode: number;
} | null => {
  let shared: {
    strokeColor: string;
    strokeWidth: number;
    textRenderingMode: number;
  } | null = null;
  for (const paint of paints) {
    if (paint === null) {
      return null;
    }
    const strokeColor = paint.strokeColor ?? DEFAULT_PDF_TEXT_STROKE_COLOR;
    const next = {
      strokeColor,
      strokeWidth: paint.strokeWidth,
      textRenderingMode: paint.textRenderingMode,
    };
    if (shared === null) {
      shared = next;
      continue;
    }
    if (
      shared.strokeColor !== next.strokeColor ||
      shared.strokeWidth !== next.strokeWidth ||
      shared.textRenderingMode !== next.textRenderingMode
    ) {
      return null;
    }
  }
  return shared;
};

const fallbackItemPaint = (fallback: string): PdfTextItemPaint => ({
  color: fallback,
  strokeColor: DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
  textRenderingMode: TEXT_RENDERING_FILL,
});

const toItemPaint = (
  paint: PdfTextPaint,
  fallback: string
): PdfTextItemPaint => ({
  color: paint.color ?? fallback,
  strokeColor: paint.strokeColor ?? DEFAULT_PDF_TEXT_STROKE_COLOR,
  strokeWidth: paint.strokeWidth,
  textRenderingMode: paint.textRenderingMode,
});

const fallbackPaints = (length: number, fallback: string): PdfTextItemPaint[] =>
  Array.from({ length }, () => fallbackItemPaint(fallback));

/**
 * Zip showText paints onto getTextContent items.
 * Fail closed to `fallback` when counts diverge or any paint is unsupported,
 * unless every paint shares one primary ink (same-color merge recovery).
 */
export const zipPdfTextItemPaints = (
  items: readonly ExtractableTextItem[],
  paints: readonly (PdfTextPaint | null)[],
  fallback: string = DEFAULT_PDF_TEXT_COLOR
): ZipPdfTextItemPaintsResult => {
  const itemPaints = fallbackPaints(items.length, fallback);
  const paintableIndices: number[] = [];
  for (const [index, item] of items.entries()) {
    if (isPaintableItem(item)) {
      paintableIndices.push(index);
    }
  }

  const sameInk = allPaintsSamePrimaryInk(paints);
  const sharedStroke = paintsShareModeAndStroke(paints);
  if (
    paints.length !== paintableIndices.length ||
    paints.some((paint) => paint === null)
  ) {
    if (
      sameInk !== null &&
      sharedStroke !== null &&
      paints.length > paintableIndices.length &&
      paintableIndices.length > 0
    ) {
      const recovered = toItemPaint(
        {
          color: needsFill(sharedStroke.textRenderingMode) ? sameInk : null,
          strokeColor: needsStroke(sharedStroke.textRenderingMode)
            ? sharedStroke.strokeColor
            : null,
          strokeWidth: sharedStroke.strokeWidth,
          textRenderingMode: sharedStroke.textRenderingMode,
        },
        fallback
      );
      // When fill-only recovery, color is sameInk; when stroke-only, color falls back.
      if (
        needsFill(sharedStroke.textRenderingMode) &&
        !needsStroke(sharedStroke.textRenderingMode)
      ) {
        recovered.color = sameInk;
      } else if (
        needsStroke(sharedStroke.textRenderingMode) &&
        !needsFill(sharedStroke.textRenderingMode)
      ) {
        recovered.color = fallback;
        recovered.strokeColor = sameInk;
      } else {
        recovered.color = sameInk;
        recovered.strokeColor = sharedStroke.strokeColor;
      }
      for (const index of paintableIndices) {
        itemPaints[index] = { ...recovered };
      }
      return { aligned: true, paints: itemPaints };
    }
    return { aligned: false, paints: itemPaints };
  }

  for (const [paintIndex, itemIndex] of paintableIndices.entries()) {
    const paint = paints[paintIndex];
    if (paint === null) {
      itemPaints[itemIndex] = fallbackItemPaint(fallback);
      continue;
    }
    itemPaints[itemIndex] = toItemPaint(paint, fallback);
  }

  return { aligned: true, paints: itemPaints };
};

/**
 * Zip fill colors only (legacy). Prefer `zipPdfTextItemPaints`.
 */
export const zipPdfTextItemColors = (
  items: readonly ExtractableTextItem[],
  paints: readonly (string | null)[],
  fallback: string = DEFAULT_PDF_TEXT_COLOR
): ZipPdfTextItemColorsResult => {
  const paintRecords: (PdfTextPaint | null)[] = paints.map((color) =>
    color === null
      ? null
      : {
          color,
          strokeColor: null,
          strokeWidth: DEFAULT_PDF_TEXT_STROKE_WIDTH,
          textRenderingMode: TEXT_RENDERING_FILL,
        }
  );
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
    items,
    paintRecords,
    fallback
  );
  return {
    aligned,
    colors: itemPaints.map((paint) => paint.color),
  };
};
