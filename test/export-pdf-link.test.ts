import { readFile } from "node:fs/promises";
import path from "node:path";

import { AnnotationMode, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, expect, test } from "vitest";

import { pdfTextMatrixOrigin } from "@/lib/editor/coordinates";
import type { TextItemTransform } from "@/lib/editor/coordinates";
import {
  pdfLinkActionsEqual,
  pdfLinkBoxAfterLabel,
  pdfLinkEditableLabel,
  pdfLinkOverlappingTextRuns,
  pdfLinkTextAppearance,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorDocument,
  EditorPage,
  PdfLinkAnnotation,
} from "@/lib/editor/types";
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
  buildSplitLinkCaptionFixture,
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

const splitLinkPage = async (): Promise<{
  bytes: Uint8Array;
  link: PdfLinkAnnotation;
  page: EditorPage;
}> => {
  const bytes = await buildSplitLinkCaptionFixture();
  const base = await editorDocumentFromBytes(bytes, {
    withVectorsAndColors: true,
  });
  const [page] = base.pages;
  const link = page?.pdfAnnotationObjects.find(
    (object): object is PdfLinkAnnotation => object.type === "pdf-link"
  );
  if (!(page && link)) {
    throw new Error("missing split link fixture");
  }
  return { bytes, link, page };
};

afterEach(() => {
  editorStore.clearDocument();
});

test("a link label ignores runs that only touch the link rect", async () => {
  const { link, page } = await splitLinkPage();
  const { label, runs } = pdfLinkEditableLabel(page, link);
  expect(label).toBe("https://bozomalabs.com");
  expect(runs.map((run) => run.text)).toEqual(["https://bozoma", "labs.com"]);
});

type OperatorList = Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>;

const FILL_OPS = new Set<number>([OPS.fill, OPS.eoFill]);

interface LabelPaintOrder {
  labelIndex: number;
  lastFillIndex: number;
}

/** Operator index of the `label` text show and of the last fill on the page. */
const labelPaintOrder = (
  list: OperatorList,
  label: string
): LabelPaintOrder => {
  let labelIndex = -1;
  let lastFillIndex = -1;
  for (const [index, fn] of list.fnArray.entries()) {
    const args = list.argsArray[index];
    if (!Array.isArray(args)) {
      continue;
    }
    const isFill =
      FILL_OPS.has(fn) || (fn === OPS.constructPath && FILL_OPS.has(args[0]));
    if (isFill) {
      lastFillIndex = index;
    }
    const isShow = fn === OPS.showText || fn === OPS.showSpacedText;
    if (isShow && Array.isArray(args[0])) {
      const shown = args[0].map((glyph) => glyph?.unicode ?? "").join("");
      if (shown === label) {
        labelIndex = index;
      }
    }
  }
  return { labelIndex, lastFillIndex };
};

test("a label edit across split runs paints every cover before the label", async () => {
  const { bytes, link, page } = await splitLinkPage();
  const [, second] = pdfLinkOverlappingTextRuns(link, page.pdfTextObjects);
  editorStore.resetDocument([page], "split.pdf");
  const nextLabel = "https://bozomalabs.coms";
  editorStore.commitPdfLinkLabel(nextLabel, null, {
    linkId: link.id,
    pageId: page.id,
  });
  const [edited] = editorStore.getState().document.pages;
  if (!edited) {
    throw new Error("missing edited page");
  }
  const emptied = edited.pdfTextObjects.find((run) => run.id === second?.id);
  expect(emptied?.text).toBe("");
  expect(emptied && pdfLinkTextAppearance(edited, emptied)).toBeNull();

  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages: [edited] },
    fontBytes: {
      [FONT_FILES.sans[400]]: await liberationSansBytes(),
    },
  });
  const pdf = await loadPdfJsDocument(output).promise;
  const exported = await pdf.getPage(1);
  const { labelIndex, lastFillIndex } = labelPaintOrder(
    await exported.getOperatorList({
      annotationMode: AnnotationMode.DISABLE,
    }),
    nextLabel
  );
  expect(labelIndex).toBeGreaterThan(-1);
  expect(lastFillIndex).toBeLessThan(labelIndex);
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
