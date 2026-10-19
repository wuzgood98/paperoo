import { Encodings, Font } from "@pdf-lib/standard-fonts";
import type { EncodingType, IFontNames } from "@pdf-lib/standard-fonts";
import { PDFArray, PDFDict, PDFName, PDFNumber } from "pdf-lib";
import type { PDFObject } from "pdf-lib";

/** One glyph a show operator paints, with what it takes to measure it. */
export interface ShownGlyph {
  /** The glyph's code bytes, one latin1 char per byte. */
  bytes: string;
  /** Horizontal advance in glyph space (thousandths of text space). */
  width: number;
  /** Word spacing (`Tw`) applies: a single-byte code 32. */
  wordSpace: boolean;
}

/** What precise redaction needs to know about a font. */
export interface RedactionFont {
  /** Top of a glyph box, in thousandths of text space. */
  ascent: number;
  /** Bottom of a glyph box (negative), in thousandths of text space. */
  descent: number;
  /** The glyphs a string draws, or null when one cannot be measured. */
  glyphs: (bytes: string) => ShownGlyph[] | null;
}

const DEFAULT_ASCENT = 800;
const DEFAULT_DESCENT = -200;
const DEFAULT_CID_WIDTH = 1000;
const SPACE_CODE = 32;
const FIRST_PRINTABLE = 32;
const LAST_ASCII = 126;
const BYTE = 256;

const STANDARD_FONTS = new Set<string>([
  "Courier",
  "Courier-Bold",
  "Courier-BoldOblique",
  "Courier-Oblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-BoldOblique",
  "Helvetica-Oblique",
  "Symbol",
  "Times-Bold",
  "Times-BoldItalic",
  "Times-Italic",
  "Times-Roman",
  "ZapfDingbats",
]);

const numberOf = (value: PDFObject | undefined): number | null =>
  value instanceof PDFNumber ? value.asNumber() : null;

const nameOf = (value: PDFObject | undefined): string | null =>
  value instanceof PDFName ? value.decodeText() : null;

/** Code → glyph name for a pdf-lib encoding. */
const codeNames = (encoding: EncodingType): Map<number, string> => {
  const names = new Map<number, string>();
  for (const codePoint of encoding.supportedCodePoints) {
    const { code, name } = encoding.encodeUnicodeCodePoint(codePoint);
    if (!names.has(code)) {
      names.set(code, name);
    }
  }
  return names;
};

let winAnsiNames: Map<number, string> | undefined;
let symbolNames: Map<number, string> | undefined;
let dingbatNames: Map<number, string> | undefined;

/**
 * StandardEncoding agrees with WinAnsi on printable ASCII except for the two
 * quotes; codes above it differ and are not measured.
 */
const standardEncodingName = (code: number): string | undefined => {
  if (code === 0x27) {
    return "quoteright";
  }
  if (code === 0x60) {
    return "quoteleft";
  }
  winAnsiNames ??= codeNames(Encodings.WinAnsi);
  return code >= FIRST_PRINTABLE && code <= LAST_ASCII
    ? winAnsiNames.get(code)
    : undefined;
};

/** Glyph names by code for a standard-14 font, or null when not supported. */
const standardGlyphNames = (
  baseFont: string,
  encoding: PDFObject | undefined
): ((code: number) => string | undefined) | null => {
  if (baseFont === "Symbol") {
    symbolNames ??= codeNames(Encodings.Symbol);
    const names = symbolNames;
    return encoding ? null : (code) => names.get(code);
  }
  if (baseFont === "ZapfDingbats") {
    dingbatNames ??= codeNames(Encodings.ZapfDingbats);
    const names = dingbatNames;
    return encoding ? null : (code) => names.get(code);
  }
  if (encoding === undefined) {
    return standardEncodingName;
  }
  if (nameOf(encoding) === "WinAnsiEncoding") {
    winAnsiNames ??= codeNames(Encodings.WinAnsi);
    const names = winAnsiNames;
    return (code) => names.get(code);
  }
  // MacRoman, or a dictionary with Differences: not measured here.
  return null;
};

/** A glyph box's top and bottom, in thousandths of text space. */
interface FontExtent {
  ascent: number;
  descent: number;
}

const descriptorMetrics = (
  descriptor: PDFDict | undefined,
  fallback: Partial<FontExtent> = {}
): FontExtent => {
  const ascent = numberOf(descriptor?.lookup(PDFName.of("Ascent")));
  const descent = numberOf(descriptor?.lookup(PDFName.of("Descent")));
  return {
    ascent:
      ascent !== null && ascent > 0
        ? ascent
        : (fallback.ascent ?? DEFAULT_ASCENT),
    descent:
      descent !== null && descent < 0
        ? descent
        : (fallback.descent ?? DEFAULT_DESCENT),
  };
};

const singleByteGlyphs = (
  width: (code: number) => number | null,
  bytes: string
): ShownGlyph[] | null => {
  const glyphs: ShownGlyph[] = [];
  for (const char of bytes) {
    const code = char.codePointAt(0) ?? 0;
    const advance = width(code);
    if (advance === null) {
      return null;
    }
    glyphs.push({
      bytes: char,
      width: advance,
      wordSpace: code === SPACE_CODE,
    });
  }
  return glyphs;
};

/** A TrueType or Type1 font with its own `/Widths`. */
const simpleFontWithWidths = (
  font: PDFDict,
  widths: PDFArray
): RedactionFont => {
  const descriptor = font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  const firstChar = numberOf(font.lookup(PDFName.of("FirstChar"))) ?? 0;
  const missing = numberOf(descriptor?.lookup(PDFName.of("MissingWidth"))) ?? 0;
  const values = widths
    .asArray()
    .map((entry, index) => numberOf(widths.lookup(index)) ?? numberOf(entry));
  return {
    ...descriptorMetrics(descriptor),
    glyphs: (bytes) =>
      singleByteGlyphs((code) => values[code - firstChar] ?? missing, bytes),
  };
};

const standardFont = (
  font: PDFDict,
  baseFont: string
): RedactionFont | null => {
  const names = standardGlyphNames(
    baseFont,
    font.lookup(PDFName.of("Encoding"))
  );
  if (!names) {
    return null;
  }
  // SAFETY: baseFont is one of the standard-14 names checked by the caller.
  const metrics = Font.load(baseFont as IFontNames);
  const { ascent, descent } = descriptorMetrics(
    font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict),
    {
      ascent: metrics.Ascender ?? metrics.FontBBox[3],
      descent: metrics.Descender ?? metrics.FontBBox[1],
    }
  );
  return {
    ascent,
    descent,
    glyphs: (bytes) =>
      singleByteGlyphs((code) => {
        const name = names(code);
        return (name ? metrics.getWidthOfGlyph(name) : null) ?? null;
      }, bytes),
  };
};

/** CID widths from a descendant font's `/W` array. */
const cidWidths = (descendant: PDFDict): Map<number, number> => {
  const widths = new Map<number, number>();
  const list = descendant.lookupMaybe(PDFName.of("W"), PDFArray);
  if (!list) {
    return widths;
  }
  const entries = list.asArray().map((_, index) => list.lookup(index));
  let index = 0;
  while (index < entries.length) {
    const first = numberOf(entries[index]);
    const next = entries[index + 1];
    if (first === null) {
      break;
    }
    if (next instanceof PDFArray) {
      for (const [offset] of next.asArray().entries()) {
        const width = numberOf(next.lookup(offset));
        if (width !== null) {
          widths.set(first + offset, width);
        }
      }
      index += 2;
      continue;
    }
    const last = numberOf(next);
    const width = numberOf(entries[index + 2]);
    if (last === null || width === null) {
      break;
    }
    for (let cid = first; cid <= last; cid += 1) {
      widths.set(cid, width);
    }
    index += 3;
  }
  return widths;
};

/** A Type0 font on Identity-H: two-byte codes that are CIDs. */
const identityFont = (font: PDFDict): RedactionFont | null => {
  if (nameOf(font.lookup(PDFName.of("Encoding"))) !== "Identity-H") {
    return null;
  }
  const descendants = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
  const descendant = descendants?.lookupMaybe(0, PDFDict);
  if (!descendant) {
    return null;
  }
  const widths = cidWidths(descendant);
  const fallback =
    numberOf(descendant.lookup(PDFName.of("DW"))) ?? DEFAULT_CID_WIDTH;
  return {
    ...descriptorMetrics(
      descendant.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict)
    ),
    glyphs: (bytes) => {
      if (bytes.length % 2 !== 0) {
        return null;
      }
      const glyphs: ShownGlyph[] = [];
      for (let index = 0; index < bytes.length; index += 2) {
        const cid =
          (bytes.codePointAt(index) ?? 0) * BYTE +
          (bytes.codePointAt(index + 1) ?? 0);
        glyphs.push({
          bytes: bytes.slice(index, index + 2),
          width: widths.get(cid) ?? fallback,
          wordSpace: false,
        });
      }
      return glyphs;
    },
  };
};

/**
 * Metrics for a font precise redaction can measure: a simple font with
 * `/Widths`, a standard-14 font in WinAnsi or Standard encoding, or a Type0
 * font on Identity-H. Anything else (Type3, Identity-V, custom CMaps,
 * Differences without widths) returns null and the page is flattened.
 */
export const redactionFontFor = (font: PDFDict): RedactionFont | null => {
  const subtype = nameOf(font.lookup(PDFName.of("Subtype")));
  if (subtype === "Type0") {
    return identityFont(font);
  }
  if (subtype !== "Type1" && subtype !== "TrueType" && subtype !== "MMType1") {
    return null;
  }
  const widths = font.lookupMaybe(PDFName.of("Widths"), PDFArray);
  if (widths) {
    return simpleFontWithWidths(font, widths);
  }
  const baseFont = nameOf(font.lookup(PDFName.of("BaseFont")));
  return baseFont && STANDARD_FONTS.has(baseFont)
    ? standardFont(font, baseFont)
    : null;
};
