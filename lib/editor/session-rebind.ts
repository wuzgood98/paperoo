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

/**
 * Saved pages refer to pdf.js runtime ids — a run's `fontName`
 * (`g_d{doc}_f{n}`) and an image's `sourceId` — that a fresh open of the
 * same bytes assigns differently. Map each saved id onto the fresh
 * extraction, matching runs by text item and images by paint operator.
 * Returns null when the saved pages do not fit the fresh ones.
 */
export const rebindRuntimeIds = (
  saved: readonly EditorPage[],
  fresh: readonly EditorPage[]
): EditorPage[] | null => {
  const freshBySource = new Map(fresh.map((page) => [page.sourceIndex, page]));
  const fontNames = new Map<string, string>();
  const imageIds = new Map<string, string>();

  for (const page of saved) {
    const match = freshBySource.get(page.sourceIndex);
    if (!match) {
      return null;
    }
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
      if (!freshRun || !mapId(fontNames, run.fontName, freshRun.fontName)) {
        return null;
      }
    }
    const freshImages = new Map<number, PdfImageObject>(
      match.pdfImageObjects.map((image) => [image.sourceIndex, image])
    );
    for (const image of page.pdfImageObjects) {
      const freshImage = freshImages.get(image.sourceIndex);
      const placed =
        freshImage !== undefined &&
        Math.abs(freshImage.originalX - image.originalX) <=
          IMAGE_MATCH_TOLERANCE &&
        Math.abs(freshImage.originalY - image.originalY) <=
          IMAGE_MATCH_TOLERANCE &&
        Math.abs(freshImage.originalWidth - image.originalWidth) <=
          IMAGE_MATCH_TOLERANCE &&
        Math.abs(freshImage.originalHeight - image.originalHeight) <=
          IMAGE_MATCH_TOLERANCE;
      if (!placed || !mapId(imageIds, image.sourceId, freshImage.sourceId)) {
        return null;
      }
    }
  }

  return saved.map((page) => ({
    ...page,
    pdfImageObjects: page.pdfImageObjects.map((image) => ({
      ...image,
      // Previews are provisional assets; they are rebuilt on demand.
      previewAssetId: null,
      sourceId: imageIds.get(image.sourceId) ?? image.sourceId,
    })),
    pdfTextObjects: page.pdfTextObjects.map((run) => ({
      ...run,
      fontName: fontNames.get(run.fontName) ?? run.fontName,
    })),
  }));
};
