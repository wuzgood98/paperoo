import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFString,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import type {
  PDFDocument,
  PDFField,
  PDFObject,
  PDFFont,
  PDFForm,
  PDFObjectCopier,
  PDFPage,
} from "pdf-lib";

import { documentForm, isPdfFormFieldDirty } from "@/lib/editor/object-utils";
import type {
  EditorDocument,
  PdfFormChoiceOption,
  PdfFormField,
} from "@/lib/editor/types";
import {
  coversText,
  FORM_FALLBACK_FONT_URLS,
  formFieldDrawnText,
  helveticaCovers,
} from "@/lib/pdf/form-fonts";
import type { GlyphCover } from "@/lib/pdf/form-fonts";

const hasXfa = (source: PDFDocument): boolean =>
  source.catalog.AcroForm()?.has(PDFName.of("XFA")) === true;

const displayFor = (
  exportValue: string,
  options: readonly PdfFormChoiceOption[]
): string =>
  options.find((option) => option.exportValue === exportValue)?.display ??
  exportValue;

const withDisplaySelection = (
  field: PDFDropdown | PDFOptionList,
  options: readonly PdfFormChoiceOption[],
  run: () => void
): void => {
  const original = field.getSelected.bind(field);
  field.getSelected = () =>
    original().map((value) => displayFor(value, options));
  try {
    run();
  } finally {
    field.getSelected = original;
  }
};

/** Resolves an appearance font for a field's text, embedding each face once. */
export type FormFieldFonts = (text: string) => Promise<PDFFont>;

/**
 * Helvetica when it can draw every letter, else the first fallback font
 * that can, else the first fallback there is (the export warned already).
 */
export const createFormFieldFonts = (
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): FormFieldFonts => {
  let helvetica: Promise<PDFFont> | undefined;
  const embedded = new Map<string, Promise<PDFFont>>();
  const covers = new Map<string, GlyphCover>();
  const fallbacks = FORM_FALLBACK_FONT_URLS.filter((url) => fontBytes[url]);
  const coverOf = (url: string, bytes: Uint8Array): GlyphCover => {
    let cover = covers.get(url);
    if (!cover) {
      const face = fontkit.create(bytes);
      cover = (codePoint) => face.hasGlyphForCodePoint(codePoint);
      covers.set(url, cover);
    }
    return cover;
  };
  const embed = (url: string, bytes: Uint8Array): Promise<PDFFont> => {
    let font = embedded.get(url);
    if (!font) {
      // The source document is loaded, not created, so it has no fontkit.
      doc.registerFontkit(fontkit);
      font = doc.embedFont(bytes, { subset: true });
      embedded.set(url, font);
    }
    return font;
  };
  return async (text) => {
    helvetica ??= doc.embedFont(StandardFonts.Helvetica);
    if (coversText(helveticaCovers, text) || fallbacks.length === 0) {
      return await helvetica;
    }
    const covering = fallbacks.find((url) => {
      const bytes = fontBytes[url];
      return bytes ? coversText(coverOf(url, bytes), text) : false;
    });
    const url = covering ?? fallbacks[0];
    const bytes = url ? fontBytes[url] : undefined;
    return url && bytes ? await embed(url, bytes) : await helvetica;
  };
};

const applyChoiceValues = (
  pdfField: PDFDropdown | PDFOptionList,
  values: readonly string[],
  options: readonly PdfFormChoiceOption[],
  font: PDFFont
): void => {
  if (values.length === 0) {
    pdfField.clear();
  } else {
    const dropdown = pdfField instanceof PDFDropdown ? pdfField : null;
    const wasEditable = dropdown?.isEditable() ?? true;
    if (dropdown && !wasEditable) {
      dropdown.enableEditing();
    }
    pdfField.acroField.setValues(
      values.map((value) => PDFHexString.fromText(value))
    );
    if (dropdown && !wasEditable) {
      dropdown.disableEditing();
    }
  }
  withDisplaySelection(pdfField, options, () => {
    pdfField.updateAppearances(font);
  });
};

/**
 * Set the field's value and each widget's appearance state directly:
 * pdf-lib's check() only knows the first widget's on-state. The PDF's own
 * drawings stay; pdf-lib draws defaults only for widgets that have none.
 */
const setCheckboxState = (
  pdfField: PDFCheckBox,
  value: string | null
): void => {
  const off = PDFName.of("Off");
  const widgets = pdfField.acroField.getWidgets();
  if (widgets.some((widget) => !widget.getOnValue())) {
    pdfField.updateAppearances();
  }
  const on = value === null ? off : PDFName.of(value);
  pdfField.acroField.dict.set(PDFName.of("V"), on);
  for (const widget of widgets) {
    widget.setAppearanceState(widget.getOnValue() === on ? on : off);
  }
};

/** A ref as PDF.js writes annotation ids: `12R`, or `12R3` with a generation. */
const pdfJsRefId = (ref: PDFRef): string =>
  ref.generationNumber === 0
    ? `${ref.objectNumber}R`
    : `${ref.objectNumber}R${ref.generationNumber}`;

/** Each widget's owning field, by the widget's PDF.js annotation id. */
const fieldsByWidgetId = (form: PDFForm): Map<string, PDFField> => {
  const owners = new Map<string, PDFField>();
  for (const pdfField of form.getFields()) {
    // A field with one widget may be the widget itself.
    owners.set(pdfJsRefId(pdfField.ref), pdfField);
    const kids = pdfField.acroField.Kids();
    for (const kid of kids?.asArray() ?? []) {
      if (kid instanceof PDFRef) {
        owners.set(pdfJsRefId(kid), pdfField);
      }
    }
  }
  return owners;
};

/**
 * The fields that own this field's widgets. Usually one; more when a PDF
 * gives two fields the same full name, which a name lookup would miss.
 */
const owningFields = (
  owners: ReadonlyMap<string, PDFField>,
  field: PdfFormField
): PDFField[] => [
  ...new Set(
    field.widgets.flatMap((widget) => {
      const owner = owners.get(widget.sourceAnnotId);
      return owner ? [owner] : [];
    })
  ),
];

// oxlint-disable-next-line eslint/complexity -- one write path per AcroForm field kind
const applyToPdfField = (
  pdfField: PDFField,
  field: PdfFormField,
  font: PDFFont
): void => {
  if (field.kind === "text" && pdfField instanceof PDFTextField) {
    pdfField.setText(field.value.length > 0 ? field.value : undefined);
    pdfField.updateAppearances(font);
    return;
  }
  if (field.kind === "checkbox" && pdfField instanceof PDFCheckBox) {
    setCheckboxState(pdfField, field.value);
    return;
  }
  if (field.kind === "radio" && pdfField instanceof PDFRadioGroup) {
    if (field.value) {
      pdfField.select(field.value);
    } else {
      pdfField.clear();
    }
    pdfField.updateAppearances();
    return;
  }
  if (field.kind === "dropdown" && pdfField instanceof PDFDropdown) {
    applyChoiceValues(
      pdfField,
      field.value ? [field.value] : [],
      field.options,
      font
    );
    return;
  }
  if (field.kind === "listbox" && pdfField instanceof PDFOptionList) {
    applyChoiceValues(pdfField, field.value, field.options, font);
  }
};

const DA = PDFName.of("DA");

/**
 * pdf-lib writes the size it drew at into /DA, so a fit-to-box field
 * would stop fitting in every viewer after one export. Put each back.
 */
const keepDefaultAppearances = (pdfField: PDFField, draw: () => void): void => {
  const dicts = [
    pdfField.acroField.dict,
    ...pdfField.acroField.getWidgets().map((widget) => widget.dict),
  ];
  const saved = dicts.map((dict): [PDFDict, PDFObject | undefined] => [
    dict,
    dict.get(DA),
  ]);
  draw();
  for (const [dict, appearance] of saved) {
    if (appearance) {
      dict.set(DA, appearance);
    } else {
      dict.delete(DA);
    }
  }
};

const applyField = async (
  owners: ReadonlyMap<string, PDFField>,
  field: PdfFormField,
  fonts: FormFieldFonts
): Promise<void> => {
  if (field.kind === "signature" || !isPdfFormFieldDirty(field)) {
    return;
  }
  if (field.kind === "text" && (field.richText || field.fileSelect)) {
    return;
  }
  const pdfFields = owningFields(owners, field);
  if (pdfFields.length === 0) {
    return;
  }
  const font = await fonts(formFieldDrawnText(field));
  for (const pdfField of pdfFields) {
    keepDefaultAppearances(pdfField, () => {
      applyToPdfField(pdfField, field, font);
    });
  }
};

export const applyPdfFormEdits = async (
  source: PDFDocument,
  document: EditorDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<void> => {
  if (hasXfa(source)) {
    return;
  }
  const owners = fieldsByWidgetId(source.getForm());
  const fonts = createFormFieldFonts(source, fontBytes);
  for (const field of documentForm(document).fields) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- appearances must apply in field order
    await applyField(owners, field, fonts);
  }
};

const refKey = (ref: PDFRef): string =>
  `${ref.objectNumber}R${ref.generationNumber}`;

/** Take the form widgets off a copied page (a duplicate keeps no fields). */
export const stripFormWidgets = (output: PDFDocument, page: PDFPage): void => {
  const annots = page.node.Annots();
  if (!annots) {
    return;
  }
  const kept = annots.asArray().filter((entry) => {
    const dict = output.context.lookup(entry);
    return !(
      dict instanceof PDFDict &&
      dict.get(PDFName.of("Subtype")) === PDFName.of("Widget")
    );
  });
  page.node.set(PDFName.of("Annots"), output.context.obj(kept));
};

/** Every annotation ref on the output's pages. */
export const outputAnnotRefKeys = (output: PDFDocument): Set<string> => {
  const keys = new Set<string>();
  for (const page of output.getPages()) {
    const annots = page.node.Annots();
    if (!annots) {
      continue;
    }
    for (let index = 0; index < annots.size(); index += 1) {
      const entry = annots.get(index);
      if (entry instanceof PDFRef) {
        keys.add(refKey(entry));
      }
    }
  }
  return keys;
};

/**
 * Keep a field node when it still shows somewhere: a widget on an output
 * page, or a field whose kids keep one. Fields that never had widgets stay.
 */
const pruneFieldRef = (
  output: PDFDocument,
  ref: PDFRef,
  onPage: ReadonlySet<string>
): boolean => {
  const dict = output.context.lookup(ref);
  if (!(dict instanceof PDFDict)) {
    return false;
  }
  if (dict.get(PDFName.of("Subtype")) === PDFName.of("Widget")) {
    return onPage.has(refKey(ref));
  }
  const kids = dict.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray) || kids.size() === 0) {
    return true;
  }
  const kept = kids
    .asArray()
    .filter(
      (kid): kid is PDFRef =>
        kid instanceof PDFRef && pruneFieldRef(output, kid, onPage)
    );
  dict.set(PDFName.of("Kids"), output.context.obj(kept));
  return kept.length > 0;
};

/**
 * Give the output one AcroForm: each source's form, copied with the copier
 * its pages used so widget refs line up, keeping only fields that still
 * have a widget on an output page (pages may have been deleted or split off).
 */
const fieldName = (field: PDFDict): string | null => {
  const name = field.lookup(PDFName.of("T"));
  return name instanceof PDFString || name instanceof PDFHexString
    ? name.decodeText()
    : null;
};

/** Every field and widget ref under the given fields. */
const fieldTreeRefKeys = (
  output: PDFDocument,
  fields: readonly PDFRef[]
): Set<string> => {
  const keys = new Set<string>();
  const stack = [...fields];
  for (let ref = stack.pop(); ref; ref = stack.pop()) {
    if (keys.has(refKey(ref))) {
      continue;
    }
    keys.add(refKey(ref));
    const kids = output.context
      .lookupMaybe(ref, PDFDict)
      ?.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray) {
      for (const kid of kids.asArray()) {
        if (kid instanceof PDFRef) {
          stack.push(kid);
        }
      }
    }
  }
  return keys;
};

/** `name`, or `name_2`, `name_3`… — the first not yet taken. */
const unusedName = (name: string, taken: ReadonlySet<string>): string => {
  let suffix = 2;
  while (taken.has(`${name}_${suffix}`)) {
    suffix += 1;
  }
  return `${name}_${suffix}`;
};

/** Merge another source's form resources (fonts) without replacing any. */
const mergeFormResources = (into: PDFDict, from: PDFDict): void => {
  const fromFonts = from
    .lookupMaybe(PDFName.of("DR"), PDFDict)
    ?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const intoResources = into.lookupMaybe(PDFName.of("DR"), PDFDict);
  const intoFonts = intoResources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!(fromFonts && intoFonts)) {
    return;
  }
  for (const [key, value] of fromFonts.entries()) {
    if (!intoFonts.has(key)) {
      intoFonts.set(key, value);
    }
  }
};

export const writeOutputAcroForm = (
  output: PDFDocument,
  sources: readonly { copier: PDFObjectCopier; source: PDFDocument }[]
): void => {
  const onPage = outputAnnotRefKeys(output);
  let merged: PDFDict | null = null;
  const fields: PDFRef[] = [];
  const calculationOrder: PDFRef[] = [];
  // Field names must be unique in a document: a later source's clashing
  // top-level name is renamed on its copy (Name → Name_2).
  const taken = new Set<string>();
  for (const { copier, source } of sources) {
    const acroForm = source.catalog.get(PDFName.of("AcroForm"));
    if (!acroForm) {
      continue;
    }
    const copied = output.context.lookup(copier.copy(acroForm));
    if (!(copied instanceof PDFDict)) {
      continue;
    }
    if (merged) {
      mergeFormResources(merged, copied);
    } else {
      merged = copied;
    }
    const order = copied.lookup(PDFName.of("CO"));
    if (order instanceof PDFArray) {
      for (const entry of order.asArray()) {
        if (entry instanceof PDFRef) {
          calculationOrder.push(entry);
        }
      }
    }
    const sourceFields = copied.lookup(PDFName.of("Fields"));
    if (!(sourceFields instanceof PDFArray)) {
      continue;
    }
    const names: string[] = [];
    for (const field of sourceFields.asArray()) {
      if (!(field instanceof PDFRef && pruneFieldRef(output, field, onPage))) {
        continue;
      }
      fields.push(field);
      const dict = output.context.lookup(field);
      const name = dict instanceof PDFDict ? fieldName(dict) : null;
      if (!(dict instanceof PDFDict && name !== null)) {
        continue;
      }
      if (taken.has(name)) {
        const renamed = unusedName(name, taken);
        dict.set(PDFName.of("T"), PDFHexString.fromText(renamed));
        names.push(renamed);
      } else {
        names.push(name);
      }
    }
    // A source's own names never clash with each other.
    for (const name of names) {
      taken.add(name);
    }
  }
  if (!merged) {
    return;
  }
  merged.set(PDFName.of("Fields"), output.context.obj(fields));
  // A calculation order naming a pruned field would keep it in the file.
  const keptFields = fieldTreeRefKeys(output, fields);
  const keptOrder = calculationOrder.filter((ref) =>
    keptFields.has(refKey(ref))
  );
  if (keptOrder.length > 0) {
    merged.set(PDFName.of("CO"), output.context.obj(keptOrder));
  } else {
    merged.delete(PDFName.of("CO"));
  }
  // The XFA form is a second copy of every field, values included.
  merged.delete(PDFName.of("XFA"));
  output.catalog.set(PDFName.of("AcroForm"), output.context.register(merged));
};
