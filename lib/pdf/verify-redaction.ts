import {
  apply,
  boundsOf,
  IDENTITY,
  multiply,
  overlaps,
  rectBounds,
} from "@/lib/pdf/content-geometry";
import type { Matrix } from "@/lib/pdf/content-geometry";
import type { FlattenSource } from "@/lib/pdf/flatten-redacted-pages";
import { textOverlapsBoxes } from "@/lib/pdf/output-pages";
import type { RedactedOutputPage, UserRect } from "@/lib/pdf/output-pages";

/** The pdf.js operator codes the check follows. */
export interface VerifyOps {
  paintImageMaskXObject: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  restore: number;
  save: number;
  transform: number;
}

const MATRIX_SIZE = 6;

const asMatrix = (
  args: readonly number[] | null | undefined
): Matrix | null => {
  if (!args || args.length < MATRIX_SIZE) {
    return null;
  }
  const values = args.slice(0, MATRIX_SIZE);
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;
  return [a, b, c, d, e, f];
};

/** Whether any image the operator list paints lands on a box. */
const imageUnderBox = (
  fnArray: readonly number[],
  argsArray: readonly (readonly number[] | null)[],
  boxes: readonly UserRect[],
  ops: VerifyOps
): boolean => {
  const images = new Set([
    ops.paintImageMaskXObject,
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
  ]);
  const holes = boxes.map(rectBounds);
  const stack: Matrix[] = [];
  let ctm = IDENTITY;
  for (const [index, fn] of fnArray.entries()) {
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.transform) {
      const matrix = asMatrix(argsArray[index]);
      if (matrix) {
        ctm = multiply(matrix, ctm);
      }
    } else if (images.has(fn)) {
      const placed = boundsOf([
        apply(ctm, 0, 0),
        apply(ctm, 1, 0),
        apply(ctm, 1, 1),
        apply(ctm, 0, 1),
      ]);
      if (holes.some((hole) => overlaps(placed, hole))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * The safety net after precise redaction: open the export as a reader would
 * and check each precisely redacted page. A page fails when pdf.js still
 * finds text touching a box, or paints an image onto one. Returns the
 * failed pages' output indexes, to be flattened instead.
 */
export const failedRedactions = async (
  bytes: Uint8Array,
  pages: readonly RedactedOutputPage[],
  deps: {
    ops: VerifyOps;
    open: (bytes: Uint8Array) => Promise<FlattenSource>;
  }
): Promise<number[]> => {
  const source = await deps.open(bytes);
  try {
    const failed: number[] = [];
    for (const { boxes, outputIndex } of pages) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page at a time
      const page = await source.getPage(outputIndex + 1);
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page at a time
      const [content, operators] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
      ]);
      const textUnderBox = content.items.some(
        (item) =>
          "str" in item &&
          item.str.trim() !== "" &&
          textOverlapsBoxes(item, boxes)
      );
      if (
        textUnderBox ||
        imageUnderBox(operators.fnArray, operators.argsArray, boxes, deps.ops)
      ) {
        failed.push(outputIndex);
      }
    }
    return failed;
  } finally {
    await source.destroy();
  }
};
