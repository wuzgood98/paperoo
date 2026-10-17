import { activatePdfLinkAction } from "@/lib/editor/annotation-links";
import {
  hitTestPdfAnnotation,
  hitTestPdfFormField,
  hitTestPdfImage,
  hitTestPdfText,
  hitTestPdfVector,
  pdfTextEditable,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorDocument,
  EditorPage,
  PdfLinkAnnotation,
  Point,
} from "@/lib/editor/types";
import { ensureEditorFonts } from "@/lib/fonts/measure-text";
import { textObjectFromOcrWord } from "@/lib/ocr/edit";
import { hitTestOcrWord, visibleOcrWords } from "@/lib/ocr/hit";
import { outlineTextSession } from "@/lib/ocr/outline-session";
import { isOutlineTextCandidateOn } from "@/lib/ocr/outline-text";
import type { OcrTextObject } from "@/lib/ocr/types";
import { ensurePdfImagePreview } from "@/lib/pdf/pdf-image-preview";

const isLinkAnnotation = (
  object: ReturnType<typeof hitTestPdfAnnotation>
): object is PdfLinkAnnotation => object?.type === "pdf-link";

/** Select the topmost PDF object at a page point, or clear selection. */
export const selectPdfObjectAtPoint = (
  page: EditorPage,
  point: Point,
  options: {
    ocrWords?: readonly OcrTextObject[];
    shiftKey?: boolean;
  } = {}
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
  const ocrHit = hitTestOcrWord(
    visibleOcrWords(options.ocrWords ?? [], page.suppressedOcrWordIds),
    point
  );
  if (ocrHit) {
    editorStore.selectOcrWords([ocrHit.id]);
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
    // It may be text drawn as outlines: read it now rather than in turn.
    if (isOutlineTextCandidateOn(page, vectorHit)) {
      outlineTextSession.prioritize(page.id, vectorHit.id);
    }
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
  if (!pdfTextEditable(textHit)) {
    return true;
  }
  setEditingPdfTextId(textHit.id);
  void ensureEditorFonts();
  return true;
};

export const beginOcrEditAtPoint = (
  page: EditorPage,
  point: Point,
  ocrWords: readonly OcrTextObject[],
  setEditingId: (id: string | null) => void
): boolean => {
  const hit = hitTestOcrWord(
    visibleOcrWords(ocrWords, page.suppressedOcrWordIds),
    point
  );
  if (!hit) {
    return false;
  }
  const object = textObjectFromOcrWord(hit);
  editorStore.commitOcrEdit(object, hit.id);
  setEditingId(object.id);
  return true;
};

export interface PdfHoverIds {
  annotationId: string | null;
  formFieldId: string | null;
  imageId: string | null;
  ocrWordId: string | null;
  textId: string | null;
  vectorId: string | null;
}

export const EMPTY_PDF_HOVER: PdfHoverIds = {
  annotationId: null,
  formFieldId: null,
  imageId: null,
  ocrWordId: null,
  textId: null,
  vectorId: null,
};

/** Same hover target, so a pointer move can keep the previous state object. */
export const samePdfHover = (left: PdfHoverIds, right: PdfHoverIds): boolean =>
  left.annotationId === right.annotationId &&
  left.formFieldId === right.formFieldId &&
  left.imageId === right.imageId &&
  left.ocrWordId === right.ocrWordId &&
  left.textId === right.textId &&
  left.vectorId === right.vectorId;

export const pdfHoverIdsAtPoint = (
  page: EditorPage,
  point: Point,
  document: Pick<EditorDocument, "form">,
  ocrWords: readonly OcrTextObject[] = []
): PdfHoverIds => {
  const formHit = hitTestPdfFormField(document, page.id, point);
  if (formHit) {
    return {
      annotationId: null,
      formFieldId: formHit.id,
      imageId: null,
      ocrWordId: null,
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
      ocrWordId: null,
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
      ocrWordId: null,
      textId: textHit.id,
      vectorId: null,
    };
  }
  const ocrHit = hitTestOcrWord(
    visibleOcrWords(ocrWords, page.suppressedOcrWordIds),
    point
  );
  if (ocrHit) {
    return {
      annotationId: null,
      formFieldId: null,
      imageId: null,
      ocrWordId: ocrHit.id,
      textId: null,
      vectorId: null,
    };
  }
  const imageHit = hitTestPdfImage(page.pdfImageObjects, point);
  if (imageHit) {
    return {
      annotationId: null,
      formFieldId: null,
      imageId: imageHit.id,
      ocrWordId: null,
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
    ocrWordId: null,
    textId: null,
    vectorId: vectorHit?.id ?? null,
  };
};
