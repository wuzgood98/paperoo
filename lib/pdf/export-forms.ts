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
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import type { PDFDocument, PDFFont, PDFForm, PDFObjectCopier } from "pdf-lib";

import { documentForm, isPdfFormFieldDirty } from "@/lib/editor/object-utils";
import type {
  EditorDocument,
  PdfFormChoiceOption,
  PdfFormField,
} from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";

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

export const createFormFieldFonts = (
  doc: PDFDocument,
  fontBytes: Record<string, Uint8Array>
): FormFieldFonts => {
  let helvetica: Promise<PDFFont> | undefined;
  let fallback: Promise<PDFFont> | undefined;
  return async (text) => {
    helvetica ??= doc.embedFont(StandardFonts.Helvetica);
    const standard = await helvetica;
    try {
      standard.encodeText(text);
      return standard;
    } catch {
      const bytes = fontBytes[FONT_FILES.sans[400]];
      if (!bytes) {
        return standard;
      }
      if (!fallback) {
        // The source document is loaded, not created, so it has no fontkit.
        doc.registerFontkit(fontkit);
        fallback = doc.embedFont(bytes, { subset: true });
      }
      return await fallback;
    }
  };
};

const appearanceText = (field: PdfFormField): string => {
  switch (field.kind) {
    case "text": {
      return field.value;
    }
    case "dropdown": {
      return field.value ? displayFor(field.value, field.options) : "";
    }
    case "listbox": {
      return field.value
        .map((value) => displayFor(value, field.options))
        .join("\n");
    }
    case "radio": {
      return field.value ?? "";
    }
    default: {
      return "";
    }
  }
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

// oxlint-disable-next-line eslint/complexity -- one write path per AcroForm field kind
const applyField = async (
  form: PDFForm,
  field: PdfFormField,
  fonts: FormFieldFonts
): Promise<void> => {
  if (field.kind === "signature" || !isPdfFormFieldDirty(field)) {
    return;
  }
  if (field.kind === "text" && (field.richText || field.fileSelect)) {
    return;
  }
  const pdfField = form.getFieldMaybe(field.name);
  if (!pdfField) {
    return;
  }
  const font = await fonts(appearanceText(field));
  if (field.kind === "text" && pdfField instanceof PDFTextField) {
    pdfField.setText(field.value.length > 0 ? field.value : undefined);
    pdfField.updateAppearances(font);
    return;
  }
  if (field.kind === "checkbox" && pdfField instanceof PDFCheckBox) {
    if (field.value) {
      pdfField.check();
    } else {
      pdfField.uncheck();
    }
    pdfField.updateAppearances();
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

export const applyPdfFormEdits = async (
  source: PDFDocument,
  document: EditorDocument,
  fontBytes: Record<string, Uint8Array>
): Promise<void> => {
  if (hasXfa(source)) {
    return;
  }
  const form = source.getForm();
  const fonts = createFormFieldFonts(source, fontBytes);
  for (const field of documentForm(document).fields) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- appearances must apply in field order
    await applyField(form, field, fonts);
  }
};

const refKey = (ref: PDFRef): string =>
  `${ref.objectNumber}R${ref.generationNumber}`;

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
export const writeOutputAcroForm = (
  output: PDFDocument,
  sources: readonly { copier: PDFObjectCopier; source: PDFDocument }[]
): void => {
  const onPage = outputAnnotRefKeys(output);
  let merged: PDFDict | null = null;
  const fields: PDFRef[] = [];
  for (const { copier, source } of sources) {
    const acroForm = source.catalog.get(PDFName.of("AcroForm"));
    if (!acroForm) {
      continue;
    }
    const copied = output.context.lookup(copier.copy(acroForm));
    if (!(copied instanceof PDFDict)) {
      continue;
    }
    merged ??= copied;
    const sourceFields = copied.lookup(PDFName.of("Fields"));
    if (!(sourceFields instanceof PDFArray)) {
      continue;
    }
    for (const field of sourceFields.asArray()) {
      if (field instanceof PDFRef && pruneFieldRef(output, field, onPage)) {
        fields.push(field);
      }
    }
  }
  if (!merged) {
    return;
  }
  merged.set(PDFName.of("Fields"), output.context.obj(fields));
  output.catalog.set(PDFName.of("AcroForm"), output.context.register(merged));
};
