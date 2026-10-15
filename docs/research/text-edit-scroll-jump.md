# Text edit scroll jump

Why double-clicking PDF text to edit scrolls or shifts the document, so the edit lands on the wrong spot (or nowhere) until the user retries.

Primary sources: `@tanstack/virtual-core` 3.17.11 source (`dist/esm/index.js`), [MDN `HTMLElement.focus()` `preventScroll`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus#preventscroll), [MDN `ResizeObserver`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) / [HTML spec event loop: "update the rendering" runs resize observers before paint](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering), paperoo editor viewport / page frame / store / inspector.

---

## Symptom

1. User double-clicks text on a page.
2. First `pointerdown` scrolls the stack (usually down) and/or shifts it by a few dozen pixels.
3. The second click of the double-click lands on different content, so no edit opens (or the wrong run opens).
4. User scrolls back; scroll-spy flips the current page back; next try repeats.
5. It "sticks" only once the clicked page is already current and the inspector strip is already mounted.

## Cause 1 — page activation reveals the page with `align: "auto"` (the scroll down)

- [`editor-page-frame.tsx`](../../components/editor/editor-page-frame.tsx) `onPointerDown` calls `editorStore.setCurrentPage(page.id, { syncFitZoom: false })` when the pressed page is not current.
- [`editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) reacts to every `currentPageId` change not tagged as scroll-spy with `virtualizer.scrollToIndex(index, { align: "auto", behavior: "auto" })`.
- TanStack `getOffsetForIndex` (virtual-core 3.17.11, `dist/esm/index.js` ~L1040):

  ```js
  if (align === "auto") {
    if (item.end >= scrollOffset + size - scrollPaddingEnd) align = "end";
    else if (item.start <= scrollOffset + scrollPaddingStart) align = "start";
    else return [scrollOffset, align];
  }
  ```

  "auto" is not "only if hidden": any page whose bottom is below the viewport bottom gets `align: "end"`, so a fit-width page that is partly visible is scrolled to its bottom edge.

- Scroll-spy ([`activePageIdFromScroll`](../../lib/editor/page-frame-size.ts)) picks the page covering the 35–65 % band of the viewport, so clicking text on the other visible page is common.
- [`store.ts`](../../lib/editor/store.ts) `setCurrentPage` clears all selections; scrolling back makes scroll-spy switch the page again, resetting the cycle.

## Cause 2 — inspector strip is in flow above the scroller (the shift in place)

- `<InspectorBar />` sits above the scroller in a flex column in `editor-viewport.tsx`.
- Selecting PDF text mounts `PdfTextInspector` with [`inspectorStripClassName`](../../components/editor/inspector-strip.ts) (`border-b px-3 py-2`).
- The scroller loses that height from the top while `scrollTop` is unchanged, so all pages move down on screen; they move back up when selection clears.

## Cause 3 (minor) — `focus()` without `preventScroll`

[`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) and [`pdf-form-layer.tsx`](../../components/editor/pdf-form-layer.tsx) call `input.focus()`. Per MDN, focus scrolls the element into view unless `{ preventScroll: true }` is passed. The element was just clicked, so usually visible, but a partly clipped run still triggers a scroll.

## Cause 4 — the reveal effect re-runs on every document change (found in browser)

The reveal effect depends on `[currentPageId, pages, virtualizer]`. When an edit opens, `ensurePdfTextMeasured` writes the run's measurement to the store, so `pages` gets a new identity and the effect calls `scrollToIndex` again (~300 ms after the double-click) even though the current page did not change. Measurements are cached, so after the first try on a run the jump stops — this is the "keep retrying until it sticks" part. Instrumented `scrollTo` stack: `Virtualizer.scrollToIndex ← EditorViewport.useEffect`.

## Cause 5 — strip toggle reads as a viewport resize and refits zoom (found in browser)

The scroller's ResizeObserver feeds `editorStore.setViewportSize`, which calls `recomputeFitZoom` for the _current_ page when zoom mode is fit-width / fit-page ([`store.ts`](../../lib/editor/store.ts) `setViewportSize`). Mounting/unmounting the strip changes the scroller height, so with mixed page sizes (sample.pdf: portrait page 1, landscape page 2) the zoom jumped 115 % → 88 % when scroll-spy moved to page 2 and cleared the selection. The strip is 48.8 px tall; `offsetHeight` rounds to 49, so a naive "add the strip back" still differs by 0.2 px and triggers the refit.

## Fix

1. Pointer activation tags the page change "no reveal" (viewport-owned ref, same mechanism as scroll-spy) so `scrollToIndex` is skipped. Sidebar, PageUp/PageDown, undo keep revealing.
2. Reveal only when the current page's id or index changes (`revealedRef`), not on every `pages` identity change.
3. Observe the inspector strip height; on change by `delta`, `scroller.scrollTop += delta`. ResizeObserver callbacks run in "update the rendering" before paint, so no visible jump. Suppress scroll-spy briefly while adjusting.
4. Report viewport height as `round(scroller height + strip getBoundingClientRect().height)` so strip toggles are not viewport resizes.
5. `focus({ preventScroll: true })` in the PDF text and form editors.
