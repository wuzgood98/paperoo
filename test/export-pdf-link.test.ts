import { readFile } from "node:fs/promises";
import path from "node:path";

import { AnnotationMode, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { pdfTextMatrixOrigin } from "@/lib/editor/coordinates";
import type { TextItemTransform } from "@/lib/editor/coordinates";
import {
  pdfLinkActionsEqual,
  pdfLinkBoxAfterLabel,
  pdfLinkOverlappingTextRuns,
} from "@/lib/editor/object-utils";
import type { EditorDocument, PdfLinkAnnotation } from "@/lib/editor/types";
import { DEFAULT_PDF_TEXT_COLOR } from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { extractPdfAnnotationObjects } from "@/lib/pdf/extract-annotations";
import {
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import {
  extractPdfTextPaints,
  toPdfTextColorOps,
  zipPdfTextItemPaints,
} from "@/lib/pdf/extract-text-colors";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import {
  annotHasUri,
  buildBlueLinkCaptionFixture,
  buildPdfAnnotationFixture,
  countPageAnnotSubtypes,
} from "./pdf-annotation-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const editorDocumentFromBytes = async (
  bytes: Uint8Array,
  options: { withVectorsAndColors?: boolean } = {}
): Promise<EditorDocument> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const rawAnnotations = await page.getAnnotations({ intent: "display" });
  const textContent = await page.getTextContent();
  const operatorList = options.withVectorsAndColors
    ? await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE })
    : null;
  const cropBox = { height: 792, width: 612, x: 0, y: 0 };
  const extractPage = { cropBox, id: "page-1", sourceRotate: 0 as const };
  const { objects } = extractPdfAnnotationObjects(rawAnnotations, extractPage);
  const extractableText = toExtractableTextContent(textContent);
  const itemPaints =
    operatorList === null
      ? undefined
      : zipPdfTextItemPaints(
          extractableText.items,
          extractPdfTextPaints(operatorList, toPdfTextColorOps(OPS)),
          DEFAULT_PDF_TEXT_COLOR
        ).paints;
  const pdfTextObjects = extractPdfTextObjects(
    extractableText,
    extractPage,
    undefined,
    itemPaints
  );
  const pdfVectorObjects =
    operatorList === null
      ? []
      : extractPdfVectorObjects(operatorList, extractPage, toPdfVectorOps(OPS));
  return {
    pages: [
      {
        cropBox,
        height: 792,
        id: "page-1",
        objects: [],
        pdfAnnotationObjects: objects,
        pdfImageObjects: [],
        pdfTextObjects,
        pdfVectorObjects,
        rotation: 0,
        skippedPdfAnnotationSubtypes: [],
        sourceIndex: 0,
        sourceRotate: 0,
        width: 612,
      },
    ],
  };
};

const captionFillColor = async (
  bytes: Uint8Array,
  caption: string
): Promise<string | undefined> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  const operatorList = await page.getOperatorList({
    annotationMode: AnnotationMode.DISABLE,
  });
  const extractable = toExtractableTextContent(textContent);
  const { paints } = zipPdfTextItemPaints(
    extractable.items,
    extractPdfTextPaints(operatorList, toPdfTextColorOps(OPS)),
    DEFAULT_PDF_TEXT_COLOR
  );
  for (const [index, item] of extractable.items.entries()) {
    if (item.str?.includes(caption)) {
      return paints[index]?.color;
    }
  }
  return undefined;
};

const isTextItemTransform = (
  value: readonly unknown[]
): value is TextItemTransform =>
  value.length >= 6 &&
  value.slice(0, 6).every((entry) => Number.isFinite(entry));

const captionBaselineY = async (
  bytes: Uint8Array,
  caption: string
): Promise<number | undefined> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    if ("str" in item && item.str?.includes(caption) && "transform" in item) {
      if (!isTextItemTransform(item.transform)) {
        continue;
      }
      return pdfTextMatrixOrigin(item.transform).y;
    }
  }
  return undefined;
};

const liberationSansBytes = async (): Promise<Uint8Array> =>
  new Uint8Array(
    await readFile(
      path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
    )
  );

test("extract stores originalAction on URI links", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const document = await editorDocumentFromBytes(bytes);
  const link = document.pages[0]?.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  expect(link).toBeDefined();
  if (!link) {
    return;
  }
  expect(pdfLinkActionsEqual(link.action, link.originalAction)).toBe(true);
});

test("export writes edited URL and label text", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const base = await editorDocumentFromBytes(bytes);
  const [page] = base.pages;
  if (!page) {
    throw new Error("missing page");
  }
  const link = page.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  if (!link) {
    throw new Error("missing uri link");
  }

  const editedLink: PdfLinkAnnotation = {
    ...link,
    action: { kind: "url", url: "https://example.com/updated" },
    label: "New label",
  };
  const textRuns = page.pdfTextObjects.map((object) =>
    object.text.includes("Click") ? { ...object, text: "New label" } : object
  );

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      pages: [
        {
          ...page,
          pdfAnnotationObjects: page.pdfAnnotationObjects.map((object) =>
            object.id === link.id ? editedLink : object
          ),
          pdfTextObjects: textRuns,
        },
      ],
    },
    fontBytes: {},
  });

  expect(await annotHasUri(output, "https://example.com/updated")).toBe(true);
  const subtypes = await countPageAnnotSubtypes(output, 0);
  expect(subtypes.get("Widget")).toBe(1);

  const task = loadPdfJsDocument(output);
  const pdf = await task.promise;
  const exportedPage = await pdf.getPage(1);
  const text = await exportedPage.getTextContent();
  const combined = text.items
    .map((item) => ("str" in item ? item.str : ""))
    .join("");
  expect(combined).toContain("New label");
});

test("export keeps blue fill after link label edit", async () => {
  const bytes = await buildBlueLinkCaptionFixture();
  const base = await editorDocumentFromBytes(bytes, {
    withVectorsAndColors: true,
  });
  const [page] = base.pages;
  if (!page) {
    throw new Error("missing page");
  }
  const link = page.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  if (!link) {
    throw new Error("missing uri link");
  }
  const primary = page.pdfTextObjects.find((object) =>
    object.text.includes("Old caption")
  );
  if (!primary) {
    throw new Error("missing caption run");
  }
  const runs = pdfLinkOverlappingTextRuns(link, page.pdfTextObjects);
  const overlapping = runs.length > 0 ? runs : [primary];
  const nextLabel = "New caption";
  const box = pdfLinkBoxAfterLabel(link, primary, nextLabel);
  const editedLink: PdfLinkAnnotation = { ...link, ...box, label: nextLabel };
  const overlapIds = new Set(overlapping.map((run) => run.id));
  const textRuns = page.pdfTextObjects.map((object) => {
    if (object.id === primary.id) {
      return {
        ...object,
        captionFill: "#0000ff",
        captionUnderline: {
          color: "#0000ff",
          offsetFromRunTop: primary.height * 0.92,
          thickness: 1,
        },
        text: nextLabel,
      };
    }
    if (overlapIds.has(object.id)) {
      return { ...object, text: "" };
    }
    return object;
  });

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      pages: [
        {
          ...page,
          pdfAnnotationObjects: page.pdfAnnotationObjects.map((object) =>
            object.id === link.id ? editedLink : object
          ),
          pdfTextObjects: textRuns,
        },
      ],
    },
    fontBytes: {},
  });

  expect(await captionFillColor(output, nextLabel)).toBe("#0000ff");
});

test("export keeps the original caption baseline after a label edit", async () => {
  const bytes = await buildBlueLinkCaptionFixture();
  const base = await editorDocumentFromBytes(bytes, {
    withVectorsAndColors: true,
  });
  const [page] = base.pages;
  if (!page) {
    throw new Error("missing page");
  }
  const link = page.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation =>
      object.type === "pdf-link" && object.action.kind === "url"
  );
  if (!link) {
    throw new Error("missing uri link");
  }
  const primary = page.pdfTextObjects.find((object) =>
    object.text.includes("Old caption")
  );
  if (!primary) {
    throw new Error("missing caption run");
  }
  const originalBaseline = pdfTextMatrixOrigin(primary.transform).y;
  const runs = pdfLinkOverlappingTextRuns(link, page.pdfTextObjects);
  const overlapping = runs.length > 0 ? runs : [primary];
  const nextLabel = "New caption";
  const box = pdfLinkBoxAfterLabel(link, primary, nextLabel);
  const editedLink: PdfLinkAnnotation = { ...link, ...box, label: nextLabel };
  const overlapIds = new Set(overlapping.map((run) => run.id));
  const textRuns = page.pdfTextObjects.map((object) => {
    if (object.id === primary.id) {
      return {
        ...object,
        captionFill: "#0000ff",
        captionUnderline: {
          color: "#0000ff",
          offsetFromRunTop: primary.height * 0.92,
          thickness: 1,
        },
        text: nextLabel,
      };
    }
    if (overlapIds.has(object.id)) {
      return { ...object, text: "" };
    }
    return object;
  });

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      pages: [
        {
          ...page,
          pdfAnnotationObjects: page.pdfAnnotationObjects.map((object) =>
            object.id === link.id ? editedLink : object
          ),
          pdfTextObjects: textRuns,
        },
      ],
    },
    fontBytes: {
      [FONT_FILES.sans[400]]: await liberationSansBytes(),
    },
  });

  expect(await captionBaselineY(output, nextLabel)).toBeCloseTo(
    originalBaseline
  );
});
