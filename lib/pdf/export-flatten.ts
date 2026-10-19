import fontkit from "@pdf-lib/fontkit";
import {
  beginText,
  endText,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  StandardFonts,
  TextRenderingMode,
} from "pdf-lib";
import type { PDFFont, PDFObject } from "pdf-lib";

import {
  markInternalLinkTargets,
  resolveInternalLinkTargets,
} from "@/lib/pdf/export-annotations";
import type { OutputPagePlacement } from "@/lib/pdf/export-annotations";
import { writeOutputAcroForm } from "@/lib/pdf/export-forms";
import { saveSwept } from "@/lib/pdf/output-gc";
import {
  rectArrayTouchesBoxes,
  textClearOfBoxes,
} from "@/lib/pdf/output-pages";
import type { PositionedText, RedactionBox } from "@/lib/pdf/output-pages";
import { scrubHiddenData } from "@/lib/pdf/scrub";

/** A redacted page as rendered on the main thread, boxes painted in. */
export interface FlattenedPage {
  boxes: RedactionBox[];
  /** JPEG of the page's crop box at rotation 0, boxes filled. */
  jpeg: Uint8Array;
  outputIndex: number;
  /** Text outside every box, to keep the page searchable. */
  text: PositionedText[];
}

export interface FlattenInput {
  /** The export with redactions skipped (pass 1). */
  bytes: Uint8Array;
  /** The face for the invisible text; Helvetica when unset. */
  fontBytes?: Uint8Array;
  pages: readonly FlattenedPage[];
}

export interface FlattenReport {
  bytes: Uint8Array;
  flattenedPageCount: number;
  /** Fully qualified names of form fields removed with a redacted widget. */
  removedFieldNames: string[];
}

const PASS_ONE_DOC_ID = "pass-1";

const fieldText = (dict: PDFDict, key: string): string | null => {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : null;
};

const isSubtype = (dict: PDFDict, subtype: string): boolean =>
  dict.get(PDFName.of("Subtype")) === PDFName.of(subtype);

const annotRect = (dict: PDFDict): number[] => {
  const rect = dict.lookup(PDFName.of("Rect"));
  return rect instanceof PDFArray
    ? rect.asArray().map((value) => Number(value.toString()))
    : [];
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
  redacted: ReadonlyMap<number, FlattenedPage>
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

/**
 * Remove every field with a widget under a box, with all its widgets on
 * every page: its value would otherwise survive in the form. Returns the
 * removed fields' names.
 */
const removeFieldsUnderBoxes = (
  doc: PDFDocument,
  pages: readonly PDFPage[],
  redacted: ReadonlyMap<number, FlattenedPage>
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
  return names.toSorted();
};

/** A redacted page keeps only its links that stay clear of every box. */
const keepClearLinks = (
  doc: PDFDocument,
  page: PDFPage,
  boxes: readonly RedactionBox[]
): void => {
  const annots = page.node.Annots();
  if (!annots) {
    return;
  }
  const kept = annots.asArray().filter((entry) => {
    const dict = doc.context.lookup(entry);
    return (
      dict instanceof PDFDict &&
      isSubtype(dict, "Link") &&
      !rectArrayTouchesBoxes(annotRect(dict), boxes)
    );
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
};

const encodeOrNull = (font: PDFFont, text: string): PDFHexString | null => {
  try {
    return font.encodeText(text);
  } catch {
    return null;
  }
};

/** Advance-axis stretch (Tz, percent) that makes the text span `width`. */
const HUNDRED_PERCENT = 100;

/**
 * Searchable, unpainted text (rendering mode 3) on a pdf.js text matrix,
 * stretched so it spans the width pdf.js measured for the original.
 */
const pushInvisibleRun = (
  page: PDFPage,
  font: PDFFont,
  fontKey: PDFName,
  item: PositionedText
): void => {
  const encoded = encodeOrNull(font, item.str);
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  const run = Math.hypot(a, b);
  const natural = font.widthOfTextAtSize(item.str, 1) * run;
  if (!encoded || run === 0 || natural <= 0) {
    return;
  }
  const stretch = (HUNDRED_PERCENT * item.width) / natural;
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(fontKey, 1),
    setTextMatrix(a, b, c, d, e, f),
    setCharacterSqueeze(stretch),
    showText(encoded),
    endText(),
    popGraphicsState()
  );
};

const embedTextFont = async (
  doc: PDFDocument,
  fontBytes: Uint8Array | undefined
): Promise<PDFFont> => {
  if (fontBytes) {
    try {
      return await doc.embedFont(fontBytes, { subset: true });
    } catch {
      // A font fontkit cannot parse falls back to the standard face.
    }
  }
  return doc.embedFont(StandardFonts.Helvetica);
};

/** Rebuild a redacted page from its picture and the text outside the boxes. */
const drawFlattenedPage = async (
  output: PDFDocument,
  source: PDFPage,
  flattened: FlattenedPage,
  font: () => Promise<PDFFont>
): Promise<PDFPage> => {
  const crop = source.getCropBox();
  const page = output.addPage([crop.width, crop.height]);
  page.setMediaBox(crop.x, crop.y, crop.width, crop.height);
  page.setRotation(source.getRotation());
  const image = await output.embedJpg(flattened.jpeg);
  page.drawImage(image, {
    height: crop.height,
    width: crop.width,
    x: crop.x,
    y: crop.y,
  });
  const text = flattened.text.filter(
    (item) => item.str.trim() !== "" && textClearOfBoxes(item, flattened.boxes)
  );
  if (text.length > 0) {
    const textFont = await font();
    const fontKey = page.node.newFontDictionary(textFont.name, textFont.ref);
    for (const item of text) {
      pushInvisibleRun(page, textFont, fontKey, item);
    }
  }
  return page;
};

/**
 * Pass 2 of a redacting export: copy pass 1 into a fresh document, rebuilding
 * each redacted page from its rendered picture. Nothing of a redacted page's
 * content stream, fonts or images survives; its links outside the boxes and
 * the text outside the boxes (invisible, searchable) do. Every other page is
 * copied as it is. Hidden data is scrubbed and unreachable objects swept.
 */
export const flattenRedactedPages = async (
  input: FlattenInput
): Promise<FlattenReport> => {
  const source = await PDFDocument.load(input.bytes, { updateMetadata: false });
  const sourcePages = source.getPages();
  const redacted = new Map(input.pages.map((page) => [page.outputIndex, page]));
  const removedFieldNames = removeFieldsUnderBoxes(
    source,
    sourcePages,
    redacted
  );
  for (const [index, { boxes }] of redacted) {
    const page = sourcePages[index];
    if (page) {
      keepClearLinks(source, page, boxes);
    }
  }
  markInternalLinkTargets(
    new Map([[PASS_ONE_DOC_ID, { doc: source, pages: sourcePages }]]),
    sourcePages.map((_, sourceIndex) => ({
      docId: PASS_ONE_DOC_ID,
      sourceIndex,
    }))
  );

  const output = await PDFDocument.create({ updateMetadata: false });
  output.registerFontkit(fontkit);
  let textFont: Promise<PDFFont> | undefined;
  const font = (): Promise<PDFFont> => {
    textFont ??= embedTextFont(output, input.fontBytes);
    return textFont;
  };
  const copier = PDFObjectCopier.for(source.context, output.context);
  const placements: OutputPagePlacement[] = [];
  for (const [sourceIndex, sourcePage] of sourcePages.entries()) {
    const flattened = redacted.get(sourceIndex);
    let page: PDFPage;
    if (flattened) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- pages are written in order
      page = await drawFlattenedPage(output, sourcePage, flattened, font);
      for (const link of sourcePage.node.Annots()?.asArray() ?? []) {
        const copied = copier.copy(link);
        page.node.addAnnot(
          copied instanceof PDFRef ? copied : output.context.register(copied)
        );
      }
    } else {
      const node = copier.copy(sourcePage.node);
      page = PDFPage.of(node, output.context.register(node), output);
      output.addPage(page);
    }
    placements.push({ docId: PASS_ONE_DOC_ID, page, sourceIndex });
  }
  resolveInternalLinkTargets(output, placements);
  writeOutputAcroForm(output, [{ copier, source }]);
  scrubHiddenData(output);
  return {
    bytes: await saveSwept(output),
    flattenedPageCount: redacted.size,
    removedFieldNames,
  };
};
