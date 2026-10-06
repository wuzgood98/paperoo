import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";

test("pdf-lib Liberation no-descender height is not the hhea ascent", async () => {
  const bytes = await readFile(
    path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
  );
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes);
  expect(font.heightAtSize(1000, { descender: false })).toBeCloseTo(683.1875);
  expect(font.heightAtSize(1000, { descender: false })).not.toBeCloseTo(905.27);
});
