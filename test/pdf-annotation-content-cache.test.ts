import { expect, test } from "vitest";

import {
  createPageCanvasCache,
  MAX_CACHED_PAGE_CANVASES,
} from "@/lib/pdf/pdf-annotation-content-cache";

interface FakeCanvas {
  document: object | null;
  serial: number;
}

interface FakeRenderer {
  document: object | null;
  renders: number;
}

/** A cache over a fake renderer that records every render it performs. */
const fakeCache = () => {
  const state: FakeRenderer = {
    document: { name: "a" },
    renders: 0,
  };
  const cache = createPageCanvasCache<FakeCanvas>({
    currentDocument: () => state.document,
    render: async () => {
      state.renders += 1;
      await Promise.resolve();
      return { document: state.document, serial: state.renders };
    },
  });
  return { cache, state };
};

test("a page canvas is rendered once and reused", async () => {
  const { cache, state } = fakeCache();
  const first = await cache(0, 1);
  expect(await cache(0, 1)).toBe(first);
  expect(state.renders).toBe(1);
});

test("concurrent requests share one render", async () => {
  const { cache, state } = fakeCache();
  const [left, right] = await Promise.all([cache(1, 1), cache(1, 1)]);
  expect(left).toBe(right);
  expect(state.renders).toBe(1);
});

test("opening another PDF drops the previous file's canvases", async () => {
  const { cache, state } = fakeCache();
  await cache(0, 1);
  const documentB = { name: "b" };
  state.document = documentB;
  const fromB = await cache(0, 1);
  expect(fromB?.document).toBe(documentB);
  expect(state.renders).toBe(2);
});

test("the cache keeps only the most recently used canvases", async () => {
  const { cache, state } = fakeCache();
  await cache(0, 1);
  for (let index = 1; index <= MAX_CACHED_PAGE_CANVASES; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- fills the cache in order
    await cache(index, 1);
  }
  const rendersBefore = state.renders;
  await cache(MAX_CACHED_PAGE_CANVASES, 1);
  expect(state.renders).toBe(rendersBefore);
  await cache(0, 1);
  expect(state.renders).toBe(rendersBefore + 1);
});
