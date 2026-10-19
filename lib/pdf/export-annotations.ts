import type { PDFDocument, PDFFont, PDFObject, PDFPage } from "pdf-lib";
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";

import { displayedToUserSpace } from "@/lib/editor/coordinates";
import {
  isPdfAnnotationDirty,
  pdfLinkActionsEqual,
} from "@/lib/editor/object-utils";
import { pageKeyOf, pageKeyString } from "@/lib/editor/page-source";
import type {
  EditorPage,
  PdfAnnotationObject,
  PdfFreeTextAnnotation,
  PdfLinkAnnotation,
  PdfMarkupAnnotation,
} from "@/lib/editor/types";

// oxlint-disable-next-line eslint/prefer-named-capture-group -- ES2017 target lacks named capture groups in TypeScript.
const SOURCE_REF_REGEX = /^(\d+)R(\d*)$/u;

const parseSourceRef = (
  sourceRef: string
): { generationNumber: number; objectNumber: number } | null => {
  const match = SOURCE_REF_REGEX.exec(sourceRef);
  if (!match?.[1]) {
    return null;
  }
  return {
    generationNumber: match[2] ? Math.trunc(Number(match[2])) : 0,
    objectNumber: Math.trunc(Number(match[1])),
  };
};

/** Source annotation ref ("12R0") → the ref of its copy on the output page. */
export type AnnotRefMap = ReadonlyMap<string, PDFRef>;

const refKey = (objectNumber: number, generationNumber: number): string =>
  `${objectNumber}R${generationNumber}`;

const findAnnotRef = (
  annotRefs: AnnotRefMap,
  sourceRef: string
): PDFRef | null => {
  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    return null;
  }
  return (
    annotRefs.get(refKey(parsed.objectNumber, parsed.generationNumber)) ?? null
  );
};

/**
 * Pair each annotation of a source page with its copy: the copier keeps the
 * `/Annots` order, so entries match by position.
 */
export const copiedAnnotRefs = (
  source: PDFPage,
  copy: PDFPage
): AnnotRefMap => {
  const refs = new Map<string, PDFRef>();
  const from = source.node.Annots();
  const to = copy.node.Annots();
  if (!(from && to)) {
    return refs;
  }
  for (let index = 0; index < Math.min(from.size(), to.size()); index += 1) {
    const original = from.get(index);
    const copied = to.get(index);
    if (original instanceof PDFRef && copied instanceof PDFRef) {
      refs.set(
        refKey(original.objectNumber, original.generationNumber),
        copied
      );
    }
  }
  return refs;
};

const hexToPdfRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? [...normalized].map((char) => `${char}${char}`).join("")
      : normalized.padEnd(6, "0");
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ];
};

const userRectFromDisplayed = (
  object: PdfAnnotationObject,
  editorPage: EditorPage
): [number, number, number, number] => {
  const user = displayedToUserSpace(
    {
      height: object.height,
      width: object.width,
      x: object.x,
      y: object.y,
    },
    editorPage.cropBox,
    editorPage.sourceRotate
  );
  return [user.x, user.y, user.x + user.width, user.y + user.height];
};

const userQuadPointsFromLink = (
  link: PdfLinkAnnotation,
  editorPage: EditorPage
): number[] => {
  const flat: number[] = [];
  for (const quad of link.quads) {
    const user = displayedToUserSpace(
      quad,
      editorPage.cropBox,
      editorPage.sourceRotate
    );
    const x1 = user.x;
    const y1 = user.y;
    const x2 = user.x + user.width;
    const y2 = user.y + user.height;
    flat.push(x1, y2, x2, y2, x1, y1, x2, y1);
  }
  return flat;
};

const setLinkUriAction = (
  doc: PDFDocument,
  dict: PDFDict,
  url: string
): void => {
  dict.delete(PDFName.of("Dest"));
  const existing = dict.lookup(PDFName.of("A"), PDFDict);
  if (existing instanceof PDFDict) {
    const subtype = existing.get(PDFName.of("S"));
    if (subtype instanceof PDFName && subtype.decodeText() === "URI") {
      existing.set(PDFName.of("URI"), PDFString.of(url));
      return;
    }
  }
  const action = doc.context.obj({
    S: PDFName.of("URI"),
    Type: PDFName.of("Action"),
  });
  if (action instanceof PDFDict) {
    action.set(PDFName.of("URI"), PDFString.of(url));
  }
  dict.set(PDFName.of("A"), action);
};

const removeAnnotation = (
  doc: PDFDocument,
  page: PDFPage,
  annotRefs: AnnotRefMap,
  sourceRef: string,
  popupRef: string | null
): void => {
  const ref = findAnnotRef(annotRefs, sourceRef);
  if (!ref) {
    return;
  }
  page.node.removeAnnot(ref);
  doc.context.delete(ref);
  if (popupRef) {
    const popup = findAnnotRef(annotRefs, popupRef);
    if (popup) {
      page.node.removeAnnot(popup);
      doc.context.delete(popup);
    }
  }
};

const quadPathForMarkup = (
  object: PdfMarkupAnnotation,
  subtype: PdfMarkupAnnotation["type"]
): string => {
  const quads = object.originalUserQuadPoints;
  const [r, g, b] = hexToPdfRgb(object.color);
  const lines: string[] = ["q"];
  if (subtype === "pdf-highlight") {
    lines.push(`${r} ${g} ${b} rg`);
  } else {
    lines.push(`${r} ${g} ${b} RG`, "[] 0 d", "1 w");
  }
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const x1 = quads[i] ?? 0;
    const y1 = quads[i + 1] ?? 0;
    const x2 = quads[i + 2] ?? 0;
    const y2 = quads[i + 3] ?? 0;
    const x3 = quads[i + 4] ?? 0;
    const y3 = quads[i + 5] ?? 0;
    const x4 = quads[i + 6] ?? 0;
    const y4 = quads[i + 7] ?? 0;
    if (subtype === "pdf-highlight") {
      lines.push(`${x1} ${y1} m ${x2} ${y2} l ${x4} ${y4} l ${x3} ${y3} l h f`);
    } else if (subtype === "pdf-underline") {
      lines.push(`${x3} ${y3 + 1.3} m ${x4} ${y4 + 1.3} l S`);
    } else if (subtype === "pdf-strikeout") {
      const mx = (x1 + x3) / 2;
      const my = (y1 + y3) / 2;
      const nx = (x2 + x4) / 2;
      const ny = (y2 + y4) / 2;
      lines.push(`${mx} ${my} m ${nx} ${ny} l S`);
    } else {
      lines.push(`${x3} ${y3 + 1.3} m ${x4} ${y4 + 1.3} l S`);
    }
  }
  lines.push("Q");
  return lines.join("\n");
};

const setMarkupAppearance = (
  doc: PDFDocument,
  dict: PDFDict,
  object: PdfMarkupAnnotation,
  editorPage: EditorPage
): void => {
  const rect = userRectFromDisplayed(object, editorPage);
  const [r, g, b] = hexToPdfRgb(object.color);
  dict.set(PDFName.of("C"), doc.context.obj([r, g, b]));
  if (object.type === "pdf-highlight" && object.opacity !== undefined) {
    dict.set(PDFName.of("CA"), doc.context.obj(object.opacity));
  }
  dict.set(PDFName.of("Rect"), doc.context.obj(rect));
  const appearance = quadPathForMarkup(object, object.type);
  const stream = doc.context.flateStream(appearance, {
    BBox: doc.context.obj(rect),
    FormType: 1,
    Subtype: PDFName.of("Form"),
    Type: PDFName.of("XObject"),
  });
  const streamRef = doc.context.register(stream);
  const ap = doc.context.obj({ N: streamRef });
  dict.set(PDFName.of("AP"), ap);
};

const escapePdfString = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");

const setFreeTextAppearance = async (
  doc: PDFDocument,
  helvetica: () => Promise<PDFFont>,
  dict: PDFDict,
  object: PdfFreeTextAnnotation,
  editorPage: EditorPage
): Promise<void> => {
  const rect = userRectFromDisplayed(object, editorPage);
  const [r, g, b] = hexToPdfRgb(object.fontColor);
  dict.set(PDFName.of("Rect"), doc.context.obj(rect));
  dict.set(PDFName.of("Contents"), PDFString.of(object.contents));
  dict.set(
    PDFName.of("DA"),
    PDFString.of(`/Helv ${object.fontSize} Tf ${r} ${g} ${b} rg`)
  );
  const font = await helvetica();
  const { fontSize } = object;
  const lines = object.contents.split(/\r\n|\n|\r/u);
  const lineHeight = fontSize * 1.35;
  const textY = rect[3] - fontSize * 0.85;
  let stream = "q\n";
  stream += `${r} ${g} ${b} rg\n`;
  stream += `BT /Helv ${fontSize} Tf ${rect[0]} ${textY} Td\n`;
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      stream += `0 -${lineHeight} Td\n`;
    }
    stream += `(${escapePdfString(line)}) Tj\n`;
  }
  stream += "ET\nQ";
  const appearanceStream = doc.context.flateStream(stream, {
    BBox: doc.context.obj(rect),
    FormType: 1,
    Matrix: doc.context.obj([1, 0, 0, 1, -rect[0], -rect[1]]),
    Resources: doc.context.obj({
      Font: doc.context.obj({ Helv: font.ref }),
    }),
    Subtype: PDFName.of("Form"),
    Type: PDFName.of("XObject"),
  });
  const appearanceRef = doc.context.register(appearanceStream);
  dict.set(PDFName.of("AP"), doc.context.obj({ N: appearanceRef }));
};

// oxlint-disable-next-line eslint/complexity -- per-annotation-type export branches.
const applyAnnotationEdit = async (
  doc: PDFDocument,
  helvetica: () => Promise<PDFFont>,
  editorPage: EditorPage,
  page: PDFPage,
  annotRefs: AnnotRefMap,
  object: PdfAnnotationObject
): Promise<void> => {
  if (object.deleted) {
    removeAnnotation(
      doc,
      page,
      annotRefs,
      object.sourceRef,
      "popupRef" in object ? object.popupRef : null
    );
    return;
  }
  const ref = findAnnotRef(annotRefs, object.sourceRef);
  if (!ref) {
    return;
  }
  const dict = doc.context.lookup(ref, PDFDict);
  if (!(dict instanceof PDFDict)) {
    return;
  }
  switch (object.type) {
    case "pdf-highlight":
    case "pdf-underline":
    case "pdf-squiggly":
    case "pdf-strikeout": {
      setMarkupAppearance(doc, dict, object, editorPage);
      return;
    }
    case "pdf-free-text": {
      await setFreeTextAppearance(doc, helvetica, dict, object, editorPage);
      return;
    }
    case "pdf-text-note": {
      dict.set(
        PDFName.of("Rect"),
        doc.context.obj(userRectFromDisplayed(object, editorPage))
      );
      dict.set(PDFName.of("Contents"), PDFString.of(object.contents));
      return;
    }
    case "pdf-stamp": {
      if (object.x !== object.originalX || object.y !== object.originalY) {
        dict.set(
          PDFName.of("Rect"),
          doc.context.obj(userRectFromDisplayed(object, editorPage))
        );
      }
      break;
    }
    case "pdf-link": {
      if (
        !pdfLinkActionsEqual(object.action, object.originalAction) &&
        object.action.kind === "url"
      ) {
        setLinkUriAction(doc, dict, object.action.url);
      }
      const geometryDirty =
        object.x !== object.originalX ||
        object.y !== object.originalY ||
        object.width !== object.originalWidth ||
        object.height !== object.originalHeight ||
        object.label !== object.originalLabel;
      if (
        geometryDirty &&
        object.originalUserQuadPoints &&
        object.originalUserQuadPoints.length >= 8
      ) {
        dict.set(
          PDFName.of("Rect"),
          doc.context.obj(userRectFromDisplayed(object, editorPage))
        );
        dict.set(
          PDFName.of("QuadPoints"),
          doc.context.obj(userQuadPointsFromLink(object, editorPage))
        );
      } else if (geometryDirty) {
        dict.set(
          PDFName.of("Rect"),
          doc.context.obj(userRectFromDisplayed(object, editorPage))
        );
      }
      break;
    }
    default: {
      break;
    }
  }
};

/** An explicit destination array, direct or behind a ref. */
const destinationArray = (
  doc: PDFDocument,
  dest: PDFObject | undefined
): PDFArray | null => {
  const resolved = dest instanceof PDFRef ? doc.context.lookup(dest) : dest;
  return resolved instanceof PDFArray ? resolved : null;
};

/** A link's explicit destination arrays: its `/Dest` and its GoTo's `/D`. */
const linkDestinations = (
  doc: PDFDocument,
  link: PDFDict
): { array: PDFArray; drop: () => void }[] => {
  const found: { array: PDFArray; drop: () => void }[] = [];
  const dest = destinationArray(doc, link.get(PDFName.of("Dest")));
  if (dest) {
    found.push({ array: dest, drop: () => link.delete(PDFName.of("Dest")) });
  }
  const action = doc.context.lookup(link.get(PDFName.of("A")));
  if (
    action instanceof PDFDict &&
    action.get(PDFName.of("S")) === PDFName.of("GoTo")
  ) {
    const goTo = destinationArray(doc, action.get(PDFName.of("D")));
    if (goTo) {
      found.push({ array: goTo, drop: () => link.delete(PDFName.of("A")) });
    }
  }
  return found;
};

const isLink = (dict: PDFDict): boolean =>
  dict.get(PDFName.of("Subtype")) === PDFName.of("Link");

/**
 * Prepare the annotations of every output page for copying. A ref to a
 * source page would make the copier write that page again as a hidden copy
 * (it maps objects, not refs), carrying its original content. So an
 * internal link's target becomes a number marker holding the source page
 * index, resolved once the output pages exist, and every `/P` goes (it is
 * set again on the copy). A link to a page left out of the output (deleted,
 * or not extracted) loses its destination. Edits the parsed sources, which
 * exist only for this export.
 */
export const markInternalLinkTargets = (
  sources: ReadonlyMap<string, { doc: PDFDocument; pages: PDFPage[] }>,
  outputPages: readonly EditorPage[]
): void => {
  const kept = new Set(
    outputPages.map((page) => pageKeyString(pageKeyOf(page)))
  );
  for (const [docId, { doc, pages }] of sources) {
    const indexByRef = new Map(
      pages.map((page, index) => [
        refKey(page.ref.objectNumber, page.ref.generationNumber),
        index,
      ])
    );
    /** The source index a destination names, or null for none in this doc. */
    const targetIndex = (target: PDFObject | undefined): number | null => {
      if (target instanceof PDFNumber) {
        // Marked already (a shared array), or a producer's page index.
        return target.asNumber();
      }
      if (!(target instanceof PDFRef)) {
        return null;
      }
      return (
        indexByRef.get(refKey(target.objectNumber, target.generationNumber)) ??
        null
      );
    };
    for (const [index, page] of pages.entries()) {
      if (!kept.has(pageKeyString({ docId, sourceIndex: index }))) {
        continue;
      }
      for (const entry of page.node.Annots()?.asArray() ?? []) {
        const dict = doc.context.lookup(entry);
        if (!(dict instanceof PDFDict)) {
          continue;
        }
        dict.delete(PDFName.of("P"));
        if (!isLink(dict)) {
          continue;
        }
        for (const { array, drop } of linkDestinations(doc, dict)) {
          const target = targetIndex(array.get(0));
          if (
            target === null ||
            !kept.has(pageKeyString({ docId, sourceIndex: target }))
          ) {
            drop();
          } else {
            array.set(0, PDFNumber.of(target));
          }
        }
      }
    }
  }
};

/** An output page and the source page it was copied from. */
export interface OutputPagePlacement {
  docId: string;
  page: PDFPage;
  sourceIndex: number;
}

/**
 * Point each marked link target at the first output page copied from that
 * source page, and give every annotation the `/P` of the page that holds
 * it. `placements` are the output pages in order.
 */
export const resolveInternalLinkTargets = (
  output: PDFDocument,
  placements: readonly OutputPagePlacement[]
): void => {
  const firstCopy = new Map<string, PDFRef>();
  for (const { docId, page, sourceIndex } of placements) {
    const key = pageKeyString({ docId, sourceIndex });
    if (!firstCopy.has(key)) {
      firstCopy.set(key, page.ref);
    }
  }
  for (const { docId, page } of placements) {
    for (const entry of page.node.Annots()?.asArray() ?? []) {
      const dict = output.context.lookup(entry);
      if (!(dict instanceof PDFDict)) {
        continue;
      }
      dict.set(PDFName.of("P"), page.ref);
      if (!isLink(dict)) {
        continue;
      }
      for (const { array, drop } of linkDestinations(output, dict)) {
        const marker = array.get(0);
        if (!(marker instanceof PDFNumber)) {
          continue;
        }
        const target = firstCopy.get(
          pageKeyString({ docId, sourceIndex: marker.asNumber() })
        );
        if (target) {
          array.set(0, target);
        } else {
          drop();
        }
      }
    }
  }
};

/** One Helvetica per output document, shared by every free-text appearance. */
export const helveticaFor = (doc: PDFDocument): (() => Promise<PDFFont>) => {
  let embedded: Promise<PDFFont> | undefined;
  return () => {
    embedded ??= doc.embedFont(StandardFonts.Helvetica);
    return embedded;
  };
};

/**
 * Apply a page's annotation edits to its copy in the output. Each copy has
 * its own annotations, so a duplicated page's edits never leak into another.
 */
export const applyPageAnnotationEdits = async (
  doc: PDFDocument,
  helvetica: () => Promise<PDFFont>,
  editorPage: EditorPage,
  page: PDFPage,
  annotRefs: AnnotRefMap
): Promise<void> => {
  for (const object of editorPage.pdfAnnotationObjects) {
    if (!isPdfAnnotationDirty(object)) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential annot edits
    await applyAnnotationEdit(
      doc,
      helvetica,
      editorPage,
      page,
      annotRefs,
      object
    );
  }
};
