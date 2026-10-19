import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, PDFName } from "pdf-lib";
import { expect, test } from "vitest";

import { normalizeRotation } from "@/lib/editor/coordinates";
import { mapDocumentFormFields } from "@/lib/editor/object-utils";
import type {
  EditorDocument,
  EditorPage,
  PdfFormField,
} from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { extractPdfForm } from "@/lib/pdf/extract-forms";

import {
  buildPdfFormFixture,
  buildXfaFormFixture,
  FORM_FIELD,
} from "./pdf-form-fixture";
import { pdfContainsText } from "./pdf-scan";
import { loadPdfJsDocument } from "./pdfjs-node";

const editorDocumentFromBytes = async (
  bytes: Uint8Array
): Promise<EditorDocument> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const formPages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const { view } = page;
      const cropBox = {
        height: view[3] - view[1],
        width: view[2] - view[0],
        x: view[0],
        y: view[1],
      };
      const extractPage = {
        cropBox,
        id: `page-${index + 1}`,
        sourceRotate: normalizeRotation(page.rotate),
      };
      const annotations = await page.getAnnotations({ intent: "display" });
      const editorPage: EditorPage = {
        cropBox,
        height: viewport.height,
        id: extractPage.id,
        objects: [],
        pdfAnnotationObjects: [],
        pdfImageObjects: [],
        pdfTextObjects: [],
        pdfVectorObjects: [],
        rotation: 0,
        skippedPdfAnnotationSubtypes: [],
        sourceIndex: index,
        sourceRotate: extractPage.sourceRotate,
        width: viewport.width,
      };
      return {
        annotations,
        editorPage,
        extractPage,
      };
    })
  );
  return {
    form: extractPdfForm({
      hasJavaScript: await pdf.hasJSActions(),
      hasXfa: pdf.isPureXfa,
      pages: formPages.map((entry) => ({
        annotations: entry.annotations,
        page: entry.extractPage,
      })),
      signatures: (await pdf.getSignatures()) ?? [],
    }),
    pages: formPages.map((entry) => entry.editorPage),
  };
};

const setFieldValue = (
  field: PdfFormField,
  writer: (current: PdfFormField) => PdfFormField
): PdfFormField => writer(field);

test("export keeps AcroForm fields interactive with updated values", async () => {
  const bytes = await buildPdfFormFixture();
  const base = await editorDocumentFromBytes(bytes);
  const edited = mapDocumentFormFields(base, (field) => {
    if (field.name === FORM_FIELD.name && field.kind === "text") {
      return setFieldValue(field, (current) =>
        current.kind === "text" ? { ...current, value: "Ama" } : current
      );
    }
    if (field.name === FORM_FIELD.bio && field.kind === "text") {
      return { ...field, value: "Line one\nLine two\nLine three" };
    }
    if (field.name === FORM_FIELD.newsletter && field.kind === "checkbox") {
      return { ...field, value: false };
    }
    if (field.name === FORM_FIELD.terms && field.kind === "checkbox") {
      return { ...field, value: true };
    }
    if (field.name === FORM_FIELD.region && field.kind === "radio") {
      return { ...field, value: "Kenya" };
    }
    if (field.name === FORM_FIELD.country && field.kind === "dropdown") {
      return { ...field, value: "NG" };
    }
    if (field.name === FORM_FIELD.tags && field.kind === "listbox") {
      return { ...field, value: ["Nigeria"] };
    }
    return field;
  });

  const output = await exportDocument({
    assets: {},
    bytes,
    document: edited,
    fontBytes: {},
  });

  const exported = await PDFDocument.load(output);
  expect(exported.catalog.AcroForm()).toBeTruthy();
  const form = exported.getForm();
  expect(form.getTextField(FORM_FIELD.name).getText()).toBe("Ama");
  expect(form.getTextField(FORM_FIELD.bio).getText()).toBe(
    "Line one\nLine two\nLine three"
  );
  expect(form.getCheckBox(FORM_FIELD.newsletter).isChecked()).toBe(false);
  expect(form.getCheckBox(FORM_FIELD.terms).isChecked()).toBe(true);
  expect(form.getRadioGroup(FORM_FIELD.region).getSelected()).toBe("Kenya");
  expect(form.getDropdown(FORM_FIELD.country).getSelected()).toEqual(["NG"]);
  expect(form.getOptionList(FORM_FIELD.tags).getSelected()).toEqual([
    "Nigeria",
  ]);
  expect(form.getSignature(FORM_FIELD.signature)).toBeTruthy();

  const task = loadPdfJsDocument(output);
  const pdf = await task.promise;
  const fieldObjects = await pdf.getFieldObjects();
  expect(fieldObjects?.get(FORM_FIELD.name)).toBeTruthy();
  const page = await pdf.getPage(1);
  const annots = await page.getAnnotations({ intent: "display" });
  expect(annots.some((item) => item.subtype === "Widget")).toBe(true);

  const reloaded = await editorDocumentFromBytes(output);
  const byName = Object.fromEntries(
    (reloaded.form?.fields ?? []).map((field) => [field.name, field])
  );
  const nameField = byName[FORM_FIELD.name];
  const bioField = byName[FORM_FIELD.bio];
  const countryField = byName[FORM_FIELD.country];
  expect(nameField?.kind === "text" ? nameField.value : null).toBe("Ama");
  expect(bioField?.kind === "text" ? bioField.value : null).toBe(
    "Line one\nLine two\nLine three"
  );
  expect(countryField?.kind === "dropdown" ? countryField.value : null).toBe(
    "NG"
  );
  expect(byName[FORM_FIELD.signature]?.kind).toBe("signature");
});

test("export drops the XFA form without calling getForm", async () => {
  const bytes = await buildXfaFormFixture();
  const document = await editorDocumentFromBytes(bytes);
  const output = await exportDocument({
    assets: {},
    bytes,
    document,
    fontBytes: {},
  });
  const exported = await PDFDocument.load(output);
  // XFA repeats every field value; edited or pruned fields would leak.
  expect(exported.catalog.AcroForm()?.has(PDFName.of("XFA"))).toBe(false);
  expect(await pdfContainsText(output, "xdp:xdp")).toBe(false);
});

test("export fills a non-Latin form value with the embedded fallback font", async () => {
  const bytes = await buildPdfFormFixture();
  const base = await editorDocumentFromBytes(bytes);
  const value = "Привет, мир";
  const edited = mapDocumentFormFields(base, (field) =>
    field.name === FORM_FIELD.name && field.kind === "text"
      ? { ...field, value }
      : field
  );
  const sans = new Uint8Array(
    await readFile(
      path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
    )
  );

  const output = await exportDocument({
    assets: {},
    bytes,
    document: edited,
    fontBytes: { [FONT_FILES.sans[400]]: sans },
  });

  const exported = await PDFDocument.load(output);
  expect(exported.getForm().getTextField(FORM_FIELD.name).getText()).toBe(
    value
  );
});
