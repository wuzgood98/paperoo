import { toastManager } from "@/components/ui/toast-manager";
import { isPdfTextDirty } from "@/lib/editor/object-utils";
import { pageDocId } from "@/lib/editor/page-source";
import { editorStore } from "@/lib/editor/store";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { ocrSession } from "@/lib/ocr/session";
import { clonePdfBytes } from "@/lib/pdf/bytes";
import { interWeightsNeeded } from "@/lib/pdf/figma-fallback";
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
}

export const buildEditedPdfBytes = async (): Promise<EditedPdf> => {
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

    const worker = new Worker(new URL("export.worker.ts", import.meta.url), {
      type: "module",
    });

    // oxlint-disable-next-line promise/avoid-new -- worker results arrive through message events
    return await new Promise<EditedPdf>((resolve, reject) => {
      worker.addEventListener(
        "message",
        (
          event: MessageEvent<{
            bytes?: ArrayBuffer;
            coverOnlyRunIds?: string[];
            error?: string;
            ok: boolean;
          }>
        ) => {
          worker.terminate();
          if (event.data.ok && event.data.bytes) {
            resolve({
              bytes: event.data.bytes,
              coverOnlyRunIds: event.data.coverOnlyRunIds ?? [],
            });
            return;
          }
          reject(new Error(event.data.error ?? "Export failed."));
        }
      );
      worker.addEventListener("error", () => {
        worker.terminate();
        reject(new Error("The export worker crashed."));
      });
      const exportBytes = clonePdfBytes(bytes);
      // Every other source document a page comes from (blank pages, merges).
      const sources: Record<string, ArrayBuffer> = {};
      for (const page of state.document.pages) {
        const docId = pageDocId(page);
        const source = pdfSession.bytesOf(docId);
        if (docId !== PRIMARY_DOC_ID && source && !(docId in sources)) {
          sources[docId] = new Uint8Array(source).buffer;
        }
      }
      worker.postMessage(
        {
          assets,
          bytes: exportBytes.buffer,
          document: state.document,
          fontBytes,
          ocrWordsByPage: ocrSession.wordsForExport(),
          sources,
        },
        {
          transfer: [
            exportBytes.buffer,
            ...Object.values(sources),
            ...transfer,
          ],
        }
      );
    });
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

export const runExport = async (): Promise<void> => {
  const exported = editorStore.getState().document;
  const { bytes: result, coverOnlyRunIds } = await buildEditedPdfBytes();
  const state = editorStore.getState();
  const blob = new Blob([result], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName = state.fileName?.replace(/\.pdf$/iu, "") ?? "document";
  link.href = url;
  link.download = `${baseName}-edited.pdf`;
  link.click();
  URL.revokeObjectURL(url);
  editorStore.markClean(exported);
  warnCoverOnly(coverOnlyRunIds.length);
};
