import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type {
  EditorPage,
  PdfFormCheckboxField,
  PdfFormModel,
  PdfFormRadioField,
  PdfFormTextField,
  PdfFormWidget,
} from "@/lib/editor/types";

const widget = (overrides: Partial<PdfFormWidget> = {}): PdfFormWidget => ({
  exportValue: null,
  height: 20,
  id: "widget-1",
  pageId: "page-1",
  sourceAnnotId: "12R",
  width: 200,
  x: 72,
  y: 720,
  ...overrides,
});

const textField = (
  overrides: Partial<PdfFormTextField> = {}
): PdfFormTextField => ({
  align: "left",
  comb: false,
  fileSelect: false,
  id: "field-text",
  kind: "text",
  maxLength: null,
  multiline: false,
  name: "person.name",
  originalValue: "Gideon",
  password: false,
  readOnly: false,
  required: false,
  richText: false,
  value: "Gideon",
  widgets: [widget()],
  ...overrides,
});

const checkboxField = (
  overrides: Partial<PdfFormCheckboxField> = {}
): PdfFormCheckboxField => ({
  id: "field-check",
  kind: "checkbox",
  name: "prefs.newsletter",
  originalValue: "Yes",
  readOnly: false,
  required: false,
  value: "Yes",
  widgets: [
    widget({
      exportValue: "Yes",
      height: 16,
      id: "widget-check",
      width: 16,
      y: 520,
    }),
  ],
  ...overrides,
});

const radioField = (
  overrides: Partial<PdfFormRadioField> = {}
): PdfFormRadioField => ({
  id: "field-radio",
  kind: "radio",
  name: "prefs.region",
  options: [
    { display: "Ghana", exportValue: "Ghana" },
    { display: "Nigeria", exportValue: "Nigeria" },
  ],
  originalValue: "Nigeria",
  readOnly: false,
  required: false,
  value: "Nigeria",
  widgets: [
    widget({
      exportValue: "Ghana",
      height: 16,
      id: "widget-radio-1",
      width: 16,
      y: 460,
    }),
    widget({
      exportValue: "Nigeria",
      height: 16,
      id: "widget-radio-2",
      width: 16,
      y: 440,
    }),
  ],
  ...overrides,
});

const page = (): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

const formModel = (): PdfFormModel => ({
  fields: [textField(), checkboxField(), radioField()],
  hasJavaScript: false,
  hasXfa: false,
  signatures: [],
});

afterEach(() => {
  editorStore.clearDocument();
});

test("a text field blur records one history entry and undo restores it", () => {
  editorStore.resetDocument([page()], "form.pdf", formModel());
  editorStore.selectPdfFormField("field-text");
  editorStore.patchPdfFormField((field) =>
    field.kind === "text" ? { ...field, value: "Ama" } : field
  );
  expect(editorStore.selectedPdfFormField()?.kind === "text").toBe(true);
  const edited = editorStore.selectedPdfFormField();
  expect(edited?.kind === "text" ? edited.value : null).toBe("Ama");
  expect(editorStore.canUndo()).toBe(true);

  editorStore.undo();
  const restored = editorStore.getState().document.form?.fields[0];
  expect(restored?.kind === "text" ? restored.value : null).toBe("Gideon");
  expect(editorStore.canRedo()).toBe(true);
});

test("checkbox and radio each record a separate history entry", () => {
  editorStore.resetDocument([page()], "form.pdf", formModel());
  editorStore.selectPdfFormField("field-check");
  editorStore.patchPdfFormField((field) =>
    field.kind === "checkbox" ? { ...field, value: null } : field
  );
  editorStore.selectPdfFormField("field-radio");
  editorStore.patchPdfFormField((field) =>
    field.kind === "radio" ? { ...field, value: "Ghana" } : field
  );

  const fields = editorStore.getState().document.form?.fields ?? [];
  const checkbox = fields.find((field) => field.id === "field-check");
  const radio = fields.find((field) => field.id === "field-radio");
  expect(checkbox?.kind === "checkbox" ? checkbox.value : "missing").toBe(null);
  expect(radio?.kind === "radio" ? radio.value : null).toBe("Ghana");

  editorStore.undo();
  const afterRadioUndo = editorStore
    .getState()
    .document.form?.fields.find((field) => field.id === "field-radio");
  expect(afterRadioUndo?.kind === "radio" ? afterRadioUndo.value : null).toBe(
    "Nigeria"
  );
  const checkboxAfterRadioUndo = editorStore
    .getState()
    .document.form?.fields.find((field) => field.id === "field-check");
  expect(
    checkboxAfterRadioUndo?.kind === "checkbox"
      ? checkboxAfterRadioUndo.value
      : "missing"
  ).toBe(null);

  editorStore.undo();
  const checkboxRestored = editorStore
    .getState()
    .document.form?.fields.find((field) => field.id === "field-check");
  expect(
    checkboxRestored?.kind === "checkbox" ? checkboxRestored.value : null
  ).toBe("Yes");
});

test("deleteSelected leaves form fields in place", () => {
  editorStore.resetDocument([page()], "form.pdf", formModel());
  editorStore.selectPdfFormField("field-text");
  editorStore.deleteSelected();
  expect(
    editorStore
      .getState()
      .document.form?.fields.some((field) => field.id === "field-text")
  ).toBe(true);
  expect(editorStore.getState().selectedPdfFormFieldId).toBe("field-text");
});

const textAndCheckboxValues = () =>
  (editorStore.getState().document.form?.fields ?? []).map((field) =>
    field.kind === "text" || field.kind === "checkbox" ? field.value : "-"
  );

test("clearing the form restores every field as one undo step", () => {
  editorStore.resetDocument([page()], "form.pdf", formModel());
  editorStore.selectPdfFormField("field-text");
  editorStore.patchPdfFormField((field) =>
    field.kind === "text" ? { ...field, value: "Ama" } : field
  );
  editorStore.selectPdfFormField("field-check");
  editorStore.patchPdfFormField((field) =>
    field.kind === "checkbox" ? { ...field, value: null } : field
  );

  editorStore.resetPdfForm();
  expect(textAndCheckboxValues()).toEqual(["Gideon", "Yes", "-"]);

  editorStore.undo();
  expect(textAndCheckboxValues()).toEqual(["Ama", null, "-"]);
});
