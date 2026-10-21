import { beforeAll, expect, test } from "vitest";

import { normalizeRotation } from "@/lib/editor/coordinates";
import type { PdfFormModel } from "@/lib/editor/types";
import { extractPdfForm } from "@/lib/pdf/extract-forms";

import {
  buildPdfFormEdgeFixture,
  buildPdfFormFixture,
  EDGE_FIELD,
  FORM_FIELD,
} from "./pdf-form-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const loadFormPages = async (bytes: Uint8Array) => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const pageCount = pdf.numPages;
  const pages = await Promise.all(
    Array.from({ length: pageCount }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const { view } = page;
      return {
        annotations: await page.getAnnotations({ intent: "display" }),
        page: {
          cropBox: {
            height: view[3] - view[1],
            width: view[2] - view[0],
            x: view[0],
            y: view[1],
          },
          id: `page-${index + 1}`,
          sourceRotate: normalizeRotation(page.rotate),
        },
        viewport,
      };
    })
  );
  const signatures = (await pdf.getSignatures()) ?? [];
  return {
    hasJavaScript: await pdf.hasJSActions(),
    hasXfa: pdf.isPureXfa,
    pages,
    signatures,
  };
};

let form: PdfFormModel;

beforeAll(async () => {
  const bytes = await buildPdfFormFixture();
  form = extractPdfForm(await loadFormPages(bytes));
});

const fieldNamed = (name: string) =>
  form.fields.find((field) => field.name === name);

test("extracts text fields and flags", () => {
  expect(form.hasXfa).toBe(false);
  const name = fieldNamed(FORM_FIELD.name);
  expect(name?.kind).toBe("text");
  if (name?.kind !== "text") {
    return;
  }
  expect(name.value).toBe("Gideon");
  expect(name.multiline).toBe(false);
  expect(name.readOnly).toBe(false);
  expect(name.widgets).toHaveLength(1);

  const bio = fieldNamed(FORM_FIELD.bio);
  expect(bio?.kind).toBe("text");
  if (bio?.kind !== "text") {
    return;
  }
  expect(bio.multiline).toBe(true);
  expect(bio.value).toBe("Line one\nLine two");

  const required = fieldNamed(FORM_FIELD.required);
  expect(required?.kind).toBe("text");
  if (required?.kind !== "text") {
    return;
  }
  expect(required.required).toBe(true);
  expect(required.value).toBe("");

  const readonly = fieldNamed(FORM_FIELD.readonly);
  expect(readonly?.kind).toBe("text");
  if (readonly?.kind !== "text") {
    return;
  }
  expect(readonly.readOnly).toBe(true);
  expect(readonly.value).toBe("Locked");

  const pin = fieldNamed(FORM_FIELD.pin);
  expect(pin?.kind).toBe("text");
  if (pin?.kind !== "text") {
    return;
  }
  expect(pin.maxLength).toBe(8);
});

test("extracts checkbox and radio widgets", () => {
  const newsletter = fieldNamed(FORM_FIELD.newsletter);
  expect(newsletter?.kind).toBe("checkbox");
  if (newsletter?.kind !== "checkbox") {
    return;
  }
  expect(newsletter.value).toBe("Yes");
  expect(newsletter.widgets[0]?.exportValue).toBe("Yes");

  const terms = fieldNamed(FORM_FIELD.terms);
  expect(terms?.kind).toBe("checkbox");
  if (terms?.kind !== "checkbox") {
    return;
  }
  expect(terms.value).toBeNull();

  const region = fieldNamed(FORM_FIELD.region);
  expect(region?.kind).toBe("radio");
  if (region?.kind !== "radio") {
    return;
  }
  expect(region.value).toBe("Nigeria");
  expect(region.widgets).toHaveLength(3);
  expect(region.options.map((option) => option.exportValue)).toEqual([
    "Ghana",
    "Nigeria",
    "Kenya",
  ]);
});

test("extracts choice fields with display vs export values", () => {
  const country = fieldNamed(FORM_FIELD.country);
  expect(country?.kind).toBe("dropdown");
  if (country?.kind !== "dropdown") {
    return;
  }
  expect(country.value).toBe("GH");
  expect(country.options).toEqual([
    { display: "Ghana", exportValue: "GH" },
    { display: "Nigeria", exportValue: "NG" },
    { display: "Kenya", exportValue: "KE" },
  ]);

  const cities = fieldNamed(FORM_FIELD.cities);
  expect(cities?.kind).toBe("listbox");
  if (cities?.kind !== "listbox") {
    return;
  }
  expect(cities.multiSelect).toBe(false);
  expect(cities.value).toEqual(["Nairobi"]);

  const tags = fieldNamed(FORM_FIELD.tags);
  expect(tags?.kind).toBe("listbox");
  if (tags?.kind !== "listbox") {
    return;
  }
  expect(tags.multiSelect).toBe(true);
  expect(tags.value).toEqual(["Ghana", "Kenya"]);
});

test("extracts shared, signature, and rotated widgets", () => {
  const shared = fieldNamed(FORM_FIELD.shared);
  expect(shared?.kind).toBe("text");
  if (shared?.kind !== "text") {
    return;
  }
  expect(shared.widgets).toHaveLength(2);
  expect(shared.widgets.map((widget) => widget.pageId).toSorted()).toEqual([
    "page-1",
    "page-2",
  ]);
  expect(shared.value).toBe("Same field");

  const signature = fieldNamed(FORM_FIELD.signature);
  expect(signature?.kind).toBe("signature");
  expect(signature?.readOnly).toBe(true);

  const rotated = fieldNamed(FORM_FIELD.rotated);
  expect(rotated?.kind).toBe("text");
  if (rotated?.kind !== "text") {
    return;
  }
  expect(rotated.widgets).toHaveLength(1);
  const [rotatedWidget] = rotated.widgets;
  expect(rotatedWidget?.pageId).toBe("page-2");
  expect(rotatedWidget?.height ?? 0).toBeGreaterThan(rotatedWidget?.width ?? 0);
  expect(rotatedWidget?.x).toBeGreaterThan(690);
  expect(rotatedWidget?.y).toBeGreaterThan(60);
});

test("marks XFA documents and leaves the field list empty", () => {
  const xfa = extractPdfForm({
    hasJavaScript: false,
    hasXfa: true,
    pages: [],
    signatures: [],
  });
  expect(xfa.hasXfa).toBe(true);
  expect(xfa.fields).toEqual([]);
});

test("leaves out hidden widgets", async () => {
  const edge = extractPdfForm(
    await loadFormPages(await buildPdfFormEdgeFixture())
  );
  const names = edge.fields.map((field) => field.name);
  expect(names).toContain(EDGE_FIELD.visible);
  expect(names).not.toContain(EDGE_FIELD.hidden);
});

test("a checkbox reads its on-state from whichever widget is on", async () => {
  const edge = extractPdfForm(
    await loadFormPages(await buildPdfFormEdgeFixture())
  );
  const pick = edge.fields.find((field) => field.name === EDGE_FIELD.pick);
  expect(pick?.kind).toBe("checkbox");
  if (pick?.kind !== "checkbox") {
    return;
  }
  expect(pick.widgets.map((widget) => widget.exportValue)).toEqual(["A", "B"]);
  expect(pick.value).toBe("B");
  expect(pick.originalValue).toBe("B");
});
