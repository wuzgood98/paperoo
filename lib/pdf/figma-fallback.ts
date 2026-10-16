import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import {
  INTER_3_400_ADVANCES,
  INTER_3_600_ADVANCES,
  INTER_4_400_ADVANCES,
  INTER_4_600_ADVANCES,
} from "@/lib/fonts/inter-advances";
import { rebuiltGlyphLayout, resolveGlyphFace } from "@/lib/pdf/glyph-face";
import type { GlyphFace } from "@/lib/pdf/glyph-face";

/** The bundled Inter weights. */
export type InterWeight = 400 | 600;

/**
 * How a Figma run is drawn when its own glyphs can't spell the new text:
 * Inter when the face's widths prove it is Inter (Figma's default), else
 * Liberation Sans at a weight guessed from the glyph outlines.
 */
export interface FigmaFallbackStyle {
  family: "inter" | "liberation";
  /** Extra space after each glyph, in em; negative tightens. */
  letterSpacingEm: number;
  weight: 400 | 600 | 700;
}

interface InterTable {
  advances: Readonly<Record<string, number>>;
  weight: InterWeight;
}

/** 4.1 is bundled; 3.19 widths also count, since older Figma exports used it. */
const INTER_TABLES: readonly InterTable[] = [
  { advances: INTER_4_400_ADVANCES, weight: 400 },
  { advances: INTER_4_600_ADVANCES, weight: 600 },
  { advances: INTER_3_400_ADVANCES, weight: 400 },
  { advances: INTER_3_600_ADVANCES, weight: 600 },
];

/** Fewer comparable glyphs than this proves nothing either way. */
const MIN_COMPARED_GLYPHS = 8;
/** Real Inter widths agree to rounding; another sans is off by several %. */
const MAX_MEDIAN_ERROR = 0.01;
const MAX_P90_ERROR = 0.03;
const P90 = 0.9;
const TJ_UNITS_PER_EM = 1000;

/**
 * A stem (the ink width of l, I or i) at least this wide, in em, reads as
 * bold. Regular sans stems sit near 0.08 em; semibold and bold near 0.11+.
 */
const BOLD_STEM_EM = 0.1;
const STEM_GLYPHS = ["l", "I", "i"];

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

/** Width errors of the face against one Inter table, sorted ascending. */
const widthErrors = (face: GlyphFace, table: InterTable): number[] => {
  const errors: number[] = [];
  for (const [char, shape] of face.glyphs) {
    const advance = table.advances[char];
    if (advance === undefined || shape.width <= 0 || char.trim() === "") {
      continue;
    }
    errors.push(Math.abs(advance - shape.width) / advance);
  }
  return errors.toSorted((left, right) => left - right);
};

/**
 * The Inter weight a face was set in, when its glyph widths match Inter's
 * own advances closely enough to be Inter; otherwise null.
 */
export const matchInterWeight = (face: GlyphFace): InterWeight | null => {
  let best: { median: number; weight: InterWeight } | null = null;
  for (const table of INTER_TABLES) {
    const errors = widthErrors(face, table);
    if (errors.length < MIN_COMPARED_GLYPHS) {
      continue;
    }
    const median = quantile(errors, 0.5);
    const fits =
      median <= MAX_MEDIAN_ERROR && quantile(errors, P90) <= MAX_P90_ERROR;
    if (fits && (!best || median < best.median)) {
      best = { median, weight: table.weight };
    }
  }
  return best?.weight ?? null;
};

/** Regular or bold for Liberation, from how thick the face's stems are. */
export const guessFaceWeight = (face: GlyphFace): 400 | 700 => {
  for (const char of STEM_GLYPHS) {
    const shape = face.glyphs.get(char);
    if (shape && shape.commands.length > 0) {
      const stem = shape.box[2] - shape.box[0];
      return stem >= BOLD_STEM_EM ? 700 : 400;
    }
  }
  return 400;
};

const styleCache = new WeakMap<GlyphFace, FigmaFallbackStyle>();

/** The substitute style for a Figma face; the same for preview and export. */
export const figmaFallbackStyle = (face: GlyphFace): FigmaFallbackStyle => {
  const cached = styleCache.get(face);
  if (cached) {
    return cached;
  }
  const inter = matchInterWeight(face);
  const style: FigmaFallbackStyle = {
    family: inter === null ? "liberation" : "inter",
    // Figma's TJ numbers tighten (positive) or loosen; letter spacing is the reverse.
    letterSpacingEm: -face.tracking / TJ_UNITS_PER_EM,
    weight: inter ?? guessFaceWeight(face),
  };
  styleCache.set(face, style);
  return style;
};

/**
 * The substitute style for a Figma run whose own glyphs can't spell its
 * text. Null for other runs, and when the run's own glyphs can be used.
 */
export const figmaFallbackFor = (
  pages: readonly EditorPage[],
  page: Pick<EditorPage, "id" | "sourceRotate">,
  run: Pick<
    PdfTextObject,
    "captionUnderline" | "invisibleGlyphs" | "rotation" | "showOrdinal" | "text"
  >
): FigmaFallbackStyle | null => {
  if (run.invisibleGlyphs !== true || rebuiltGlyphLayout(pages, page, run)) {
    return null;
  }
  const face = resolveGlyphFace(pages, page.id, run);
  return face ? figmaFallbackStyle(face) : null;
};

/** Inter weights an export needs, so only those font files are fetched. */
export const interWeightsNeeded = (
  pages: readonly EditorPage[],
  isDirty: (run: PdfTextObject) => boolean
): Set<InterWeight> => {
  const weights = new Set<InterWeight>();
  for (const page of pages) {
    for (const run of page.pdfTextObjects) {
      if (run.invisibleGlyphs !== true || !isDirty(run)) {
        continue;
      }
      const style = figmaFallbackFor(pages, page, run);
      if (style?.family === "inter" && style.weight !== 700) {
        weights.add(style.weight);
      }
    }
  }
  return weights;
};
