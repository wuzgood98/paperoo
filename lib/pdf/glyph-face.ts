import type {
  EditorPage,
  PdfGlyphShape,
  PdfGlyphShow,
  PdfTextObject,
  PdfType3Glyphs,
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
  const all = pages.flatMap((page) =>
    (page.type3Glyphs?.shows ?? []).map((show) => ({
      ink: inkKeys(page, show),
      located: { page, show },
    }))
  );
  const keys = new Set(inkKeys(seed.page, seed.show));
  const included = new Set<LocatedShow>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const { ink, located } of all) {
      if (included.has(located)) {
        continue;
      }
      if (!ink.some((key) => keys.has(key))) {
        continue;
      }
      included.add(located);
      for (const key of ink) {
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
        const samples = pairSamples.get(key);
        if (samples) {
          samples.push(adjustment);
        } else {
          pairSamples.set(key, [adjustment]);
        }
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

interface FaceCacheEntry {
  faces: Map<string, GlyphFace | null>;
  glyphSets: readonly (PdfType3Glyphs | undefined)[];
  ids: readonly string[];
}

const faceCache = new WeakMap<readonly EditorPage[], FaceCacheEntry>();
let lastFaceEntry: FaceCacheEntry | null = null;

const sameGlyphSource = (
  entry: FaceCacheEntry,
  pages: readonly EditorPage[]
): boolean =>
  entry.ids.length === pages.length &&
  pages.every(
    (page, index) =>
      page.id === entry.ids[index] &&
      page.type3Glyphs === entry.glyphSets[index]
  );

/**
 * Faces depend only on page order and each page's sliced glyphs, which edits
 * never touch. Every edit makes a new `pages` array, so carry the last
 * document's faces over when its glyph sources are unchanged.
 */
const facesFor = (
  pages: readonly EditorPage[]
): Map<string, GlyphFace | null> => {
  const known = faceCache.get(pages);
  if (known) {
    return known.faces;
  }
  const entry =
    lastFaceEntry && sameGlyphSource(lastFaceEntry, pages)
      ? lastFaceEntry
      : {
          faces: new Map<string, GlyphFace | null>(),
          glyphSets: pages.map((page) => page.type3Glyphs),
          ids: pages.map((page) => page.id),
        };
  faceCache.set(pages, entry);
  lastFaceEntry = entry;
  return entry.faces;
};

/**
 * The face a Figma run was set in, rebuilt from glyphs cut from the
 * document's own outlines. Null when the run is not outline-backed or its
 * text block was not sliced. Outline-only text names a matched face's text
 * block in `glyphFace` instead of its own.
 */
export const resolveGlyphFace = (
  pages: readonly EditorPage[],
  runPageId: string,
  run: Pick<PdfTextObject, "glyphFace" | "invisibleGlyphs" | "showOrdinal">
): GlyphFace | null => {
  const pageId = run.glyphFace?.pageId ?? runPageId;
  const showOrdinal = run.glyphFace?.showOrdinal ?? run.showOrdinal;
  if (run.invisibleGlyphs !== true || showOrdinal === undefined) {
    return null;
  }
  const cacheKey = `${pageId}:${showOrdinal}`;
  const cache = facesFor(pages);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const page = pages.find((item) => item.id === pageId);
  const show = page?.type3Glyphs?.shows.find(
    (item) => item.showOrdinal === showOrdinal
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
    | "captionUnderline"
    | "glyphFace"
    | "invisibleGlyphs"
    | "rotation"
    | "showOrdinal"
    | "text"
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
  text: string,
  /** The substitute is Inter, because the face's widths match it. */
  approximatedWithInter = false
): string => {
  if (layout) {
    return "Using the document's own glyphs.";
  }
  const substitute = approximatedWithInter
    ? "approximated with Inter (Figma's default)"
    : "using a substitute";
  const missing = face ? missingGlyphs(face, text) : [];
  if (missing.length === 0) {
    return `The document's own glyphs can't be used here; ${substitute}.`;
  }
  const names = missing.map((char) => (char === " " ? "space" : `“${char}”`));
  return `Original glyphs missing for ${names.join(", ")}; ${substitute}.`;
};
