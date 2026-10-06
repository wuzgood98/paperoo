import { expect, test } from "vitest";

import { DEFAULT_ASCENT_RATIO } from "@/lib/editor/coordinates";
import { ocrWordsFromEngine } from "@/lib/ocr/from-engine";
import type { EngineOcrPage } from "@/lib/ocr/from-engine";

const enginePage = (): EngineOcrPage => ({
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              baseline: { x0: 10, x1: 210, y0: 48, y1: 48 },
              bbox: { x0: 10, x1: 210, y0: 20, y1: 60 },
              words: [
                {
                  bbox: { x0: 10, x1: 90, y0: 20, y1: 60 },
                  confidence: 92,
                  text: "Hello",
                },
                {
                  bbox: { x0: 100, x1: 210, y0: 20, y1: 60 },
                  confidence: 88,
                  text: "World",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

test("maps engine word boxes into displayed page space with line baseline", () => {
  const ids = ["line-1", "w1", "w2"];
  const words = ocrWordsFromEngine(enginePage(), {
    createId: () => ids.shift() ?? "missing",
    pageId: "page-1",
    scale: 2,
  });
  expect(words).toHaveLength(2);
  expect(words[0]).toMatchObject({
    baselineY: 24,
    confidence: 92,
    height: 20,
    id: "w1",
    lineId: "line-1",
    pageId: "page-1",
    source: "ocr",
    text: "Hello",
    type: "ocr-text",
    width: 40,
    x: 5,
    y: 10,
  });
  expect(words[1]?.id).toBe("w2");
  expect(words[1]?.text).toBe("World");
  expect(words[1]?.x).toBe(50);
  expect(words[1]?.lineId).toBe("line-1");
});

test("falls back to ascent ratio when a line has no baseline", () => {
  const words = ocrWordsFromEngine(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  bbox: { x0: 0, x1: 40, y0: 0, y1: 20 },
                  words: [
                    {
                      bbox: { x0: 0, x1: 40, y0: 0, y1: 20 },
                      confidence: 70,
                      text: "Hi",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { createId: () => "w", pageId: "p", scale: 1 }
  );
  expect(words[0]?.baselineY).toBeCloseTo(20 * DEFAULT_ASCENT_RATIO);
});

test("skips blank words", () => {
  const words = ocrWordsFromEngine(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  bbox: { x0: 0, x1: 10, y0: 0, y1: 10 },
                  words: [
                    {
                      bbox: { x0: 0, x1: 10, y0: 0, y1: 10 },
                      confidence: 10,
                      text: "  ",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { createId: () => "w", pageId: "p", scale: 1 }
  );
  expect(words).toEqual([]);
});
