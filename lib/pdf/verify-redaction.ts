import {
  apply,
  boundsOf,
  IDENTITY,
  invert,
  multiply,
  overlaps,
  rectBounds,
} from "@/lib/pdf/content-geometry";
import type { Bounds2, Matrix } from "@/lib/pdf/content-geometry";
import type {
  FlattenSource,
  FlattenSourcePage,
  PdfJsImage,
  PdfJsOperatorArg,
} from "@/lib/pdf/flatten-redacted-pages";
import { positionedTextItems, textOverlapsBoxes } from "@/lib/pdf/output-pages";
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
  args: readonly PdfJsOperatorArg[] | null | undefined
): Matrix | null => {
  if (!args || args.length < MATRIX_SIZE) {
    return null;
  }
  const values = args.slice(0, MATRIX_SIZE).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;
  return [a, b, c, d, e, f];
};

/** Samples deep inside a box may differ by at most this much (0–255). */
const UNIFORM_SPREAD = 40;
/** Pixels this close to a box edge are not judged (JPEG ringing). */
const EDGE_PIXELS = 1.5;
const BYTE = 8;
const RGB = 3;
const RGBA = 4;
const KIND_GRAY_1BPP = 1;
const KIND_RGB = 2;
const KIND_RGBA = 3;
const IMAGE_WAIT_MS = 10_000;

/* oxlint-disable anti-slop/no-runtime-typeof -- pdf.js operator arguments are untyped; this is where they are read */
/** A decoded image by id, once pdf.js has it. */
const objectById = (
  page: FlattenSourcePage,
  id: string
): Promise<PdfJsImage | null> => {
  const objects = id.startsWith("g_") ? page.commonObjs : page.objs;
  // oxlint-disable-next-line promise/avoid-new -- pdf.js reports through a callback
  return new Promise((resolve) => {
    // An image that never arrives fails the check rather than hanging it.
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    objects.get(id, (image) => {
      clearTimeout(timer);
      resolve(image ?? null);
    });
  });
};

/** The image an operator paints, as pdf.js decoded it. */
const paintedImage = (
  page: FlattenSourcePage,
  args: readonly PdfJsOperatorArg[] | null | undefined
): Promise<PdfJsImage | null> => {
  const [first] = args ?? [];
  if (typeof first === "string") {
    return objectById(page, first);
  }
  if (!first || typeof first !== "object") {
    return Promise.resolve(null);
  }
  if (typeof first.data === "string") {
    return objectById(page, first.data);
  }
  const { bitmap, data, height, kind, width } = first;
  return Promise.resolve(
    width === undefined || height === undefined
      ? null
      : { bitmap, data, height, kind, width }
  );
};
/* oxlint-enable anti-slop/no-runtime-typeof */

/** One channel value of pixel (col, row), or null past the data. */
const channel = (
  image: PdfJsImage,
  col: number,
  row: number,
  index: number
): number | null => {
  const { data, kind, width } = image;
  if (!data) {
    return null;
  }
  if (kind === undefined || kind === KIND_GRAY_1BPP) {
    const byte = data[row * Math.ceil(width / BYTE) + Math.floor(col / BYTE)];
    return byte === undefined
      ? null
      : Math.floor(byte / 2 ** (BYTE - 1 - (col % BYTE))) % 2;
  }
  const stride = kind === KIND_RGBA ? RGBA : RGB;
  return kind === KIND_RGB || kind === KIND_RGBA
    ? (data[(row * width + col) * stride + index] ?? null)
    : null;
};

/**
 * Whether the image's pixels inside the boxes are all but uniform: what is
 * left after blanking. Unreadable images do not pass.
 */
const blankUnderBoxes = (
  image: PdfJsImage,
  ctm: Matrix,
  holes: readonly Bounds2[]
): boolean => {
  const inverse = invert(ctm);
  if (!(inverse && image.data && image.width > 0 && image.height > 0)) {
    return false;
  }
  const { height, width } = image;
  const channels =
    image.kind === KIND_RGB || image.kind === KIND_RGBA ? RGB : 1;
  const low = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const high = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const point = apply(ctm, (col + 0.5) / width, 1 - (row + 0.5) / height);
      const edge = (EDGE_PIXELS * Math.hypot(ctm[0], ctm[1])) / width;
      const inside = holes.some(
        (hole) =>
          point.x > hole.minX + edge &&
          point.x < hole.maxX - edge &&
          point.y > hole.minY + edge &&
          point.y < hole.maxY - edge
      );
      if (!inside) {
        continue;
      }
      for (let index = 0; index < channels; index += 1) {
        const value = channel(image, col, row, index);
        if (value === null) {
          return false;
        }
        low[index] = Math.min(low[index] ?? value, value);
        high[index] = Math.max(high[index] ?? value, value);
      }
    }
  }
  const spread = channels === 1 && image.kind !== KIND_RGB ? 0 : UNIFORM_SPREAD;
  return low.every(
    (value, index) =>
      !Number.isFinite(value) || (high[index] ?? value) - value <= spread
  );
};

/** Whether any image the operator list paints shows content under a box. */
/** Reads a decoded bitmap back as RGBA samples. */
type BitmapReader = (
  bitmap: ImageBitmap,
  width: number,
  height: number
) => Uint8ClampedArray | null;

/** The image with samples: a bitmap is read back as RGBA when possible. */
const readable = (
  image: PdfJsImage,
  readBitmap: BitmapReader | undefined
): PdfJsImage => {
  if (image.data || !image.bitmap || !readBitmap) {
    return image;
  }
  const data = readBitmap(image.bitmap, image.width, image.height);
  return data ? { ...image, data, kind: KIND_RGBA } : image;
};

const imageUnderBox = async (
  page: FlattenSourcePage,
  fnArray: readonly number[],
  argsArray: readonly (readonly PdfJsOperatorArg[] | null)[],
  boxes: readonly UserRect[],
  ops: VerifyOps,
  readBitmap?: BitmapReader
): Promise<boolean> => {
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
      if (!holes.some((hole) => overlaps(placed, hole))) {
        continue;
      }
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- images in paint order
      const image = await paintedImage(page, argsArray[index]);
      if (
        !(image && blankUnderBoxes(readable(image, readBitmap), ctm, holes))
      ) {
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
    /** RGBA pixels of an image pdf.js decoded to a bitmap (browsers). */
    readBitmap?: (
      bitmap: ImageBitmap,
      width: number,
      height: number
    ) => Uint8ClampedArray | null;
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
      const textUnderBox = positionedTextItems(content).some((item) =>
        textOverlapsBoxes(item, boxes)
      );
      if (
        textUnderBox ||
        // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- one page at a time
        (await imageUnderBox(
          page,
          operators.fnArray,
          operators.argsArray,
          boxes,
          deps.ops,
          deps.readBitmap
        ))
      ) {
        failed.push(outputIndex);
      }
    }
    return failed;
  } finally {
    await source.destroy();
  }
};
