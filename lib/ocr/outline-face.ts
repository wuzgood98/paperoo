import type {
  EditorPage,
  PdfGlyphFaceRef,
  PdfGlyphShape,
} from "@/lib/editor/types";
import { boxOf, inkedSubpaths } from "@/lib/ocr/outline-text";
import type {
  OutlineGlyph,
  OutlineLine,
  UserBox,
} from "@/lib/ocr/outline-text";
import { layoutGlyphText, resolveGlyphFace } from "@/lib/pdf/glyph-face";
import type { GlyphFace } from "@/lib/pdf/glyph-face";

/** A document face the label's glyphs matched, and the size they are set at. */
export interface OutlineFaceMatch {
  face: GlyphFace;
  ref: PdfGlyphFaceRef;
  /** Font size in user-space units. */
  size: number;
  /** Line texts with look-alike characters fixed from the glyph shapes. */
  texts: string[];
}

export interface OutlineLineGeometry {
  /** Baseline y in user space. */
  baseline: number;
  /** Pen origin x in user space. */
  originX: number;
  /** Advance width in user space. */
  width: number;
}

/** Characters OCR confuses that a face draws differently. */
const LOOK_ALIKES: readonly (readonly string[])[] = [
  ["I", "l", "1", "|"],
  ["O", "0"],
];
/** Ink smaller than this (user units) is too small to compare. */
const MIN_COMPARED_INK = 0.5;
const MIN_COMPARED_GLYPHS = 4;
/** Share of the label's glyphs the face must have to be its face. */
const MIN_FACE_COVERAGE = 0.6;
/** Same face at one size: ink heights agree this closely (median relative error). */
const MAX_HEIGHT_ERROR = 0.04;
/** Widths vary more with hinting and overlap; still tight between weights. */
const MAX_WIDTH_ERROR = 0.06;
const P90 = 0.9;
const MAX_P90_ERROR = 0.15;

const LOWERCASE_FLAT = new Set("acemnorsuvwxz");
const CAP_HEIGHT = new Set("ABDEFHIKLMNPRTUVWXYZ0123456789");
/** Typical sans x-height and cap height in em (Inter and Liberation agree within ~5%). */
const X_HEIGHT_EM = 0.53;
const CAP_HEIGHT_EM = 0.72;
/** Glyphs whose ink drops below the baseline. */
const DESCENDERS = new Set("gjpqyQ,;()[]{}/|@$_");
/** An `l`, `I` or `i` stem at least this wide (em) reads as bold. */
const BOLD_STEM_EM = 0.1;
const STEM_CHARS = new Set("lIi");

export type Weight = 400 | 700;

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const quantile = (values: readonly number[], q: number): number => {
  const sorted = values.toSorted((left, right) => left - right);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  );
};

const inkCache = new WeakMap<PdfGlyphShape, UserBox | null>();

/** Ink bounds of a face glyph in em, or null for a glyph with no ink. */
export const glyphInkBox = (shape: PdfGlyphShape): UserBox | null => {
  if (inkCache.has(shape)) {
    return inkCache.get(shape) ?? null;
  }
  const subpaths = inkedSubpaths(shape.commands);
  const box = subpaths.length > 0 ? boxOf(subpaths) : null;
  inkCache.set(shape, box);
  return box;
};

const width = (box: UserBox): number => box.maxX - box.minX;
const height = (box: UserBox): number => box.maxY - box.minY;

/**
 * Every distinct face the document's Figma text uses, each with one text
 * block that seeds it. Faces only grow from pages already loaded.
 */
export const documentGlyphFaces = (
  pages: readonly EditorPage[]
): { face: GlyphFace; ref: PdfGlyphFaceRef }[] => {
  const faces: { face: GlyphFace; keys: Set<string>; ref: PdfGlyphFaceRef }[] =
    [];
  for (const page of pages) {
    for (const show of page.type3Glyphs?.shows ?? []) {
      const inked = show.glyphs.filter(
        (key) => (page.type3Glyphs?.shapes[key]?.commands.length ?? 0) > 0
      );
      if (
        inked.length === 0 ||
        faces.some((known) => inked.every((key) => known.keys.has(key)))
      ) {
        continue;
      }
      const ref = { pageId: page.id, showOrdinal: show.showOrdinal };
      const face = resolveGlyphFace(pages, page.id, {
        glyphFace: ref,
        invisibleGlyphs: true,
      });
      if (face) {
        faces.push({
          face,
          keys: new Set([...face.glyphs.values()].map((shape) => shape.key)),
          ref,
        });
      }
    }
  }
  return faces.map(({ face, ref }) => ({ face, ref }));
};

interface Comparison {
  heightError: number;
  widthError: number;
}

const compareGlyph = (
  glyph: OutlineGlyph,
  shape: PdfGlyphShape | undefined,
  size: number
): Comparison | null => {
  const ink = shape ? glyphInkBox(shape) : null;
  if (!ink || height(ink) <= 0 || width(ink) <= 0) {
    return null;
  }
  return {
    heightError: Math.abs(height(glyph) / (height(ink) * size) - 1),
    widthError: Math.abs(width(glyph) / (width(ink) * size) - 1),
  };
};

const comparable = (glyph: OutlineGlyph): boolean =>
  height(glyph) >= MIN_COMPARED_INK && width(glyph) >= MIN_COMPARED_INK;

const isLookAlike = (char: string): boolean =>
  LOOK_ALIKES.some((group) => group.includes(char));

const emptyShape: PdfGlyphShape = {
  box: [0, 0, 0, 0],
  commands: [],
  key: "",
  unicode: "",
  width: 0,
};

/** Put corrected characters back into the OCR text, keeping its spaces. */
const replaceGlyphChars = (
  text: string,
  glyphs: readonly OutlineGlyph[]
): string => {
  let next = 0;
  return [...text]
    .map((char) => {
      if (/\s/u.test(char)) {
        return char;
      }
      const glyph = glyphs[next];
      next += 1;
      return glyph?.char ?? char;
    })
    .join("");
};

/** Size the glyphs are set at in this face, from unambiguous characters. */
const faceSize = (
  face: GlyphFace,
  glyphs: readonly OutlineGlyph[]
): number | null => {
  const ratios: number[] = [];
  for (const glyph of glyphs) {
    const ink = glyphInkBox(face.glyphs.get(glyph.char) ?? emptyShape);
    if (
      !isLookAlike(glyph.char) &&
      ink &&
      height(ink) > 0 &&
      comparable(glyph)
    ) {
      ratios.push(height(glyph) / height(ink));
    }
  }
  return ratios.length > 0 ? median(ratios) : null;
};

/** The look-alike whose glyph in this face fits the ink best. */
const fixLookAlike = (
  face: GlyphFace,
  glyph: OutlineGlyph,
  size: number
): string => {
  const group = LOOK_ALIKES.find((members) => members.includes(glyph.char));
  if (!group) {
    return glyph.char;
  }
  let best = glyph.char;
  let bestError = Number.POSITIVE_INFINITY;
  for (const char of group) {
    const comparison = compareGlyph(glyph, face.glyphs.get(char), size);
    const error = comparison
      ? comparison.heightError + comparison.widthError
      : Number.POSITIVE_INFINITY;
    if (error < bestError) {
      best = char;
      bestError = error;
    }
  }
  return best;
};

interface FaceScore {
  error: number;
  match: OutlineFaceMatch;
}

const scoreFace = (
  candidate: { face: GlyphFace; ref: PdfGlyphFaceRef },
  lines: readonly OutlineLine[]
): FaceScore | null => {
  const { face } = candidate;
  const glyphs = lines.flatMap((line) => line.glyphs);
  const size = faceSize(face, glyphs);
  if (size === null || size <= 0) {
    return null;
  }
  const fixedLines = lines.map((line) =>
    line.glyphs.map((glyph) => ({
      ...glyph,
      char: fixLookAlike(face, glyph, size),
    }))
  );
  const heightErrors: number[] = [];
  const widthErrors: number[] = [];
  let covered = 0;
  for (const glyph of fixedLines.flat()) {
    const shape = face.glyphs.get(glyph.char);
    if (shape) {
      covered += 1;
    }
    const comparison = comparable(glyph)
      ? compareGlyph(glyph, shape, size)
      : null;
    if (comparison) {
      heightErrors.push(comparison.heightError);
      widthErrors.push(comparison.widthError);
    }
  }
  const compared = Math.min(MIN_COMPARED_GLYPHS, glyphs.length);
  if (
    heightErrors.length < compared ||
    covered < glyphs.length * MIN_FACE_COVERAGE
  ) {
    return null;
  }
  const heightError = median(heightErrors);
  const widthError = median(widthErrors);
  const fits =
    heightError <= MAX_HEIGHT_ERROR &&
    widthError <= MAX_WIDTH_ERROR &&
    quantile(heightErrors, P90) <= MAX_P90_ERROR &&
    quantile(widthErrors, P90) <= MAX_P90_ERROR;
  if (!fits) {
    return null;
  }
  const texts = lines.map((line, index) =>
    replaceGlyphChars(line.text, fixedLines[index] ?? [])
  );
  return {
    error: heightError + widthError,
    match: { face, ref: candidate.ref, size, texts },
  };
};

/**
 * The document face the label is set in, when its glyphs' ink matches one
 * face at one size. Null for text in a face the document's text never uses.
 */
export const matchOutlineFace = (
  pages: readonly EditorPage[],
  lines: readonly OutlineLine[]
): OutlineFaceMatch | null => {
  let best: FaceScore | null = null;
  for (const candidate of documentGlyphFaces(pages)) {
    const score = scoreFace(candidate, lines);
    if (score && (!best || score.error < best.error)) {
      best = score;
    }
  }
  return best?.match ?? null;
};

/** Font size from ink heights alone, for text in a face the document lacks. */
export const estimateOutlineSize = (lines: readonly OutlineLine[]): number => {
  const estimates: number[] = [];
  for (const glyph of lines.flatMap((line) => line.glyphs)) {
    if (LOWERCASE_FLAT.has(glyph.char)) {
      estimates.push(height(glyph) / X_HEIGHT_EM);
    } else if (CAP_HEIGHT.has(glyph.char)) {
      estimates.push(height(glyph) / CAP_HEIGHT_EM);
    }
  }
  if (estimates.length > 0) {
    return median(estimates);
  }
  return median(lines.map((line) => height(boxOf(line.glyphs))));
};

/** Regular or bold, from how thick the label's stems are. */
export const estimateOutlineWeight = (
  lines: readonly OutlineLine[],
  size: number
): Weight => {
  const stems: number[] = [];
  for (const glyph of lines.flatMap((line) => line.glyphs)) {
    if (STEM_CHARS.has(glyph.char)) {
      stems.push(width(glyph) / size);
    }
  }
  return stems.length > 0 && median(stems) >= BOLD_STEM_EM ? 700 : 400;
};

/** Where a line's pen starts and its baseline sits, from its glyph ink. */
export const outlineLineGeometry = (
  line: OutlineLine,
  text: string,
  match: OutlineFaceMatch | null,
  size: number
): OutlineLineGeometry => {
  const glyphs = line.glyphs.map((glyph, index) => ({
    ...glyph,
    char: [...text.replaceAll(/\s/gu, "")][index] ?? glyph.char,
  }));
  const ink = boxOf(glyphs);
  const layout = match ? layoutGlyphText(match.face, text) : null;
  if (!(match && layout)) {
    const resting = glyphs.filter((glyph) => !DESCENDERS.has(glyph.char));
    return {
      baseline: median(
        (resting.length > 0 ? resting : glyphs).map((glyph) => glyph.minY)
      ),
      originX: ink.minX,
      width: ink.maxX - ink.minX,
    };
  }
  const baselines: number[] = [];
  const origins: number[] = [];
  for (const [index, placed] of layout.glyphs
    .filter((entry) => entry.shape.commands.length > 0)
    .entries()) {
    const glyph = glyphs[index];
    const shapeInk = glyphInkBox(placed.shape);
    if (!(glyph && shapeInk)) {
      continue;
    }
    baselines.push(glyph.minY - shapeInk.minY * size);
    origins.push(glyph.minX - (placed.x + shapeInk.minX) * size);
  }
  return {
    baseline: median(baselines),
    originX: median(origins),
    width: layout.width * size,
  };
};
