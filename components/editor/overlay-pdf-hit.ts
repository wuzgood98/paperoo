import { activatePdfLinkAction } from "@/lib/editor/annotation-links";
import {
  hitTestPdfAnnotation,
  hitTestPdfFormField,
  hitTestPdfImage,
  hitTestPdfText,
  hitTestPdfVector,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorDocument,
  EditorPage,
  PdfLinkAnnotation,
  Point,
} from "@/lib/editor/types";
import { ensureEditorFonts } from "@/lib/fonts/measure-text";
import { ensurePdfImagePreview } from "@/lib/pdf/pdf-image-preview";

const isLinkAnnotation = (
  object: ReturnType<typeof hitTestPdfAnnotation>
): object is PdfLinkAnnotation => object?.type === "pdf-link";

/** Select the topmost PDF object at a page point, or clear selection. */
export const selectPdfObjectAtPoint = (
  page: EditorPage,
  point: Point,
  options: { shiftKey?: boolean } = {}
): boolean => {
  const formHit = hitTestPdfFormField(
    editorStore.getState().document,
    page.id,
    point
  );
  if (formHit) {
    editorStore.selectPdfFormField(formHit.id);
    return true;
  }
  const annotationHit = hitTestPdfAnnotation(page.pdfAnnotationObjects, point);
  if (annotationHit) {
    if (
      isLinkAnnotation(annotationHit) &&
      !options.shiftKey &&
      annotationHit.action.kind !== "none"
    ) {
      activatePdfLinkAction(
        annotationHit.action,
        editorStore.getState().document,
        (pageId) => editorStore.setCurrentPage(pageId),
        page.id
      );
      return true;
    }
    editorStore.selectPdfAnnotation(annotationHit.id);
    return true;
  }
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
  annotationId: string | null;
  formFieldId: string | null;
  imageId: string | null;
  textId: string | null;
  vectorId: string | null;
}

export const EMPTY_PDF_HOVER: PdfHoverIds = {
  annotationId: null,
  formFieldId: null,
  imageId: null,
  textId: null,
  vectorId: null,
};

export const pdfHoverIdsAtPoint = (
  page: EditorPage,
  point: Point,
  document: EditorDocument
): PdfHoverIds => {
  const formHit = hitTestPdfFormField(document, page.id, point);
  if (formHit) {
    return {
      annotationId: null,
      formFieldId: formHit.id,
      imageId: null,
      textId: null,
      vectorId: null,
    };
  }
  const annotationHit = hitTestPdfAnnotation(page.pdfAnnotationObjects, point);
  if (annotationHit) {
    return {
      annotationId: annotationHit.id,
      formFieldId: null,
      imageId: null,
      textId: null,
      vectorId: null,
    };
  }
  const textHit = hitTestPdfText(page.pdfTextObjects, point);
  if (textHit) {
    return {
      annotationId: null,
      formFieldId: null,
      imageId: null,
      textId: textHit.id,
      vectorId: null,
    };
  }
  const imageHit = hitTestPdfImage(page.pdfImageObjects, point);
  if (imageHit) {
    return {
      annotationId: null,
      formFieldId: null,
      imageId: imageHit.id,
      textId: null,
      vectorId: null,
    };
  }
  const vectorHit = hitTestPdfVector(
    page.pdfVectorObjects,
    point,
    page.cropBox,
    page.sourceRotate
  );
  return {
    annotationId: null,
    formFieldId: null,
    imageId: null,
    textId: null,
    vectorId: vectorHit?.id ?? null,
  };
};
