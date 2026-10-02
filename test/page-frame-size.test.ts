import { expect, test } from "vitest";

import {
  activePageIdFromScroll,
  PAGE_STACK_GAP,
  PAGE_STACK_PADDING,
  pageFrameCssSize,
} from "@/lib/editor/page-frame-size";
import type { EditorPage } from "@/lib/editor/types";

const page = (
  id: string,
  width: number,
  height: number,
  rotation: EditorPage["rotation"] = 0
): Pick<EditorPage, "height" | "id" | "rotation" | "width"> => ({
  height,
  id,
  rotation,
  width,
});

test("pageFrameCssSize scales width and height by zoom", () => {
  expect(pageFrameCssSize(page("a", 612, 792), 2)).toEqual({
    height: 1584,
    width: 1224,
  });
});

test("pageFrameCssSize swaps axes for 90-degree rotation", () => {
  expect(pageFrameCssSize(page("a", 612, 792, 90), 1)).toEqual({
    height: 612,
    width: 792,
  });
});

test("activePageIdFromScroll picks the page overlapping the center band", () => {
  const pages = [page("a", 100, 400), page("b", 100, 400), page("c", 100, 400)];
  // Page heights 400, gap 24, padding 32.
  // Page a: 32..432, b: 456..856, c: 880..1280
  // Viewport height 200 → band [scrollTop+70, scrollTop+130]
  const active = activePageIdFromScroll({
    pages,
    scrollTop: 500,
    viewportHeight: 200,
    zoom: 1,
  });
  expect(active).toBe("b");
});

test("activePageIdFromScroll falls back to page under viewport center", () => {
  const pages = [page("a", 100, 1000)];
  const active = activePageIdFromScroll({
    gap: PAGE_STACK_GAP,
    padding: PAGE_STACK_PADDING,
    pages,
    scrollTop: 0,
    viewportHeight: 100,
    zoom: 1,
  });
  expect(active).toBe("a");
});

test("activePageIdFromScroll returns null for empty pages", () => {
  expect(
    activePageIdFromScroll({
      pages: [],
      scrollTop: 0,
      viewportHeight: 400,
      zoom: 1,
    })
  ).toBeNull();
});
