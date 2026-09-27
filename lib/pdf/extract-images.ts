import {
  IDENTITY_CTM,
  imageCtmToDisplayedBox,
  multiplyCtm,
} from "@/lib/editor/coordinates";
import type { Ctm } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type { CropBox, PageRotation, PdfImageObject } from "@/lib/editor/types";

export interface PdfImageOps {
  clip: number;
  eoClip: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageMaskXObject: number;
  paintImageMaskXObjectGroup: number;
  paintImageMaskXObjectRepeat: number;
  paintImageXObject: number;
  paintImageXObjectRepeat: number;
  paintInlineImageXObject: number;
  paintSolidColorImageMask: number;
  restore: number;
  save: number;
  transform: number;
}

export type OperatorArg =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly OperatorArg[];

export interface ExtractableOperatorList {
  argsArray: readonly OperatorArg[];
  fnArray: readonly number[];
}

export const toPdfImageOps = (ops: PdfImageOps): PdfImageOps => ({
  clip: ops.clip,
  eoClip: ops.eoClip,
  paintFormXObjectBegin: ops.paintFormXObjectBegin,
  paintFormXObjectEnd: ops.paintFormXObjectEnd,
  paintImageMaskXObject: ops.paintImageMaskXObject,
  paintImageMaskXObjectGroup: ops.paintImageMaskXObjectGroup,
  paintImageMaskXObjectRepeat: ops.paintImageMaskXObjectRepeat,
  paintImageXObject: ops.paintImageXObject,
  paintImageXObjectRepeat: ops.paintImageXObjectRepeat,
  paintInlineImageXObject: ops.paintInlineImageXObject,
  paintSolidColorImageMask: ops.paintSolidColorImageMask,
  restore: ops.restore,
  save: ops.save,
  transform: ops.transform,
});

export interface ExtractImagePage {
  cropBox: CropBox;
  id: string;
  sourceRotate: PageRotation;
}

interface GraphicsState {
  clipped: boolean;
  ctm: Ctm;
}

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

const namedSourceId = (value: OperatorArg): string | null => {
  if (Array.isArray(value) || value === null || value === undefined) {
    return null;
  }
  const name = `${value}`;
  if (
    name === "true" ||
    name === "false" ||
    name.length === 0 ||
    Number.isFinite(Number(name))
  ) {
    return null;
  }
  return name;
};

const imageSourceId = (args: OperatorArg, sourceIndex: number): string => {
  const direct = namedSourceId(args);
  if (direct) {
    return direct;
  }
  if (Array.isArray(args)) {
    return namedSourceId(args[0]) ?? `inline-${sourceIndex}`;
  }
  return `inline-${sourceIndex}`;
};

const formMatrix = (args: OperatorArg): Ctm | null => {
  if (Array.isArray(args)) {
    return toCtm(args[0]) ?? toCtm(args);
  }
  return null;
};

const isMaskOp = (fn: number, ops: PdfImageOps): boolean =>
  fn === ops.paintImageMaskXObject ||
  fn === ops.paintImageMaskXObjectGroup ||
  fn === ops.paintImageMaskXObjectRepeat ||
  fn === ops.paintSolidColorImageMask;

export const extractPdfImageObjects = (
  list: ExtractableOperatorList,
  page: ExtractImagePage,
  ops: PdfImageOps
): PdfImageObject[] => {
  const objects: PdfImageObject[] = [];
  const stack: GraphicsState[] = [];
  let current: GraphicsState = { clipped: false, ctm: IDENTITY_CTM };

  for (const [sourceIndex, fn] of list.fnArray.entries()) {
    const args = list.argsArray[sourceIndex];

    if (fn === ops.save) {
      stack.push(current);
      current = { clipped: current.clipped, ctm: current.ctm };
      continue;
    }

    if (fn === ops.restore || fn === ops.paintFormXObjectEnd) {
      current = stack.pop() ?? { clipped: false, ctm: IDENTITY_CTM };
      continue;
    }

    if (fn === ops.transform) {
      const next = toCtm(args);
      if (next) {
        current = { ...current, ctm: multiplyCtm(current.ctm, next) };
      }
      continue;
    }

    if (fn === ops.paintFormXObjectBegin) {
      stack.push(current);
      const matrix = formMatrix(args);
      current = {
        clipped: current.clipped,
        ctm: matrix ? multiplyCtm(current.ctm, matrix) : current.ctm,
      };
      continue;
    }

    if (fn === ops.clip || fn === ops.eoClip) {
      current = { ...current, clipped: true };
      continue;
    }

    if (isMaskOp(fn, ops) || fn === ops.paintImageXObjectRepeat) {
      continue;
    }

    if (fn !== ops.paintImageXObject && fn !== ops.paintInlineImageXObject) {
      continue;
    }

    if (current.clipped) {
      continue;
    }

    const box = imageCtmToDisplayedBox(
      current.ctm,
      page.cropBox,
      page.sourceRotate
    );
    if (!box) {
      continue;
    }

    objects.push({
      deleted: false,
      height: box.height,
      id: createId(),
      originalHeight: box.height,
      originalRotation: box.rotation,
      originalWidth: box.width,
      originalX: box.x,
      originalY: box.y,
      pageId: page.id,
      previewAssetId: null,
      replacementAssetId: null,
      rotation: box.rotation,
      sourceId: imageSourceId(args, sourceIndex),
      sourceIndex,
      type: "pdf-image",
      width: box.width,
      x: box.x,
      y: box.y,
    });
  }

  return objects;
};
