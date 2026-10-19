import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { PDFDict, PDFDocument } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { createRedactionObject } from "@/lib/editor/object-utils";
import type { EditorDocument, EditorPage, Rect } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import { flattenRedactedPages } from "@/lib/pdf/export-flatten";
import { exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import { renderRedactedPages } from "@/lib/pdf/flatten-redacted-pages";
import type { FlattenDeps } from "@/lib/pdf/flatten-redacted-pages";
import { documentHasRedactions, redactionPlan } from "@/lib/pdf/output-pages";
import { pdfSession } from "@/lib/pdf/session";
import { failedRedactions } from "@/lib/pdf/verify-redaction";
import type { VerifyOps } from "@/lib/pdf/verify-redaction";

import { loadPdfJsDocument } from "./pdfjs-node";

export interface NodeCanvas {
  encode: (format: "jpeg", quality: number) => Promise<Uint8Array>;
  getContext: (kind: "2d") => CanvasRenderingContext2D;
}

/** The napi-rs canvas package, loaded the way pdf.js loads it in Node. */
export const napiCanvas = async (): Promise<{
  createCanvas: (width: number, height: number) => NodeCanvas;
}> => {
  const pdfjs = await realpath(
    path.join(process.cwd(), "node_modules/pdfjs-dist/package.json")
  );
  // SAFETY: the package's documented createCanvas export.
  return createRequire(pdfjs)("@napi-rs/canvas") as {
    createCanvas: (width: number, height: number) => NodeCanvas;
  };
};

const JPEG_QUALITY = 92;

export const nodeDeps = async (): Promise<FlattenDeps<NodeCanvas>> => {
  const { createCanvas } = await napiCanvas();
  return {
    createCanvas: (width, height) => {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    },
    encodeJpeg: async (canvas) =>
      new Uint8Array(await canvas.encode("jpeg", JPEG_QUALITY)),
    open: async (bytes) => {
      const task = loadPdfJsDocument(bytes);
      const doc = await task.promise;
      return {
        destroy: () => task.destroy(),
        getPage: (pageNumber) => doc.getPage(pageNumber),
      };
    },
  };
};

export const nodeVerifyOps: VerifyOps = {
  paintImageMaskXObject: OPS.paintImageMaskXObject,
  paintImageXObject: OPS.paintImageXObject,
  paintInlineImageXObject: OPS.paintInlineImageXObject,
  restore: OPS.restore,
  save: OPS.save,
  transform: OPS.transform,
};

export interface RedactedExport {
  bytes: Uint8Array;
  /** Pages rebuilt from a picture. */
  flattened: number;
  /** Pages pass 1 left for flattening, before the safety net. */
  flattenPages: number[];
  /** Pages redacted in their own content. */
  precise: number;
  removedFieldNames: string[];
}

/**
 * The app's export (run-export.ts) with Node standing in for the browser:
 * pass 1, the safety net, then the flatten pass for what is left.
 */
export const redactingExport = async (
  bytes: Uint8Array,
  document: EditorDocument,
  options: {
    mode?: "apply" | "skip";
    ocrWordsByPage?: Record<string, OcrTextObject[]>;
    pageIds?: string[];
  } = {}
): Promise<RedactedExport> => {
  const plan = redactionPlan(document, options.pageIds);
  const pass1 = await exportDocumentWithReport({
    assets: {},
    bytes,
    document,
    fontBytes: {},
    ocrWordsByPage: options.ocrWordsByPage,
    pageIds: options.pageIds,
    redactions: options.mode ?? "apply",
    scrub: documentHasRedactions(document),
  });
  const deps = await nodeDeps();
  const flatten = new Set(pass1.flattenPages);
  const precise = plan.filter((page) => !flatten.has(page.outputIndex));
  const failed =
    precise.length > 0
      ? await failedRedactions(Uint8Array.from(pass1.bytes), precise, {
          open: deps.open,
          ops: nodeVerifyOps,
        })
      : [];
  for (const index of failed) {
    flatten.add(index);
  }
  const toFlatten = plan.filter((page) => flatten.has(page.outputIndex));
  const result = {
    flattenPages: pass1.flattenPages,
    precise: plan.length - toFlatten.length,
  };
  if (toFlatten.length === 0) {
    return {
      ...result,
      bytes: pass1.bytes,
      flattened: 0,
      removedFieldNames: pass1.removedFieldNames,
    };
  }
  const pages = await renderRedactedPages(
    Uint8Array.from(pass1.bytes),
    toFlatten,
    deps
  );
  const font = await readFile(
    path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
  );
  const report = await flattenRedactedPages({
    bytes: pass1.bytes,
    fontBytes: new Uint8Array(font),
    pages,
  });
  return {
    ...result,
    bytes: report.bytes,
    flattened: report.flattenedPageCount,
    removedFieldNames: [
      ...pass1.removedFieldNames,
      ...report.removedFieldNames,
    ].toSorted(),
  };
};

export const openPages = async (bytes: Uint8Array): Promise<EditorPage[]> => {
  const { pages } = await pdfSession.open(Uint8Array.from(bytes));
  return pages;
};

export const withBoxes = (
  page: EditorPage,
  ...boxes: { fill?: string; rect: Rect }[]
): EditorPage => ({
  ...page,
  objects: [
    ...page.objects,
    ...boxes.map(({ fill, rect }) => createRedactionObject(rect, fill)),
  ],
});

export const pageTexts = async (bytes: Uint8Array): Promise<string[]> => {
  const pdf = await loadPdfJsDocument(bytes).promise;
  const texts: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages in order
    const page = await pdf.getPage(number);
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages in order
    const content = await page.getTextContent();
    texts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replaceAll(/\s+/gu, " ")
        .trim()
    );
  }
  return texts;
};

/** RGBA pixels of page `number` at `scale`, with the canvas size. */
export const renderPixels = async (
  bytes: Uint8Array,
  number: number,
  { rotation, scale = 1 }: { rotation?: number; scale?: number } = {}
): Promise<{ data: Uint8ClampedArray; height: number; width: number }> => {
  const { createCanvas } = await napiCanvas();
  const pdf = await loadPdfJsDocument(bytes).promise;
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ rotation, scale });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({
    // SAFETY: pdf.js draws onto any 2D canvas; Node's is @napi-rs/canvas.
    canvas: canvas as never,
    canvasContext: context,
    viewport,
  }).promise;
  return {
    data: context.getImageData(0, 0, width, height).data,
    height,
    width,
  };
};

/** RGB at points of page `number`, rendered at scale 1 and `rotation`. */
export const pixelAt = async (
  bytes: Uint8Array,
  number: number,
  rotation: number,
  points: readonly { x: number; y: number }[]
): Promise<[number, number, number][]> => {
  const { data, width } = await renderPixels(bytes, number, { rotation });
  return points.map(({ x, y }) => {
    const index = (Math.round(y) * width + Math.round(x)) * 4;
    return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
  });
};

const PIXEL_TOLERANCE = 24;

export const near = (
  actual: readonly number[],
  expected: readonly number[]
): boolean =>
  actual.every(
    (value, index) =>
      Math.abs(value - (expected[index] ?? 0)) <= PIXEL_TOLERANCE
  );

export const center = (rect: Rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

export const infoKeys = async (bytes: Uint8Array): Promise<string[]> => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  return info instanceof PDFDict
    ? info.keys().map((key) => key.decodeText())
    : [];
};
