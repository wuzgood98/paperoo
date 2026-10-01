import {
  IDENTITY_CTM,
  multiplyCtm,
  userPointToDisplayed,
} from "@/lib/editor/coordinates";
import type { Ctm } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type {
  CropBox,
  PageRotation,
  PdfPathCommand,
  PdfVectorFillStyle,
  PdfVectorKind,
  PdfVectorObject,
  PdfVectorPaint,
  PdfVectorStrokeStyle,
  Point,
} from "@/lib/editor/types";
import type {
  ExtractableOperatorList,
  OperatorArg,
} from "@/lib/pdf/extract-images";

/** DrawOPS ids from pdfjs-dist (not re-exported on the public entry). */
export const DrawOPS = {
  closePath: 4,
  curveTo: 2,
  lineTo: 1,
  moveTo: 0,
  quadraticCurveTo: 3,
} as const;

export interface PdfVectorOps {
  clip: number;
  closeEOFillStroke: number;
  closeFillStroke: number;
  closeStroke: number;
  constructPath: number;
  eoClip: number;
  eoFill: number;
  eoFillStroke: number;
  endPath: number;
  fill: number;
  fillStroke: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  restore: number;
  save: number;
  setFillCMYKColor: number;
  setFillColor: number;
  setFillColorN: number;
  setFillGray: number;
  setFillRGBColor: number;
  setFillTransparent: number;
  setGState: number;
  setLineCap: number;
  setLineJoin: number;
  setLineWidth: number;
  setStrokeCMYKColor: number;
  setStrokeColor: number;
  setStrokeColorN: number;
  setStrokeGray: number;
  setStrokeRGBColor: number;
  setStrokeTransparent: number;
  shadingFill: number;
  stroke: number;
  transform: number;
}

export const toPdfVectorOps = (ops: PdfVectorOps): PdfVectorOps => ({ ...ops });

export interface ExtractVectorPage {
  cropBox: CropBox;
  id: string;
  sourceRotate: PageRotation;
}

interface GraphicsState {
  clipped: boolean;
  ctm: Ctm;
  fill: PdfVectorFillStyle | null;
  fillOk: boolean;
  formDepth: number;
  lineCap: number;
  lineJoin: number;
  lineWidth: number;
  stroke: PdfVectorFillStyle | null;
  strokeOk: boolean;
  unsafe: boolean;
}

const VECTOR_MIN_AXIS = 1e-4;
const RECT_EPSILON = 1e-3;

const finiteNumber = (value: OperatorArg): number | null =>
  Number.isFinite(value) ? Number(value) : null;

const toCtm = (value: OperatorArg): Ctm | null => {
  if (!Array.isArray(value) || value.length < 6) {
    return null;
  }
  const a = finiteNumber(value[0]);
  const b = finiteNumber(value[1]);
  const c = finiteNumber(value[2]);
  const d = finiteNumber(value[3]);
  const e = finiteNumber(value[4]);
  const f = finiteNumber(value[5]);
  if (
    a === null ||
    b === null ||
    c === null ||
    d === null ||
    e === null ||
    f === null
  ) {
    return null;
  }
  return [a, b, c, d, e, f];
};

const formMatrix = (args: OperatorArg): Ctm | null => {
  if (Array.isArray(args)) {
    return toCtm(args[0]) ?? toCtm(args);
  }
  return null;
};

const applyCtmPoint = (ctm: Ctm, x: number, y: number): Point => ({
  x: ctm[0] * x + ctm[2] * y + ctm[4],
  y: ctm[1] * x + ctm[3] * y + ctm[5],
});

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

const paintName = (
  paintFn: number,
  ops: PdfVectorOps
): PdfVectorPaint | null => {
  if (paintFn === ops.stroke) {
    return "stroke";
  }
  if (paintFn === ops.closeStroke) {
    return "closeStroke";
  }
  if (paintFn === ops.fill) {
    return "fill";
  }
  if (paintFn === ops.eoFill) {
    return "eoFill";
  }
  if (paintFn === ops.fillStroke) {
    return "fillStroke";
  }
  if (paintFn === ops.eoFillStroke) {
    return "eoFillStroke";
  }
  if (paintFn === ops.closeFillStroke) {
    return "closeFillStroke";
  }
  if (paintFn === ops.closeEOFillStroke) {
    return "closeEOFillStroke";
  }
  return null;
};

const usesFill = (paint: PdfVectorPaint): boolean =>
  paint === "fill" ||
  paint === "eoFill" ||
  paint === "fillStroke" ||
  paint === "eoFillStroke" ||
  paint === "closeFillStroke" ||
  paint === "closeEOFillStroke";

const usesStroke = (paint: PdfVectorPaint): boolean =>
  paint === "stroke" ||
  paint === "closeStroke" ||
  paint === "fillStroke" ||
  paint === "eoFillStroke" ||
  paint === "closeFillStroke" ||
  paint === "closeEOFillStroke";

const readBufferNumber = (
  buffer: ArrayLike<number>,
  index: number
): number | null => {
  const value = buffer[index];
  return Number.isFinite(value) ? Number(value) : null;
};

// oxlint-disable-next-line eslint/complexity -- DrawOPS decode branches per path command id
export const decodeDrawOps = (
  buffer: ArrayLike<number>,
  ctm: Ctm
): PdfPathCommand[] | null => {
  const commands: PdfPathCommand[] = [];
  let index = 0;
  const { length } = buffer;
  while (index < length) {
    const op = readBufferNumber(buffer, index);
    index += 1;
    if (op === null) {
      return null;
    }
    if (op === DrawOPS.moveTo || op === DrawOPS.lineTo) {
      const x = readBufferNumber(buffer, index);
      const y = readBufferNumber(buffer, index + 1);
      if (x === null || y === null) {
        return null;
      }
      index += 2;
      const point = applyCtmPoint(ctm, x, y);
      commands.push({
        type: op === DrawOPS.moveTo ? "moveTo" : "lineTo",
        x: point.x,
        y: point.y,
      });
      continue;
    }
    if (op === DrawOPS.curveTo) {
      const x1 = readBufferNumber(buffer, index);
      const y1 = readBufferNumber(buffer, index + 1);
      const x2 = readBufferNumber(buffer, index + 2);
      const y2 = readBufferNumber(buffer, index + 3);
      const x3 = readBufferNumber(buffer, index + 4);
      const y3 = readBufferNumber(buffer, index + 5);
      if (
        x1 === null ||
        y1 === null ||
        x2 === null ||
        y2 === null ||
        x3 === null ||
        y3 === null
      ) {
        return null;
      }
      index += 6;
      const c1 = applyCtmPoint(ctm, x1, y1);
      const c2 = applyCtmPoint(ctm, x2, y2);
      const end = applyCtmPoint(ctm, x3, y3);
      commands.push({
        type: "curveTo",
        x1: c1.x,
        x2: c2.x,
        x3: end.x,
        y1: c1.y,
        y2: c2.y,
        y3: end.y,
      });
      continue;
    }
    if (op === DrawOPS.quadraticCurveTo) {
      const x1 = readBufferNumber(buffer, index);
      const y1 = readBufferNumber(buffer, index + 1);
      const x = readBufferNumber(buffer, index + 2);
      const y = readBufferNumber(buffer, index + 3);
      if (x1 === null || y1 === null || x === null || y === null) {
        return null;
      }
      index += 4;
      const control = applyCtmPoint(ctm, x1, y1);
      const end = applyCtmPoint(ctm, x, y);
      commands.push({
        type: "quadraticCurveTo",
        x: end.x,
        x1: control.x,
        y: end.y,
        y1: control.y,
      });
      continue;
    }
    if (op === DrawOPS.closePath) {
      commands.push({ type: "closePath" });
      continue;
    }
    return null;
  }
  return commands.length > 0 ? commands : null;
};

const nearlyEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= RECT_EPSILON;

const isAxisAlignedSegment = (a: Point, b: Point): boolean =>
  nearlyEqual(a.x, b.x) || nearlyEqual(a.y, b.y);

export const classifyVectorKind = (
  commands: readonly PdfPathCommand[]
): PdfVectorKind => {
  const points: Point[] = [];
  let closed = false;
  let pendingMove: Point | null = null;
  for (const command of commands) {
    if (command.type === "closePath") {
      closed = true;
      continue;
    }
    if (command.type === "curveTo" || command.type === "quadraticCurveTo") {
      return "path";
    }
    if (command.type === "moveTo") {
      pendingMove = { x: command.x, y: command.y };
      continue;
    }
    if (command.type === "lineTo") {
      if (pendingMove) {
        points.push(pendingMove);
        pendingMove = null;
      }
      points.push({ x: command.x, y: command.y });
    }
  }

  if (points.length === 2 && !closed) {
    return "line";
  }

  if (points.length === 4 && closed) {
    const [p0, p1, p2, p3] = points;
    if (!(p0 && p1 && p2 && p3)) {
      return "path";
    }
    if (
      isAxisAlignedSegment(p0, p1) &&
      isAxisAlignedSegment(p1, p2) &&
      isAxisAlignedSegment(p2, p3) &&
      isAxisAlignedSegment(p3, p0)
    ) {
      return "rect";
    }
  }

  return "path";
};

export const pathMinMaxToDisplayedBox = (
  minMax: readonly number[],
  ctm: Ctm,
  crop: CropBox,
  sourceRotate: PageRotation
): {
  height: number;
  rotation: number;
  width: number;
  x: number;
  y: number;
} | null => {
  if (minMax.length < 4) {
    return null;
  }
  // SAFETY: pathMinMax from PDF.js constructPath is [xMin, yMin, xMax, yMax] numbers.
  const xMin = finiteNumber(minMax[0] as OperatorArg);
  // SAFETY: see comment above for pathMinMax layout.
  const yMin = finiteNumber(minMax[1] as OperatorArg);
  // SAFETY: see comment above for pathMinMax layout.
  const xMax = finiteNumber(minMax[2] as OperatorArg);
  // SAFETY: see comment above for pathMinMax layout.
  const yMax = finiteNumber(minMax[3] as OperatorArg);
  if (xMin === null || yMin === null || xMax === null || yMax === null) {
    return null;
  }
  const corners = [
    applyCtmPoint(ctm, xMin, yMin),
    applyCtmPoint(ctm, xMax, yMin),
    applyCtmPoint(ctm, xMax, yMax),
    applyCtmPoint(ctm, xMin, yMax),
  ].map((point) => userPointToDisplayed(point, crop, sourceRotate));

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    left = Math.min(left, corner.x);
    top = Math.min(top, corner.y);
    right = Math.max(right, corner.x);
    bottom = Math.max(bottom, corner.y);
  }
  const width = right - left;
  const height = bottom - top;
  if (width < VECTOR_MIN_AXIS && height < VECTOR_MIN_AXIS) {
    return null;
  }
  return {
    height: Math.max(height, VECTOR_MIN_AXIS),
    rotation: 0,
    width: Math.max(width, VECTOR_MIN_AXIS),
    x: left,
    y: top,
  };
};

const isNumericBuffer = (
  value: OperatorArg
): value is ArrayLike<number> & Iterable<number> =>
  Array.isArray(value) ||
  (ArrayBuffer.isView(value) && !(value instanceof DataView));

const readPathBuffer = (args: OperatorArg): ArrayLike<number> | null => {
  if (!Array.isArray(args) || args.length < 2) {
    return null;
  }
  // oxlint-disable-next-line eslint/prefer-destructuring -- index 1 is the nested DrawOPS buffer slot
  const wrapped = args[1];
  const buffer = Array.isArray(wrapped) ? wrapped[0] : wrapped;
  if (buffer === undefined || buffer === null || !isNumericBuffer(buffer)) {
    return null;
  }
  return buffer;
};

const readPathMinMax = (args: OperatorArg): readonly number[] | null => {
  if (!Array.isArray(args) || args.length < 3) {
    return null;
  }
  // oxlint-disable-next-line eslint/prefer-destructuring -- index 2 is the pathMinMax slot
  const minMax = args[2];
  if (minMax === undefined || minMax === null || !isNumericBuffer(minMax)) {
    return null;
  }
  return [...minMax];
};

const readPaintFn = (args: OperatorArg): number | null => {
  if (!Array.isArray(args) || args.length < 1) {
    return null;
  }
  const [paintFn] = args;
  // SAFETY: constructPath arg0 is the numeric paint OPS id from PDF.js.
  return finiteNumber(paintFn as OperatorArg);
};

const defaultState = (): GraphicsState => ({
  clipped: false,
  ctm: IDENTITY_CTM,
  fill: { color: "#000000" },
  fillOk: true,
  formDepth: 0,
  lineCap: 0,
  lineJoin: 0,
  lineWidth: 1,
  stroke: { color: "#000000" },
  strokeOk: true,
  unsafe: false,
});

const patchState = (
  current: GraphicsState,
  patch: Partial<GraphicsState>
): GraphicsState => ({ ...current, ...patch });

// oxlint-disable-next-line eslint/complexity -- operator-list walk branches once per OPS id, same shape as image extraction
export const extractPdfVectorObjects = (
  list: ExtractableOperatorList,
  page: ExtractVectorPage,
  ops: PdfVectorOps
): PdfVectorObject[] => {
  const objects: PdfVectorObject[] = [];
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

    if (fn === ops.paintFormXObjectEnd) {
      current = stack.pop() ?? defaultState();
      continue;
    }

    if (fn === ops.transform) {
      const next = toCtm(args);
      if (next) {
        current = patchState(current, { ctm: multiplyCtm(current.ctm, next) });
      }
      continue;
    }

    if (fn === ops.paintFormXObjectBegin) {
      stack.push(current);
      const matrix = formMatrix(args);
      current = patchState(current, {
        ctm: matrix ? multiplyCtm(current.ctm, matrix) : current.ctm,
        formDepth: current.formDepth + 1,
      });
      continue;
    }

    if (fn === ops.clip || fn === ops.eoClip) {
      current = patchState(current, { clipped: true });
      continue;
    }

    if (fn === ops.setGState || fn === ops.shadingFill) {
      current = patchState(current, { unsafe: true });
      continue;
    }

    if (fn === ops.setLineWidth) {
      const width = Array.isArray(args)
        ? finiteNumber(args[0])
        : finiteNumber(args);
      if (width !== null && width >= 0) {
        current = patchState(current, { lineWidth: width });
      }
      continue;
    }

    if (fn === ops.setLineCap) {
      const cap = Array.isArray(args)
        ? finiteNumber(args[0])
        : finiteNumber(args);
      if (cap !== null) {
        current = patchState(current, { lineCap: cap });
      }
      continue;
    }

    if (fn === ops.setLineJoin) {
      const join = Array.isArray(args)
        ? finiteNumber(args[0])
        : finiteNumber(args);
      if (join !== null) {
        current = patchState(current, { lineJoin: join });
      }
      continue;
    }

    if (fn === ops.setFillRGBColor) {
      const color = readRgb(args);
      current = color
        ? patchState(current, { fill: { color }, fillOk: true })
        : patchState(current, { fillOk: false });
      continue;
    }

    if (fn === ops.setStrokeRGBColor) {
      const color = readRgb(args);
      current = color
        ? patchState(current, { stroke: { color }, strokeOk: true })
        : patchState(current, { strokeOk: false });
      continue;
    }

    if (fn === ops.setFillGray) {
      const color = readGray(args);
      current = color
        ? patchState(current, { fill: { color }, fillOk: true })
        : patchState(current, { fillOk: false });
      continue;
    }

    if (fn === ops.setStrokeGray) {
      const color = readGray(args);
      current = color
        ? patchState(current, { stroke: { color }, strokeOk: true })
        : patchState(current, { strokeOk: false });
      continue;
    }

    if (
      fn === ops.setFillCMYKColor ||
      fn === ops.setStrokeCMYKColor ||
      fn === ops.setFillColorN ||
      fn === ops.setStrokeColorN ||
      fn === ops.setFillColor ||
      fn === ops.setStrokeColor ||
      fn === ops.setFillTransparent ||
      fn === ops.setStrokeTransparent
    ) {
      if (
        fn === ops.setFillCMYKColor ||
        fn === ops.setFillColorN ||
        fn === ops.setFillColor ||
        fn === ops.setFillTransparent
      ) {
        current = patchState(current, { fillOk: false });
      }
      if (
        fn === ops.setStrokeCMYKColor ||
        fn === ops.setStrokeColorN ||
        fn === ops.setStrokeColor ||
        fn === ops.setStrokeTransparent
      ) {
        current = patchState(current, { strokeOk: false });
      }
      continue;
    }

    if (fn !== ops.constructPath) {
      continue;
    }

    if (current.clipped || current.formDepth > 0 || current.unsafe) {
      continue;
    }

    const paintFn = readPaintFn(args);
    if (paintFn === null || paintFn === ops.endPath) {
      continue;
    }
    const paint = paintName(paintFn, ops);
    if (!paint) {
      continue;
    }

    const buffer = readPathBuffer(args);
    const minMax = readPathMinMax(args);
    if (!buffer || !minMax) {
      continue;
    }

    const commands = decodeDrawOps(buffer, current.ctm);
    if (!commands) {
      continue;
    }

    if (usesFill(paint) && !current.fillOk) {
      continue;
    }
    if (usesStroke(paint) && !current.strokeOk) {
      continue;
    }

    const box = pathMinMaxToDisplayedBox(
      minMax,
      current.ctm,
      page.cropBox,
      page.sourceRotate
    );
    if (!box) {
      continue;
    }

    const fill: PdfVectorFillStyle | null = usesFill(paint)
      ? current.fill
      : null;
    const stroke: PdfVectorStrokeStyle | null = usesStroke(paint)
      ? {
          color: current.stroke?.color ?? "#000000",
          lineCap: current.lineCap,
          lineJoin: current.lineJoin,
          width: current.lineWidth,
        }
      : null;

    const kind = classifyVectorKind(commands);
    objects.push({
      commands,
      deleted: false,
      fill,
      height: box.height,
      id: createId(),
      kind,
      originalFill: fill ? { ...fill } : null,
      originalHeight: box.height,
      originalRotation: box.rotation,
      originalStroke: stroke ? { ...stroke } : null,
      originalWidth: box.width,
      originalX: box.x,
      originalY: box.y,
      pageId: page.id,
      paint,
      rotation: box.rotation,
      sourceIndex,
      sourceOperatorIndices: [sourceIndex],
      stroke,
      type: "pdf-vector",
      width: box.width,
      x: box.x,
      y: box.y,
    });
  }

  return objects;
};
