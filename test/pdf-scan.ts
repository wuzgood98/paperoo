import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
} from "pdf-lib";
import type { PDFObject, PDFRef } from "pdf-lib";

const HEX_TOKEN_REGEX = /<(?<digits>[\da-fA-F\s]+)>/gu;
const WHITESPACE_REGEX = /\s/gu;

const latin1 = (bytes: Uint8Array): string => {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCodePoint(byte);
  }
  return text;
};

const hexOf = (codes: readonly number[], digits: number): string =>
  codes.map((code) => code.toString(16).padStart(digits, "0")).join("");

/** UTF-16BE, as pdf-lib and most producers write text strings. */
const utf16be = (text: string): string => {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0;
    out += String.fromCodePoint(Math.trunc(code / 256), code % 256);
  }
  return out;
};

/** Every spelling of `needle` a content stream or string could hold. */
const spellings = (needle: string): string[] => {
  const codes = [...needle].map((char) => char.codePointAt(0) ?? 0);
  const winAnsi = hexOf(codes, 2);
  const wide = hexOf(codes, 4);
  return [
    needle,
    utf16be(needle),
    winAnsi.toUpperCase(),
    winAnsi.toLowerCase(),
    wide.toUpperCase(),
    wide.toLowerCase(),
  ];
};

/** The bytes of every `<…>` hex token, as latin-1 text. */
const decodedHexTokens = (text: string): string[] =>
  [...text.matchAll(HEX_TOKEN_REGEX)].map((match) => {
    const clean = (match.groups?.digits ?? "").replaceAll(WHITESPACE_REGEX, "");
    let out = "";
    for (let index = 0; index + 1 < clean.length; index += 2) {
      out += String.fromCodePoint(
        Number.parseInt(clean.slice(index, index + 2), 16)
      );
    }
    return out;
  });

const streamText = (stream: PDFStream): string => {
  if (!(stream instanceof PDFRawStream)) {
    return latin1(stream.getContents());
  }
  try {
    return latin1(decodePDFRawStream(stream).decode());
  } catch {
    // An image filter pdf-lib cannot decode (DCT, JPX…) holds no text.
    return latin1(stream.getContents());
  }
};

/** Every string a parsed object holds, directly or nested. */
const collectStrings = (root: PDFObject, out: string[]): void => {
  const stack: PDFObject[] = [root];
  for (let next = stack.pop(); next; next = stack.pop()) {
    if (next instanceof PDFString || next instanceof PDFHexString) {
      out.push(next.decodeText(), latin1(next.asBytes()));
    } else if (next instanceof PDFDict) {
      stack.push(...next.values());
    } else if (next instanceof PDFArray) {
      stack.push(...next.asArray());
    } else if (next instanceof PDFStream) {
      stack.push(next.dict);
    }
  }
};

/**
 * Whether `needle` survives anywhere in a PDF: in the raw bytes, in any
 * object's strings, or in any decoded stream (as text, WinAnsi or UTF-16BE
 * hex, or inside a hex token). Unreferenced objects count: pdf-lib's parser
 * reads every object in the file, not only those the xref reaches.
 */
export const pdfContainsText = async (
  bytes: Uint8Array,
  needle: string
): Promise<boolean> => {
  const forms = spellings(needle);
  const holds = (text: string): boolean =>
    forms.some((form) => text.includes(form));
  if (holds(latin1(bytes))) {
    return true;
  }
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const texts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    collectStrings(object, texts);
    if (object instanceof PDFStream) {
      const text = streamText(object);
      texts.push(text, ...decodedHexTokens(text));
    }
  }
  return texts.some(holds);
};

/** Refs of every `/Type /Page` dict in the file, in the tree or not. */
export const allPageDictRefs = async (bytes: Uint8Array): Promise<PDFRef[]> => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const refs: PDFRef[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.get(PDFName.of("Type")) === PDFName.of("Page")
    ) {
      refs.push(ref);
    }
  }
  return refs;
};
