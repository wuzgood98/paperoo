import { PDFDocument, PDFName } from "pdf-lib";

export type FigmaFace = "regular" | "semibold";

/** What a Figma export puts in the Type3 text layer for one text node. */
export interface FigmaType3Run {
  face: FigmaFace;
  /** Fill of the visible outline path, as 0–1 gray (Figma uses an ICC gray-ish RGB). */
  gray: number;
  size: number;
  text: string;
  x: number;
  y: number;
}

export const FIGMA_HEADING: FigmaType3Run = {
  face: "semibold",
  gray: 0.1,
  size: 14.245655,
  text: "Structuring Data",
  x: 32,
  y: 502,
};

export const FIGMA_BODY: FigmaType3Run = {
  face: "regular",
  gray: 0.45,
  size: 8,
  text: "Take raw text.",
  x: 32,
  y: 487,
};

/** Top of the tallest stand-in glyph ink, in em above the baseline. */
export const FIGMA_INK_TOP_EM = 0.72;
const LOWERCASE_TOP_EM = 0.52;
const GLYPH_SIDE_BEARING = 0.02;
const SEMIBOLD_EXTRA_WIDTH = 0.03;
const BASE_WIDTH = 0.4;
const WIDTH_STEP = 0.025;
const WIDTH_BUCKETS = 9;
const SPACE_WIDTH = 0.25;

/**
 * A metrics-only glyph no run uses. Its d1 box makes the font's glyph-box
 * union 1.3 em tall, so pdf.js inflates each text item's height by 1.3× the
 * way it does for the Figma QA file's 1.306.
 */
const STRUT_BOX = [0, -0.24, 0.5, 1.06] as const;

export interface FigmaGlyph {
  box: readonly [number, number, number, number];
  width: number;
}

/** Each face draws each letter with its own width and box, like a real font. */
export const figmaGlyph = (face: FigmaFace, char: string): FigmaGlyph => {
  if (char === " ") {
    return { box: [0, 0, 0, 0], width: SPACE_WIDTH };
  }
  const code = char.codePointAt(0) ?? 0;
  const width =
    BASE_WIDTH +
    (code % WIDTH_BUCKETS) * WIDTH_STEP +
    (face === "semibold" ? SEMIBOLD_EXTRA_WIDTH : 0);
  const top = char === char.toLowerCase() ? LOWERCASE_TOP_EM : FIGMA_INK_TOP_EM;
  return {
    box: [GLYPH_SIDE_BEARING, 0, width - GLYPH_SIDE_BEARING, top],
    width,
  };
};

/** Advance of a run's text in em. */
export const figmaAdvanceEm = (run: FigmaType3Run): number =>
  [...run.text].reduce(
    (sum, char) => sum + figmaGlyph(run.face, char).width,
    0
  );

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

/** One rectangle subpath per glyph: the run's visible ink. */
const outlinePath = (run: FigmaType3Run): string => {
  const parts: string[] = [];
  let pen = 0;
  for (const char of run.text) {
    const { box, width } = figmaGlyph(run.face, char);
    const [llx, lly, urx, ury] = box;
    if (urx > llx) {
      const x0 = (pen + llx) * run.size;
      const x1 = (pen + urx) * run.size;
      const y0 = lly * run.size;
      const y1 = ury * run.size;
      parts.push(`${x0} ${y0} m ${x1} ${y0} l ${x1} ${y1} l ${x0} ${y1} l h`);
    }
    pen += width;
  }
  return `${parts.join(" ")} f`;
};

interface Occurrence {
  char: string;
  glyph: FigmaGlyph;
}

const showRun = (run: FigmaType3Run, firstCode: number): string => {
  const encoded = [...run.text]
    .map(
      (_char, index) => `\\${(firstCode + index).toString(8).padStart(3, "0")}`
    )
    .join("");
  const ink = `${run.gray} ${run.gray} ${run.gray} rg`;
  return [
    `q 1 0 0 1 ${run.x} ${run.y} cm ${ink} ${outlinePath(run)} Q`,
    `q 1 0 0 1 ${run.x} ${run.y} cm BT ${run.size} 0 0 ${run.size} 0 0 Tm /F1 1 Tf (${encoded}) Tj ET Q`,
  ].join("\n");
};

/**
 * One page laid out like a Figma export: each text node is a filled outline
 * path (one subpath per glyph) followed by invisible Type3 text (`d1`-only
 * CharProcs, FontMatrix [1 0 0 1 0 0], FontBBox [0 0 0 0], `Tf` size 1, the
 * real size in `Tm`). Like Figma, every glyph occurrence gets its own code.
 */
export const buildFigmaType3Fixture = async (
  runs: readonly FigmaType3Run[] = [FIGMA_HEADING, FIGMA_BODY],
  /** Raw content drawn after the runs, e.g. artwork beside a heading. */
  extraContent = ""
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]);
  const { context } = doc;

  const occurrences: Occurrence[] = runs.flatMap((run) =>
    [...run.text].map((char) => ({ char, glyph: figmaGlyph(run.face, char) }))
  );
  const strutCode = occurrences.length;

  const charProcs = context.obj({});
  const addProc = (code: number, glyph: FigmaGlyph): void => {
    const [llx, lly, urx, ury] = glyph.box;
    const proc = context.flateStream(
      `${glyph.width} 0 ${llx} ${lly} ${urx} ${ury} d1`
    );
    charProcs.set(PDFName.of(`C${code}`), context.register(proc));
  };
  for (const [code, { glyph }] of occurrences.entries()) {
    addProc(code, glyph);
  }
  addProc(strutCode, { box: STRUT_BOX, width: STRUT_BOX[2] });

  const codeCount = strutCode + 1;
  const font = context.obj({
    CharProcs: charProcs,
    Encoding: context.obj({
      Differences: [
        0,
        ...Array.from({ length: codeCount }, (_unused, code) =>
          PDFName.of(`C${code}`)
        ),
      ],
      Type: "Encoding",
    }),
    FirstChar: 0,
    FontBBox: [0, 0, 0, 0],
    FontMatrix: [1, 0, 0, 1, 0, 0],
    LastChar: strutCode,
    Resources: context.obj({}),
    Subtype: "Type3",
    ToUnicode: context.register(
      context.flateStream(
        toUnicodeCMap([...occurrences.map(({ char }) => char), "|"])
      )
    ),
    Type: "Font",
    Widths: [...occurrences.map(({ glyph }) => glyph.width), STRUT_BOX[2]],
  });
  page.node.setFontDictionary(PDFName.of("F1"), context.register(font));

  let nextCode = 0;
  const shows = runs.map((run) => {
    const content = showRun(run, nextCode);
    nextCode += run.text.length;
    return content;
  });
  const content = context.flateStream([...shows, extraContent].join("\n"));
  page.node.set(PDFName.of("Contents"), context.register(content));

  return new Uint8Array(await doc.save());
};
