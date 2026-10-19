import type { EditorDocument } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import { flattenRedactedPages } from "@/lib/pdf/export-flatten";
import { exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import type { ExportAsset, ExportInput } from "@/lib/pdf/export-pdf";
import type { PositionedText, RedactionBox } from "@/lib/pdf/output-pages";

export interface ExportWorkerRequest {
  assets: Record<string, { buffer: ArrayBuffer; mimeType: string }>;
  bytes: ArrayBuffer;
  document: EditorDocument;
  fontBytes: Record<string, ArrayBuffer>;
  kind: "export";
  ocrWordsByPage?: Readonly<Record<string, readonly OcrTextObject[]>>;
  pageIds?: readonly string[];
  redactions: "apply" | "forbid" | "skip";
  scrub: boolean;
  sources?: Record<string, ArrayBuffer>;
}

export interface FlattenWorkerRequest {
  bytes: ArrayBuffer;
  fontBytes?: ArrayBuffer;
  kind: "flatten";
  pages: {
    boxes: RedactionBox[];
    jpeg: ArrayBuffer;
    outputIndex: number;
    text: PositionedText[];
  }[];
}

export type WorkerRequest = ExportWorkerRequest | FlattenWorkerRequest;

export type WorkerResponse =
  | { error: string; ok: false }
  | {
      bytes: ArrayBuffer;
      coverOnlyRunIds: string[];
      flattenPages: number[];
      kind: "export";
      ok: true;
      removedFieldNames: string[];
    }
  | {
      bytes: ArrayBuffer;
      flattenedPageCount: number;
      kind: "flatten";
      ok: true;
      removedFieldNames: string[];
    };

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

const runExportRequest = async (
  request: ExportWorkerRequest
): Promise<WorkerResponse> => {
  const assets: Record<string, ExportAsset> = {};
  for (const [id, asset] of Object.entries(request.assets)) {
    assets[id] = {
      bytes: toUint8(asset.buffer),
      mimeType: asset.mimeType,
    };
  }

  const fontBytes: Record<string, Uint8Array> = {};
  for (const [key, buffer] of Object.entries(request.fontBytes)) {
    fontBytes[key] = toUint8(buffer);
  }

  const input: ExportInput = {
    assets,
    bytes: toUint8(request.bytes),
    document: request.document,
    fontBytes,
    ocrWordsByPage: request.ocrWordsByPage,
    pageIds: request.pageIds,
    redactions: request.redactions,
    scrub: request.scrub,
    sources: Object.fromEntries(
      Object.entries(request.sources ?? {}).map(([docId, buffer]) => [
        docId,
        toUint8(buffer),
      ])
    ),
  };
  const report = await exportDocumentWithReport(input);
  return {
    bytes: ownedBuffer(report.bytes),
    coverOnlyRunIds: report.coverOnlyRunIds,
    flattenPages: report.flattenPages,
    kind: "export",
    ok: true,
    removedFieldNames: report.removedFieldNames,
  };
};

const runFlattenRequest = async (
  request: FlattenWorkerRequest
): Promise<WorkerResponse> => {
  const report = await flattenRedactedPages({
    bytes: toUint8(request.bytes),
    fontBytes: request.fontBytes ? toUint8(request.fontBytes) : undefined,
    pages: request.pages.map((page) => ({ ...page, jpeg: toUint8(page.jpeg) })),
  });
  return {
    bytes: ownedBuffer(report.bytes),
    flattenedPageCount: report.flattenedPageCount,
    kind: "flatten",
    ok: true,
    removedFieldNames: report.removedFieldNames,
  };
};

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  try {
    const response =
      event.data.kind === "flatten"
        ? await runFlattenRequest(event.data)
        : await runExportRequest(event.data);
    self.postMessage(response, {
      transfer: response.ok ? [response.bytes] : [],
    });
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
