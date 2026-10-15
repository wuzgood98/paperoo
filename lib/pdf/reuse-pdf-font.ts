import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from "pdf-lib";
import type { PDFObject, PDFPage } from "pdf-lib";

import type { PdfTextObject } from "@/lib/editor/types";

export interface ReusedPdfFontText {
  encoded: Uint8Array;
  resourceName: string;
  /** Advance width in page units at `fontSize`, from the font's own widths. */
  width: number;
}

type BytesPerCode = 1 | 2;

interface UnicodeCodeMap {
  bytesPerCode: BytesPerCode;
  /** Unicode code point to character code; the first code wins. */
  codes: Map<number, number>;
}

/** Glyph space units per text space unit for every font type except Type3. */
const GLYPH_UNITS_PER_EM = 1000;
/** PDF spec default for a CIDFont's missing /DW. */
const DEFAULT_CID_WIDTH = 1000;
/** PDF spec default for a FontDescriptor's missing /MissingWidth. */
const DEFAULT_MISSING_WIDTH = 0;
/** Ranges wider than this are malformed; real bfranges span one low byte. */
const MAX_BFRANGE_SPAN = 10_000;
const BYTE_RADIX = 256;
const MAX_BMP_CODE_POINT = 0xff_ff;
const HEX_DIGITS_PER_BYTE = 2;
const HEX_DIGITS_PER_UTF16_UNIT = 4;

const SIMPLE_FONT_SUBTYPES = new Set(["MMType1", "TrueType", "Type1"]);

const BFCHAR_BLOCK = /beginbfchar(?<body>[\s\S]*?)endbfchar/gu;
const BFRANGE_BLOCK = /beginbfrange(?<body>[\s\S]*?)endbfrange/gu;
const CMAP_TOKEN = /<(?<hex>[0-9A-Fa-f\s]*)>|\[|\]|[^\s<>[\]]+/gu;
const WHITESPACE = /\s/gu;

type CMapToken =
  | { kind: "hex"; value: string }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "other" };

/** Tokenize a CMap body. Any PDF whitespace separates tokens (CR, LF, tab). */
const cmapTokens = (body: string): CMapToken[] => {
  const tokens: CMapToken[] = [];
  for (const match of body.matchAll(CMAP_TOKEN)) {
    const [text] = match;
    const hex = match.groups?.hex;
    if (hex !== undefined) {
      tokens.push({ kind: "hex", value: hex.replaceAll(WHITESPACE, "") });
    } else if (text === "[") {
      tokens.push({ kind: "open" });
    } else if (text === "]") {
      tokens.push({ kind: "close" });
    } else {
      tokens.push({ kind: "other" });
    }
  }
  return tokens;
};

const hexToInt = (hex: string): number => Number.parseInt(hex, 16);

const isLoneSurrogate = (codePoint: number): boolean =>
  codePoint >= 0xd8_00 && codePoint <= 0xdf_ff;

/**
 * Decode a ToUnicode destination (UTF-16BE) to one code point. Ligature
 * destinations such as `fi` return null: one code cannot stand for one char.
 */
export const singleCodePoint = (hex: string): number | null => {
  if (hex.length === HEX_DIGITS_PER_BYTE) {
    return hexToInt(hex);
  }
  if (hex.length === 0 || hex.length % HEX_DIGITS_PER_UTF16_UNIT !== 0) {
    return null;
  }
  const units: number[] = [];
  for (let index = 0; index < hex.length; index += HEX_DIGITS_PER_UTF16_UNIT) {
    units.push(hexToInt(hex.slice(index, index + HEX_DIGITS_PER_UTF16_UNIT)));
  }
  const chars = [...String.fromCodePoint(...units)];
  const [char] = chars;
  const codePoint = char?.codePointAt(0);
  if (
    chars.length !== 1 ||
    codePoint === undefined ||
    isLoneSurrogate(codePoint)
  ) {
    return null;
  }
  return codePoint;
};

const isSourceCode = (
  token: CMapToken | undefined,
  bytesPerCode: BytesPerCode
): token is { kind: "hex"; value: string } =>
  token?.kind === "hex" &&
  token.value.length === bytesPerCode * HEX_DIGITS_PER_BYTE;

const noteCode = (
  codes: Map<number, number>,
  codePoint: number | null,
  code: number
): void => {
  if (codePoint !== null && !codes.has(codePoint)) {
    codes.set(codePoint, code);
  }
};

const invertBfchar = (
  tokens: readonly CMapToken[],
  codes: Map<number, number>,
  bytesPerCode: BytesPerCode
): void => {
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const source = tokens[index];
    const dest = tokens[index + 1];
    if (isSourceCode(source, bytesPerCode) && dest?.kind === "hex") {
      noteCode(codes, singleCodePoint(dest.value), hexToInt(source.value));
    }
  }
};

/** Consume `[ <dst>… ]` from `start`; returns the index after `]`. */
const invertBfrangeArray = (
  tokens: readonly CMapToken[],
  start: number,
  firstCode: number,
  codes: Map<number, number> | null
): number => {
  let index = start + 1;
  let offset = 0;
  while (index < tokens.length && tokens[index]?.kind !== "close") {
    const dest = tokens[index];
    if (codes && dest?.kind === "hex") {
      noteCode(codes, singleCodePoint(dest.value), firstCode + offset);
    }
    offset += 1;
    index += 1;
  }
  return index + 1;
};

const invertBfrange = (
  tokens: readonly CMapToken[],
  codes: Map<number, number>,
  bytesPerCode: BytesPerCode
): void => {
  let index = 0;
  while (index + 2 < tokens.length) {
    const startToken = tokens[index];
    const endToken = tokens[index + 1];
    if (startToken?.kind !== "hex" || endToken?.kind !== "hex") {
      index += 1;
      continue;
    }
    const start = hexToInt(startToken.value);
    const end = hexToInt(endToken.value);
    const usable =
      isSourceCode(startToken, bytesPerCode) &&
      isSourceCode(endToken, bytesPerCode) &&
      end >= start &&
      end - start <= MAX_BFRANGE_SPAN;
    const dest = tokens[index + 2];
    if (dest?.kind === "open") {
      index = invertBfrangeArray(
        tokens,
        index + 2,
        start,
        usable ? codes : null
      );
      continue;
    }
    index += 3;
    if (!usable || dest?.kind !== "hex") {
      continue;
    }
    const first = singleCodePoint(dest.value);
    if (first === null || first + (end - start) > MAX_BMP_CODE_POINT) {
      continue;
    }
    for (let offset = 0; offset <= end - start; offset += 1) {
      noteCode(codes, first + offset, start + offset);
    }
  }
};

/**
 * Invert a ToUnicode CMap: Unicode code point to character code. Only sources
 * of the font's own code width are kept, so codes always encode correctly.
 */
export const invertToUnicodeCMap = (
  cmap: string,
  bytesPerCode: BytesPerCode
): UnicodeCodeMap | null => {
  const codes = new Map<number, number>();
  for (const block of cmap.matchAll(BFCHAR_BLOCK)) {
    invertBfchar(cmapTokens(block.groups?.body ?? ""), codes, bytesPerCode);
  }
  for (const block of cmap.matchAll(BFRANGE_BLOCK)) {
    invertBfrange(cmapTokens(block.groups?.body ?? ""), codes, bytesPerCode);
  }
  return codes.size === 0 ? null : { bytesPerCode, codes };
};

/** Character codes for `text`, or null when any character is unmapped. */
const codesForText = (
  text: string,
  mapping: UnicodeCodeMap
): number[] | null => {
  const codes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    const code =
      codePoint === undefined ? undefined : mapping.codes.get(codePoint);
    if (code === undefined) {
      return null;
    }
    codes.push(code);
  }
  return codes;
};

const encodeCodes = (
  codes: readonly number[],
  bytesPerCode: BytesPerCode
): Uint8Array => {
  const encoded = new Uint8Array(codes.length * bytesPerCode);
  for (const [index, code] of codes.entries()) {
    if (bytesPerCode === 1) {
      encoded[index] = code;
      continue;
    }
    encoded[index * 2] = Math.floor(code / BYTE_RADIX);
    encoded[index * 2 + 1] = code % BYTE_RADIX;
  }
  return encoded;
};

export const encodeWithToUnicode = (
  text: string,
  mapping: UnicodeCodeMap
): Uint8Array | null => {
  const codes = codesForText(text, mapping);
  return codes ? encodeCodes(codes, mapping.bytesPerCode) : null;
};

const nameOf = (value: PDFObject | undefined): string | null =>
  value instanceof PDFName ? value.decodeText() : null;

/**
 * Bytes per character code, from the font type. Simple fonts use one byte;
 * Type0 is reusable only with Identity-H, where the code is the CID.
 */
const fontBytesPerCode = (font: PDFDict): BytesPerCode | null => {
  const subtype = nameOf(font.lookup(PDFName.of("Subtype")));
  if (subtype && SIMPLE_FONT_SUBTYPES.has(subtype)) {
    return 1;
  }
  if (
    subtype === "Type0" &&
    nameOf(font.lookup(PDFName.of("Encoding"))) === "Identity-H"
  ) {
    return 2;
  }
  return null;
};

const readCMap = (font: PDFDict): string | null => {
  const toUnicode = font.lookup(PDFName.of("ToUnicode"));
  if (!(toUnicode instanceof PDFRawStream)) {
    return null;
  }
  try {
    const bytes = decodePDFRawStream(toUnicode).decode();
    return new TextDecoder("latin1").decode(bytes);
  } catch {
    // Unsupported filter or corrupt stream: the font cannot be reused.
    return null;
  }
};

const numberAt = (array: PDFArray, index: number): number | null => {
  if (index < 0 || index >= array.size()) {
    return null;
  }
  const value = array.lookup(index);
  return value instanceof PDFNumber ? value.asNumber() : null;
};

const numberIn = (dict: PDFDict, key: string): number | null => {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : null;
};

const missingWidth = (font: PDFDict): number => {
  const descriptor = font.lookup(PDFName.of("FontDescriptor"));
  return descriptor instanceof PDFDict
    ? (numberIn(descriptor, "MissingWidth") ?? DEFAULT_MISSING_WIDTH)
    : DEFAULT_MISSING_WIDTH;
};

const cidFontWidths = (font: PDFDict): Map<number, number> => {
  const map = new Map<number, number>();
  const widths = font.lookup(PDFName.of("W"));
  if (!(widths instanceof PDFArray)) {
    return map;
  }
  let index = 0;
  while (index < widths.size()) {
    const start = numberAt(widths, index);
    const next = widths.lookup(index + 1);
    if (start === null) {
      return map;
    }
    if (next instanceof PDFArray) {
      for (let offset = 0; offset < next.size(); offset += 1) {
        const width = numberAt(next, offset);
        if (width !== null) {
          map.set(start + offset, width);
        }
      }
      index += 2;
      continue;
    }
    const end = numberAt(widths, index + 1);
    const width = numberAt(widths, index + 2);
    if (end === null || width === null || end < start) {
      return map;
    }
    for (let code = start; code <= end; code += 1) {
      map.set(code, width);
    }
    index += 3;
  }
  return map;
};

type GlyphWidth = (code: number) => number;

/**
 * Width lookup in glyph units, or null when the font has no widths to trust.
 * Without one, export and preview could disagree on the fitted box.
 */
const glyphWidths = (
  font: PDFDict,
  bytesPerCode: BytesPerCode
): GlyphWidth | null => {
  if (bytesPerCode === 2) {
    const descendants = font.lookup(PDFName.of("DescendantFonts"));
    const descendant =
      descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
    if (!(descendant instanceof PDFDict)) {
      return null;
    }
    const widths = cidFontWidths(descendant);
    const fallback = numberIn(descendant, "DW") ?? DEFAULT_CID_WIDTH;
    return (code) => widths.get(code) ?? fallback;
  }
  const widths = font.lookup(PDFName.of("Widths"));
  if (!(widths instanceof PDFArray)) {
    return null;
  }
  const firstChar = numberIn(font, "FirstChar") ?? 0;
  const fallback = missingWidth(font);
  return (code) => numberAt(widths, code - firstChar) ?? fallback;
};

interface FontMatch {
  dict: PDFDict;
  ref: PDFRef | null;
  resourceName: string;
}

const matchBaseFont = (
  fonts: PDFDict,
  baseFontName: string
): FontMatch | null => {
  for (const [key, raw] of fonts.entries()) {
    const dict = fonts.lookup(key);
    if (!(dict instanceof PDFDict)) {
      continue;
    }
    if (nameOf(dict.lookup(PDFName.of("Subtype"))) === "Type3") {
      continue;
    }
    if (nameOf(dict.lookup(PDFName.of("BaseFont"))) !== baseFontName) {
      continue;
    }
    return {
      dict,
      ref: raw instanceof PDFRef ? raw : null,
      resourceName: key.decodeText(),
    };
  }
  return null;
};

const findEmbeddedFont = (
  page: PDFPage,
  baseFontName: string
): FontMatch | null => {
  const { Font: pageFonts, XObject: xObjects } = page.node.normalizedEntries();
  const onPage = matchBaseFont(pageFonts, baseFontName);
  if (onPage) {
    return onPage;
  }
  for (const [key] of xObjects.entries()) {
    // Form XObjects are streams; their resources live on the stream dict.
    const raw = xObjects.lookup(key);
    const xObject = raw instanceof PDFStream ? raw.dict : raw;
    if (
      !(xObject instanceof PDFDict) ||
      nameOf(xObject.lookup(PDFName.of("Subtype"))) !== "Form"
    ) {
      continue;
    }
    const resources = xObject.lookup(PDFName.of("Resources"));
    const fonts =
      resources instanceof PDFDict
        ? resources.lookup(PDFName.of("Font"))
        : undefined;
    if (!(fonts instanceof PDFDict)) {
      continue;
    }
    const match = matchBaseFont(fonts, baseFontName);
    if (!match?.ref) {
      continue;
    }
    // Promote to the page's own resources; later lookups then match on page.
    const resourceName = page.node.newFontDictionary("F", match.ref);
    return { ...match, resourceName: resourceName.decodeText() };
  }
  return null;
};

const bytesToHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(HEX_DIGITS_PER_BYTE, "0");
  }
  return hex;
};

interface ReusableFont {
  mapping: UnicodeCodeMap;
  match: FontMatch;
  widthOf: GlyphWidth;
}

/** The font resource, its inverted ToUnicode and widths; null when any is unusable. */
const loadReusableFont = (
  page: PDFPage,
  baseFontName: string
): ReusableFont | null => {
  const match = findEmbeddedFont(page, baseFontName);
  if (!match) {
    return null;
  }
  const bytesPerCode = fontBytesPerCode(match.dict);
  if (!bytesPerCode) {
    return null;
  }
  const widthOf = glyphWidths(match.dict, bytesPerCode);
  const cmap = readCMap(match.dict);
  if (!(widthOf && cmap)) {
    return null;
  }
  const mapping = invertToUnicodeCMap(cmap, bytesPerCode);
  return mapping ? { mapping, match, widthOf } : null;
};

/**
 * Code points `reuseEmbeddedPdfFont` can encode for this font on this page.
 * Preview probes it up front so it never shows a font the export cannot use.
 */
export const reusableCodePoints = (
  page: PDFPage,
  baseFontName: string
): number[] => {
  const font = loadReusableFont(page, baseFontName);
  return font ? [...font.mapping.codes.keys()] : [];
};

/**
 * Encode replacement text with the page's existing font, when every character
 * is in its ToUnicode map. Returns null so the caller can use a bundled font.
 */
export const reuseEmbeddedPdfFont = (
  page: PDFPage,
  object: Pick<PdfTextObject, "baseFontName" | "fontSize" | "height" | "text">
): ReusedPdfFontText | null => {
  if (!object.baseFontName || object.text.length === 0) {
    return null;
  }
  const font = loadReusableFont(page, object.baseFontName);
  if (!font) {
    return null;
  }
  const codes = codesForText(object.text, font.mapping);
  if (!codes) {
    return null;
  }
  const units = codes.reduce((sum, code) => sum + font.widthOf(code), 0);
  const fontSize = object.fontSize ?? object.height;
  return {
    encoded: encodeCodes(codes, font.mapping.bytesPerCode),
    resourceName: font.match.resourceName,
    width: (units / GLYPH_UNITS_PER_EM) * fontSize,
  };
};

export const reusedFontHex = (encoded: Uint8Array): PDFHexString =>
  PDFHexString.of(bytesToHex(encoded));
