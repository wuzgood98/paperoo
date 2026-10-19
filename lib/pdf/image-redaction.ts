import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import type { PDFContext, PDFObject } from "pdf-lib";

import {
  apply,
  invert,
  mappedBounds,
  maxScale,
} from "@/lib/pdf/content-geometry";
import type { Matrix } from "@/lib/pdf/content-geometry";
import type { RedactionBox } from "@/lib/pdf/output-pages";

/** Decodes and encodes JPEG; the worker uses OffscreenCanvas, tests napi canvas. */
export interface ImageCodec {
  /** RGBA pixels of a JPEG, or null when it cannot be decoded. */
  decodeJpeg: (bytes: Uint8Array) => Promise<{
    data: Uint8ClampedArray;
    height: number;
    width: number;
  } | null>;
  encodeJpeg: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number
  ) => Promise<Uint8Array>;
}

const BYTE = 8;
const FULL = 255;
const PNG_PREDICTORS = 10;
const TIFF_PREDICTOR = 2;
const RGBA = 4;
const RGB = 3;
const CMYK = 4;

const nameOf = (value: PDFObject | undefined): string | null =>
  value instanceof PDFName ? value.decodeText() : null;

const numberOf = (value: PDFObject | undefined): number | null =>
  value instanceof PDFNumber ? value.asNumber() : null;

/** The filters on a stream, outermost first. */
const filtersOf = (dict: PDFDict): string[] => {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFArray) {
    return filter
      .asArray()
      .map((_, index) => nameOf(filter.lookup(index)) ?? "?");
  }
  const single = nameOf(filter);
  return single ? [single] : [];
};

const paethPredictor = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
};

const PNG_NONE = 0;
const PNG_SUB = 1;
const PNG_UP = 2;
const PNG_AVERAGE = 3;
const PNG_PAETH = 4;

/** Undo PNG row filters (predictors 10–15). */
const undoPng = (
  data: Uint8Array,
  rowBytes: number,
  pixelBytes: number
): Uint8Array | null => {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let row = 0; row < rows; row += 1) {
    const type = data[row * (rowBytes + 1)];
    const source = row * (rowBytes + 1) + 1;
    const target = row * rowBytes;
    for (let index = 0; index < rowBytes; index += 1) {
      const raw = data[source + index] ?? 0;
      const left =
        index >= pixelBytes ? (out[target + index - pixelBytes] ?? 0) : 0;
      const up = row > 0 ? (out[target - rowBytes + index] ?? 0) : 0;
      const upLeft =
        row > 0 && index >= pixelBytes
          ? (out[target - rowBytes + index - pixelBytes] ?? 0)
          : 0;
      let predicted = 0;
      if (type === PNG_SUB) {
        predicted = left;
      } else if (type === PNG_UP) {
        predicted = up;
      } else if (type === PNG_AVERAGE) {
        predicted = Math.floor((left + up) / 2);
      } else if (type === PNG_PAETH) {
        predicted = paethPredictor(left, up, upLeft);
      } else if (type !== PNG_NONE) {
        return null;
      }
      out[target + index] = (raw + predicted) % (FULL + 1);
    }
  }
  return out;
};

/** Undo TIFF predictor 2 for 8-bit samples. */
const undoTiff = (
  data: Uint8Array,
  rowBytes: number,
  colors: number
): Uint8Array => {
  const out = Uint8Array.from(data);
  for (let start = 0; start < out.length; start += rowBytes) {
    for (let index = colors; index < rowBytes; index += 1) {
      out[start + index] =
        ((out[start + index] ?? 0) + (out[start + index - colors] ?? 0)) %
        (FULL + 1);
    }
  }
  return out;
};

/** Samples with any predictor undone, or null for an unsupported one. */
const unpredict = (
  dict: PDFDict,
  data: Uint8Array,
  rowBytes: number,
  pixelBytes: number,
  colors: number
): Uint8Array | null => {
  const params = dict.lookup(PDFName.of("DecodeParms"));
  const parms =
    params instanceof PDFArray ? params.lookupMaybe(0, PDFDict) : params;
  const predictor =
    parms instanceof PDFDict
      ? (numberOf(parms.lookup(PDFName.of("Predictor"))) ?? 1)
      : 1;
  if (predictor >= PNG_PREDICTORS) {
    return undoPng(data, rowBytes, pixelBytes);
  }
  if (predictor === TIFF_PREDICTOR) {
    return undoTiff(data, rowBytes, colors);
  }
  return predictor === 1 ? data : null;
};

const NAMED_COMPONENTS = new Map([
  ["CMYK", CMYK],
  ["CalGray", 1],
  ["CalRGB", RGB],
  ["DeviceCMYK", CMYK],
  ["DeviceGray", 1],
  ["DeviceRGB", RGB],
  ["G", 1],
  ["Indexed", 1],
  ["Lab", RGB],
  ["RGB", RGB],
  ["Separation", 1],
]);

/** Components per sample for a colour space, or null when not known. */
const componentsOf = (space: PDFObject | undefined): number | null => {
  if (!(space instanceof PDFArray)) {
    return NAMED_COMPONENTS.get(nameOf(space) ?? "") ?? null;
  }
  const family = nameOf(space.lookup(0)) ?? "";
  if (family === "ICCBased") {
    const profile = space.lookup(1);
    const dict = profile instanceof PDFRawStream ? profile.dict : undefined;
    return numberOf(dict?.lookup(PDFName.of("N")));
  }
  if (family === "DeviceN") {
    const names = space.lookup(1);
    return names instanceof PDFArray ? names.size() : null;
  }
  return NAMED_COMPONENTS.get(family) ?? null;
};

const hexRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "").padEnd(6, "0");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
};

/** The box fill as samples in a colour space with `components` channels. */
const fillSamples = (
  fill: string,
  components: number,
  space: PDFObject | undefined
): number[] => {
  const [r, g, b] = hexRgb(fill);
  const family =
    space instanceof PDFArray ? nameOf(space.lookup(0)) : nameOf(space);
  if (family === "Indexed" || family === "Separation" || family === "DeviceN") {
    return Array.from({ length: components }, () => 0);
  }
  if (components === 1) {
    return [Math.round(0.299 * r + 0.587 * g + 0.114 * b)];
  }
  if (components === RGB) {
    return [r, g, b];
  }
  if (components === CMYK) {
    const key = FULL - Math.max(r, g, b);
    const scale = key === FULL ? 0 : FULL / (FULL - key);
    return [
      Math.round((FULL - r - key) * scale),
      Math.round((FULL - g - key) * scale),
      Math.round((FULL - b - key) * scale),
      key,
    ];
  }
  return Array.from({ length: components }, () => 0);
};

/** Where an image pixel lands and which box (if any) covers it. */
interface PixelMap {
  /** The box covering pixel (col, row), or null. */
  boxAt: (col: number, row: number) => RedactionBox | null;
  cols: [number, number];
  rows: [number, number];
}

/**
 * Map the image's pixel grid into user space: the image fills the unit
 * square, row 0 at the top. A pixel is covered when its center, padded by
 * half a pixel, falls inside a box.
 */
const pixelMap = (
  ctm: Matrix,
  width: number,
  height: number,
  boxes: readonly RedactionBox[]
): PixelMap | null => {
  const inverse = invert(ctm);
  if (!inverse) {
    return null;
  }
  const pad = maxScale(ctm) / Math.min(width, height) / 2;
  let colMin = width;
  let colMax = -1;
  let rowMin = height;
  let rowMax = -1;
  for (const box of boxes) {
    const local = mappedBounds(
      inverse,
      box.x - pad,
      box.y - pad,
      box.x + box.width + pad,
      box.y + box.height + pad
    );
    colMin = Math.min(colMin, Math.floor(local.minX * width));
    colMax = Math.max(colMax, Math.ceil(local.maxX * width));
    rowMin = Math.min(rowMin, Math.floor((1 - local.maxY) * height));
    rowMax = Math.max(rowMax, Math.ceil((1 - local.minY) * height));
  }
  return {
    boxAt: (col, row) => {
      const point = apply(ctm, (col + 0.5) / width, 1 - (row + 0.5) / height);
      return (
        boxes.find(
          (box) =>
            point.x >= box.x - pad &&
            point.x <= box.x + box.width + pad &&
            point.y >= box.y - pad &&
            point.y <= box.y + box.height + pad
        ) ?? null
      );
    },
    cols: [Math.max(0, colMin), Math.min(width - 1, colMax)],
    rows: [Math.max(0, rowMin), Math.min(height - 1, rowMax)],
  };
};

/** Blank covered pixels of 8-bit samples in place; true if any changed. */
const blankSamples = (
  samples: Uint8Array | Uint8ClampedArray,
  layout: { components: number; height: number; width: number },
  map: PixelMap,
  valueFor: (box: RedactionBox) => readonly number[]
): boolean => {
  const { components, width } = layout;
  const [firstRow, lastRow] = map.rows;
  const [firstCol, lastCol] = map.cols;
  let changed = false;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      const box = map.boxAt(col, row);
      if (!box) {
        continue;
      }
      const value = valueFor(box);
      const start = (row * width + col) * components;
      for (let channel = 0; channel < components; channel += 1) {
        samples[start + channel] = value[channel] ?? 0;
      }
      changed = true;
    }
  }
  return changed;
};

/** Clear covered pixels of a 1-bit stencil to "not painted". */
const blankBits = (
  bits: Uint8Array,
  layout: { height: number; width: number },
  map: PixelMap,
  unpainted: 0 | 1
): void => {
  const rowBytes = Math.ceil(layout.width / BYTE);
  const [firstRow, lastRow] = map.rows;
  const [firstCol, lastCol] = map.cols;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      if (!map.boxAt(col, row)) {
        continue;
      }
      const index = row * rowBytes + Math.floor(col / BYTE);
      // Samples are packed eight to a byte, most significant bit first.
      // oxlint-disable-next-line eslint/no-bitwise -- packed 1-bit samples
      const mask = 1 << (BYTE - 1 - (col % BYTE));
      const byte = bits[index] ?? 0;
      // oxlint-disable-next-line eslint/no-bitwise -- packed 1-bit samples
      bits[index] = unpainted === 1 ? byte | mask : byte & ~mask;
    }
  }
};

/** A stream's dict entries, without those that describe its encoding. */
const plainEntries = (dict: PDFDict, drop: readonly string[]) => {
  const skip = new Set(["Length", "Filter", "DecodeParms", ...drop]);
  return Object.fromEntries(
    dict
      .entries()
      .filter(([key]) => !skip.has(key.decodeText()))
      .map(([key, value]) => [key.decodeText(), value])
  );
};

const decodedBytes = (stream: PDFRawStream): Uint8Array | null => {
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
};

const DECODABLE = new Set([
  "ASCII85Decode",
  "ASCIIHexDecode",
  "FlateDecode",
  "LZWDecode",
  "RunLengthDecode",
]);

interface RedactImageInput {
  boxes: readonly RedactionBox[];
  codec: ImageCodec | undefined;
  context: PDFContext;
  ctm: Matrix;
  stream: PDFRawStream;
}

/** A stencil (ImageMask or `/Mask`) with covered bits cleared. */
const redactStencil = (
  input: RedactImageInput,
  extra: Record<string, PDFObject>
): PDFRawStream | null => {
  const { dict } = input.stream;
  const width = numberOf(dict.lookup(PDFName.of("Width"))) ?? 0;
  const height = numberOf(dict.lookup(PDFName.of("Height"))) ?? 0;
  const raw = decodedBytes(input.stream);
  const rowBytes = Math.ceil(width / BYTE);
  const bits = raw ? unpredict(dict, raw, rowBytes, 1, 1) : null;
  const map = pixelMap(input.ctm, width, height, input.boxes);
  if (!(bits && map) || bits.length < rowBytes * height) {
    return null;
  }
  const decode = dict.lookup(PDFName.of("Decode"));
  const inverted =
    decode instanceof PDFArray && numberOf(decode.lookup(0)) === 1;
  // Sample 1 is "not painted" unless Decode flips it.
  const copy = Uint8Array.from(bits);
  blankBits(copy, { height, width }, map, inverted ? 0 : 1);
  return input.context.flateStream(copy, {
    ...plainEntries(dict, []),
    ...extra,
  });
};

/** An 8-bit image decoded by pdf-lib, covered pixels set to the box fill. */
const redactSamples = (
  input: RedactImageInput,
  extra: Record<string, PDFObject>,
  fillOverride: number | null
): PDFRawStream | null => {
  const { dict } = input.stream;
  const width = numberOf(dict.lookup(PDFName.of("Width"))) ?? 0;
  const height = numberOf(dict.lookup(PDFName.of("Height"))) ?? 0;
  const bits = numberOf(dict.lookup(PDFName.of("BitsPerComponent")));
  const space = dict.lookup(PDFName.of("ColorSpace"));
  const components = componentsOf(space);
  if (bits !== BYTE || !components || width <= 0 || height <= 0) {
    return null;
  }
  const raw = decodedBytes(input.stream);
  const rowBytes = width * components;
  const samples = raw
    ? unpredict(dict, raw, rowBytes, components, components)
    : null;
  const map = pixelMap(input.ctm, width, height, input.boxes);
  if (!(samples && map) || samples.length < rowBytes * height) {
    return null;
  }
  const copy = samples.slice(0, rowBytes * height);
  blankSamples(copy, { components, height, width }, map, (box) =>
    fillOverride === null
      ? fillSamples(box.fill, components, space)
      : Array.from({ length: components }, () => fillOverride)
  );
  return input.context.flateStream(copy, {
    ...plainEntries(dict, []),
    ...extra,
  });
};

/** A JPEG decoded by the codec, covered pixels filled, encoded again. */
const redactJpeg = async (
  input: RedactImageInput,
  extra: Record<string, PDFObject>
): Promise<PDFRawStream | null> => {
  const { codec, stream } = input;
  const { dict } = stream;
  const space = dict.lookup(PDFName.of("ColorSpace"));
  const components = componentsOf(space);
  if (!codec || components === CMYK || components === null) {
    return null;
  }
  const decoded = await codec.decodeJpeg(stream.getContents());
  const width = numberOf(dict.lookup(PDFName.of("Width")));
  const height = numberOf(dict.lookup(PDFName.of("Height")));
  if (!decoded || decoded.width !== width || decoded.height !== height) {
    return null;
  }
  const map = pixelMap(input.ctm, decoded.width, decoded.height, input.boxes);
  if (!map) {
    return null;
  }
  const pixels = Uint8ClampedArray.from(decoded.data);
  blankSamples(pixels, { components: RGBA, height, width }, map, (box) => [
    ...hexRgb(box.fill),
    FULL,
  ]);
  const jpeg = await codec.encodeJpeg(pixels, width, height);
  const entries = plainEntries(dict, ["Decode", "ColorSpace"]);
  return input.context.stream(jpeg, {
    ...entries,
    ...extra,
    BitsPerComponent: 8,
    ColorSpace: components === RGB ? space : PDFName.of("DeviceRGB"),
    Filter: "DCTDecode",
  });
};

/** One image's samples (and its own masks) with what lies under the boxes blanked. */
const redactImageData = (
  input: RedactImageInput,
  extra: Record<string, PDFObject>,
  fillOverride: number | null
): Promise<PDFRawStream | null> => {
  const { dict } = input.stream;
  if (dict.has(PDFName.of("Alternates")) || dict.has(PDFName.of("OPI"))) {
    return Promise.resolve(null);
  }
  const filters = filtersOf(dict);
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    return redactJpeg(input, extra);
  }
  if (!filters.every((filter) => DECODABLE.has(filter))) {
    return Promise.resolve(null);
  }
  const imageMask = dict.lookup(PDFName.of("ImageMask"));
  return Promise.resolve(
    imageMask?.toString() === "true"
      ? redactStencil(input, extra)
      : redactSamples(input, extra, fillOverride)
  );
};

/**
 * A copy of an image XObject with every pixel under a box blanked, its soft
 * mask and stencil mask blanked the same way. Null when the image is in a
 * form this cannot rewrite exactly (JBIG2, JPX, CCITT, odd bit depths, CMYK
 * JPEG, no codec): the page is flattened instead.
 */
export const redactImage = async (
  input: RedactImageInput
): Promise<PDFRawStream | null> => {
  const { context, stream } = input;
  const extra: Record<string, PDFObject> = {};
  for (const key of ["SMask", "Mask"]) {
    const mask = stream.dict.lookup(PDFName.of(key));
    if (!(mask instanceof PDFRawStream)) {
      continue;
    }
    // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- at most two masks
    const blanked = await redactImageData(
      { ...input, stream: mask },
      {},
      key === "SMask" ? 0 : null
    );
    if (!blanked) {
      return null;
    }
    extra[key] = context.register(blanked);
  }
  return redactImageData(input, extra, null);
};
