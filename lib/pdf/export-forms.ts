import {
  PDFCheckBox,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFObjectCopier,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import type { PDFFont, PDFDocument, PDFForm } from "pdf-lib";

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

export const resolveFormFieldFont = async (
  doc: PDFDocument,
  text: string,
  fontBytes: Record<string, Uint8Array>
): Promise<PDFFont> => {
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  try {
    helvetica.encodeText(text);
    return helvetica;
  } catch {
    const bytes = fontBytes[FONT_FILES.sans[400]];
    if (bytes) {
      return doc.embedFont(bytes);
    }
    return helvetica;
  }
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
  source: PDFDocument,
  form: PDFForm,
  field: PdfFormField,
  fontBytes: Record<string, Uint8Array>
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
  const font = await resolveFormFieldFont(
    source,
    appearanceText(field),
    fontBytes
  );
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
  for (const field of documentForm(document).fields) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop eslint/no-await-in-loop -- appearances must apply in field order
    await applyField(source, form, field, fontBytes);
  }
};

export const copyPagesWithAcroForm = async (
  source: PDFDocument,
  output: PDFDocument,
  indices: readonly number[]
): Promise<PDFPage[]> => {
  await source.flush();
  const copier = PDFObjectCopier.for(source.context, output.context);
  const sourcePages = source.getPages();
  const copied: PDFPage[] = [];
  for (const index of indices) {
    const srcPage = sourcePages[index];
    if (!srcPage) {
      continue;
    }
    const node = copier.copy(srcPage.node);
    const ref = output.context.register(node);
    copied.push(PDFPage.of(node, ref, output));
  }
  const acroForm = source.catalog.get(PDFName.of("AcroForm"));
  if (acroForm) {
    output.catalog.set(PDFName.of("AcroForm"), copier.copy(acroForm));
  }
  return copied;
};
