import path from "node:path";

import { PDFDocument, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, expect, test, vi } from "vitest";

import { pdfSession } from "@/lib/pdf/session";

import "./pdfjs-node";

const PAGE_SIZE = 200;
const SHADING_NAME = "Sh0";
const RED_MIN = 200;
const GREEN_MAX = 80;

/** Helvetica (not embedded) drawn with `7 Tr`, then filled by a red shading. */
const clipTextPdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_SIZE, PAGE_SIZE]);
  const font = doc.context.obj({
    BaseFont: "Helvetica",
    Encoding: "WinAnsiEncoding",
    Subtype: "Type1",
    Type: "Font",
  });
  const shading = doc.context.obj({
    ColorSpace: "DeviceRGB",
    Coords: [0, 0, PAGE_SIZE, 0],
    Function: {
      C0: [1, 0, 0],
      C1: [1, 0, 0],
      Domain: [0, 1],
      FunctionType: 2,
      N: 1,
    },
    ShadingType: 2,
  });
  page.node.set(
    PDFName.of("Resources"),
    doc.context.obj({
      Font: { F1: doc.context.register(font) },
      Shading: { [SHADING_NAME]: doc.context.register(shading) },
    })
  );
  const content = doc.context.stream(
    `q BT /F1 72 Tf 7 Tr 10 70 Td (HI) Tj ET /${SHADING_NAME} sh Q`
  );
  page.node.set(PDFName.of("Contents"), doc.context.register(content));
  return new Uint8Array(await doc.save());
};

interface NodeCanvasFactory {
  create: (
    width: number,
    height: number
  ) => { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
}

// Node's pdf.js reads font data with fs.readFile, so this must be a plain
// path rather than a file:// URL.
const standardFontDataUrl = `${path
  .join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")
  .replaceAll(path.sep, "/")}/`;

/** Count of red pixels after rendering page 1 at 1x. */
const redPixels = async (useSystemFonts: boolean): Promise<number> => {
  const task = getDocument({
    data: await clipTextPdf(),
    standardFontDataUrl,
    useSystemFonts,
    useWasm: false,
    useWorkerFetch: false,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    // SAFETY: pdf.js types canvasFactory as Object; in Node it is a
    // NodeCanvasFactory backed by @napi-rs/canvas.
    const factory = doc.canvasFactory as NodeCanvasFactory;
    const { canvas, context } = factory.create(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const { data } = context.getImageData(
      0,
      0,
      viewport.width,
      viewport.height
    );
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 0) > RED_MIN && (data[index + 1] ?? 0) < GREEN_MAX) {
        count += 1;
      }
    }
    return count;
  } finally {
    await task.destroy();
  }
};

afterEach(async () => {
  vi.restoreAllMocks();
  await pdfSession.close();
});

test("text in clip render mode clips a following shading to its glyphs", async () => {
  const painted = await redPixels(false);

  // "HI" at 72pt covers a few thousand pixels, far less than the whole page.
  expect(painted).toBeGreaterThan(500);
  expect(painted).toBeLessThan((PAGE_SIZE * PAGE_SIZE) / 2);
});

test("system fonts leave standard-14 text unable to clip", async () => {
  // Documents why the session must not use system fonts.
  expect(await redPixels(true)).toBe(0);
});

test("the session loads bundled standard-14 font data", async () => {
  const pdfjs = await import("@/lib/pdf/pdfjs");
  const spy = vi.spyOn(pdfjs, "getDocument");
  await pdfSession.open(await clipTextPdf());
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ useSystemFonts: false })
  );
});
