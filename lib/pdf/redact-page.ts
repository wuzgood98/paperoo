import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import type { PDFDocument, PDFObject, PDFPage } from "pdf-lib";

import { displayedToUserSpace } from "@/lib/editor/coordinates";
import {
  isPdfImageDirty,
  isPdfTextDirty,
  isPdfVectorDirty,
} from "@/lib/editor/object-utils";
import type { EditorPage, Rect } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import {
  pageRedactionBoxes,
  rectArrayTouchesBoxes,
} from "@/lib/pdf/output-pages";
import type { RedactionBox, UserRect } from "@/lib/pdf/output-pages";

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Displayed bounds of a box turned by `rotation` degrees about its center. */
const turnedBounds = (box: Rect, rotation: number): Rect => {
  if (rotation % 360 === 0) {
    return box;
  }
  const angle = rotation * DEGREES_TO_RADIANS;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  return {
    height,
    width,
    x: box.x + box.width / 2 - width / 2,
    y: box.y + box.height / 2 - height / 2,
  };
};

/**
 * Displayed rects of everything Paperoo itself draws on the page: overlay
 * objects, replacement text, and moved or restyled images and vectors.
 */
const paperooDrawn = (page: EditorPage): Rect[] => {
  const rects: Rect[] = [];
  for (const object of page.objects) {
    if (object.type !== "redaction") {
      rects.push(turnedBounds(object, object.rotation));
    }
  }
  for (const run of page.pdfTextObjects) {
    if (isPdfTextDirty(run)) {
      rects.push(run);
    }
  }
  for (const item of [...page.pdfImageObjects, ...page.pdfVectorObjects]) {
    const dirty =
      "sourceId" in item ? isPdfImageDirty(item) : isPdfVectorDirty(item);
    if (dirty && !item.deleted) {
      rects.push(turnedBounds(item, item.rotation));
    }
  }
  // A changed or deleted vector is hidden by repainting its own path in
  // white at its original place, so that place counts as drawn too.
  for (const item of page.pdfVectorObjects) {
    if (isPdfVectorDirty(item)) {
      rects.push(
        turnedBounds(
          {
            height: item.originalHeight,
            width: item.originalWidth,
            x: item.originalX,
            y: item.originalY,
          },
          item.originalRotation
        )
      );
    }
  }
  return rects;
};

const touches = (
  rect: Rect,
  page: EditorPage,
  boxes: readonly UserRect[]
): boolean => {
  const user = displayedToUserSpace(rect, page.cropBox, page.sourceRotate);
  return rectArrayTouchesBoxes(
    [user.x, user.y, user.x + user.width, user.y + user.height],
    boxes
  );
};

export interface PageRedaction {
  boxes: RedactionBox[];
  /**
   * Try precise redaction: nothing Paperoo draws on the page touches a box.
   * What Paperoo draws comes after the content edits, so it would sit under
   * the box, still in the file.
   */
  tryPrecise: boolean;
}

/** The page's redaction boxes and whether precise redaction may be tried. */
export const pageRedaction = (
  page: EditorPage,
  mode: "apply" | "forbid" | "skip"
): PageRedaction | null => {
  const boxes = pageRedactionBoxes(page);
  if (boxes.length === 0) {
    return null;
  }
  return {
    boxes,
    tryPrecise:
      mode === "apply" &&
      !paperooDrawn(page).some((rect) => touches(rect, page, boxes)),
  };
};

/**
 * User-space boxes where deleted PDF images and vectors were: OCR words
 * there read content the user took off the page.
 */
export const deletedObjectBoxes = (page: EditorPage): UserRect[] => {
  const boxes: UserRect[] = [];
  for (const item of [...page.pdfImageObjects, ...page.pdfVectorObjects]) {
    if (item.deleted) {
      const original = {
        height: item.originalHeight,
        width: item.originalWidth,
        x: item.originalX,
        y: item.originalY,
      };
      boxes.push(
        displayedToUserSpace(
          turnedBounds(original, item.originalRotation),
          page.cropBox,
          page.sourceRotate
        )
      );
    }
  }
  return boxes;
};

/** OCR words that stay clear of every box (all of them without boxes). */
export const ocrWordsClearOf = (
  words: readonly OcrTextObject[] | undefined,
  page: EditorPage,
  boxes: readonly UserRect[] | undefined
): readonly OcrTextObject[] =>
  boxes && words
    ? words.filter((word) => !touches(word, page, boxes))
    : (words ?? []);

/** Whether a displayed rect stays clear of every box. */
export const clearOfBoxes = (
  rect: Rect,
  page: EditorPage,
  boxes: readonly UserRect[] | undefined
): boolean => !boxes || !touches(rect, page, boxes);

export const annotRect = (dict: PDFDict): number[] => {
  const rect = dict.lookup(PDFName.of("Rect"));
  return rect instanceof PDFArray
    ? rect.asArray().map((value) => Number(value.toString()))
    : [];
};

export const isSubtype = (dict: PDFDict, subtype: string): boolean =>
  dict.get(PDFName.of("Subtype")) === PDFName.of(subtype);

/**
 * Remove every annotation (form widgets aside) that touches a box, and the
 * popups of removed annotations. Widgets go with their fields, later.
 */
export const removeAnnotationsUnderBoxes = (
  doc: PDFDocument,
  page: PDFPage,
  boxes: readonly UserRect[]
): void => {
  const annots = page.node.Annots();
  if (!annots) {
    return;
  }
  // Entries are refs or, less often, dicts written inline in /Annots.
  const removed = new Set<PDFObject>();
  const entries = annots.asArray();
  for (const entry of entries) {
    const dict = doc.context.lookup(entry);
    if (
      dict instanceof PDFDict &&
      !isSubtype(dict, "Widget") &&
      rectArrayTouchesBoxes(annotRect(dict), boxes)
    ) {
      removed.add(entry);
    }
  }
  const kept = entries.filter((entry) => {
    if (removed.has(entry)) {
      return false;
    }
    const parent = doc.context
      .lookupMaybe(entry, PDFDict)
      ?.get(PDFName.of("Parent"));
    return !(parent instanceof PDFRef && removed.has(parent));
  });
  // A kept annotation can point at a removed one (a reply's /IRT, say),
  // which would keep it in the file.
  for (const entry of kept) {
    const dict = doc.context.lookup(entry);
    if (!(dict instanceof PDFDict)) {
      continue;
    }
    for (const [key, value] of dict.entries()) {
      if (value instanceof PDFRef && removed.has(value)) {
        dict.delete(key);
      }
    }
  }
  page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
};

const fieldText = (dict: PDFDict, key: string): string | null => {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : null;
};

/** The field a widget belongs to: itself when it carries a name. */
const terminalFieldRef = (doc: PDFDocument, widget: PDFRef): PDFRef => {
  const dict = doc.context.lookupMaybe(widget, PDFDict);
  const parent = dict?.get(PDFName.of("Parent"));
  return dict && !dict.has(PDFName.of("T")) && parent instanceof PDFRef
    ? parent
    : widget;
};

const qualifiedName = (doc: PDFDocument, ref: PDFRef): string => {
  const parts: string[] = [];
  const seen = new Set<PDFRef>();
  let current: PDFRef | undefined = ref;
  while (current && !seen.has(current)) {
    seen.add(current);
    const dict: PDFDict | undefined = doc.context.lookupMaybe(current, PDFDict);
    const part = dict ? fieldText(dict, "T") : null;
    if (part !== null) {
      parts.unshift(part);
    }
    const parent: PDFObject | undefined = dict?.get(PDFName.of("Parent"));
    current = parent instanceof PDFRef ? parent : undefined;
  }
  return parts.join(".");
};

const withoutRefs = (
  doc: PDFDocument,
  array: PDFArray,
  refs: ReadonlySet<PDFRef>
): PDFArray =>
  doc.context.obj(
    array
      .asArray()
      .filter((entry) => !(entry instanceof PDFRef && refs.has(entry)))
  );

/** The fields with a widget under a box on a redacted page. */
const fieldsUnderBoxes = (
  doc: PDFDocument,
  pages: readonly PDFPage[],
  redacted: ReadonlyMap<number, { boxes: readonly UserRect[] }>
): Set<PDFRef> => {
  const fields = new Set<PDFRef>();
  for (const [index, { boxes }] of redacted) {
    for (const entry of pages[index]?.node.Annots()?.asArray() ?? []) {
      const dict = doc.context.lookup(entry);
      if (
        entry instanceof PDFRef &&
        dict instanceof PDFDict &&
        isSubtype(dict, "Widget") &&
        rectArrayTouchesBoxes(annotRect(dict), boxes)
      ) {
        fields.add(terminalFieldRef(doc, entry));
      }
    }
  }
  return fields;
};

/** A field's widgets: its kids, or the field itself when merged. */
const widgetsOf = (doc: PDFDocument, field: PDFRef): PDFRef[] => {
  const kids = doc.context
    .lookupMaybe(field, PDFDict)
    ?.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) {
    return [field];
  }
  return kids.asArray().filter((kid) => kid instanceof PDFRef);
};

/** Take a field out of its parent's kids, or out of the form's fields. */
const detachField = (doc: PDFDocument, field: PDFRef): void => {
  const parent = doc.context
    .lookupMaybe(field, PDFDict)
    ?.get(PDFName.of("Parent"));
  const nested = parent instanceof PDFRef;
  const owner = nested
    ? doc.context.lookupMaybe(parent, PDFDict)
    : doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const key = PDFName.of(nested ? "Kids" : "Fields");
  const list = owner?.lookup(key);
  if (owner && list instanceof PDFArray) {
    owner.set(key, withoutRefs(doc, list, new Set([field])));
  }
};

/** A removed field must not stay reachable through the calculation order. */
const dropFromCalculationOrder = (
  doc: PDFDocument,
  fields: ReadonlySet<PDFRef>
): void => {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const order = acroForm?.lookup(PDFName.of("CO"));
  if (acroForm && order instanceof PDFArray) {
    acroForm.set(PDFName.of("CO"), withoutRefs(doc, order, fields));
  }
};

/**
 * Remove every field with a widget under a box, with all its widgets on
 * every page: its value would otherwise survive in the form. Returns the
 * removed fields' names.
 */
export const removeFieldsUnderBoxes = (
  doc: PDFDocument,
  pages: readonly PDFPage[],
  redacted: ReadonlyMap<number, { boxes: readonly UserRect[] }>
): string[] => {
  const fields = fieldsUnderBoxes(doc, pages, redacted);
  const widgets = new Set(
    [...fields].flatMap((field) => widgetsOf(doc, field))
  );
  if (widgets.size > 0) {
    for (const page of pages) {
      const annots = page.node.Annots();
      if (annots) {
        page.node.set(PDFName.of("Annots"), withoutRefs(doc, annots, widgets));
      }
    }
  }
  const names = [...fields].map((field) => qualifiedName(doc, field));
  for (const field of fields) {
    detachField(doc, field);
  }
  dropFromCalculationOrder(doc, fields);
  return names.toSorted();
};
