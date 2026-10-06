import { expect, test } from "vitest";

import { ocrDocumentProgressLabel, ocrStatusLabel } from "@/lib/ocr/progress";

test("progress copy matches the V7 banners", () => {
  expect(
    ocrStatusLabel({ pageCount: 8, pageNumber: 2, status: "preparing" })
  ).toBe("Preparing page 2...");
  expect(
    ocrStatusLabel({ pageCount: 8, pageNumber: 2, status: "recognizing" })
  ).toBe("Recognizing text...");
  expect(
    ocrDocumentProgressLabel({
      pageCount: 8,
      pageNumber: 2,
      status: "recognizing",
    })
  ).toBe("Page 2 of 8");
});
