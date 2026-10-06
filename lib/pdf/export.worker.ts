import type { EditorDocument } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import type { ExportAsset, ExportInput } from "@/lib/pdf/export-pdf";

interface WorkerRequest {
  assets: Record<string, { buffer: ArrayBuffer; mimeType: string }>;
  bytes: ArrayBuffer;
  document: EditorDocument;
  fontBytes: Record<string, ArrayBuffer>;
  ocrWordsByPage?: Readonly<Record<string, readonly OcrTextObject[]>>;
}

type WorkerResponse =
  | { error: string; ok: false }
  | { bytes: ArrayBuffer; ok: true };

const toUint8 = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  try {
    const assets: Record<string, ExportAsset> = {};
    for (const [id, asset] of Object.entries(event.data.assets)) {
      assets[id] = {
        bytes: toUint8(asset.buffer),
        mimeType: asset.mimeType,
      };
    }

    const fontBytes: Record<string, Uint8Array> = {};
    for (const [key, buffer] of Object.entries(event.data.fontBytes)) {
      fontBytes[key] = toUint8(buffer);
    }

    const input: ExportInput = {
      assets,
      bytes: toUint8(event.data.bytes),
      document: event.data.document,
      fontBytes,
      ocrWordsByPage: event.data.ocrWordsByPage,
    };
    const result = await exportDocument(input);
    const copy = new ArrayBuffer(result.byteLength);
    new Uint8Array(copy).set(result);
    const response: WorkerResponse = { bytes: copy, ok: true };
    self.postMessage(response, { transfer: [copy] });
  } catch (error) {
    const response: WorkerResponse = {
      error: error instanceof Error ? error.message : "Export failed.",
      ok: false,
    };
    self.postMessage(response, self.location.origin);
  }
});
