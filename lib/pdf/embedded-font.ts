import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { fontFamilyCss } from "@/lib/fonts/measure-text";

type CodePointSets = Map<string, Set<number>>;

const addCodePoints = (
  sets: CodePointSets,
  fontName: string,
  text: string
): void => {
  let codes = sets.get(fontName);
  if (!codes) {
    codes = new Set();
    sets.set(fontName, codes);
  }
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) {
      codes.add(codePoint);
    }
  }
};

const encodeCodePoints = (codes: ReadonlySet<number>): string =>
  [...codes]
    .toSorted((left, right) => left - right)
    .map((code) => String.fromCodePoint(code))
    .join("");

const encodeSets = (sets: CodePointSets): Map<string, string> => {
  const glyphs = new Map<string, string>();
  for (const [fontName, codes] of sets) {
    glyphs.set(fontName, encodeCodePoints(codes));
  }
  return glyphs;
};

/** Characters already shown in each embedded font. Whitespace is included. */
export const collectEmbeddedFontGlyphs = (
  items: readonly { fontName?: string; str?: string }[]
): Map<string, string> => {
  const sets: CodePointSets = new Map();
  for (const item of items) {
    if (item.fontName && item.str) {
      addCodePoints(sets, item.fontName, item.str);
    }
  }
  return encodeSets(sets);
};

/** True when the run's embedded face has already shown every character of `text`. */
export const embeddedFontHasShown = (
  object: Pick<
    PdfTextObject,
    "embeddedFontGlyphs" | "embeddedFontUnavailable" | "fontName"
  >,
  text: string
): boolean => {
  if (
    object.embeddedFontUnavailable ||
    !object.fontName ||
    !object.embeddedFontGlyphs
  ) {
    return false;
  }
  const have = new Set(object.embeddedFontGlyphs);
  for (const char of text) {
    if (!have.has(char)) {
      return false;
    }
  }
  return true;
};

/**
 * True when both preview and export can draw `text` in the run's own font:
 * the face has shown every character, and the probed font resource can encode
 * them. Unprobed runs fail closed so preview never promises what export lacks.
 */
export const embeddedFontCanDraw = (
  object: Pick<
    PdfTextObject,
    | "embeddedFontGlyphs"
    | "embeddedFontUnavailable"
    | "fontName"
    | "reusableFontGlyphs"
  >,
  text: string
): boolean => {
  if (!(object.reusableFontGlyphs && embeddedFontHasShown(object, text))) {
    return false;
  }
  const encodable = new Set(object.reusableFontGlyphs);
  for (const char of text) {
    if (!encodable.has(char)) {
      return false;
    }
  }
  return true;
};

/** Union per-font glyphs across loaded pages so later pages widen coverage. */
export const mergeEmbeddedFontGlyphs = (
  pages: readonly EditorPage[]
): EditorPage[] => {
  const sets: CodePointSets = new Map();
  for (const page of pages) {
    for (const run of page.pdfTextObjects) {
      if (!run.fontName) {
        continue;
      }
      const source =
        run.embeddedFontGlyphs && run.embeddedFontGlyphs.length > 0
          ? run.embeddedFontGlyphs
          : run.originalText;
      addCodePoints(sets, run.fontName, source);
    }
  }
  const encoded = encodeSets(sets);
  return pages.map((page) => {
    let changed = false;
    const pdfTextObjects = page.pdfTextObjects.map((object) => {
      const glyphs = encoded.get(object.fontName);
      if (glyphs === undefined || glyphs === object.embeddedFontGlyphs) {
        return object;
      }
      changed = true;
      return { ...object, embeddedFontGlyphs: glyphs };
    });
    return changed ? { ...page, pdfTextObjects } : page;
  });
};

/** CSS font-family for a run: the embedded face when it can draw `text`. */
export const pdfTextPreviewFontCss = (
  object: Pick<
    PdfTextObject,
    | "embeddedFontGlyphs"
    | "embeddedFontUnavailable"
    | "fontFamily"
    | "fontName"
    | "reusableFontGlyphs"
  >,
  text: string
): string => {
  const fallback = fontFamilyCss(object.fontFamily ?? "sans");
  if (!object.fontName || !embeddedFontCanDraw(object, text)) {
    return fallback;
  }
  return `"${object.fontName}", ${fallback}`;
};
