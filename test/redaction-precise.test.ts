import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { createTextObject } from "@/lib/editor/object-utils";
import type { EditorPage, Rect } from "@/lib/editor/types";
import { redactionFontFor } from "@/lib/pdf/redaction-fonts";
import { pdfSession } from "@/lib/pdf/session";
import { failedRedactions } from "@/lib/pdf/verify-redaction";

import { buildFigmaType3Fixture, FIGMA_HEADING } from "./figma-type3-fixture";
import { buildPdfFormFixture, FORM_FIELD } from "./pdf-form-fixture";
import { pdfContainsText } from "./pdf-scan";
import {
  center,
  infoKeys,
  near,
  nodeDeps,
  nodeVerifyOps,
  openPages,
  pageTexts,
  pixelAt,
  redactingExport,
  renderPixels,
  withBoxes,
} from "./redaction-pipeline";

afterEach(async () => {
  await pdfSession.close();
});

const PAGE_HEIGHT = 792;
const LETTER: [number, number] = [612, PAGE_HEIGHT];

/** A displayed (top-left origin) rect from user-space edges. */
const displayed = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  height: y1 - y0,
  width: x1 - x0,
  x: x0,
  y: PAGE_HEIGHT - y1,
});

const firstPage = async (bytes: Uint8Array): Promise<EditorPage> => {
  const [page] = await openPages(bytes);
  if (!page) {
    throw new Error("No page");
  }
  return page;
};

/** Pages built with pdf-lib, with raw content where a test needs it. */
const pdfWith = async (
  draw: (page: PDFPage, doc: PDFDocument) => Promise<void> | void
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  await draw(doc.addPage(LETTER), doc);
  return new Uint8Array(await doc.save());
};

const rawContent = (page: PDFPage, doc: PDFDocument, content: string): void => {
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.flateStream(content))
  );
};

const helvetica = async (page: PDFPage, doc: PDFDocument): Promise<PDFFont> => {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of("F1"), font.ref);
  return font;
};

/** Scale for pixel comparisons. */
const SCALE = 2;
/** Pixels around a box that may differ (its antialiased edge). */
const EDGE = 3;
const PIXEL_DIFF = 40;

/** Pixels outside every box that differ between two renders of page 1. */
const changedOutside = async (
  before: Uint8Array,
  after: Uint8Array,
  boxes: readonly Rect[]
): Promise<number> => {
  const [a, b] = await Promise.all([
    renderPixels(before, 1, { scale: SCALE }),
    renderPixels(after, 1, { scale: SCALE }),
  ]);
  const inBox = (x: number, y: number): boolean =>
    boxes.some(
      (box) =>
        x >= box.x * SCALE - EDGE &&
        x <= (box.x + box.width) * SCALE + EDGE &&
        y >= box.y * SCALE - EDGE &&
        y <= (box.y + box.height) * SCALE + EDGE
    );
  let changed = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (inBox(x, y)) {
        continue;
      }
      const index = (y * a.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const diff = Math.abs(
          (a.data[index + channel] ?? 0) - (b.data[index + channel] ?? 0)
        );
        if (diff > PIXEL_DIFF) {
          changed += 1;
          break;
        }
      }
    }
  }
  return changed;
};

const hasImageXObject = async (bytes: Uint8Array): Promise<boolean> => {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .some(([, object]) =>
      "dict" in object && object.dict instanceof PDFDict
        ? object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
        : false
    );
};

test("part of a run is removed in place; the rest stays text where it was", async () => {
  let box: Rect = { height: 0, width: 0, x: 0, y: 0 };
  const bytes = await pdfWith(async (page, doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Name: SECRET", { font, size: 18, x: 72, y: 700 });
    page.drawText("PUBLIC", { font, size: 18, x: 72, y: 600 });
    const start = 72 + font.widthOfTextAtSize("Name: ", 18);
    box = displayed(
      start + 1,
      694,
      start + font.widthOfTextAtSize("SECRET", 18) + 2,
      716
    );
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: box })],
  });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  const [text] = await pageTexts(result.bytes);
  expect(text).toContain("Name:");
  expect(text).toContain("PUBLIC");
  expect(text).not.toContain("SECRET");
  expect(await pdfContainsText(result.bytes, "SECRET")).toBe(false);
  expect(await hasImageXObject(result.bytes)).toBe(false);
  expect(await changedOutside(bytes, result.bytes, [box])).toBe(0);
  const [inside] = await pixelAt(result.bytes, 1, 0, [center(box)]);
  expect(inside && near(inside, [0, 0, 0])).toBe(true);
  expect(await infoKeys(result.bytes)).toEqual(["Producer"]);
});

test("TJ gaps, spacing, scaling, rise and quote operators keep later glyphs in place", async () => {
  const boxes: Rect[] = [];
  const bytes = await pdfWith(async (page, doc) => {
    const font = await helvetica(page, doc);
    const size = 12;
    const charSpacing = 1.5;
    const wordSpacing = 4;
    const scale = 0.9;
    const advance = (text: string): number =>
      [...text].reduce(
        (sum, char) =>
          sum +
          (font.widthOfTextAtSize(char, size) +
            charSpacing +
            (char === " " ? wordSpacing : 0)) *
            scale,
        0
      );
    rawContent(
      page,
      doc,
      [
        `BT /F1 ${size} Tf ${charSpacing} Tc ${wordSpacing} Tw 90 Tz 2 Ts 16 TL`,
        "72 600 Td [(Keep) -250 (HIDE) 120 (tail end)] TJ",
        "(HIDE row more) '",
        '3 1 (HIDE quoted row) "',
        "ET",
      ].join(" ")
    );
    const hideStart = 72 + advance("Keep") + 0.25 * size * scale;
    boxes.push(
      displayed(hideStart - 0.5, 599, hideStart + advance("HIDE") - 2, 611),
      displayed(70, 583, 72 + advance("HIDE") - 2, 595)
    );
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, ...boxes.map((rect) => ({ rect })))],
  });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  // pdf.js spaces out letters under character spacing; compare without.
  const [spaced = ""] = await pageTexts(result.bytes);
  const text = spaced.replaceAll(" ", "");
  expect(text).toContain("Keep");
  expect(text).toContain("tailend");
  expect(text).toContain("rowmore");
  expect(text).toContain("quotedrow");
  // The third line was not boxed.
  expect(text.match(/HIDE/gu)).toHaveLength(1);
  expect(await changedOutside(bytes, result.bytes, boxes)).toBe(0);
});

test("a Type0 Identity-H run is cut glyph by glyph", async () => {
  let box: Rect = { height: 0, width: 0, x: 0, y: 0 };
  const fontBytes = await readFile(
    path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
  );
  const bytes = await pdfWith(async (page, doc) => {
    const font = await doc.embedFont(fontBytes);
    page.drawText("Account 4111 0000 9999", { font, size: 16, x: 72, y: 700 });
    const start = 72 + font.widthOfTextAtSize("Account 4111 ", 16);
    box = displayed(
      start + 1,
      694,
      start + font.widthOfTextAtSize("0000", 16) - 1,
      716
    );
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: box })],
  });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  const [text] = await pageTexts(result.bytes);
  expect(text).toContain("Account 4111");
  expect(text).toContain("9999");
  expect(text).not.toContain("0000");
  expect(await changedOutside(bytes, result.bytes, [box])).toBe(0);
});

test("marked-content text describing a redacted run is dropped", async () => {
  const bytes = await pdfWith(async (page, doc) => {
    await helvetica(page, doc);
    rawContent(
      page,
      doc,
      "/Span <</ActualText (TOPSECRET)>> BDC BT /F1 18 Tf 72 700 Td (Hidden) Tj ET EMC " +
        "BT /F1 18 Tf 72 600 Td (Visible) Tj ET"
    );
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: displayed(60, 690, 200, 720) })],
  });

  expect(result.precise).toBe(1);
  expect(await pdfContainsText(result.bytes, "TOPSECRET")).toBe(false);
  expect(await pdfContainsText(result.bytes, "Hidden")).toBe(false);
  expect(await pageTexts(result.bytes)).toEqual(["Visible"]);
});

test("paths: covered ones go, rects and straight lines are cut, curves go whole", async () => {
  const box = displayed(200, 380, 300, 480);
  const bytes = await pdfWith((page, doc) => {
    rawContent(
      page,
      doc,
      [
        // A red band through the box: cut around it.
        "1 0 0 rg 100 400 300 50 re f",
        // A blue line through the box: cut around it.
        "0 0 1 RG 4 w 100 360 m 400 500 l S",
        // A green curve touching the box: removed whole.
        "0 1 0 RG 2 w 50 300 m 150 520 250 300 333.25 330 c S",
        // A path inside the box: removed, coordinates and all.
        "0 g 222.5 400 m 277.75 400 l 250 460 l h f",
      ].join(" ")
    );
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: box })],
  });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  const [band, line, curve, inside] = await pixelAt(result.bytes, 1, 0, [
    // Band, left of the box.
    { x: 150, y: PAGE_HEIGHT - 425 },
    // Line near its start, left of the box.
    { x: 110, y: PAGE_HEIGHT - 364.7 },
    // Curve near its start, far from the box.
    { x: 52, y: PAGE_HEIGHT - 304 },
    center(box),
  ]);
  expect(band && near(band, [255, 0, 0])).toBe(true);
  expect(line && near(line, [0, 0, 255])).toBe(true);
  expect(curve && near(curve, [255, 255, 255])).toBe(true);
  expect(inside && near(inside, [0, 0, 0])).toBe(true);
  expect(await pdfContainsText(result.bytes, "277.75")).toBe(false);
  expect(await pdfContainsText(result.bytes, "333.25")).toBe(false);
});

test("annotations and fields under a box are removed; others stay", async () => {
  const fixture = await PDFDocument.load(await buildPdfFormFixture());
  const [first] = fixture.getPages();
  if (!first) {
    throw new Error("No page");
  }
  const note = (y: number, contents: string) =>
    fixture.context.register(
      fixture.context.obj({
        Contents: PDFString.of(contents),
        Rect: [400, y, 420, y + 20],
        Subtype: "Text",
        Type: "Annot",
      })
    );
  first.node.addAnnot(note(720, "Under the box"));
  first.node.addAnnot(note(100, "Out in the open"));
  const bytes = new Uint8Array(
    await fixture.save({ updateFieldAppearances: false })
  );
  const [page1, page2] = await openPages(bytes);
  if (!(page1 && page2)) {
    throw new Error("No pages");
  }
  // person.name's widget (72,720 200×20) and the first note.
  const box = displayed(68, 716, 430, 744);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page1, { rect: box }), page2],
  });

  expect(result.precise).toBe(1);
  expect(result.removedFieldNames).toEqual([FORM_FIELD.name]);
  expect(await pdfContainsText(result.bytes, "Gideon")).toBe(false);
  expect(await pdfContainsText(result.bytes, "Under the box")).toBe(false);
  expect(await pdfContainsText(result.bytes, "Out in the open")).toBe(true);
  const exported = await PDFDocument.load(result.bytes);
  const names = exported
    .getForm()
    .getFields()
    .map((field) => field.getName());
  expect(names).not.toContain(FORM_FIELD.name);
  expect(names).toContain(FORM_FIELD.bio);
});

test("what precise redaction cannot handle is flattened", async () => {
  const figma = await buildFigmaType3Fixture();
  const figmaPage = await firstPage(figma);
  const heading = figmaPage.pdfTextObjects.find(
    (run) => run.originalText === FIGMA_HEADING.text
  );
  expect(heading).toBeDefined();
  const type3 = await redactingExport(figma, {
    pages: [
      withBoxes(figmaPage, {
        rect: {
          height: heading?.height ?? 0,
          width: heading?.width ?? 0,
          x: heading?.x ?? 0,
          y: heading?.y ?? 0,
        },
      }),
    ],
  });
  expect(type3.flattenPages).toEqual([0]);
  expect(type3.flattened).toBe(1);
  await pdfSession.close();

  // A 4-bit image: not rewritten pixel by pixel.
  const imaged = await pdfWith((page, doc) => {
    const image = doc.context.register(
      doc.context.flateStream(new Uint8Array(8 * 16).fill(0x5a), {
        BitsPerComponent: 4,
        ColorSpace: "DeviceGray",
        Height: 16,
        Subtype: "Image",
        Type: "XObject",
        Width: 16,
      })
    );
    const key = page.node.newXObject("Im", image);
    rawContent(page, doc, `q 100 0 0 100 100 600 cm ${key.toString()} Do Q`);
  });
  const imagePage = await firstPage(imaged);
  const image = await redactingExport(imaged, {
    pages: [withBoxes(imagePage, { rect: displayed(120, 620, 160, 660) })],
  });
  expect(image.flattenPages).toEqual([0]);
  await pdfSession.close();

  const clipped = await pdfWith(async (page, doc) => {
    await helvetica(page, doc);
    rawContent(
      page,
      doc,
      "q BT /F1 48 Tf 7 Tr 72 700 Td (Mask) Tj ET 1 0 0 rg 0 0 612 792 re f Q"
    );
  });
  const clipPage = await firstPage(clipped);
  const clip = await redactingExport(clipped, {
    pages: [withBoxes(clipPage, { rect: displayed(70, 690, 200, 740) })],
  });
  expect(clip.flattenPages).toEqual([0]);
  await pdfSession.close();

  // A colour set between building a path and filling it: renderers still
  // fill the path, so it cannot be measured from the build operators.
  const interrupted = await pdfWith((page, doc) => {
    rawContent(page, doc, "200 400 100 50 re 1 0 0 rg f");
  });
  const interruptedPage = await firstPage(interrupted);
  const unmeasured = await redactingExport(interrupted, {
    pages: [
      withBoxes(interruptedPage, { rect: displayed(180, 380, 320, 470) }),
    ],
  });
  expect(unmeasured.flattenPages).toEqual([0]);
});

test("an overlay under a box sends the page to flattening", async () => {
  const bytes = await pdfWith(async (page, doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Plain", { font, size: 18, x: 72, y: 600 });
  });
  const page = await firstPage(bytes);
  const box = displayed(60, 690, 300, 730);
  const overlay = {
    ...createTextObject({ x: box.x + 10, y: box.y + 5 }),
    content: "Typed note",
  };

  const result = await redactingExport(bytes, {
    pages: [withBoxes({ ...page, objects: [overlay] }, { rect: box })],
  });

  expect(result.flattenPages).toEqual([0]);
  expect(await pageTexts(result.bytes)).toEqual(["Plain"]);
});

test("a font only the redacted text used leaves the file", async () => {
  const bytes = await pdfWith(async (page, doc) => {
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("Kept line", { font: regular, size: 18, x: 72, y: 600 });
    page.drawText("Secretname", { font: bold, size: 18, x: 72, y: 500 });
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: displayed(60, 490, 300, 525) })],
  });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  expect(await pageTexts(result.bytes)).toEqual(["Kept line"]);
  const reloaded = await PDFDocument.load(result.bytes);
  const [output] = reloaded.getPages();
  const fonts = output?.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  const baseFonts = (fonts?.values() ?? []).map((font) =>
    fonts?.context.lookup(font, PDFDict).get(PDFName.of("BaseFont"))?.toString()
  );
  expect(baseFonts.toSorted()).toEqual(["/Helvetica", "/Helvetica"]);
});

test("an image redacted on one page does not stay through another page's shared resources", async () => {
  const doc = await PDFDocument.create();
  const image = (fill: string) =>
    doc.context.register(
      doc.context.flateStream(fill.repeat(16).slice(0, 256), {
        BitsPerComponent: 8,
        ColorSpace: "DeviceGray",
        Height: 16,
        Subtype: "Image",
        Type: "XObject",
        Width: 16,
      })
    );
  const shared = doc.context.register(
    doc.context.obj({
      XObject: {
        Kept: image("KEPTIMAGEBYTES"),
        Secret: image("SECRETIMAGEBYTE"),
      },
    })
  );
  for (const name of ["Secret", "Kept"]) {
    const page = doc.addPage(LETTER);
    page.node.set(PDFName.of("Resources"), shared);
    rawContent(page, doc, `q 100 0 0 100 100 600 cm /${name} Do Q`);
  }
  const bytes = new Uint8Array(await doc.save());
  const [first, second] = await openPages(bytes);
  if (!(first && second)) {
    throw new Error("No pages");
  }

  const result = await redactingExport(bytes, {
    pages: [withBoxes(first, { rect: displayed(90, 590, 210, 710) }), second],
  });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  expect(await pdfContainsText(result.bytes, "SECRETIMAGEBYTE")).toBe(false);
  expect(await pdfContainsText(result.bytes, "KEPTIMAGEBYTES")).toBe(true);
});

test("a page with /UserUnit keeps text, page and boxes in one space", async () => {
  const bytes = await pdfWith(async (page, doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.node.set(PDFName.of("UserUnit"), doc.context.obj(2));
    page.drawText("Kept line", { font, size: 18, x: 72, y: 600 });
    page.drawText("Unitsecret", { font, size: 18, x: 72, y: 500 });
  });
  const page = await firstPage(bytes);
  expect(page).toMatchObject({ height: PAGE_HEIGHT, width: 612 });
  const secret = page.pdfTextObjects.find(
    (run) => run.originalText === "Unitsecret"
  );
  if (!secret) {
    throw new Error("No secret run");
  }

  // The box is drawn where the run shows on the page.
  const result = await redactingExport(bytes, {
    pages: [
      withBoxes(page, {
        rect: {
          height: secret.height,
          width: secret.width,
          x: secret.x,
          y: secret.y,
        },
      }),
    ],
  });

  expect(await pageTexts(result.bytes)).toEqual(["Kept line"]);
  expect(await pdfContainsText(result.bytes, "Unitsecret")).toBe(false);
});

test("Type3 glyphs painted far from the pen are still seen near a box", async () => {
  // Each glyph paints a square 3 to 4 em above its pen position.
  const bytes = await pdfWith((page, doc) => {
    const { context } = doc;
    const glyph = context.register(
      context.flateStream("1000 0 0 3000 1000 4000 d1 0 3000 1000 1000 re f")
    );
    const font = context.register(
      context.obj({
        CharProcs: { a: glyph },
        Encoding: { Differences: [97, PDFName.of("a")], Type: "Encoding" },
        FirstChar: 97,
        FontBBox: [0, 3000, 1000, 4000],
        FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        LastChar: 97,
        Resources: {},
        Subtype: "Type3",
        Type: "Font",
        Widths: [1000],
      })
    );
    page.node.setFontDictionary(PDFName.of("T3"), font);
    rawContent(page, doc, "BT /T3 20 Tf 100 400 Td (aaa) Tj ET");
  });
  const page = await firstPage(bytes);

  // Over the ink, 60 to 80 pt above the baseline.
  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: displayed(95, 455, 170, 485) })],
  });

  expect(result.flattenPages).toEqual([0]);
});

test("a form without a BBox is treated as painting anywhere", async () => {
  const bytes = await pdfWith((page, doc) => {
    const form = doc.context.register(
      doc.context.flateStream("0 0 1 rg 10 10 m 40.125 30 l 20 5 l h f", {
        Subtype: "Form",
        Type: "XObject",
      })
    );
    const key = page.node.newXObject("Fm", form);
    rawContent(page, doc, `q 1 0 0 1 200 400 cm ${key.toString()} Do Q`);
  });
  const page = await firstPage(bytes);

  const result = await redactingExport(bytes, {
    pages: [withBoxes(page, { rect: displayed(205, 402, 245, 435) })],
  });

  expect(await pdfContainsText(result.bytes, "40.125")).toBe(false);
});

test("a deleted vector under a box is not repainted as its cover", async () => {
  const bytes = await pdfWith((page, doc) => {
    rawContent(
      page,
      doc,
      "0 0 1 RG 3 w 210 400 m 250 470 270 390 291.25 430 c S"
    );
  });
  const page = await firstPage(bytes);
  expect(page.pdfVectorObjects).toHaveLength(1);
  const deleted = {
    ...page,
    pdfVectorObjects: page.pdfVectorObjects.map((vector) => ({
      ...vector,
      deleted: true,
    })),
  };

  const result = await redactingExport(bytes, {
    pages: [withBoxes(deleted, { rect: displayed(180, 360, 320, 500) })],
  });

  expect(result.flattenPages).toEqual([0]);
  expect(await pdfContainsText(result.bytes, "291.25")).toBe(false);
});

test("the safety net catches text and images left under a box", async () => {
  const bytes = await pdfWith(async (page, doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Leftover", { font, size: 18, x: 72, y: 700 });
    page.drawText("Fine", { font, size: 18, x: 72, y: 400 });
  });
  const deps = await nodeDeps();
  const verify = (rect: Rect) =>
    failedRedactions(
      Uint8Array.from(bytes),
      [
        {
          boxes: [
            {
              fill: "#000000",
              height: rect.height,
              width: rect.width,
              x: rect.x,
              y: PAGE_HEIGHT - rect.y - rect.height,
            },
          ],
          outputIndex: 0,
        },
      ],
      { open: deps.open, ops: nodeVerifyOps }
    );

  expect(await verify(displayed(70, 695, 150, 720))).toEqual([0]);
  expect(await verify(displayed(300, 100, 400, 200))).toEqual([]);
});

test("only measurable fonts are supported", async () => {
  const { context } = await PDFDocument.create();

  expect(
    redactionFontFor(
      context.obj({ BaseFont: "Helvetica", Subtype: "Type1", Type: "Font" })
    )
  ).not.toBeNull();
  expect(
    redactionFontFor(context.obj({ Encoding: "Identity-V", Subtype: "Type0" }))
  ).toBeNull();
  expect(redactionFontFor(context.obj({ Subtype: "Type3" }))).toBeNull();
  expect(
    redactionFontFor(
      context.obj({
        BaseFont: "Helvetica",
        Encoding: { Differences: [65, "B"] },
        Subtype: "Type1",
      })
    )
  ).toBeNull();
});
