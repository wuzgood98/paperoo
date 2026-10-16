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

/** Runs in one font share a glyph string; build its lookup set once. */
const MAX_GLYPH_SET_ENTRIES = 256;

const glyphSetCache = new Map<string, ReadonlySet<string>>();

const glyphSet = (glyphs: string): ReadonlySet<string> => {
  const cached = glyphSetCache.get(glyphs);
  if (cached) {
    return cached;
  }
  if (glyphSetCache.size >= MAX_GLYPH_SET_ENTRIES) {
    glyphSetCache.clear();
  }
  const set = new Set(glyphs);
  glyphSetCache.set(glyphs, set);
  return set;
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
  const have = glyphSet(object.embeddedFontGlyphs);
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
  const encodable = glyphSet(object.reusableFontGlyphs);
  for (const char of text) {
    if (!encodable.has(char)) {
      return false;
    }
  }
  return true;
};

const addPageCodePoints = (
  sets: CodePointSets,
  pages: readonly EditorPage[]
): void => {
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
};

/** Give every run of a font in `fonts` that font's glyph string. */
const applyFontGlyphs = (
  pages: readonly EditorPage[],
  glyphsByFont: ReadonlyMap<string, string>,
  fonts: ReadonlySet<string> | null
): EditorPage[] =>
  pages.map((page) => {
    let changed = false;
    const pdfTextObjects = page.pdfTextObjects.map((object) => {
      if (fonts && !fonts.has(object.fontName)) {
        return object;
      }
      const glyphs = glyphsByFont.get(object.fontName);
      if (glyphs === undefined || glyphs === object.embeddedFontGlyphs) {
        return object;
      }
      changed = true;
      return { ...object, embeddedFontGlyphs: glyphs };
    });
    return changed ? { ...page, pdfTextObjects } : page;
  });

/** Code point sets behind a merged page list, so appends skip rescanning it. */
const mergedFontSets = new WeakMap<readonly EditorPage[], CodePointSets>();

const cloneSets = (sets: CodePointSets): CodePointSets =>
  new Map([...sets].map(([fontName, codes]) => [fontName, new Set(codes)]));

/** Union per-font glyphs across loaded pages so later pages widen coverage. */
export const mergeEmbeddedFontGlyphs = (
  pages: readonly EditorPage[]
): EditorPage[] => {
  const sets: CodePointSets = new Map();
  addPageCodePoints(sets, pages);
  const merged = applyFontGlyphs(pages, encodeSets(sets), null);
  mergedFontSets.set(merged, sets);
  return merged;
};

/**
 * Same result as merging `combine(existing, incoming)` from scratch, but
 * hydration appends scan only the new pages, and rewrite existing runs only
 * for fonts whose glyphs actually grew.
 */
export const appendEmbeddedFontGlyphs = (
  existing: readonly EditorPage[],
  incoming: readonly EditorPage[],
  combine: (
    existing: readonly EditorPage[],
    incoming: readonly EditorPage[]
  ) => EditorPage[]
): EditorPage[] => {
  const known = mergedFontSets.get(existing);
  if (!known) {
    return mergeEmbeddedFontGlyphs(combine(existing, incoming));
  }
  const sets = cloneSets(known);
  addPageCodePoints(sets, incoming);
  const grown = new Set<string>();
  const glyphsByFont = new Map<string, string>();
  for (const [fontName, codes] of sets) {
    if (codes.size !== known.get(fontName)?.size) {
      grown.add(fontName);
    }
    glyphsByFont.set(fontName, encodeCodePoints(codes));
  }
  const merged = combine(
    grown.size === 0
      ? existing
      : applyFontGlyphs(existing, glyphsByFont, grown),
    applyFontGlyphs(incoming, glyphsByFont, null)
  );
  mergedFontSets.set(merged, sets);
  return merged;
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
