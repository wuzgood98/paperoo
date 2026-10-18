import { PDFDocument } from "pdf-lib";

import { pageKeyString } from "@/lib/editor/page-source";
import type { PageKey } from "@/lib/editor/page-source";
import { probeFontGlyphs } from "@/lib/pdf/probe-font-glyphs";
import type {
  ProbeFontRequest,
  ProbeFontResponse,
} from "@/lib/pdf/probe-font.worker";
import { pdfSession } from "@/lib/pdf/session";

type ProbeGlyphs = (
  sourceIndex: number,
  baseFontName: string
) => Promise<string>;

interface ProbeCache {
  bytes: Uint8Array;
  dispose: () => void;
  probe: ProbeGlyphs;
  results: Map<string, Promise<string>>;
}

/** One parsed copy per open source document, by docId. */
const caches = new Map<string, ProbeCache>();

/** Fallback without workers (tests, old browsers): parse on this thread. */
const inThreadProber = (bytes: Uint8Array): Omit<ProbeCache, "results"> => {
  const doc = PDFDocument.load(bytes, { updateMetadata: false });
  return {
    bytes,
    dispose: () => {
      // Nothing to release; the parsed document is garbage once unreferenced.
    },
    probe: async (sourceIndex, baseFontName) =>
      probeFontGlyphs(await doc, sourceIndex, baseFontName),
  };
};

/**
 * pdf-lib parses the whole file before the first probe, which froze the
 * first text edit on large PDFs. A worker keeps that parse off this thread.
 */
const workerProber = (bytes: Uint8Array): Omit<ProbeCache, "results"> => {
  const worker = new Worker(new URL("probe-font.worker.ts", import.meta.url), {
    type: "module",
  });
  const pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (glyphs: string) => void }
  >();
  let nextId = 0;
  const failAll = (message: string): void => {
    for (const { reject } of pending.values()) {
      reject(new Error(message));
    }
    pending.clear();
  };
  worker.addEventListener(
    "message",
    (event: MessageEvent<ProbeFontResponse>) => {
      const response = event.data;
      const waiter = pending.get(response.id);
      if (!waiter) {
        return;
      }
      pending.delete(response.id);
      if (response.ok) {
        waiter.resolve(response.glyphs);
      } else {
        waiter.reject(new Error(response.error));
      }
    }
  );
  worker.addEventListener("error", () => {
    failAll("The font probe worker crashed.");
  });
  // A copy, transferred: the session keeps its own bytes.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const load: ProbeFontRequest = { bytes: buffer, kind: "load" };
  worker.postMessage(load, { transfer: [buffer] });
  return {
    bytes,
    dispose: () => {
      failAll("The PDF changed before the font probe finished.");
      worker.terminate();
    },
    probe: (sourceIndex, baseFontName) => {
      nextId += 1;
      const id = nextId;
      // oxlint-disable-next-line promise/avoid-new -- worker replies arrive through message events
      const result = new Promise<string>((resolve, reject) => {
        pending.set(id, { reject, resolve });
      });
      const request: ProbeFontRequest = {
        baseFontName,
        id,
        kind: "probe",
        sourceIndex,
      };
      worker.postMessage(request, { transfer: [] });
      return result;
    },
  };
};

const sessionCache = (docId: string, bytes: Uint8Array): ProbeCache => {
  // Drop parsers of documents that closed or were reopened.
  const open = new Set(pdfSession.docIds());
  for (const [id, entry] of caches) {
    if (!open.has(id) || (id === docId && entry.bytes !== bytes)) {
      entry.dispose();
      caches.delete(id);
    }
  }
  let cache = caches.get(docId);
  if (!cache) {
    const prober =
      typeof Worker === "undefined"
        ? inThreadProber(bytes)
        : workerProber(bytes);
    cache = { ...prober, results: new Map() };
    caches.set(docId, cache);
  }
  return cache;
};

/**
 * Characters the export can encode with `baseFontName` on source page
 * `sourceIndex`, run against the same pdf-lib lookup the export uses. Empty
 * when the font cannot be reused at all.
 */
export const probeReusableFontGlyphs = async (
  page: PageKey,
  baseFontName: string | undefined
): Promise<string> => {
  const bytes = pdfSession.bytesOf(page.docId);
  if (!(bytes && baseFontName)) {
    return "";
  }
  const session = sessionCache(page.docId, bytes);
  const key = `${pageKeyString(page)}:${baseFontName}`;
  const known = session.results.get(key);
  if (known) {
    return await known;
  }
  const result = session.probe(page.sourceIndex, baseFontName);
  session.results.set(key, result);
  try {
    return await result;
  } catch (error) {
    // Let a later edit retry instead of caching the failure.
    session.results.delete(key);
    throw error;
  }
};
