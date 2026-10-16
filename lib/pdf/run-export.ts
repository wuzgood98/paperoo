import { toastManager } from "@/components/ui/toast-manager";
import { editorStore } from "@/lib/editor/store";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { ocrSession } from "@/lib/ocr/session";
import { clonePdfBytes } from "@/lib/pdf/bytes";
import { ensureDirtyPdfImageAssets } from "@/lib/pdf/pdf-image-preview";
import { pdfSession } from "@/lib/pdf/session";

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}`);
  }
  return response.arrayBuffer();
};

export interface EditedPdf {
  bytes: ArrayBuffer;
  /** Edited runs whose old text could only be covered, not removed. */
  coverOnlyRunIds: string[];
}

export const buildEditedPdfBytes = async (): Promise<EditedPdf> => {
  const state = editorStore.getState();
  const { bytes } = pdfSession;
  if (!bytes || state.document.pages.length === 0) {
    throw new Error("Open a PDF before exporting.");
  }

  editorStore.setExporting(true);

  try {
    const fontBytes: Record<string, ArrayBuffer> = {};
    const fontUrls = [
      FONT_FILES.sans[400],
      FONT_FILES.sans[700],
      FONT_FILES.sans.italic400,
      FONT_FILES.sans.italic700,
    ];
    const buffers = await Promise.all(fontUrls.map((url) => fetchBytes(url)));
    for (const [index, url] of fontUrls.entries()) {
      const buffer = buffers[index];
      if (buffer) {
        fontBytes[url] = buffer;
      }
    }

    await ensureDirtyPdfImageAssets();

    const assets: Record<string, { buffer: ArrayBuffer; mimeType: string }> =
      {};
    for (const [id, asset] of editorStore.getAssets()) {
      const copy = new Uint8Array(asset.bytes);
      assets[id] = {
        buffer: copy.buffer,
        mimeType: asset.mimeType,
      };
    }

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
      worker.postMessage(
        {
          assets,
          bytes: exportBytes.buffer,
          document: state.document,
          fontBytes,
          ocrWordsByPage: ocrSession.wordsForExport(),
        },
        { transfer: [exportBytes.buffer] }
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
  warnCoverOnly(coverOnlyRunIds.length);
};
