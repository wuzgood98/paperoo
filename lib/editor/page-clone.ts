import { createId } from "@/lib/editor/ids";
import type { EditorPage } from "@/lib/editor/types";

/**
 * A second appearance of `page`: same source page and edits, with new ids
 * for the page and everything on it so the two can change independently.
 * `ocrWordIds` maps the page's OCR words to the copies made for `pageId`
 * (see the OCR controller's `clonePage`). Form fields stay
 * with the original page; the copy shows and exports without widgets.
 */
export const clonePageWithFreshIds = (
  page: EditorPage,
  {
    ocrWordIds = new Map(),
    pageId = createId(),
  }: { ocrWordIds?: ReadonlyMap<string, string>; pageId?: string } = {}
): EditorPage => {
  const vectorIds = new Map(
    page.pdfVectorObjects.map((vector) => [vector.id, createId()])
  );
  return {
    ...page,
    id: pageId,
    objects: page.objects.map((object) => {
      if (object.type === "text" && object.ocrWordId) {
        const ocrWordId = ocrWordIds.get(object.ocrWordId);
        if (ocrWordId) {
          return { ...object, id: createId(), ocrWordId };
        }
        // A word the copy does not have: keep the edit as plain text.
        const { ocrWordId: _dropped, ...plain } = object;
        return { ...plain, id: createId() };
      }
      return { ...object, id: createId() };
    }),
    omitFormWidgets: true,
    pdfAnnotationObjects: page.pdfAnnotationObjects.map((object) => ({
      ...object,
      id: createId(),
      pageId,
    })),
    pdfImageObjects: page.pdfImageObjects.map((object) => ({
      ...object,
      id: createId(),
      pageId,
    })),
    pdfTextObjects: page.pdfTextObjects.map((run) => ({
      ...run,
      glyphFace:
        run.glyphFace?.pageId === page.id
          ? { ...run.glyphFace, pageId }
          : run.glyphFace,
      id: createId(),
      inkVectorId: run.inkVectorId && vectorIds.get(run.inkVectorId),
      pageId,
    })),
    pdfVectorObjects: page.pdfVectorObjects.map((vector) => ({
      ...vector,
      id: vectorIds.get(vector.id) ?? createId(),
      pageId,
    })),
    suppressedOcrWordIds: page.suppressedOcrWordIds?.flatMap((id) => {
      const copy = ocrWordIds.get(id);
      return copy ? [copy] : [];
    }),
  };
};
