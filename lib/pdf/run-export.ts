import { toastManager } from "@/components/ui/toast-manager";
import { isPdfTextDirty } from "@/lib/editor/object-utils";
import { pageRangeLabel } from "@/lib/editor/page-range";
import { pageDocId } from "@/lib/editor/page-source";
import { editorStore } from "@/lib/editor/store";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { ocrSession } from "@/lib/ocr/session";
import type {
  ExportWorkerRequest,
  FlattenWorkerRequest,
  WorkerRequest,
  WorkerResponse,
} from "@/lib/pdf/export.worker";
import { interWeightsNeeded } from "@/lib/pdf/figma-fallback";
import { renderRedactedPages } from "@/lib/pdf/flatten-redacted-pages";
import { documentHasRedactions, redactionPlan } from "@/lib/pdf/output-pages";
import { ensureDirtyPdfImageAssets } from "@/lib/pdf/pdf-image-preview";
import { pdfSession } from "@/lib/pdf/session";

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}`);
  }
  return response.arrayBuffer();
};

/** Bundled font files, fetched once per session; exports transfer copies. */
const fontCache = new Map<string, Promise<ArrayBuffer>>();

const cachedFontCopy = async (url: string): Promise<ArrayBuffer> => {
  let pending = fontCache.get(url);
  if (!pending) {
    pending = fetchBytes(url);
    fontCache.set(url, pending);
  }
  try {
    const buffer = await pending;
    return buffer.slice(0);
  } catch (error) {
    // A failed fetch is retried on the next export.
    fontCache.delete(url);
    throw error;
  }
};

export interface EditedPdf {
  bytes: ArrayBuffer;
  /** Edited runs whose old text could only be covered, not removed. */
  coverOnlyRunIds: string[];
  /** Pages rebuilt from a picture because they hold redactions. */
  flattenedPageCount: number;
  /** Form fields removed because a widget sat under a redaction. */
  removedFieldNames: string[];
}

type WorkerSuccess<Kind extends WorkerRequest["kind"]> = Extract<
  WorkerResponse,
  { kind: Kind; ok: true }
>;

/** One request to a fresh export worker, answered once. */
const callExportWorker = <Request extends WorkerRequest>(
  request: Request,
  transfer: Transferable[]
): Promise<WorkerSuccess<Request["kind"]>> => {
  const worker = new Worker(new URL("export.worker.ts", import.meta.url), {
    type: "module",
  });
  // oxlint-disable-next-line promise/avoid-new -- worker results arrive through message events
  return new Promise((resolve, reject) => {
    worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        worker.terminate();
        const { data } = event;
        if (data.ok && data.kind === request.kind) {
          // SAFETY: the worker answers each request with its own kind.
          resolve(data as WorkerSuccess<Request["kind"]>);
          return;
        }
        reject(new Error(data.ok ? "Export failed." : data.error));
      }
    );
    worker.addEventListener("error", () => {
      worker.terminate();
      reject(new Error("The export worker crashed."));
    });
    worker.postMessage(request, { transfer });
  });
};

export interface ExportOptions {
  /** Export only these pages (extract); all pages when unset. */
  pageIds?: readonly string[];
}

export const buildEditedPdfBytes = async ({
  pageIds,
}: ExportOptions = {}): Promise<EditedPdf> => {
  const state = editorStore.getState();
  const bytes = pdfSession.bytesOf(PRIMARY_DOC_ID);
  if (!bytes || state.document.pages.length === 0) {
    throw new Error("Open a PDF before exporting.");
  }

  editorStore.setExporting(true);

  try {
    const fontBytes: Record<string, ArrayBuffer> = {};
    const fontUrls: string[] = [
      FONT_FILES.sans[400],
      FONT_FILES.sans[700],
      FONT_FILES.sans.italic400,
      FONT_FILES.sans.italic700,
      // Inter only when a Figma edit's face proved to be Inter.
      ...[...interWeightsNeeded(state.document.pages, isPdfTextDirty)].map(
        (weight) => FONT_FILES.inter[weight]
      ),
    ];
    const buffers = await Promise.all(
      fontUrls.map((url) => cachedFontCopy(url))
    );
    for (const [index, url] of fontUrls.entries()) {
      const buffer = buffers[index];
      if (buffer) {
        fontBytes[url] = buffer;
      }
    }

    await ensureDirtyPdfImageAssets();

    // The store keeps its asset bytes: copy each once and transfer the copy.
    const assets: Record<string, { buffer: ArrayBuffer; mimeType: string }> =
      {};
    for (const [id, asset] of editorStore.getAssets()) {
      const copy = new Uint8Array(asset.bytes);
      assets[id] = {
        buffer: copy.buffer,
        mimeType: asset.mimeType,
      };
    }
    const transfer: ArrayBuffer[] = [
      ...Object.values(assets).map((asset) => asset.buffer),
      ...Object.values(fontBytes),
    ];

    // A copy: the export transfers it, and the session keeps its own.
    const exportBuffer = new Uint8Array(bytes).buffer;
    // Every other source document a page comes from (blank pages, merges).
    const sources: Record<string, ArrayBuffer> = {};
    for (const page of state.document.pages) {
      const docId = pageDocId(page);
      const source = pdfSession.bytesOf(docId);
      if (docId !== PRIMARY_DOC_ID && source && !(docId in sources)) {
        sources[docId] = new Uint8Array(source).buffer;
      }
    }
    const plan = redactionPlan(state.document, pageIds);
    const request: ExportWorkerRequest = {
      assets,
      bytes: exportBuffer,
      document: state.document,
      fontBytes,
      kind: "export",
      ocrWordsByPage: ocrSession.wordsForExport(),
      pageIds,
      // Boxes are burned in by the flatten pass, never drawn as boxes.
      redactions: "skip",
      // A redaction elsewhere in the document still means: leave no trace.
      scrub: plan.length === 0 && documentHasRedactions(state.document),
      sources,
    };
    const pass1 = await callExportWorker(request, [
      exportBuffer,
      ...Object.values(sources),
      ...transfer,
    ]);
    if (plan.length === 0) {
      return {
        bytes: pass1.bytes,
        coverOnlyRunIds: pass1.coverOnlyRunIds,
        flattenedPageCount: 0,
        removedFieldNames: [],
      };
    }

    const { browserFlattenDeps } = await import("@/lib/pdf/browser-flatten");
    // pdf.js takes the bytes it renders from; pass 2 keeps its own copy.
    const pages = await renderRedactedPages(
      new Uint8Array(pass1.bytes).slice(),
      plan,
      browserFlattenDeps()
    );
    const textFont = await cachedFontCopy(FONT_FILES.sans[400]);
    const flatten: FlattenWorkerRequest = {
      bytes: pass1.bytes,
      fontBytes: textFont,
      kind: "flatten",
      pages: pages.map((page) => ({
        ...page,
        jpeg: new Uint8Array(page.jpeg).buffer,
      })),
    };
    const pass2 = await callExportWorker(flatten, [
      pass1.bytes,
      textFont,
      ...flatten.pages.map((page) => page.jpeg),
    ]);
    return {
      bytes: pass2.bytes,
      coverOnlyRunIds: pass1.coverOnlyRunIds,
      flattenedPageCount: pass2.flattenedPageCount,
      removedFieldNames: pass2.removedFieldNames,
    };
  } finally {
    editorStore.setExporting(false);
  }
};

const warnCoverOnly = (count: number): void => {
  if (count === 0) {
    return;
  }
  toastManager.add({
    description:
      count === 1
        ? "One edit could only be covered. Its old text is still in the file and other PDF tools can find it."
        : `${count} edits could only be covered. Their old text is still in the file and other PDF tools can find it.`,
    title: "Old text still in the file",
    type: "warning",
  });
};

/** Say what flattening did, so nobody expects the redacted pages as text. */
export const reportFlattened = ({
  flattenedPageCount,
  removedFieldNames,
}: Pick<EditedPdf, "flattenedPageCount" | "removedFieldNames">): void => {
  if (flattenedPageCount === 0) {
    return;
  }
  const pages =
    flattenedPageCount === 1
      ? "1 page with redactions was flattened to an image"
      : `${flattenedPageCount} pages with redactions were flattened to images`;
  const lines = [`${pages}; text outside the boxes stays searchable.`];
  if (removedFieldNames.length > 0) {
    lines.push(`Removed form fields: ${removedFieldNames.join(", ")}.`);
  }
  toastManager.add({
    description: lines.join("\n"),
    title: "Redactions applied",
    type: "info",
  });
};

const exportFileName = (
  fileName: string | null,
  pageIds: readonly string[] | undefined
): string => {
  const baseName = fileName?.replace(/\.pdf$/iu, "") ?? "document";
  if (!pageIds) {
    return `${baseName}-edited.pdf`;
  }
  const wanted = new Set(pageIds);
  const positions = editorStore
    .getState()
    .document.pages.flatMap((page, index) =>
      wanted.has(page.id) ? [index + 1] : []
    );
  return `${baseName}-pages-${pageRangeLabel(positions)}.pdf`;
};

export const runExport = async (options: ExportOptions = {}): Promise<void> => {
  const exported = editorStore.getState().document;
  const edited = await buildEditedPdfBytes(options);
  const { bytes: result, coverOnlyRunIds } = edited;
  const state = editorStore.getState();
  const blob = new Blob([result], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(state.fileName, options.pageIds);
  link.click();
  URL.revokeObjectURL(url);
  // Extracted pages are a new file; the document itself is still unsaved.
  if (!options.pageIds) {
    editorStore.markClean(exported);
  }
  warnCoverOnly(coverOnlyRunIds.length);
  reportFlattened(edited);
};
