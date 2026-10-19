import type { UserRect } from "@/lib/pdf/output-pages";

/** A PDF matrix `[a b c d e f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export interface Point2 {
  x: number;
  y: number;
}

/** Axis-aligned bounds: min/max corners. */
export interface Bounds2 {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `left × right`: apply `left` first, then `right` (PDF order). */
export const multiply = (left: Matrix, right: Matrix): Matrix => {
  const [a, b, c, d, e, f] = left;
  const [A, B, C, D, E, F] = right;
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ];
};

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

export const apply = (matrix: Matrix, x: number, y: number): Point2 => {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
};

export const invert = (matrix: Matrix): Matrix | null => {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < Number.EPSILON) {
    return null;
  }
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
};

/** How far one unit can stretch under the matrix (its larger axis scale). */
export const maxScale = (matrix: Matrix): number => {
  const [a, b, c, d] = matrix;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d));
};

const AXIS_EPSILON = 1e-9;

/** True when the matrix keeps rectangles axis-aligned (no rotation or skew). */
export const isAxisAligned = (matrix: Matrix): boolean => {
  const [a, b, c, d] = matrix;
  return (
    (Math.abs(b) < AXIS_EPSILON && Math.abs(c) < AXIS_EPSILON) ||
    (Math.abs(a) < AXIS_EPSILON && Math.abs(d) < AXIS_EPSILON)
  );
};

export const boundsOf = (points: readonly Point2[]): Bounds2 => ({
  maxX: Math.max(...points.map((point) => point.x)),
  maxY: Math.max(...points.map((point) => point.y)),
  minX: Math.min(...points.map((point) => point.x)),
  minY: Math.min(...points.map((point) => point.y)),
});

/** Bounds of a rect `[x0, y0]–[x1, y1]` mapped through a matrix. */
export const mappedBounds = (
  matrix: Matrix,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Bounds2 =>
  boundsOf([
    apply(matrix, x0, y0),
    apply(matrix, x1, y0),
    apply(matrix, x1, y1),
    apply(matrix, x0, y1),
  ]);

export const inflate = (bounds: Bounds2, by: number): Bounds2 => ({
  maxX: bounds.maxX + by,
  maxY: bounds.maxY + by,
  minX: bounds.minX - by,
  minY: bounds.minY - by,
});

export const rectBounds = (rect: UserRect): Bounds2 => ({
  maxX: rect.x + rect.width,
  maxY: rect.y + rect.height,
  minX: rect.x,
  minY: rect.y,
});

/** The two share some area (touching edges do not count). */
export const overlaps = (a: Bounds2, b: Bounds2): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

export const contains = (outer: Bounds2, inner: Bounds2): boolean =>
  inner.minX >= outer.minX &&
  inner.minY >= outer.minY &&
  inner.maxX <= outer.maxX &&
  inner.maxY <= outer.maxY;

/** `rect` minus `hole`: up to four rects that cover the rest exactly. */
export const subtractRect = (rect: Bounds2, hole: Bounds2): Bounds2[] => {
  if (!overlaps(rect, hole)) {
    return [rect];
  }
  const pieces: Bounds2[] = [];
  const top = Math.min(rect.maxY, hole.maxY);
  const bottom = Math.max(rect.minY, hole.minY);
  if (hole.minY > rect.minY) {
    pieces.push({ ...rect, maxY: hole.minY });
  }
  if (hole.maxY < rect.maxY) {
    pieces.push({ ...rect, minY: hole.maxY });
  }
  if (hole.minX > rect.minX) {
    pieces.push({ ...rect, maxX: hole.minX, maxY: top, minY: bottom });
  }
  if (hole.maxX < rect.maxX) {
    pieces.push({ ...rect, maxY: top, minX: hole.maxX, minY: bottom });
  }
  return pieces;
};

/** A straight segment between two points. */
export interface Segment {
  from: Point2;
  to: Point2;
}

/**
 * The parts of a segment outside a rect (Liang–Barsky on the inside part):
 * zero, one or two pieces.
 */
export const segmentOutside = (segment: Segment, hole: Bounds2): Segment[] => {
  const { from, to } = segment;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let leave = 1;
  const edges: [number, number][] = [
    [-dx, from.x - hole.minX],
    [dx, hole.maxX - from.x],
    [-dy, from.y - hole.minY],
    [dy, hole.maxY - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) {
        return [segment];
      }
      continue;
    }
    const t = q / p;
    if (p < 0) {
      enter = Math.max(enter, t);
    } else {
      leave = Math.min(leave, t);
    }
  }
  if (enter >= leave) {
    return [segment];
  }
  const at = (t: number): Point2 => ({
    x: from.x + dx * t,
    y: from.y + dy * t,
  });
  const pieces: Segment[] = [];
  if (enter > 0) {
    pieces.push({ from, to: at(enter) });
  }
  if (leave < 1) {
    pieces.push({ from: at(leave), to });
  }
  return pieces;
};
