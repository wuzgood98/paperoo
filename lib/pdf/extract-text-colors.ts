import { DEFAULT_PDF_TEXT_COLOR } from "@/lib/editor/types";
import type {
  ExtractableOperatorList,
  OperatorArg,
} from "@/lib/pdf/extract-images";
import type { ExtractableTextItem } from "@/lib/pdf/extract-text";

/** TextRenderingMode low bits: FILL=0, STROKE=1, FILL_STROKE=2, INVISIBLE=3 (and +4 add-to-path). */
const TEXT_RENDERING_MODE_COUNT = 4;
const TEXT_RENDERING_FILL = 0;
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
  setTextRenderingMode: number;
  showSpacedText: number;
  showText: number;
}

export const toPdfTextColorOps = (ops: PdfTextColorOps): PdfTextColorOps => ({
  ...ops,
});

export interface ZipPdfTextItemColorsResult {
  aligned: boolean;
  colors: string[];
}

interface GraphicsState {
  fill: string;
  fillOk: boolean;
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

const defaultState = (): GraphicsState => ({
  fill: "#000000",
  fillOk: true,
  textRenderingMode: TEXT_RENDERING_FILL,
});

const patchState = (
  current: GraphicsState,
  patch: Partial<GraphicsState>
): GraphicsState => ({ ...current, ...patch });

const needsFill = (textRenderingMode: number): boolean => {
  // Equivalent to PDF.js `textRenderingMode & FILL_STROKE_MASK` without bitwise ops.
  const mode =
    ((textRenderingMode % TEXT_RENDERING_MODE_COUNT) +
      TEXT_RENDERING_MODE_COUNT) %
    TEXT_RENDERING_MODE_COUNT;
  return mode === TEXT_RENDERING_FILL || mode === TEXT_RENDERING_FILL_STROKE;
};

const isShowTextOp = (fn: number, ops: PdfTextColorOps): boolean =>
  fn === ops.showText ||
  fn === ops.showSpacedText ||
  fn === ops.nextLineShowText ||
  fn === ops.nextLineSetSpacingShowText;

const paintColor = (state: GraphicsState): string | null => {
  if (!needsFill(state.textRenderingMode) || !state.fillOk) {
    return null;
  }
  return state.fill;
};

/** Walk showText* ops and sample the current fill color at each paint. */
export const extractPdfTextFillPaints = (
  list: ExtractableOperatorList,
  ops: PdfTextColorOps
): (string | null)[] => {
  const paints: (string | null)[] = [];
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

    if (fn === ops.setTextRenderingMode) {
      const mode = Array.isArray(args)
        ? finiteNumber(args[0])
        : finiteNumber(args);
      if (mode !== null) {
        current = patchState(current, { textRenderingMode: mode });
      }
      continue;
    }

    if (fn === ops.setFillRGBColor) {
      const color = readRgb(args);
      current = color
        ? patchState(current, { fill: color, fillOk: true })
        : patchState(current, { fillOk: false });
      continue;
    }

    if (fn === ops.setFillGray) {
      const color = readGray(args);
      current = color
        ? patchState(current, { fill: color, fillOk: true })
        : patchState(current, { fillOk: false });
      continue;
    }

    if (
      fn === ops.setFillCMYKColor ||
      fn === ops.setFillColorN ||
      fn === ops.setFillColor ||
      fn === ops.setFillTransparent
    ) {
      current = patchState(current, { fillOk: false });
      continue;
    }

    if (!isShowTextOp(fn, ops)) {
      continue;
    }

    paints.push(paintColor(current));
  }

  return paints;
};

const isPaintableItem = (item: ExtractableTextItem): boolean =>
  item.str !== undefined && item.str !== " " && item.str !== "";

const allPaintsSameHex = (
  paints: readonly (string | null)[]
): string | null => {
  let shared: string | null = null;
  for (const paint of paints) {
    if (paint === null) {
      return null;
    }
    if (shared === null) {
      shared = paint;
      continue;
    }
    if (paint !== shared) {
      return null;
    }
  }
  return shared;
};

const fallbackColors = (length: number, fallback: string): string[] =>
  Array.from({ length }, () => fallback);

/**
 * Zip showText fill paints onto getTextContent items.
 * Fail closed to `fallback` when counts diverge or any paint is unsupported,
 * unless every paint shares one hex (same-color merge recovery).
 */
export const zipPdfTextItemColors = (
  items: readonly ExtractableTextItem[],
  paints: readonly (string | null)[],
  fallback: string = DEFAULT_PDF_TEXT_COLOR
): ZipPdfTextItemColorsResult => {
  const colors = fallbackColors(items.length, fallback);
  const paintableIndices: number[] = [];
  for (const [index, item] of items.entries()) {
    if (isPaintableItem(item)) {
      paintableIndices.push(index);
    }
  }

  const sameColor = allPaintsSameHex(paints);
  if (
    paints.length !== paintableIndices.length ||
    paints.some((paint) => paint === null)
  ) {
    // Merge recovery only: more paints than items, all the same hex.
    if (
      sameColor !== null &&
      paints.length > paintableIndices.length &&
      paintableIndices.length > 0
    ) {
      for (const index of paintableIndices) {
        colors[index] = sameColor;
      }
      return { aligned: true, colors };
    }
    return { aligned: false, colors };
  }

  for (const [paintIndex, itemIndex] of paintableIndices.entries()) {
    const paint = paints[paintIndex];
    colors[itemIndex] = paint ?? fallback;
  }

  return { aligned: true, colors };
};
