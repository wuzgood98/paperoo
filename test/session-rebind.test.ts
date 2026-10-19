import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { rebindRuntimeIds } from "@/lib/editor/session-rebind";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import type { EditorPage } from "@/lib/editor/types";
import { pdfSession } from "@/lib/pdf/session";

import "./pdfjs-node";

afterEach(async () => {
  await pdfSession.close();
});

// A 2×2 opaque red PNG.
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxMAAAA4lAQFBKY2iAAAAAElFTkSuQmCC"
  ),
  (char) => char.codePointAt(0) ?? 0
);

const buildPdf = async (label: string): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const image = await doc.embedPng(PNG_BYTES);
  for (let index = 0; index < 2; index += 1) {
    const page = doc.addPage([300, 300]);
    page.drawText(`${label} sans ${index}`, {
      font: sans,
      size: 14,
      x: 20,
      y: 250,
    });
    page.drawText(`${label} serif ${index}`, {
      font: serif,
      size: 14,
      x: 20,
      y: 200,
    });
    page.drawImage(image, { height: 40, width: 40, x: 20, y: 100 });
  }
  return new Uint8Array(await doc.save());
};

const openPages = async (bytes: Uint8Array): Promise<EditorPage[]> => {
  // pdf.js takes ownership of what it opens; keep the caller's bytes usable.
  const { pages } = await pdfSession.open(Uint8Array.from(bytes));
  return pages;
};

/** Fresh pages of the opened file, as restore passes them. */
const primary = (
  pages: readonly EditorPage[]
): Map<string, readonly EditorPage[]> => new Map([[PRIMARY_DOC_ID, pages]]);

const fontNames = (pages: readonly EditorPage[]): string[] =>
  pages.flatMap((page) => page.pdfTextObjects.map((run) => run.fontName));

test("saved runs and images point at the fresh open's runtime ids", async () => {
  const bytes = await buildPdf("Hello");
  const saved = await openPages(bytes);
  const fresh = await openPages(bytes);
  // Each open is a new pdf.js document, so its font names differ.
  expect(fontNames(saved)).not.toEqual(fontNames(fresh));
  expect(saved[0]?.pdfImageObjects.length).toBeGreaterThan(0);

  // An edit the session saved: changed text, a moved image, an overlay box.
  const [first, second] = saved;
  if (!first || !second) {
    throw new Error("expected two pages");
  }
  const edited: EditorPage[] = [
    {
      ...first,
      pdfTextObjects: first.pdfTextObjects.map((run, index) =>
        index === 0 ? { ...run, text: "Changed" } : run
      ),
    },
    {
      ...second,
      pdfImageObjects: second.pdfImageObjects.map((image) => ({
        ...image,
        x: image.x + 10,
      })),
    },
  ];

  const rebound = rebindRuntimeIds(edited, primary(fresh));
  expect(rebound).not.toBeNull();
  expect(fontNames(rebound ?? [])).toEqual(fontNames(fresh));
  expect(rebound?.[0]?.pdfTextObjects[0]?.text).toBe("Changed");
  expect(rebound?.[0]?.id).toBe(first.id);
  const reboundImage = rebound?.[1]?.pdfImageObjects[0];
  expect(reboundImage?.sourceId).toBe(fresh[1]?.pdfImageObjects[0]?.sourceId);
  expect(reboundImage?.x).toBe((second.pdfImageObjects[0]?.x ?? 0) + 10);
  expect(reboundImage?.previewAssetId).toBeNull();
});

test("saved pages from a different PDF are rejected", async () => {
  const saved = await openPages(await buildPdf("Hello"));
  const fresh = await openPages(await buildPdf("Other"));
  expect(rebindRuntimeIds(saved, primary(fresh))).toBeNull();
});

test("a saved page missing from the fresh open is rejected", async () => {
  const bytes = await buildPdf("Hello");
  const saved = await openPages(bytes);
  const fresh = await openPages(bytes);
  expect(rebindRuntimeIds(saved, primary(fresh.slice(0, 1)))).toBeNull();
});

test("each source document's ids are rebound against its own fresh pages", async () => {
  const opened = await buildPdf("Hello");
  const inserted = await buildPdf("Other");
  // pdf.js names images per page (img_p0_1), so both sources share ids.
  const savedOpened = await openPages(opened);
  const savedInserted = await openPages(inserted);
  const saved = [
    ...savedOpened,
    ...savedInserted.map((page) => ({ ...page, docId: "file:b" })),
  ];
  const freshOpened = await openPages(opened);
  const freshInserted = await openPages(inserted);
  const fresh = new Map<string, readonly EditorPage[]>([
    [PRIMARY_DOC_ID, freshOpened],
    ["file:b", freshInserted],
  ]);

  const rebound = rebindRuntimeIds(saved, fresh);
  expect(rebound).not.toBeNull();
  expect(fontNames(rebound?.slice(2) ?? [])).toEqual(fontNames(freshInserted));
  expect(fontNames(rebound?.slice(0, 2) ?? [])).toEqual(fontNames(freshOpened));
  // Pages of a source missing from `fresh` (a blank page) pass through.
  const [template] = freshOpened;
  if (!template) {
    throw new Error("expected a page");
  }
  const blank: EditorPage = { ...template, docId: "blank:300x300" };
  expect(rebindRuntimeIds([blank], fresh)?.[0]?.docId).toBe("blank:300x300");
});
