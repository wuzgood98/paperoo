import { deflateSync } from "node:zlib";

import {
  decodePDFRawStream,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import type { PDFPage, PDFRef } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import type { EditorPage, Rect } from "@/lib/editor/types";
import { pdfSession } from "@/lib/pdf/session";
import { failedRedactions } from "@/lib/pdf/verify-redaction";

import { pdfContainsText } from "./pdf-scan";
import {
  napiCanvas,
  near,
  nodeDeps,
  nodeVerifyOps,
  openPages,
  pageTexts,
  pixelAt,
  redactingExport,
  withBoxes,
} from "./redaction-pipeline";

afterEach(async () => {
  await pdfSession.close();
});

const PAGE_HEIGHT = 792;
const LETTER: [number, number] = [612, PAGE_HEIGHT];
const SIZE = 40;
/** The image's right half: a colour nothing else on the page has. */
const SECRET: [number, number, number] = [12, 200, 34];
const PUBLIC: [number, number, number] = [220, 120, 40];

/** Where every test draws its image: 200×200 at (100, 400). */
const PLACED = { size: 200, x: 100, y: 400 };

/** Displayed (top-left) rect from user-space edges. */
const displayed = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  height: y1 - y0,
  width: x1 - x0,
  x: x0,
  y: PAGE_HEIGHT - y1,
});

/** A box over the image's right half, a little inside its edges. */
const RIGHT_HALF = displayed(205, 390, 310, 610);

const LIGHT: [number, number, number] = [250, 250, 250];

/** RGB samples: left half PUBLIC, right half a SECRET/light checkerboard. */
const halves = (): Uint8Array => {
  const samples = new Uint8Array(SIZE * SIZE * 3);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const checker = (row + col) % 2 === 0 ? SECRET : LIGHT;
      const color = col < SIZE / 2 ? PUBLIC : checker;
      const index = (row * SIZE + col) * 3;
      const [red, green, blue] = color;
      samples[index] = red + (row % 3);
      samples[index + 1] = green;
      samples[index + 2] = blue + (col % 3);
    }
  }
  return samples;
};

/** PNG "Sub" rows: each row starts with filter byte 1. */
const pngSub = (samples: Uint8Array, rowBytes: number, pixel: number) => {
  const rows = samples.length / rowBytes;
  const out = new Uint8Array(rows * (rowBytes + 1));
  for (let row = 0; row < rows; row += 1) {
    out[row * (rowBytes + 1)] = 1;
    for (let index = 0; index < rowBytes; index += 1) {
      const value = samples[row * rowBytes + index] ?? 0;
      const left =
        index >= pixel ? (samples[row * rowBytes + index - pixel] ?? 0) : 0;
      out[row * (rowBytes + 1) + 1 + index] = (value - left + 256) % 256;
    }
  }
  return out;
};

const drawXObject = (
  doc: PDFDocument,
  page: PDFPage,
  name: string,
  ref: PDFRef
): void => {
  const key = page.node.newXObject(name, ref);
  const content = doc.context.register(
    doc.context.flateStream(
      `q ${PLACED.size} 0 0 ${PLACED.size} ${PLACED.x} ${PLACED.y} cm ${key.toString()} Do Q`
    )
  );
  page.node.set(PDFName.of("Contents"), content);
};

/** Two pages that draw the same image; only page 1 gets a box. */
const twoPagesWith = async (
  image: (doc: PDFDocument) => PDFRef | Promise<PDFRef>
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const ref = await image(doc);
  for (let index = 0; index < 2; index += 1) {
    drawXObject(doc, doc.addPage(LETTER), "Im1", ref);
  }
  return new Uint8Array(await doc.save());
};

const flateImage = (doc: PDFDocument, extra: { SMask?: PDFRef } = {}) =>
  doc.context.register(
    doc.context.stream(deflateSync(pngSub(halves(), SIZE * 3, 3)), {
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      DecodeParms: {
        BitsPerComponent: 8,
        Colors: 3,
        Columns: SIZE,
        Predictor: 15,
      },
      Filter: "FlateDecode",
      Height: SIZE,
      Subtype: "Image",
      Type: "XObject",
      Width: SIZE,
      ...extra,
    })
  );

const boxFirst = async (
  bytes: Uint8Array,
  rect: Rect = RIGHT_HALF
): Promise<EditorPage[]> => {
  const [first, ...rest] = await openPages(bytes);
  if (!first) {
    throw new Error("No page");
  }
  return [withBoxes(first, { rect }), ...rest];
};

/**
 * Every image XObject's decoded samples in the file. pdf-lib does not undo
 * predictors, so predicted images (the untouched originals here) are left out.
 */
const imageSamples = async (bytes: Uint8Array): Promise<Uint8Array[]> => {
  const doc = await PDFDocument.load(bytes);
  const found: Uint8Array[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") &&
      object.dict.get(PDFName.of("Filter")) !== PDFName.of("DCTDecode") &&
      !object.dict.has(PDFName.of("DecodeParms"))
    ) {
      found.push(decodePDFRawStream(object).decode());
    }
  }
  return found;
};

/** Image XObjects in the file, whatever their encoding. */
const imageCount = async (bytes: Uint8Array): Promise<number> => {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
    ).length;
};

const holdsSecret = (samples: Uint8Array): boolean => {
  for (let index = 0; index + 2 < samples.length; index += 3) {
    if (
      Math.abs((samples[index] ?? 0) - SECRET[0]) <= 3 &&
      samples[index + 1] === SECRET[1]
    ) {
      return true;
    }
  }
  return false;
};

/** A point inside the image's left (public) half, and inside the box. */
const LEFT_POINT = { x: 150, y: PAGE_HEIGHT - 500 };
const BOX_POINT = { x: 260, y: PAGE_HEIGHT - 500 };

test("an image under a box gets its pixels blanked in a copy of its own", async () => {
  const bytes = await twoPagesWith((doc) => flateImage(doc));
  const pages = await boxFirst(bytes);

  const result = await redactingExport(bytes, { pages });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  const [left, inBox] = await pixelAt(result.bytes, 1, 0, [
    LEFT_POINT,
    BOX_POINT,
  ]);
  expect(left && near(left, PUBLIC)).toBe(true);
  expect(inBox && near(inBox, [0, 0, 0])).toBe(true);
  // Page 2 still shows the original image: the edit was copy-on-write.
  const [secretOnTwo] = await pixelAt(result.bytes, 2, 0, [BOX_POINT]);
  expect(secretOnTwo && near(secretOnTwo, [0, 0, 0])).toBe(false);
  // The blanked copy (the original keeps its predictor) holds no secret pixel.
  const samples = await imageSamples(result.bytes);
  expect(samples).toHaveLength(1);
  expect(samples.filter(holdsSecret)).toHaveLength(0);
});

test("an image wholly under a box is no longer drawn or kept", async () => {
  const bytes = await twoPagesWith((doc) => flateImage(doc));
  const [first] = await openPages(bytes);
  if (!first) {
    throw new Error("No page");
  }

  const result = await redactingExport(
    bytes,
    { pages: [withBoxes(first, { rect: displayed(90, 390, 310, 610) })] },
    { pageIds: [first.id] }
  );

  expect(result.precise).toBe(1);
  expect(await imageCount(result.bytes)).toBe(0);
});

test("a soft mask and a stencil mask are blanked with their image", async () => {
  const bytes = await twoPagesWith((doc) => {
    const smask = doc.context.register(
      doc.context.flateStream(new Uint8Array(SIZE * SIZE).fill(200), {
        BitsPerComponent: 8,
        ColorSpace: "DeviceGray",
        Height: SIZE,
        Subtype: "Image",
        Type: "XObject",
        Width: SIZE,
      })
    );
    return flateImage(doc, { SMask: smask });
  });
  const pages = await boxFirst(bytes);

  const result = await redactingExport(bytes, { pages });

  expect(result.precise).toBe(1);
  const allSamples = await imageSamples(result.bytes);
  const masks = allSamples.filter((samples) => samples.length === SIZE * SIZE);
  // The original mask (page 2) and its blanked copy.
  expect(masks).toHaveLength(2);
  expect(masks.some((samples) => samples.includes(0))).toBe(true);

  const stencil = await twoPagesWith((doc) =>
    doc.context.register(
      doc.context.flateStream(new Uint8Array((SIZE / 8) * SIZE).fill(0), {
        BitsPerComponent: 1,
        Height: SIZE,
        ImageMask: true,
        Subtype: "Image",
        Type: "XObject",
        Width: SIZE,
      })
    )
  );
  await pdfSession.close();
  const stencilResult = await redactingExport(stencil, {
    pages: await boxFirst(stencil),
  });
  expect(stencilResult.precise).toBe(1);
  // A painted (0) stencil: under the box its bits are now "not painted".
  const [paintedLeft] = await pixelAt(stencilResult.bytes, 1, 0, [LEFT_POINT]);
  expect(paintedLeft && near(paintedLeft, [0, 0, 0])).toBe(true);
  const bits = await imageSamples(stencilResult.bytes);
  expect(bits.some((samples) => samples.some((byte) => byte !== 0))).toBe(true);
});

const jpegHalves = async (): Promise<Uint8Array> => {
  const { createCanvas } = await napiCanvas();
  const canvas = createCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d");
  context.fillStyle = `rgb(${PUBLIC.join(",")})`;
  context.fillRect(0, 0, SIZE / 2, SIZE);
  context.fillStyle = `rgb(${SECRET.join(",")})`;
  context.fillRect(SIZE / 2, 0, SIZE / 2, SIZE);
  return new Uint8Array(await canvas.encode("jpeg", 95));
};

test("a JPEG under a box is decoded, blanked and encoded again", async () => {
  const jpeg = await jpegHalves();
  const bytes = await twoPagesWith(async (doc) => {
    const embedded = await doc.embedJpg(jpeg);
    return embedded.ref;
  });

  const result = await redactingExport(bytes, { pages: await boxFirst(bytes) });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  const [left, inBox] = await pixelAt(result.bytes, 1, 0, [
    LEFT_POINT,
    BOX_POINT,
  ]);
  expect(left && near(left, PUBLIC)).toBe(true);
  expect(inBox && near(inBox, [0, 0, 0])).toBe(true);
  // The box is painted over it, so check the JPEG's own pixels under it.
  const deps = await nodeDeps();
  expect(
    await failedRedactions(
      Uint8Array.from(result.bytes),
      [
        {
          boxes: [{ fill: "#000000", height: 220, width: 105, x: 205, y: 390 }],
          outputIndex: 0,
        },
      ],
      { open: deps.open, ops: nodeVerifyOps }
    )
  ).toEqual([]);
  await pdfSession.close();

  const noCodec = await redactingExport(
    bytes,
    { pages: await boxFirst(bytes) },
    { noCodec: true }
  );
  expect(noCodec.flattenPages).toEqual([0]);
});

test("text in a form XObject is redacted in a copy of the form", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const inner = doc.addPage([300, 200]);
  inner.drawText("FORMSECRET", { font, size: 18, x: 20, y: 150 });
  inner.drawText("FORMPUBLIC", { font, size: 18, x: 20, y: 50 });
  const form = await doc.embedPage(inner);
  doc.removePage(0);
  for (let index = 0; index < 2; index += 1) {
    doc.addPage(LETTER).drawPage(form, { x: 100, y: 400 });
  }
  const bytes = new Uint8Array(await doc.save());
  // FORMSECRET sits at (120, 550) in page space.
  const pages = await boxFirst(bytes, displayed(110, 540, 260, 575));

  const result = await redactingExport(bytes, { pages });

  expect(result).toMatchObject({ flattened: 0, precise: 1 });
  const [first, second] = await pageTexts(result.bytes);
  expect(first).toContain("FORMPUBLIC");
  expect(first).not.toContain("FORMSECRET");
  expect(second).toContain("FORMSECRET");
});

test("an inline image under a box is removed whole", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER);
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(
      doc.context.stream(
        "q 100 0 0 100 100 500 cm BI /W 2 /H 2 /CS /G /BPC 8 ID wxyz EI Q"
      )
    )
  );
  const bytes = new Uint8Array(await doc.save());
  expect(await pdfContainsText(bytes, "wxyz")).toBe(true);

  const result = await redactingExport(bytes, {
    pages: await boxFirst(bytes, displayed(150, 550, 170, 570)),
  });

  expect(result.precise).toBe(1);
  expect(await pdfContainsText(result.bytes, "wxyz")).toBe(false);
});

test("pattern paint and unsupported image depths still flatten", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER);
  const pattern = doc.context.register(
    doc.context.flateStream("0 0 1 rg 0 0 5 5 re f", {
      BBox: [0, 0, 10, 10],
      PaintType: 1,
      PatternType: 1,
      Resources: {},
      TilingType: 1,
      XStep: 10,
      YStep: 10,
    })
  );
  page.node.set(
    PDFName.of("Resources"),
    doc.context.obj({ Pattern: { P1: pattern } })
  );
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(
      doc.context.flateStream("/Pattern cs /P1 scn 100 400 200 200 re f")
    )
  );
  const patterned = new Uint8Array(await doc.save());
  const patternResult = await redactingExport(patterned, {
    pages: await boxFirst(patterned),
  });
  expect(patternResult.flattenPages).toEqual([0]);
  await pdfSession.close();

  const fourBit = await twoPagesWith((pdf) =>
    pdf.context.register(
      pdf.context.flateStream(new Uint8Array((SIZE / 2) * SIZE).fill(0x5a), {
        BitsPerComponent: 4,
        ColorSpace: "DeviceGray",
        Height: SIZE,
        Subtype: "Image",
        Type: "XObject",
        Width: SIZE,
      })
    )
  );
  const fourBitResult = await redactingExport(fourBit, {
    pages: await boxFirst(fourBit),
  });
  expect(fourBitResult.flattenPages).toEqual([0]);
});

test("the safety net passes a blanked image and fails an untouched one", async () => {
  const bytes = await twoPagesWith((doc) => flateImage(doc));
  const deps = await nodeDeps();
  const plan = [
    {
      boxes: [{ fill: "#000000", height: 220, width: 105, x: 205, y: 390 }],
      outputIndex: 0,
    },
  ];
  expect(
    await failedRedactions(Uint8Array.from(bytes), plan, {
      open: deps.open,
      ops: nodeVerifyOps,
    })
  ).toEqual([0]);

  const result = await redactingExport(bytes, { pages: await boxFirst(bytes) });
  expect(
    await failedRedactions(Uint8Array.from(result.bytes), plan, {
      open: deps.open,
      ops: nodeVerifyOps,
    })
  ).toEqual([]);
});
