import {
  hitTestPdfImage,
  hitTestPdfText,
  hitTestPdfVector,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, Point } from "@/lib/editor/types";
import { ensureEditorFonts } from "@/lib/fonts/measure-text";
import { ensurePdfImagePreview } from "@/lib/pdf/pdf-image-preview";

/** Select the topmost PDF object at a page point, or clear selection. */
export const selectPdfObjectAtPoint = (
  page: EditorPage,
  point: Point
): boolean => {
  const textHit = hitTestPdfText(page.pdfTextObjects, point);
  if (textHit) {
    editorStore.selectPdfText(textHit.id);
    return true;
  }
  const imageHit = hitTestPdfImage(page.pdfImageObjects, point);
  if (imageHit) {
    editorStore.selectPdfImage(imageHit.id);
    void ensurePdfImagePreview(imageHit, page.sourceIndex);
    return true;
  }
  const vectorHit = hitTestPdfVector(
    page.pdfVectorObjects,
    point,
    page.cropBox,
    page.sourceRotate
  );
  if (vectorHit) {
    editorStore.selectPdfVector(vectorHit.id);
    return true;
  }
  editorStore.clearSelection();
  return false;
};

/** Start inline edit for a horizontal PDF text run at the point. */
export const beginPdfTextEditAtPoint = (
  page: EditorPage,
  point: Point,
  setEditingPdfTextId: (id: string | null) => void
): boolean => {
  const textHit = hitTestPdfText(page.pdfTextObjects, point);
  if (!textHit || textHit.dir === "ttb") {
    return false;
  }
  editorStore.selectPdfText(textHit.id);
  setEditingPdfTextId(textHit.id);
  void ensureEditorFonts();
  return true;
};

export interface PdfHoverIds {
  imageId: string | null;
  textId: string | null;
  vectorId: string | null;
}

export const pdfHoverIdsAtPoint = (
  page: EditorPage,
  point: Point
): PdfHoverIds => {
  const textHit = hitTestPdfText(page.pdfTextObjects, point);
  if (textHit) {
    return { imageId: null, textId: textHit.id, vectorId: null };
  }
  const imageHit = hitTestPdfImage(page.pdfImageObjects, point);
  if (imageHit) {
    return { imageId: imageHit.id, textId: null, vectorId: null };
  }
  const vectorHit = hitTestPdfVector(
    page.pdfVectorObjects,
    point,
    page.cropBox,
    page.sourceRotate
  );
  return {
    imageId: null,
    textId: null,
    vectorId: vectorHit?.id ?? null,
  };
};
