# Editor performance: load, text editing, vector editing

Where Paperoo still spends time after progressive open (#21) and viewport windowing (#11) shipped, and what to change. Short version: the PDF parsing that remains is not the main cost. The main cost is editor bookkeeping that grows with the size of the whole document. That includes undo history, hover re-renders, hit-tests and wide store subscriptions.

Primary sources: paperoo `lib/editor/{store,history,object-utils}.ts`, `components/editor/*`, `lib/pdf/*`, prior notes [`pdf-load-performance.md`](./pdf-load-performance.md) and [`true-viewport-windowing.md`](./true-viewport-windowing.md), [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore), [MDN `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone), [Next.js `reactCompiler`](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler), [MDN `getContext` `willReadFrequently`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext), [MDN `Scheduler.yield`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield), [pdf.js `api.js`](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js) (`PDFPageProxy.cleanup`). Versions: `next@16.3.4`, `react@19.2.8`, `pdfjs-dist@6.3.289`.

All findings come from reading the code. Nothing has been profiled yet. The costs are estimates, and the bench in [Measurement](#measurement) is meant to confirm or refute them.

---

## Already fixed, from earlier notes

| Earlier bottleneck | Now |
| --- | --- |
| Every page extracted before first paint | First paint waits for `FIRST_PAINT_PAGES = 3` pages (`lib/pdf/session.ts:91`); the rest load in the background |
| N requests fired at the worker at once | `OPEN_PAGE_CONCURRENCY = 4` (`session.ts:94`) |
| `getPage` fetched twice for visible pages | Pages are cached and pinned for the first window |
| Unused `getFieldObjects` call | Removed |
| Worker cold start | Worker is started early via `requestIdleCallback` in `editor-shell.tsx` |
| Form probes run after the pages | They now start before the page loop |
| Every page frame mounted in the viewport | Viewport is virtualized with TanStack Virtual |

---

## 1. Undo history deep-copies the whole document twice per commit

```ts
// lib/editor/store.ts:190-193 (commit)
const before = shouldRecord ? cloneSnapshot(getSnapshot()) : null;
mutate();
if (before) internal.history = pushHistory(internal.history, before);

// lib/editor/history.ts:23 (pushHistory)
past: [...history.past, cloneSnapshot(snapshot)].slice(-MAX_HISTORY),
```

- `cloneSnapshot` is `structuredClone` (`history.ts:15-16`). It deep-copies the whole object graph ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)).
- `undoHistory` and `redoHistory` copy the current snapshot again (`history.ts:37,56`).
- `snapshotsEqual` turns both whole documents into JSON strings to compare them (`history.ts:71`). It runs from `flushPreview` (`store.ts:178`) and on undo and redo.
- Up to `MAX_HISTORY = 80` full copies are kept (`history.ts:3`).
- A snapshot includes every run on every page (about 35 fields each, plus `embeddedFontGlyphs` strings repeated per run) and every vector's decoded `commands`. That makes each copy O(total runs + total path commands) across up to 200 pages.
- The store already updates immutably: `mapPdfTextObject` and the `mapPage*` helpers return new objects and reuse pages that didn't change (`store.ts:272-287`). So **the copies buy nothing**. Snapshots can hold references, an approach known as structural sharing.
- `patchHistoryDocuments` (`store.ts:256`) maps over every past and future snapshot. It runs on `appendPages` (`store.ts:358`) and on text measurement (`store.ts:396`).

**Continuous inputs record one history step per event.** These controls commit with history on every change event:
- the native colour pickers in `PdfTextInspector` and `PdfVectorInspector` (`color-field.tsx:116-117`);
- the font-size and stroke-width number inputs.

Each event therefore pays both copies. Only the opacity slider uses `previewEdit` → `commitPreview` (`inspector-bar.tsx:251-258`).

## 2. Every pointer move re-renders the hovered page's overlay

```ts
// components/editor/editor-overlay.tsx:269-278
const hover = pdfHoverIdsAtPoint(page, point, editorDocument, ocrWords);
// ...
setPdfHover(hover);
```

- `pdfHoverIdsAtPoint` always returns a new object, so React never skips the state update. It can only skip when the new value is identical, by `Object.is`, to the old one.
- There is no `requestAnimationFrame` throttle.
- `components/editor` contains no `memo`, `useMemo` or `useCallback`, apart from `document-search.tsx`. `next.config.ts` does not set `reactCompiler`.
- As a result, every move re-runs every layer's pass over all objects:
  - `PdfTextLayer` walks all runs 3×;
  - `PdfVectorLayer` walks all vectors 3×;
  - every edited vector's `commandsToSvgPath` (`pdf-vector-layer.tsx:67`) is rebuilt at full float precision.
- When no gesture is active, `toPage` calls `getBoundingClientRect()` (`overlay-gestures.ts:124-131`), up to three times per event.
- `PdfAnnotationDirtyBackdrop` lists a `.filter()` array, rebuilt on every render, in its effect dependencies (`pdf-annotation-layer.tsx:103-148`). Once any annotation is dirty, every render (and so every hover move) redraws its canvas.
- The draw tool copies the whole point array on every move (`overlay-gestures.ts:279`), which is O(n²) over a stroke.

## 3. Hit-testing is linear and measures more than it needs

Hover runs these checks in order (`overlay-pdf-hit.ts:148-226`): form → annotation → text → OCR → image → vector.

- **`hitTestPdfText`** (`object-utils.ts:1384`):
  - copies the run list with `toReversed()`;
  - calls `measurePdfTextWidth` for **every** run, which runs canvas `measureText` with no cache (`lib/fonts/measure-text.ts:170-185`);
  - that measurement calls `pdfTextPreviewFontCss`, which builds two `Set`s from glyph strings on each call (`lib/pdf/embedded-font.ts:66,93`);
  - only dirty runs need measuring; clean runs could use their source box.
- **`hitTestPdfVector`** (`object-utils.ts:1564`) → `hitTestVectorCommands` (`:1460`) walks every command of every non-deleted path. There is no bounding-box check first.
- **`hitTestPdfFormField`** → `pdfFormWidgetsOnPage` (`object-utils.ts:187`) walks every form field in the whole document.
- **Link caption helpers** filter and sort all of the page's runs once per link, with no caching:
  - `pdfLinkForDirtyCaptionRun` (`object-utils.ts:988`) and `pdfLinkOverlappingTextRuns` (`:318`);
  - `PdfTextLayer` calls them per dirty run on every render, so the cost grows with dirty runs × links × runs.

## 4. Store subscriptions are too wide

- `useEditorStore` wraps `useSyncExternalStore` with no equality function (`store.ts:1318`). That is fine as long as selectors return stable references ([React docs](https://react.dev/reference/react/useSyncExternalStore)).
- Several components select very wide slices:
  - `EditorOverlay` and `PdfFormLayer` select `state.document`;
  - the viewport and sidebar select `state.document.pages`.
- So an edit on page 5 re-renders every mounted overlay (the virtualizer's overscan keeps 3–5 pages mounted) and the whole sidebar.
- The sidebar renders all pages, up to 200 (`page-sidebar.tsx:131-176`). Only the thumbnail canvases wait until they are near view.
- Every progressive `appendPages` chunk of 4 pages (`store.ts:343`):
  - re-merges and sorts the whole page array;
  - runs `mergeEmbeddedFontGlyphs` over it;
  - patches history.

  Across a whole document that adds up to roughly O(N²/4).

## 5. Load-path leftovers

- **2 s font wait on the first-paint path.** `FONT_FACE_RESOLVE_MS = 2000` (`lib/pdf/extract-text.ts:85`) is awaited per page in `#loadPage` (`session.ts:399`), including for the first 3 pages.
- **Three passes over the operator list per page.** `extract-images.ts:144`, `extract-text-colors.ts:288` and `extract-vectors.ts:641` each walk the full `fnArray`.
- **Extraction cleanup forces a second parse.** `page.cleanup()` runs after extraction (`session.ts:443`) and drops pdf.js's operator-list and object caches (pdf.js `api.js`, `PDFPageProxy.cleanup`). The main canvas also renders with a different annotation intent (ENABLE, `render-page.ts:122`) from extraction (DISABLE). Either way, the worker parses the content stream a second time for the visible pages.
- **Content-canvas cache grows forever, and is a correctness bug.** `lib/pdf/pdf-annotation-content-cache.ts`:
  - keeps one full-page canvas per `sourceIndex:scale:rotation`, with no size limit;
  - `clearAnnotationContentCache` and `invalidatePageContentCanvas` have **no callers**;
  - so the cache survives opening a new document, and the new file's page 0 can sample the old file's page 0 canvas when picking text cover colours (`sample-pdf-text-cover.ts`).
- **Hydration and visible renders compete.** Hydration yields with `setTimeout(0)` and has no priority, so visible-canvas renders queue in the worker behind hydration requests.

## 6. Spikes when an edit starts

- **First text edit parses the whole file.** It lazily runs pdf-lib `PDFDocument.load(bytes)` on the main thread (`lib/pdf/probe-pdf-font.ts:18`), which parses the whole file once per session.
- **Cover sampling is O(pixels × runs).** `sampleBackground` checks `excludeRects.some(...)` for every pixel (`lib/pdf/sample-background.ts:64`).
  - Building the exclude rects runs per-glyph `measureText` on every other run on the page.
  - The first sample at each zoom renders a full extra page offscreen.
  - The canvas is read with `getImageData` but created without `willReadFrequently` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)).
- **Keystrokes measure the whole page until measurement lands.** Until the async measurement arrives, `PdfTextEditor` calls `pdfTextCoverRects` on every keystroke (`pdf-text-layer.tsx:126`). That falls back to `measurePdfTextCoverRects` over all runs on the page.

---

## What is fine

- **Drag, resize and rotate** write straight to DOM node styles during the gesture and commit once on release (`overlay-gestures.ts:228-270`).
- **Inline text typing** stays in a local draft (`pdf-text-layer.tsx:188-190`). Overlay text is an uncontrolled `contentEditable`. Neither touches the store per keystroke.
- **Edits never re-render the PDF canvas or rebuild the PDF.** They are SVG/DOM overlays. `PdfCanvas` depends only on `[pixelRatio, rotation, scale, sourceIndex]`.
- **Export already runs in a worker** (`lib/pdf/run-export.ts`, `export.worker.ts`).

---

## Recommendations, by expected impact per effort

1. **History with shared references.** Store snapshots by reference and stop cloning in `commit`, `pushHistory`, undo and redo. Compare snapshots by `===` instead of `JSON.stringify`. Share appended pages instead of copying them. Guard the immutability assumption with a dev/test-only deep freeze after each commit. Send colour and number inputs through `previewEdit`/`commitPreview`.
2. **Cheap hover.** Throttle hover to one rAF and keep the old `pdfHover` object when its ids haven't changed. Cache the overlay rect during a gesture.
3. **Narrow subscriptions and add memoization.** Add a per-page selector, so `EditorOverlay` and `PdfFormLayer` subscribe to their own page. Enable the React Compiler ([Next.js `reactCompiler`](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler)), with hand-written `memo` as a fallback. Fix the backdrop effect's dependencies. Cache SVG path strings per object. Virtualize the sidebar with TanStack Virtual, which is already a dependency.
4. **Hit-test and measurement fixes:**
   - measure only dirty runs;
   - check a vector's bounding box before walking its commands;
   - index form widgets by page;
   - cache `measureText` results (bounded LRU) and glyph `Set`s;
   - cache link-caption lookups per page reference;
   - turn the exclude rects into a pixel mask in `sampleBackground`;
   - use `willReadFrequently` on sampling canvases;
   - move the pdf-lib font probe to a worker, or start it at idle.
5. **Load leftovers:**
   - clear the content-canvas cache on open/close and put a size limit on it;
   - shorten the font wait for the first-paint window;
   - make `appendPages` merge incrementally and emit less often;
   - walk the operator list once, feeding all three extractors;
   - yield with `scheduler.yield()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield), with a `setTimeout` fallback) and pause hydration while visible pages render.

Measure before doing these: skipping `cleanup()` for pinned pages, and deferring operator-list extraction for offscreen pages (rec #8 in [`pdf-load-performance.md`](./pdf-load-performance.md)).

Out of scope: a custom extraction worker, tiled canvases at high zoom, removing white covers, raising `MAX_PDF_PAGES`.

Noted while reading (correctness, not performance): the vector resize preview doesn't scale until release (`pdf-vector-layer.tsx:189,240`).

---

## Measurement

There are no timings in the repo today.
- **Store and hit-tests.** Add a `vitest bench` on a synthetic document (200 pages × 1500 runs × 200 vectors) that times `commit`, undo, `hitTestPdfText` and `hitTestPdfVector`.
- **Rendering.** Use the React DevTools Profiler to confirm that hovering an unchanged target commits no renders, and that editing page N doesn't render other pages' overlays.
- **Load.** Use a Performance-tab trace from file open to first paint on 50- and 200-page PDFs, before and after.

---

## Sources

### Repo

- `lib/editor/history.ts`: `cloneSnapshot`, `pushHistory`, `undoHistory`/`redoHistory`, `snapshotsEqual`
- `lib/editor/store.ts`: `commit`, `flushPreview`, `patchHistoryDocuments`, `appendPages`, `useEditorStore`
- `lib/editor/object-utils.ts`: `hitTestPdfText`, `hitTestPdfVector`, `hitTestVectorCommands`, `pdfFormWidgetsOnPage`, `pdfLinkForDirtyCaptionRun`, `pdfLinkOverlappingTextRuns`, `measurePdfTextCoverRects`
- `lib/fonts/measure-text.ts`, `lib/pdf/embedded-font.ts`
- `components/editor/editor-overlay.tsx`, `overlay-gestures.ts`, `overlay-pdf-hit.ts`, `pdf-text-layer.tsx`, `pdf-vector-layer.tsx`, `pdf-annotation-layer.tsx`, `pdf-form-layer.tsx`, `page-sidebar.tsx`, `inspector-bar.tsx`, `color-field.tsx`
- `lib/pdf/session.ts`, `extract-text.ts`, `extract-images.ts`, `extract-vectors.ts`, `extract-text-colors.ts`, `render-page.ts`, `pdf-annotation-content-cache.ts`, `sample-pdf-text-cover.ts`, `sample-background.ts`, `probe-pdf-font.ts`, `run-export.ts`
- `next.config.ts`

### External

- [React — `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- [MDN — `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [Next.js — `reactCompiler`](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler)
- [MDN — `HTMLCanvasElement.getContext` (`willReadFrequently`)](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)
- [MDN — `Scheduler.yield`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)
- [mozilla/pdf.js `src/display/api.js`](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js): `PDFPageProxy.cleanup`, intent-keyed operator-list cache
