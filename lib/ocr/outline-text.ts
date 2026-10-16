import type { PdfPathCommand, PdfVectorObject } from "@/lib/editor/types";

/** A closed piece of an outline path, in user space (y up). */
export interface OutlineSubpath {
  commands: PdfPathCommand[];
  index: number;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface UserBox {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

/** One glyph of a recognized line: its subpaths and their combined box. */
export interface OutlineGlyph extends UserBox {
  char: string;
  subpaths: number[];
}

/** A recognized line before it becomes a text run. */
export interface OutlineLine {
  confidence: number;
  glyphs: OutlineGlyph[];
  subpaths: number[];
  text: string;
}

/** An OCR line mapped into the outline's user space. */
export interface OcrOutlineLine {
  box: UserBox;
  confidence: number;
  text: string;
}

/** Glyphs need at least this many subpaths before a path can be text. */
const MIN_TEXT_SUBPATHS = 3;
/** One glyph never spans most of a label. */
const MAX_GLYPH_SHARE = 0.6;
/** Taller subpaths than this (points) are art, not type. */
const MAX_GLYPH_HEIGHT = 200;
const MIN_LABEL_HEIGHT = 2;
/** Recognized text below this OCR confidence stays a vector. */
export const MIN_OUTLINE_CONFIDENCE = 80;
const MIN_LETTERS = 2;
/** Overlapping this share of the narrower box puts two subpaths in one glyph. */
const GLYPH_OVERLAP_SHARE = 0.5;
const LETTER = /\p{L}/gu;
const WHITESPACE = /\s/u;

/** Characters drawn as several side-by-side marks: how many glyph clusters each makes. */
const MULTI_MARK_CHARS = new Map([
  ['"', 2],
  ["“", 2],
  ["”", 2],
  ["„", 2],
  ["…", 3],
]);

const commandPoints = (
  command: PdfPathCommand
): readonly { x: number; y: number }[] => {
  switch (command.type) {
    case "moveTo":
    case "lineTo": {
      return [command];
    }
    case "curveTo": {
      return [
        { x: command.x1, y: command.y1 },
        { x: command.x2, y: command.y2 },
        { x: command.x3, y: command.y3 },
      ];
    }
    case "quadraticCurveTo": {
      return [{ x: command.x1, y: command.y1 }, command];
    }
    default: {
      return [];
    }
  }
};

const toSubpath = (
  commands: PdfPathCommand[],
  index: number
): OutlineSubpath | null => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const command of commands) {
    for (const point of commandPoints(command)) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return Number.isFinite(minX)
    ? { commands, index, maxX, maxY, minX, minY }
    : null;
};

const subpathCache = new WeakMap<readonly PdfPathCommand[], OutlineSubpath[]>();

/** Split a path at each moveTo. Indexes count every subpath, drawn or not. */
export const outlineSubpaths = (
  commands: readonly PdfPathCommand[]
): OutlineSubpath[] => {
  const cached = subpathCache.get(commands);
  if (cached) {
    return cached;
  }
  const groups: PdfPathCommand[][] = [];
  for (const command of commands) {
    const current = groups.at(-1);
    if (command.type === "moveTo" || !current) {
      groups.push([command]);
    } else {
      current.push(command);
    }
  }
  const subpaths: OutlineSubpath[] = [];
  for (const [index, group] of groups.entries()) {
    const subpath = toSubpath(group, index);
    if (subpath) {
      subpaths.push(subpath);
    }
  }
  subpathCache.set(commands, subpaths);
  return subpaths;
};

/** Below this extent (user units) a subpath has no ink. */
const MIN_INK_EXTENT = 1e-3;

/**
 * Subpaths that paint something. Figma marks each pen position with an
 * empty `m … h`; those are not glyphs.
 */
export const inkedSubpaths = (
  commands: readonly PdfPathCommand[]
): OutlineSubpath[] =>
  outlineSubpaths(commands).filter(
    (subpath) =>
      subpath.maxX - subpath.minX > MIN_INK_EXTENT ||
      subpath.maxY - subpath.minY > MIN_INK_EXTENT
  );

/** The commands of the chosen subpaths, in path order. */
export const pickSubpathCommands = (
  commands: readonly PdfPathCommand[],
  indexes: ReadonlySet<number>
): PdfPathCommand[] => {
  const picked: PdfPathCommand[] = [];
  for (const subpath of outlineSubpaths(commands)) {
    if (indexes.has(subpath.index)) {
      picked.push(...subpath.commands);
    }
  }
  return picked;
};

export const boxOf = (boxes: readonly UserBox[]): UserBox => ({
  maxX: Math.max(...boxes.map((box) => box.maxX)),
  maxY: Math.max(...boxes.map((box) => box.maxY)),
  minX: Math.min(...boxes.map((box) => box.minX)),
  minY: Math.min(...boxes.map((box) => box.minY)),
});

/**
 * A filled path that may be text drawn as outlines: several glyph-sized
 * pieces, none spanning most of the shape. OCR decides; this only keeps it
 * from running on every rectangle.
 */
export const isOutlineTextCandidate = (vector: PdfVectorObject): boolean => {
  if (
    vector.deleted ||
    vector.textInk === true ||
    vector.pageBackground === true ||
    vector.stroke !== null ||
    !vector.fill ||
    (vector.paint !== "fill" && vector.paint !== "eoFill")
  ) {
    return false;
  }
  const subpaths = inkedSubpaths(vector.commands);
  if (subpaths.length < MIN_TEXT_SUBPATHS) {
    return false;
  }
  const box = boxOf(subpaths);
  const width = box.maxX - box.minX;
  if (box.maxY - box.minY < MIN_LABEL_HEIGHT || width <= 0) {
    return false;
  }
  return subpaths.every(
    (subpath) =>
      subpath.maxX - subpath.minX <= width * MAX_GLYPH_SHARE &&
      subpath.maxY - subpath.minY <= MAX_GLYPH_HEIGHT
  );
};

const centerY = (box: UserBox): number => (box.minY + box.maxY) / 2;

/** The OCR line whose band holds the subpath, else the nearest one. */
const lineFor = (
  subpath: OutlineSubpath,
  lines: readonly OcrOutlineLine[]
): number => {
  const y = centerY(subpath);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, line] of lines.entries()) {
    const distance =
      y >= line.box.minY && y <= line.box.maxY
        ? 0
        : Math.min(Math.abs(y - line.box.minY), Math.abs(y - line.box.maxY));
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
};

const horizontalOverlap = (left: UserBox, right: UserBox): number =>
  Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);

/** Twice the signed area of a subpath's control polygon: its winding direction. */
const windingArea = (subpath: OutlineSubpath): number => {
  const points = subpath.commands.flatMap(commandPoints);
  let area = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length] ?? point;
    area += point.x * next.y - next.x * point.y;
  }
  return area;
};

/** Slack (user units) for containment and stacking tests. */
const GLYPH_TOLERANCE = 0.05;

const verticallyApart = (left: UserBox, right: UserBox): boolean =>
  left.minY >= right.maxY - GLYPH_TOLERANCE ||
  left.maxY <= right.minY + GLYPH_TOLERANCE;

const contains = (outer: UserBox, inner: UserBox): boolean =>
  inner.minX >= outer.minX - GLYPH_TOLERANCE &&
  inner.maxX <= outer.maxX + GLYPH_TOLERANCE &&
  inner.minY >= outer.minY - GLYPH_TOLERANCE &&
  inner.maxY <= outer.maxY + GLYPH_TOLERANCE;

interface GlyphCluster {
  box: UserBox;
  /** Winding of the cluster's first (outer) contour. */
  outerArea: number;
  subpaths: number[];
}

/** A dot or accent stacked over the glyph, or a counter cut out of it. */
const belongsTo = (
  cluster: GlyphCluster,
  subpath: OutlineSubpath,
  evenOdd: boolean
): boolean => {
  const narrower = Math.min(
    cluster.box.maxX - cluster.box.minX,
    subpath.maxX - subpath.minX
  );
  if (
    horizontalOverlap(cluster.box, subpath) <
    Math.max(narrower, 0) * GLYPH_OVERLAP_SHARE
  ) {
    return false;
  }
  if (verticallyApart(cluster.box, subpath)) {
    return true;
  }
  // Under nonzero fill a counter winds against its outer contour; a
  // neighbouring glyph kerned into the box (f then i) winds with it.
  return (
    contains(cluster.box, subpath) &&
    (evenOdd ||
      Math.sign(windingArea(subpath)) !== Math.sign(cluster.outerArea))
  );
};

/**
 * Group a line's subpaths into glyphs: dots and accents join the glyph they
 * sit over, counters join the glyph around them.
 */
export const clusterGlyphs = (
  subpaths: readonly OutlineSubpath[],
  evenOdd = false
): { box: UserBox; subpaths: number[] }[] => {
  const clusters: GlyphCluster[] = [];
  const ordered = subpaths.toSorted((left, right) => left.minX - right.minX);
  for (const subpath of ordered) {
    // Newest first: a counter belongs to the glyph just started, not to a
    // kerned neighbour whose box also holds it (o under T).
    const target = clusters.findLast((cluster) =>
      belongsTo(cluster, subpath, evenOdd)
    );
    if (target) {
      target.box = boxOf([target.box, subpath]);
      target.subpaths.push(subpath.index);
    } else {
      clusters.push({
        box: { ...subpath },
        outerArea: windingArea(subpath),
        subpaths: [subpath.index],
      });
    }
  }
  return clusters
    .toSorted((left, right) => left.box.minX - right.box.minX)
    .map(({ box, subpaths: indexes }) => ({ box, subpaths: indexes }));
};

/**
 * Pair a line's glyph clusters with the characters OCR read, in order. Null
 * when the counts disagree: the outline is not exactly that text.
 */
export const pairGlyphs = (
  clusters: readonly { box: UserBox; subpaths: number[] }[],
  text: string
): OutlineGlyph[] | null => {
  const chars = [...text].filter((char) => !WHITESPACE.test(char));
  const expected = chars.reduce(
    (total, char) => total + (MULTI_MARK_CHARS.get(char) ?? 1),
    0
  );
  if (expected !== clusters.length) {
    return null;
  }
  const glyphs: OutlineGlyph[] = [];
  let next = 0;
  for (const char of chars) {
    const marks = clusters.slice(
      next,
      next + (MULTI_MARK_CHARS.get(char) ?? 1)
    );
    next += marks.length;
    glyphs.push({
      ...boxOf(marks.map((mark) => mark.box)),
      char,
      subpaths: marks.flatMap((mark) => mark.subpaths),
    });
  }
  return glyphs;
};

/**
 * Turn OCR lines into recognized lines of the outline, top to bottom. Null
 * when the whole path is not confidently text: low confidence, too few
 * letters, or a line whose glyphs don't match what OCR read.
 */
export const recognizeOutlineLines = (
  vector: PdfVectorObject,
  ocrLines: readonly OcrOutlineLine[]
): OutlineLine[] | null => {
  const lines = ocrLines.filter((line) => line.text.trim() !== "");
  if (lines.length === 0) {
    return null;
  }
  const letters = lines.reduce(
    (total, line) => total + (line.text.match(LETTER)?.length ?? 0),
    0
  );
  const confidence =
    lines.reduce((total, line) => total + line.confidence, 0) / lines.length;
  if (letters < MIN_LETTERS || confidence < MIN_OUTLINE_CONFIDENCE) {
    return null;
  }
  const buckets: OutlineSubpath[][] = lines.map(() => []);
  for (const subpath of inkedSubpaths(vector.commands)) {
    buckets[lineFor(subpath, lines)]?.push(subpath);
  }
  const recognized: OutlineLine[] = [];
  for (const [index, line] of lines.entries()) {
    const subpaths = buckets[index] ?? [];
    const glyphs = pairGlyphs(
      clusterGlyphs(subpaths, vector.paint === "eoFill"),
      line.text.trim()
    );
    if (!glyphs || glyphs.length === 0) {
      return null;
    }
    recognized.push({
      confidence: line.confidence,
      glyphs,
      subpaths: subpaths.map((subpath) => subpath.index),
      text: line.text.trim(),
    });
  }
  return recognized.toSorted(
    (left, right) =>
      Math.max(...right.glyphs.map((glyph) => glyph.maxY)) -
      Math.max(...left.glyphs.map((glyph) => glyph.maxY))
  );
};
