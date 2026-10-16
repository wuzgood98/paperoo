import { PDFDocument, rgb } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { IDENTITY_CTM } from "@/lib/editor/coordinates";
import { hitTestPdfVector } from "@/lib/editor/object-utils";
import type { OperatorArg } from "@/lib/pdf/extract-images";
import {
  classifyVectorKind,
  decodeDrawOps,
  DrawOPS,
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";
import type { PdfVectorOps } from "@/lib/pdf/extract-vectors";

import { loadPdfJsDocument } from "./pdfjs-node";

const FAKE_OPS = {
  clip: 10,
  closeEOFillStroke: 19,
  closeFillStroke: 18,
  closeStroke: 13,
  constructPath: 91,
  endPath: 28,
  eoClip: 11,
  eoFill: 15,
  eoFillStroke: 17,
  fill: 14,
  fillStroke: 16,
  paintFormXObjectBegin: 30,
  paintFormXObjectEnd: 31,
  restore: 2,
  save: 1,
  setFillCMYKColor: 50,
  setFillColor: 51,
  setFillColorN: 52,
  setFillGray: 53,
  setFillRGBColor: 54,
  setFillTransparent: 55,
  setGState: 56,
  setLineCap: 57,
  setLineJoin: 58,
  setLineWidth: 59,
  setStrokeCMYKColor: 60,
  setStrokeColor: 61,
  setStrokeColorN: 62,
  setStrokeGray: 63,
  setStrokeRGBColor: 64,
  setStrokeTransparent: 65,
  shadingFill: 66,
  stroke: 12,
  transform: 3,
} satisfies PdfVectorOps;

const pageMeta = {
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  id: "page-1",
  sourceRotate: 0 as const,
};

test("decodeDrawOps applies the CTM and classifyVectorKind detects lines and rects", () => {
  const line = decodeDrawOps(
    [DrawOPS.moveTo, 10, 20, DrawOPS.lineTo, 50, 20],
    IDENTITY_CTM
  );
  expect(line).toEqual([
    { type: "moveTo", x: 10, y: 20 },
    { type: "lineTo", x: 50, y: 20 },
  ]);
  expect(classifyVectorKind(line ?? [])).toBe("line");

  const rect = decodeDrawOps(
    [
      DrawOPS.moveTo,
      0,
      0,
      DrawOPS.lineTo,
      40,
      0,
      DrawOPS.lineTo,
      40,
      20,
      DrawOPS.lineTo,
      0,
      20,
      DrawOPS.closePath,
    ],
    IDENTITY_CTM
  );
  expect(classifyVectorKind(rect ?? [])).toBe("rect");
});

test("extractPdfVectorObjects accepts PDF.js hex stroke colors and typed arrays", () => {
  const buffer = new Float32Array([
    DrawOPS.moveTo,
    72,
    700,
    DrawOPS.lineTo,
    200,
    700,
  ]);
  const objects = extractPdfVectorObjects(
    {
      argsArray: [
        undefined,
        ["#0000ff"],
        [2],
        [[], 0],
        [FAKE_OPS.stroke, [buffer], new Float32Array([72, 700, 200, 700])],
        undefined,
      ],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.setStrokeRGBColor,
        FAKE_OPS.setLineWidth,
        999,
        FAKE_OPS.constructPath,
        FAKE_OPS.restore,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects).toHaveLength(1);
  expect(objects[0]?.stroke?.color).toBe("#0000ff");
  expect(objects[0]?.stroke?.width).toBe(2);
  expect(objects[0]?.kind).toBe("line");
});

test("extractPdfVectorObjects skips clipped and form-nested paths", () => {
  const buffer = new Float32Array([
    DrawOPS.moveTo,
    10,
    10,
    DrawOPS.lineTo,
    20,
    20,
  ]);
  const objects = extractPdfVectorObjects(
    {
      argsArray: [
        undefined,
        undefined,
        [FAKE_OPS.stroke, [buffer], [10, 10, 20, 20]],
        undefined,
        [1, 0, 0, 1, 0, 0],
        [FAKE_OPS.stroke, [buffer], [10, 10, 20, 20]],
        undefined,
      ],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.clip,
        FAKE_OPS.constructPath,
        FAKE_OPS.restore,
        FAKE_OPS.paintFormXObjectBegin,
        FAKE_OPS.constructPath,
        FAKE_OPS.paintFormXObjectEnd,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects).toHaveLength(0);
});

test("extractPdfVectorObjects reads vectors from a real PDF fixture", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  page.drawLine({
    color: rgb(0, 0, 1),
    end: { x: 200, y: 700 },
    start: { x: 72, y: 700 },
    thickness: 2,
  });
  page.drawRectangle({
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
    color: rgb(1, 0.8, 0),
    height: 40,
    width: 80,
    x: 72,
    y: 600,
  });
  page.drawLine({
    color: rgb(0, 0.5, 0),
    end: { x: 200, y: 500 },
    start: { x: 72, y: 550 },
    thickness: 1,
  });
  const page2 = source.addPage([612, 792]);
  page2.drawRectangle({
    color: rgb(0.9, 0.9, 0.9),
    height: 100,
    width: 100,
    x: 50,
    y: 50,
  });
  const bytes = await source.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const list = await pdfPage.getOperatorList();
  const objects = extractPdfVectorObjects(
    list,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    toPdfVectorOps(OPS)
  );
  await task.destroy();

  expect(objects.length).toBeGreaterThanOrEqual(2);
  expect(objects.some((object) => object.kind === "line")).toBe(true);
  expect(objects.some((object) => object.kind === "rect")).toBe(true);
});

const GOOGLE_DOCS_LINE_WIDTH = 4 / 3;
const GOOGLE_DOCS_SCALE = 0.75;

const strokedLine = (): readonly [number, Float32Array[], Float32Array] => [
  FAKE_OPS.stroke,
  [new Float32Array([DrawOPS.moveTo, 96, 100, DrawOPS.lineTo, 720, 100])],
  new Float32Array([96, 100, 720, 100]),
];

const extractWithGState = (gState: readonly OperatorArg[]) =>
  extractPdfVectorObjects(
    {
      argsArray: [
        undefined,
        [GOOGLE_DOCS_SCALE, 0, 0, GOOGLE_DOCS_SCALE, 0, 0],
        [gState],
        strokedLine(),
        undefined,
      ],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.transform,
        FAKE_OPS.setGState,
        FAKE_OPS.constructPath,
        FAKE_OPS.restore,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

test("extractPdfVectorObjects keeps paths after a Google Docs-style ExtGState", () => {
  const objects = extractWithGState([
    ["LW", GOOGLE_DOCS_LINE_WIDTH],
    ["LC", 1],
    ["LJ", 2],
    ["ML", 10],
    ["CA", 1],
    ["ca", 1],
    ["BM", "source-over"],
    ["SMask", false],
    ["D", [[], 0]],
  ]);

  expect(objects).toHaveLength(1);
  expect(objects[0]?.kind).toBe("line");
  expect(objects[0]?.stroke?.lineCap).toBe(1);
  expect(objects[0]?.stroke?.lineJoin).toBe(2);
  expect(objects[0]?.stroke?.width).toBeCloseTo(
    GOOGLE_DOCS_LINE_WIDTH * GOOGLE_DOCS_SCALE,
    5
  );
  expect(objects[0]?.width).toBeCloseTo(468, 5);
});

test.each([
  ["a soft mask", ["SMask", true]],
  ["zero stroke alpha", ["CA", 0]],
  ["zero fill alpha", ["ca", 0]],
  ["a non-normal blend mode", ["BM", "multiply"]],
  ["a font", ["Font", ["g_font_1", 12]]],
  ["a dash pattern", ["D", [[3, 2], 0]]],
  ["a transfer function", ["TR", [null, null, null, null]]],
  ["an unknown key", ["XX", 1]],
] as const)(
  "extractPdfVectorObjects skips paths after an ExtGState with %s",
  (_label, entry) => {
    expect(extractWithGState([["LW", 1], [...entry]])).toHaveLength(0);
  }
);

test("extractPdfVectorObjects keeps a stroke under constant stroke alpha", () => {
  const [line] = extractWithGState([["CA", 0.5]]);

  expect(line?.stroke?.opacity).toBe(0.5);
  expect(line?.originalStroke?.opacity).toBe(0.5);
});

test("extractPdfVectorObjects keeps a translucent fill with its alpha until restore", () => {
  const square = (): readonly [number, Float32Array[], Float32Array] => [
    FAKE_OPS.fill,
    [
      new Float32Array([
        DrawOPS.moveTo,
        10,
        10,
        DrawOPS.lineTo,
        30,
        10,
        DrawOPS.lineTo,
        30,
        30,
        DrawOPS.closePath,
      ]),
    ],
    new Float32Array([10, 10, 30, 30]),
  ];
  const objects = extractPdfVectorObjects(
    {
      argsArray: [
        undefined,
        [[["ca", 0.8]]],
        ["#1a1a1a"],
        square(),
        undefined,
        square(),
      ],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.setGState,
        FAKE_OPS.setFillRGBColor,
        FAKE_OPS.constructPath,
        FAKE_OPS.restore,
        FAKE_OPS.constructPath,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects.map((object) => object.fill)).toEqual([
    { color: "#1a1a1a", opacity: 0.8 },
    { color: "#000000" },
  ]);
});

test("extractPdfVectorObjects drops an unsafe ExtGState at restore", () => {
  const objects = extractPdfVectorObjects(
    {
      argsArray: [
        undefined,
        [[["BM", "multiply"]]],
        strokedLine(),
        undefined,
        strokedLine(),
      ],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.setGState,
        FAKE_OPS.constructPath,
        FAKE_OPS.restore,
        FAKE_OPS.constructPath,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects).toHaveLength(1);
  expect(objects[0]?.sourceIndex).toBe(4);
});

test("extractPdfVectorObjects keeps lines but skips curved miter strokes under a non-default miter limit", () => {
  const curve = [
    FAKE_OPS.stroke,
    [
      new Float32Array([
        DrawOPS.moveTo,
        0,
        0,
        DrawOPS.curveTo,
        10,
        40,
        30,
        40,
        40,
        0,
      ]),
    ],
    new Float32Array([0, 0, 40, 40]),
  ];
  const objects = extractPdfVectorObjects(
    {
      argsArray: [[[["ML", 4]]], strokedLine(), curve],
      fnArray: [
        FAKE_OPS.setGState,
        FAKE_OPS.constructPath,
        FAKE_OPS.constructPath,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  expect(objects.map((object) => object.kind)).toEqual(["line"]);
});

test("extractPdfVectorObjects keeps form fills only as unselectable form content", () => {
  const filledSquare = (): readonly [number, Float32Array[], Float32Array] => [
    FAKE_OPS.fill,
    [
      new Float32Array([
        DrawOPS.moveTo,
        10,
        10,
        DrawOPS.lineTo,
        30,
        10,
        DrawOPS.lineTo,
        30,
        30,
        DrawOPS.closePath,
      ]),
    ],
    new Float32Array([10, 10, 30, 30]),
  ];
  const objects = extractPdfVectorObjects(
    {
      argsArray: [
        [
          [1, 0, 0, 1, 0, 0],
          [0, 0, 100, 100],
        ],
        filledSquare(),
        strokedLine(),
        undefined,
      ],
      fnArray: [
        FAKE_OPS.paintFormXObjectBegin,
        FAKE_OPS.constructPath,
        FAKE_OPS.constructPath,
        FAKE_OPS.paintFormXObjectEnd,
      ],
    },
    pageMeta,
    FAKE_OPS
  );

  // The stroke stays in the form; the fill is kept for text recognition.
  expect(objects).toHaveLength(1);
  expect(objects[0]?.formNested).toBe(true);
  const inside = { x: 20, y: 772 };
  expect(
    hitTestPdfVector(objects, inside, pageMeta.cropBox, 0)
  ).toBeUndefined();
  expect(
    hitTestPdfVector(
      objects.map((object) => ({ ...object, formNested: false })),
      inside,
      pageMeta.cropBox,
      0
    )
  ).toBeDefined();
});
