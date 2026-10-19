import { pageDocId } from "@/lib/editor/page-source";
import type {
  EditorPage,
  PdfImageObject,
  PdfTextObject,
} from "@/lib/editor/types";

/** Image placement differences up to this many points still match. */
const IMAGE_MATCH_TOLERANCE = 0.01;

/** Record `from` → `to`; false when `from` already maps elsewhere. */
const mapId = (map: Map<string, string>, from: string, to: string): boolean => {
  const existing = map.get(from);
  if (existing !== undefined && existing !== to) {
    return false;
  }
  map.set(from, to);
  return true;
};

const placedAlike = (a: PdfImageObject, b: PdfImageObject): boolean =>
  Math.abs(a.originalX - b.originalX) <= IMAGE_MATCH_TOLERANCE &&
  Math.abs(a.originalY - b.originalY) <= IMAGE_MATCH_TOLERANCE &&
  Math.abs(a.originalWidth - b.originalWidth) <= IMAGE_MATCH_TOLERANCE &&
  Math.abs(a.originalHeight - b.originalHeight) <= IMAGE_MATCH_TOLERANCE;

/** Runtime id maps of one source document. */
interface DocIdMaps {
  fontNames: Map<string, string>;
  imageIds: Map<string, string>;
}

/** Fill `maps` from one saved page and its fresh copy; false on a mismatch. */
const matchPage = (
  page: EditorPage,
  match: EditorPage,
  maps: DocIdMaps
): boolean => {
  const freshRuns = new Map<string, PdfTextObject>();
  for (const run of match.pdfTextObjects) {
    if (!run.outlineText) {
      freshRuns.set(`${run.sourceIndex}\0${run.originalText}`, run);
    }
  }
  for (const run of page.pdfTextObjects) {
    if (run.outlineText) {
      continue;
    }
    const freshRun = freshRuns.get(`${run.sourceIndex}\0${run.originalText}`);
    if (!freshRun || !mapId(maps.fontNames, run.fontName, freshRun.fontName)) {
      return false;
    }
  }
  const freshImages = new Map(
    match.pdfImageObjects.map((image) => [image.sourceIndex, image])
  );
  for (const image of page.pdfImageObjects) {
    const freshImage = freshImages.get(image.sourceIndex);
    if (
      !(freshImage && placedAlike(freshImage, image)) ||
      !mapId(maps.imageIds, image.sourceId, freshImage.sourceId)
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Saved pages refer to pdf.js runtime ids — a run's `fontName`
 * (`g_d{doc}_f{n}`) and an image's `sourceId` — that a fresh open of the
 * same bytes assigns differently. Map each saved id onto the fresh
 * extraction of its own source document (`fresh`, by docId), matching runs
 * by text item and images by paint operator. Pages of sources missing from
 * `fresh` (generated blank pages) carry no runtime ids and are kept as is.
 * Returns null when the saved pages do not fit the fresh ones.
 */
export const rebindRuntimeIds = (
  saved: readonly EditorPage[],
  fresh: ReadonlyMap<string, readonly EditorPage[]>
): EditorPage[] | null => {
  const maps = new Map<string, DocIdMaps>();
  for (const page of saved) {
    const docId = pageDocId(page);
    const freshPages = fresh.get(docId);
    if (!freshPages) {
      continue;
    }
    const match = freshPages.find(
      (candidate) => candidate.sourceIndex === page.sourceIndex
    );
    let docMaps = maps.get(docId);
    if (!docMaps) {
      docMaps = { fontNames: new Map(), imageIds: new Map() };
      maps.set(docId, docMaps);
    }
    if (!(match && matchPage(page, match, docMaps))) {
      return null;
    }
  }

  return saved.map((page) => {
    const docMaps = maps.get(pageDocId(page));
    return {
      ...page,
      pdfImageObjects: page.pdfImageObjects.map((image) => ({
        ...image,
        // Previews are provisional assets; they are rebuilt on demand.
        previewAssetId: null,
        sourceId: docMaps?.imageIds.get(image.sourceId) ?? image.sourceId,
      })),
      pdfTextObjects: page.pdfTextObjects.map((run) => ({
        ...run,
        fontName: docMaps?.fontNames.get(run.fontName) ?? run.fontName,
      })),
    };
  });
};
