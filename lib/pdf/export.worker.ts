import type { EditorDocument } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import { exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import type { ExportAsset, ExportInput } from "@/lib/pdf/export-pdf";

interface WorkerRequest {
  assets: Record<string, { buffer: ArrayBuffer; mimeType: string }>;
  bytes: ArrayBuffer;
  document: EditorDocument;
  fontBytes: Record<string, ArrayBuffer>;
  ocrWordsByPage?: Readonly<Record<string, readonly OcrTextObject[]>>;
  pageIds?: readonly string[];
  sources?: Record<string, ArrayBuffer>;
}

type WorkerResponse =
  | { error: string; ok: false }
  | { bytes: ArrayBuffer; coverOnlyRunIds: string[]; ok: true };

const toUint8 = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);

/** The bytes' own buffer when they fill it, so it can be transferred as is. */
const ownedBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const { buffer } = bytes;
  if (
    buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
  ) {
    return buffer;
  }
  return new Uint8Array(bytes).buffer;
};

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
      pageIds: event.data.pageIds,
      sources: Object.fromEntries(
        Object.entries(event.data.sources ?? {}).map(([docId, buffer]) => [
          docId,
          toUint8(buffer),
        ])
      ),
    };
    const { bytes: result, coverOnlyRunIds } =
      await exportDocumentWithReport(input);
    const response: WorkerResponse = {
      bytes: ownedBuffer(result),
      coverOnlyRunIds,
      ok: true,
    };
    self.postMessage(response, { transfer: [response.bytes] });
  } catch (error) {
    const response: WorkerResponse = {
      error: error instanceof Error ? error.message : "Export failed.",
      ok: false,
    };
    // Workers take no targetOrigin: an origin string throws "Overload
    // resolution failed", the reply never arrives, and the export hangs.
    self.postMessage(response, { transfer: [] });
  }
});
