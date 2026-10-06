import { expect, test } from "vitest";

import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import type { OcrService } from "@/lib/ocr/service";
import { createOcrService } from "@/lib/ocr/service";

test("recognize maps a fake engine page into OCR words", async () => {
  const engine: EngineOcrPage = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                baseline: { x0: 0, x1: 80, y0: 16, y1: 16 },
                bbox: { x0: 0, x1: 80, y0: 0, y1: 20 },
                words: [
                  {
                    bbox: { x0: 0, x1: 80, y0: 0, y1: 20 },
                    confidence: 99,
                    text: "Scan",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const service: OcrService = createOcrService({
    recognize: () => Promise.resolve(engine),
  });
  const result = await service.recognize(new Blob(), {
    language: "eng",
    pageId: "page-1",
    scale: 2,
  });
  expect(result.words).toHaveLength(1);
  expect(result.words[0]?.text).toBe("Scan");
  expect(result.words[0]?.width).toBe(40);
  expect(result.words[0]?.baselineY).toBe(8);
  await service.terminate();
});
