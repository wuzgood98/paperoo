import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PDFAcroText,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
} from "pdf-lib";
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
  buildPdfFormEdgeFixture,
  buildPdfFormFixture,
  buildXfaFormFixture,
  EDGE_FIELD,
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
      const viewport = page.getViewport({ scale: 1 / page.userUnit });
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
      return { ...field, value: null };
    }
    if (field.name === FORM_FIELD.terms && field.kind === "checkbox") {
      return { ...field, value: "Yes" };
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

const topField = (doc: PDFDocument, name: string): PDFDict => {
  const found = doc
    .getForm()
    .acroForm.getAllFields()
    .find(([acroField]) => acroField.getFullyQualifiedName() === name);
  if (!found) {
    throw new Error(`No field named ${name}.`);
  }
  return found[0].dict;
};

const kidDicts = (doc: PDFDocument, field: PDFDict): PDFDict[] =>
  field
    .lookup(PDFName.of("Kids"), PDFArray)
    .asArray()
    .map((kid) => doc.context.lookup(kid, PDFDict));

const kidStates = (doc: PDFDocument, field: PDFDict): string[] =>
  kidDicts(doc, field).map((kid) => String(kid.get(PDFName.of("AS"))));

test("export sets the chosen on-state of a multi-state checkbox", async () => {
  const bytes = await buildPdfFormEdgeFixture();
  const base = await editorDocumentFromBytes(bytes);
  const exportWith = async (value: string | null) =>
    await exportDocument({
      assets: {},
      bytes,
      document: mapDocumentFormFields(base, (field) =>
        field.name === EDGE_FIELD.pick && field.kind === "checkbox"
          ? { ...field, value }
          : field
      ),
      fontBytes: {},
    });

  const pickedBytes = await exportWith("A");
  const picked = await PDFDocument.load(pickedBytes);
  const fieldA = topField(picked, EDGE_FIELD.pick);
  expect(String(fieldA.get(PDFName.of("V")))).toBe("/A");
  expect(kidStates(picked, fieldA)).toEqual(["/A", "/Off"]);
  // The PDF's own drawings stay; pdf-lib's default tick must not replace them.
  const normal = kidDicts(picked, fieldA)[1]
    ?.lookup(PDFName.of("AP"), PDFDict)
    .lookup(PDFName.of("N"), PDFDict);
  expect(normal?.has(PDFName.of("B"))).toBe(true);

  const cleared = await PDFDocument.load(await exportWith(null));
  const fieldOff = topField(cleared, EDGE_FIELD.pick);
  expect(String(fieldOff.get(PDFName.of("V")))).toBe("/Off");
  expect(kidStates(cleared, fieldOff)).toEqual(["/Off", "/Off"]);

  const reloaded = await editorDocumentFromBytes(pickedBytes);
  const pick = reloaded.form?.fields.find(
    (field) => field.name === EDGE_FIELD.pick
  );
  expect(pick?.kind === "checkbox" ? pick.value : "missing").toBe("A");
});

test("export writes every field that owns one of the widgets", async () => {
  const bytes = await buildPdfFormEdgeFixture();
  const base = await editorDocumentFromBytes(bytes);
  // "a.b" (dotted) and "a" > "b" share a full name, so PDF.js groups them.
  const shared = base.form?.fields.find(
    (field) => field.name === EDGE_FIELD.dotted
  );
  expect(shared?.widgets).toHaveLength(2);
  const output = await exportDocument({
    assets: {},
    bytes,
    document: mapDocumentFormFields(base, (field) =>
      field.id === shared?.id && field.kind === "text"
        ? { ...field, value: "changed" }
        : field
    ),
    fontBytes: {},
  });
  const exported = await PDFDocument.load(output);
  const values = exported
    .getForm()
    .acroForm.getAllFields()
    .filter(
      ([acroField]) => acroField.getFullyQualifiedName() === EDGE_FIELD.dotted
    )
    .map(([acroField]) =>
      acroField instanceof PDFAcroText
        ? acroField.getValue()?.decodeText()
        : null
    );
  expect(values).toEqual(["changed", "changed"]);
});

const publicFont = async (url: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(path.join(process.cwd(), "public", url)));

const exportFormFonts = async () => ({
  [FONT_FILES.inter[400]]: await publicFont(FONT_FILES.inter[400]),
  [FONT_FILES.sans[400]]: await publicFont(FONT_FILES.sans[400]),
});

const defaultAppearances = (doc: PDFDocument, name: string): string[] => {
  const field = topField(doc, name);
  const kids = field.lookup(PDFName.of("Kids"));
  const dicts = kids instanceof PDFArray ? kidDicts(doc, field) : [];
  return [field, ...dicts].map((dict) =>
    String(dict.lookup(PDFName.of("DA")) ?? "")
  );
};

test("export keeps a fit-to-box field fitting the box", async () => {
  const bytes = await buildPdfFormEdgeFixture();
  const before = defaultAppearances(
    await PDFDocument.load(bytes),
    EDGE_FIELD.visible
  );
  expect(before.join(",")).toContain(" 0 Tf");
  const base = await editorDocumentFromBytes(bytes);
  const output = await exportDocument({
    assets: {},
    bytes,
    document: mapDocumentFormFields(base, (field) =>
      field.name === EDGE_FIELD.visible && field.kind === "text"
        ? { ...field, value: "A new value" }
        : field
    ),
    fontBytes: await exportFormFonts(),
  });
  const exported = await PDFDocument.load(output);
  expect(defaultAppearances(exported, EDGE_FIELD.visible)).toEqual(before);
  expect(exported.getForm().getTextField(EDGE_FIELD.visible).getText()).toBe(
    "A new value"
  );
});

test("export draws Twi letters with Inter, which has them", async () => {
  const bytes = await buildPdfFormFixture();
  const base = await editorDocumentFromBytes(bytes);
  const value = "Ɔkɔ Ɛsi ₵5";
  const output = await exportDocument({
    assets: {},
    bytes,
    document: mapDocumentFormFields(base, (field) =>
      field.name === FORM_FIELD.name && field.kind === "text"
        ? { ...field, value }
        : field
    ),
    fontBytes: await exportFormFonts(),
  });
  const exported = await PDFDocument.load(output);
  const [widget] = exported
    .getForm()
    .getTextField(FORM_FIELD.name)
    .acroField.getWidgets();
  const normal = widget?.dict
    .lookup(PDFName.of("AP"), PDFDict)
    .lookup(PDFName.of("N"));
  const fonts =
    normal instanceof PDFStream
      ? normal.dict
          .lookup(PDFName.of("Resources"), PDFDict)
          .lookup(PDFName.of("Font"), PDFDict)
      : undefined;
  const baseFonts = [...(fonts?.values() ?? [])].map((ref) =>
    String(exported.context.lookup(ref, PDFDict).get(PDFName.of("BaseFont")))
  );
  expect(baseFonts.some((name) => name.includes("Inter"))).toBe(true);
});
