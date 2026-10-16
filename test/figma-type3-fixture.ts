import { PDFDocument, PDFName } from "pdf-lib";

/** What a Figma export puts in the Type3 text layer for one text node. */
export interface FigmaType3Run {
  /** Fill of the visible outline path, as 0–1 gray (Figma uses an ICC gray-ish RGB). */
  gray: number;
  size: number;
  text: string;
  x: number;
  y: number;
}

export const FIGMA_HEADING: FigmaType3Run = {
  gray: 0.1,
  size: 14.245655,
  text: "Structuring Data",
  x: 32,
  y: 502,
};

export const FIGMA_BODY: FigmaType3Run = {
  gray: 0.45,
  size: 8,
  text: "Take raw text.",
  x: 32,
  y: 487,
};

/** Glyph advance in text space units (FontMatrix is identity, not 1/1000). */
export const GLYPH_WIDTH = 0.55;
/**
 * Every glyph's d1 box spans this height, so pdf.js inflates each text item's
 * height by it (1.3×) the way it does for the Figma QA file's 1.306.
 */
const GLYPH_BOTTOM = -0.24;
const GLYPH_TOP = 1.06;

const hex = (code: number): string => code.toString(16).padStart(2, "0");

const toUnicodeCMap = (chars: readonly string[]): string => {
  const entries = chars
    .map(
      (char, code) =>
        `<${hex(code)}> <${char.codePointAt(0)?.toString(16).padStart(4, "0")}>`
    )
    .join("\n");
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (FigmaPDF) /Ordering (FigmaPDF) /Supplement 0 >> def",
    "/CMapName /A-B-C def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    `${chars.length} beginbfchar`,
    entries,
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
};

/** Top of the stand-in glyph ink, in em above the baseline. */
export const FIGMA_INK_TOP_EM = 0.72;

/** A box standing in for the run's glyph outlines (the visible ink). */
const outlinePath = (run: FigmaType3Run): string => {
  const width = run.text.length * GLYPH_WIDTH * run.size;
  const height = run.size * FIGMA_INK_TOP_EM;
  return `0 0 m ${width} 0 l ${width} ${height} l 0 ${height} l h f`;
};

const showRun = (
  run: FigmaType3Run,
  codes: ReadonlyMap<string, number>
): string => {
  const encoded = [...run.text]
    .map((char) => `\\${(codes.get(char) ?? 0).toString(8).padStart(3, "0")}`)
    .join("");
  const ink = `${run.gray} ${run.gray} ${run.gray} rg`;
  return [
    `q 1 0 0 1 ${run.x} ${run.y} cm ${ink} ${outlinePath(run)} Q`,
    `q 1 0 0 1 ${run.x} ${run.y} cm BT ${run.size} 0 0 ${run.size} 0 0 Tm /F1 1 Tf (${encoded}) Tj ET Q`,
  ].join("\n");
};

/**
 * One page laid out like a Figma export: each text node is a filled outline
 * path followed by invisible Type3 text (`d1`-only CharProcs, FontMatrix
 * [1 0 0 1 0 0], FontBBox [0 0 0 0], `Tf` size 1, the real size in `Tm`).
 */
export const buildFigmaType3Fixture = async (
  runs: readonly FigmaType3Run[] = [FIGMA_HEADING, FIGMA_BODY],
  /** Raw content drawn after the runs, e.g. artwork beside a heading. */
  extraContent = ""
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]);
  const { context } = doc;

  const chars = [...new Set(runs.flatMap((run) => [...run.text]))];
  const codes = new Map(chars.map((char, code) => [char, code]));

  const charProcs = context.obj({});
  for (const [code] of chars.entries()) {
    const proc = context.flateStream(
      `${GLYPH_WIDTH} 0 0 ${GLYPH_BOTTOM} ${GLYPH_WIDTH} ${GLYPH_TOP} d1`
    );
    charProcs.set(PDFName.of(`C${code}`), context.register(proc));
  }

  const font = context.obj({
    CharProcs: charProcs,
    Encoding: context.obj({
      Differences: [0, ...chars.map((_char, code) => PDFName.of(`C${code}`))],
      Type: "Encoding",
    }),
    FirstChar: 0,
    FontBBox: [0, 0, 0, 0],
    FontMatrix: [1, 0, 0, 1, 0, 0],
    LastChar: chars.length - 1,
    Resources: context.obj({}),
    Subtype: "Type3",
    ToUnicode: context.register(context.flateStream(toUnicodeCMap(chars))),
    Type: "Font",
    Widths: chars.map(() => GLYPH_WIDTH),
  });
  page.node.setFontDictionary(PDFName.of("F1"), context.register(font));

  const content = context.flateStream(
    [...runs.map((run) => showRun(run, codes)), extraContent].join("\n")
  );
  page.node.set(PDFName.of("Contents"), context.register(content));

  return new Uint8Array(await doc.save());
};
