import { PDFDocument } from "pdf-lib";

import { probeFontGlyphs } from "@/lib/pdf/probe-font-glyphs";

export type ProbeFontRequest =
  | { bytes: ArrayBuffer; kind: "load" }
  | { baseFontName: string; id: number; kind: "probe"; sourceIndex: number };

export type ProbeFontResponse =
  | { glyphs: string; id: number; ok: true }
  | { error: string; id: number; ok: false };

let doc: Promise<PDFDocument> | null = null;

const reply = (response: ProbeFontResponse): void => {
  self.postMessage(response, { transfer: [] });
};

self.addEventListener(
  "message",
  async (event: MessageEvent<ProbeFontRequest>) => {
    const request = event.data;
    if (request.kind === "load") {
      doc = PDFDocument.load(new Uint8Array(request.bytes), {
        updateMetadata: false,
      });
      return;
    }
    try {
      if (!doc) {
        throw new Error("No PDF loaded for font probing.");
      }
      const loaded = await doc;
      reply({
        glyphs: probeFontGlyphs(
          loaded,
          request.sourceIndex,
          request.baseFontName
        ),
        id: request.id,
        ok: true,
      });
    } catch (error) {
      reply({
        error: error instanceof Error ? error.message : "Font probe failed.",
        id: request.id,
        ok: false,
      });
    }
  }
);
