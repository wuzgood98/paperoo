import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { isPdfTextDirty } from "@/lib/editor/object-utils";
import type { EditorPage, PdfGlyphShape } from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  figmaFallbackFor,
  figmaFallbackStyle,
  guessFaceWeight,
  interWeightsNeeded,
  matchInterWeight,
} from "@/lib/pdf/figma-fallback";
import { glyphSourceMessage, resolveGlyphFace } from "@/lib/pdf/glyph-face";
import type { GlyphFace } from "@/lib/pdf/glyph-face";

import { extractFigmaPage } from "./figma-extract";
import { buildFigmaType3Fixture } from "./figma-type3-fixture";
import type { FigmaFace, FigmaType3Run } from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const SAMPLE = "Quick brown fox jumps";

const fixtureRun = (face: FigmaFace): FigmaType3Run => ({
  face,
  gray: 0.1,
  size: 14,
  text: SAMPLE,
  x: 32,
  y: 500,
});

/** A one-run Figma page in `face`, extracted like PdfSession does. */
const facePage = async (face: FigmaFace) => {
  const bytes = await buildFigmaType3Fixture([fixtureRun(face)]);
  const { page } = await extractFigmaPage(bytes);
  const [run] = page.pdfTextObjects;
  if (!run) {
    throw new Error("Fixture has no run.");
  }
  return { bytes, page, run };
};

const faceOf = async (face: FigmaFace): Promise<GlyphFace> => {
  const { page, run } = await facePage(face);
  const resolved = resolveGlyphFace([page], page.id, run);
  if (!resolved) {
    throw new Error("Fixture run has no face.");
  }
  return resolved;
};

test("a face with Inter's widths is matched to the right Inter weight", async () => {
  expect(matchInterWeight(await faceOf("inter-regular"))).toBe(400);
  expect(matchInterWeight(await faceOf("inter-semibold"))).toBe(600);
});

test("Inter 3.19 widths, from older Figma exports, also match", async () => {
  expect(matchInterWeight(await faceOf("inter-3-regular"))).toBe(400);
});

test("a face with other widths is not taken for Inter", async () => {
  expect(matchInterWeight(await faceOf("regular"))).toBeNull();
});

const stemFace = (stem: number): GlyphFace => {
  const shape: PdfGlyphShape = {
    box: [0.06, 0, 0.06 + stem, 0.72],
    commands: [{ type: "moveTo", x: 0.06, y: 0 }],
    key: "l",
    unicode: "l",
    width: 0.22,
  };
  return { glyphs: new Map([["l", shape]]), pairs: new Map(), tracking: 0 };
};

test("Liberation's weight is guessed from stem thickness", () => {
  // The QA PDF's body stems measure 0.078 em; its headings 0.12 em.
  expect(guessFaceWeight(stemFace(0.078))).toBe(400);
  expect(guessFaceWeight(stemFace(0.12))).toBe(700);
});

test("the fallback keeps the face's tracking as letter spacing", () => {
  const face = { ...stemFace(0.078), tracking: 10 };

  expect(figmaFallbackStyle(face).letterSpacingEm).toBeCloseTo(-0.01);
});

test("no fallback while the run's own glyphs can spell its text", async () => {
  const { page, run } = await facePage("inter-regular");

  expect(
    figmaFallbackFor([page], page, { ...run, text: "brown fox" })
  ).toBeNull();
  expect(
    figmaFallbackFor([page], page, { ...run, text: "brown dog" })?.family
  ).toBe("inter");
});

test("an export only fetches the Inter weight an edit needs", async () => {
  const { page, run } = await facePage("inter-semibold");
  const edited: EditorPage = {
    ...page,
    pdfTextObjects: [{ ...run, text: "Quick brown dog" }],
  };

  expect([...interWeightsNeeded([edited], isPdfTextDirty)]).toEqual([600]);
  expect([...interWeightsNeeded([page], isPdfTextDirty)]).toEqual([]);
});

/** Export one edit and return the PostScript name of the replacement's font. */
const exportedFontName = async (face: FigmaFace, text: string) => {
  const { bytes, page, run } = await facePage(face);
  const fontBytes: Record<string, Uint8Array> = {};
  for (const url of [
    FONT_FILES.inter[400],
    FONT_FILES.inter[600],
    FONT_FILES.sans[400],
    FONT_FILES.sans[700],
  ]) {
    fontBytes[url] = new Uint8Array(readFileSync(`public${url}`));
  }
  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages: [{ ...page, pdfTextObjects: [{ ...run, text }] }] },
    fontBytes,
  });
  const pdf = await loadPdfJsDocument(output).promise;
  const exported = await pdf.getPage(1);
  const [content] = await Promise.all([
    exported.getTextContent(),
    exported.getOperatorList(),
  ]);
  const item = content.items.find(
    (entry) => "str" in entry && entry.str === text
  );
  const fontId = item && "fontName" in item ? item.fontName : "";
  const font: { name?: string } | undefined = exported.commonObjs.has(fontId)
    ? exported.commonObjs.get(fontId)
    : undefined;
  return font?.name ?? "";
};

test("an Inter-width face falls back to embedded Inter", async () => {
  expect(await exportedFontName("inter-semibold", "Quick brown dog")).toMatch(
    /Inter-SemiBold/u
  );
});

test("any other face falls back to Liberation at its guessed weight", async () => {
  // The synthetic faces' stems are wide, so they read as bold.
  expect(await exportedFontName("regular", "Quick brown dog")).toMatch(
    /LiberationSans-Bold/u
  );
});

test("the inspector says when the substitute is Inter", () => {
  const face = stemFace(0.078);

  expect(glyphSourceMessage(face, null, "lK", true)).toBe(
    "Original glyphs missing for “K”; approximated with Inter (Figma's default)."
  );
});
