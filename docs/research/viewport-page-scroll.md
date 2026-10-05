# Viewport multi-page scroll + sidebar sync

How to make Paperoo’s PDF editor viewport scroll through multiple pages while keeping `currentPageId` synced with the page sidebar.

Primary sources: paperoo editor store / viewport / sidebar / PdfCanvas / PageThumbnail, MDN Intersection Observer.

---

## Current behavior

### Page selection (`currentPageId`)

The only page-switch entry point is `editorStore.setCurrentPage`.

[`lib/editor/store.ts`](../../lib/editor/store.ts) `setCurrentPage`:

- Sets `currentPageId`
- Clears all selection ids
- Uses `setState` (not `commit`) → does not push undo history
- If `zoomMode !== "custom"`, calls `recomputeFitZoom()` against the new page size

`currentPageId` is part of `HistorySnapshot`, so undo/redo of document edits can restore page id — but clicking a thumbnail does not create a history entry by itself.

### Sidebar indication

[`components/editor/page-sidebar.tsx`](../../components/editor/page-sidebar.tsx):

- Thumbnail click → `editorStore.setCurrentPage(page.id)`
- Selection chrome: `PageThumbnail selected={page.id === currentPageId}` → primary border + ring
- No `scrollIntoView` when `currentPageId` changes from elsewhere (until this feature)

### Viewport rendered ONE page

[`components/editor/editor-viewport.tsx`](../../components/editor/editor-viewport.tsx):

- Reads `pages`, `currentPageId`, `zoom`; resolves a single `page`
- Scroller is `overflow-auto` with Ctrl/Meta+wheel pinch zoom
- One `PdfCanvas` + one `EditorOverlay`

### Page rendering cost

[`PdfCanvas`](../../components/editor/pdf-canvas.tsx) always paints when mounted at full `scale` × DPR. [`PageThumbnail`](../../components/editor/page-thumbnail.tsx) already uses `IntersectionObserver` + `rootMargin` and only renders when visible; cleanup calls `releaseCanvas`.

---

## Constraints

1. **Fit zoom vs scroll activation** — scroll-driven page changes must skip `recomputeFitZoom` or mixed page sizes jump mid-scroll.
2. **Edit targeting** — store mutations write to `currentPageId`; activate the page on pointer-down before gestures.
3. **Raster cost** — virtualize full-page canvases (near-viewport mount only).
4. **Scroll root** — [MDN Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API): `root` must be the viewport scroller.
5. **Feedback loops** — programmatic `scrollIntoView` must suppress scrollspy briefly.
6. **No mandatory CSS scroll-snap** — fights free pan when a page is taller than the scroller.
7. **Arrow keys** are taken for object nudge; PageUp/PageDown left for a later hotkey follow-up.

---

## Approach

Continuous vertical page stack in the existing scroller + IntersectionObserver scrollspy → `setCurrentPage(id, { syncFitZoom: false })` → sidebar `selected` updates. Bidirectional `scrollIntoView` for sidebar ↔ viewport. Visibility-gated `PdfCanvas` / overlay. Activate page on pointer-down.

### Sources

- Repo: `editor-viewport.tsx`, `page-sidebar.tsx`, `page-thumbnail.tsx`, `pdf-canvas.tsx`, `lib/editor/store.ts`, `lib/pdf/render-page.ts`
- [MDN — Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
