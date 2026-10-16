import type {
  EditorPage,
  PdfGlyphShape,
  PdfGlyphShow,
  PdfTextObject,
} from "@/lib/editor/types";

/** The glyphs of one face, gathered from every Figma text block that uses it. */
export interface GlyphFace {
  /** One glyph per character; the run's own page wins. */
  glyphs: ReadonlyMap<string, PdfGlyphShape>;
  /** TJ adjustment (thousandths of an em) seen between two characters. */
  pairs: ReadonlyMap<string, number>;
  /** Typical TJ adjustment between characters with no learned pair. */
  tracking: number;
}

export interface PlacedGlyph {
  shape: PdfGlyphShape;
  /** Pen position in em. */
  x: number;
}

export interface GlyphLayout {
  /** TJ adjustment before each glyph (thousandths of an em). */
  adjustments: number[];
  glyphs: PlacedGlyph[];
  /** Advance of the whole text in em. */
  width: number;
}

const TJ_UNITS_PER_EM = 1000;
const PAIR_SEPARATOR = "\u0000";

const pairKey = (left: string, right: string): string =>
  `${left}${PAIR_SEPARATOR}${right}`;

interface LocatedShow {
  page: EditorPage;
  show: PdfGlyphShow;
}

const inkKeys = (page: EditorPage, show: PdfGlyphShow): string[] =>
  show.glyphs.filter(
    (key) => (page.type3Glyphs?.shapes[key]?.commands.length ?? 0) > 0
  );

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Text blocks of the run's face: start from the glyphs the run's own block
 * drew, then add every block that shares an inked glyph, until stable.
 * Spaces carry no ink, so they never join two faces.
 */
const faceShows = (
  pages: readonly EditorPage[],
  seed: LocatedShow
): LocatedShow[] => {
  const all: LocatedShow[] = pages.flatMap((page) =>
    (page.type3Glyphs?.shows ?? []).map((show) => ({ page, show }))
  );
  const keys = new Set(inkKeys(seed.page, seed.show));
  const included = new Set<LocatedShow>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const located of all) {
      if (included.has(located)) {
        continue;
      }
      const shared =
        located === seed ||
        inkKeys(located.page, located.show).some((key) => keys.has(key));
      if (!shared) {
        continue;
      }
      included.add(located);
      for (const key of inkKeys(located.page, located.show)) {
        keys.add(key);
      }
      grew = true;
    }
  }
  // The run's own page first, so its glyphs win over identical ones elsewhere.
  return [...included].toSorted(
    (left, right) =>
      Number(right.page === seed.page) - Number(left.page === seed.page)
  );
};

const collectFace = (shows: readonly LocatedShow[]): GlyphFace => {
  const glyphs = new Map<string, PdfGlyphShape>();
  const pairSamples = new Map<string, number[]>();
  const spacing: number[] = [];
  for (const { page, show } of shows) {
    const shapes = show.glyphs.map((key) => page.type3Glyphs?.shapes[key]);
    for (const [index, shape] of shapes.entries()) {
      if (!shape) {
        continue;
      }
      const known = glyphs.get(shape.unicode);
      if (
        !known ||
        (known.commands.length === 0 && shape.commands.length > 0)
      ) {
        glyphs.set(shape.unicode, shape);
      }
      const previous = index > 0 ? shapes[index - 1] : undefined;
      const adjustment = show.kerning[index] ?? 0;
      if (previous) {
        const key = pairKey(previous.unicode, shape.unicode);
        pairSamples.set(key, [...(pairSamples.get(key) ?? []), adjustment]);
        spacing.push(adjustment);
      }
    }
  }
  const pairs = new Map<string, number>();
  for (const [key, samples] of pairSamples) {
    pairs.set(key, median(samples));
  }
  return { glyphs, pairs, tracking: median(spacing) };
};

const faceCache = new WeakMap<
  readonly EditorPage[],
  Map<string, GlyphFace | null>
>();

/**
 * The face a Figma run was set in, rebuilt from glyphs cut from the
 * document's own outlines. Null when the run is not outline-backed or its
 * text block was not sliced.
 */
export const resolveGlyphFace = (
  pages: readonly EditorPage[],
  pageId: string,
  run: Pick<PdfTextObject, "invisibleGlyphs" | "showOrdinal">
): GlyphFace | null => {
  if (run.invisibleGlyphs !== true || run.showOrdinal === undefined) {
    return null;
  }
  const cacheKey = `${pageId}:${run.showOrdinal}`;
  const cache = faceCache.get(pages) ?? new Map<string, GlyphFace | null>();
  faceCache.set(pages, cache);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const page = pages.find((item) => item.id === pageId);
  const show = page?.type3Glyphs?.shows.find(
    (item) => item.showOrdinal === run.showOrdinal
  );
  const face =
    page && show ? collectFace(faceShows(pages, { page, show })) : null;
  cache.set(cacheKey, face);
  return face;
};

/** Characters of `text` the face has no glyph for, each listed once. */
export const missingGlyphs = (face: GlyphFace, text: string): string[] => [
  ...new Set([...text].filter((char) => !face.glyphs.has(char))),
];

/** Pen positions for `text` in the face, using the document's own spacing. */
export const layoutGlyphText = (
  face: GlyphFace,
  text: string
): GlyphLayout | null => {
  const glyphs: PlacedGlyph[] = [];
  const adjustments: number[] = [];
  let pen = 0;
  let previous: string | null = null;
  for (const char of text) {
    const shape = face.glyphs.get(char);
    if (!shape) {
      return null;
    }
    const adjustment =
      previous === null
        ? 0
        : (face.pairs.get(pairKey(previous, char)) ?? face.tracking);
    pen -= adjustment / TJ_UNITS_PER_EM;
    glyphs.push({ shape, x: pen });
    adjustments.push(adjustment);
    pen += shape.width;
    previous = char;
  }
  return { adjustments, glyphs, width: pen };
};

/** Upright runs only: rebuilt glyphs are laid out along +x. */
const UPRIGHT_EPSILON = 0.5;

/**
 * The run's new text laid out in its own rebuilt face, or null when the face
 * is unknown or lacks a character (the whole run then uses a substitute;
 * sources never mix within a run).
 */
export const rebuiltGlyphLayout = (
  pages: readonly EditorPage[],
  page: Pick<EditorPage, "id" | "sourceRotate">,
  run: Pick<
    PdfTextObject,
    "captionUnderline" | "invisibleGlyphs" | "rotation" | "showOrdinal" | "text"
  >
): GlyphLayout | null => {
  if (
    run.text === "" ||
    run.captionUnderline ||
    page.sourceRotate !== 0 ||
    Math.abs(run.rotation) > UPRIGHT_EPSILON
  ) {
    return null;
  }
  const face = resolveGlyphFace(pages, page.id, run);
  return face ? layoutGlyphText(face, run.text) : null;
};

const SVG_DIGITS = 3;

const svgNum = (value: number): string => {
  const fixed = value.toFixed(SVG_DIGITS);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/u, "") : fixed;
};

/**
 * SVG path data for a layout drawn at `size` points, origin at the baseline
 * start, y down (screen space).
 */
export const glyphLayoutSvgPath = (
  layout: GlyphLayout,
  size: number
): string => {
  const parts: string[] = [];
  const point = (penX: number, x: number, y: number): string =>
    `${svgNum((penX + x) * size)} ${svgNum(-y * size)}`;
  for (const { shape, x: penX } of layout.glyphs) {
    for (const command of shape.commands) {
      switch (command.type) {
        case "moveTo": {
          parts.push(`M${point(penX, command.x, command.y)}`);
          break;
        }
        case "lineTo": {
          parts.push(`L${point(penX, command.x, command.y)}`);
          break;
        }
        case "curveTo": {
          parts.push(
            `C${point(penX, command.x1, command.y1)} ${point(penX, command.x2, command.y2)} ${point(penX, command.x3, command.y3)}`
          );
          break;
        }
        case "closePath": {
          parts.push("Z");
          break;
        }
        default: {
          break;
        }
      }
    }
  }
  return parts.join("");
};

/** Inspector wording for which glyphs a dirty Figma run is drawn in. */
export const glyphSourceMessage = (
  face: GlyphFace | null,
  layout: GlyphLayout | null,
  text: string
): string => {
  if (layout) {
    return "Using the document's own glyphs.";
  }
  const missing = face ? missingGlyphs(face, text) : [];
  if (missing.length === 0) {
    return "The document's own glyphs can't be used here; using a substitute.";
  }
  const names = missing.map((char) => (char === " " ? "space" : `“${char}”`));
  return `Original glyphs missing for ${names.join(", ")}; using a substitute.`;
};
