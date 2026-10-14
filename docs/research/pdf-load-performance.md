# PDF load performance on initial select

Selecting a PDF for editing feels slow because `pdfSession.open` fully extracts **every page** (text + operator list + annotations + fonts + vectors + images + form probes) before the store flips to `ready` and anything paints. First paint waits on O(pages) worker round-trips plus O(ops) main-thread extraction, then the visible pages pay `getPage` **twice** (once in `open`, once in `PdfCanvas`).

Primary sources: `lib/pdf/session.ts` (`PdfSession.open`), `lib/pdf/load-pdf.ts`, `lib/pdf/pdfjs.ts`, `lib/pdf/extract-*.ts`, `components/editor/editor-shell.tsx`, `components/editor/pdf-canvas.tsx`, `components/editor/editor-viewport.tsx`, `node_modules/pdfjs-dist/build/pdf.mjs` + `types/src/display/api.d.ts`. Versions: `pdfjs-dist@6.3.289`, `next@16.3.4` (`package.json:27-29`).

---

## Initial-select pipeline

1. **UI gate.** `loadPdfFile` sets `loading`, reads bytes, then `await pdfSession.open(bytes)` before `resetDocument` (`lib/pdf/load-pdf.ts:5-25`). `EditorShell` shows only a `Spinner` while `status === "loading"` and mounts `EditorViewport` on `ready` (`components/editor/editor-shell.tsx:23-34`). Nothing paints until `open` resolves.
2. **Worker cold start + document parse.** `ensurePdfjsWorker()` spawns a module `Worker` from `pdfjs-dist/build/pdf.worker.mjs` once (`lib/pdf/pdfjs.ts:22-32`); `open` then `getDocument({ data, cMapUrl, standardFontDataUrl, wasmUrl, iccUrl })` and awaits `loadingTask.promise` (`lib/pdf/session.ts:84-96`). First select pays worker spawn + WASM/CMap fetch + trailer/XRef parse.
3. **Fetch all pages at once.** `Promise.all(pageNumbers.map(getPage))` for all N pages (`lib/pdf/session.ts:112-118`). Each `getPage` is a worker round-trip (`pdf.mjs` `PDFDocumentProxy.getPage` via transport).
4. **Triple fetch per page.** Per page, `Promise.all([getTextContent(), getOperatorList({ annotationMode: DISABLE }), getAnnotations({ intent: "display" })])` (`lib/pdf/session.ts:127-131`). `getTextContent` streams chunks and concatenates (`pdf.mjs:16030-16046`); `getOperatorList` pumps the full operator list through the intent-state machine (`pdf.mjs:15982-16012`); `getAnnotations` resolves the rendering intent and asks the worker (`pdf.mjs:15831-15838`).
5. **Per-page extraction (main thread).** `extractPdfAnnotationObjects` → `toExtractableTextContent` → `await collectPdfFontFaces(commonObjs, items)` → `extractPdfTextPaints` + `zipPdfTextItemPaints` → `extractPdfImageObjects` / `extractPdfTextObjects` / `extractPdfVectorObjects` (`lib/pdf/session.ts:145-183`). Then `page.cleanup()` and the page proxy is dropped (`lib/pdf/session.ts:190`) — **not** stored in the `#pages` cache.
6. **Form tail.** After all pages, `Promise.all([hasJSActions(), getSignatures(), getFieldObjects(), getCalculationOrderIds()])` (`lib/pdf/session.ts:206-212`; thin transport wrappers at `pdf.mjs:15756-15769`, `16906-16918`), then `extractPdfForm` reuses the already-fetched `rawAnnotations` (`lib/pdf/session.ts:198-205,213`).
7. **Ready → re-fetch visible pages.** `resetDocument` sets `status: "ready"` (`lib/editor/store.ts:735-760`). `EditorViewport` (virtualized, `@tanstack/react-virtual`, `editor-viewport.tsx:46-67`) mounts; each visible `PdfCanvas` calls `pdfSession.retainPage → getPage` **again** (`components/editor/pdf-canvas.tsx:32`) because `open` never populated `#pages` (`lib/pdf/session.ts:225-238`). Visible pages are parsed twice.

---

## Bottlenecks, ranked by expected impact

1. **All-pages-eager extraction blocks first paint (structural, O(pages)).** Steps 3–6 run for all N (up to `MAX_PDF_PAGES = 200`, `lib/editor/types.ts:545-546`) before `ready`. A 1-page edit still waits behind page 200's `getTextContent` + `getOperatorList` + annotation parse. This dominates wall time on multi-page PDFs.
2. **N-wide `Promise.all` fan-out onto one worker.** `open` fires N `getPage`s, then 3N content requests, through the single `workerPort` (`lib/pdf/pdfjs.ts:27-30`). The worker services messages sequentially while the main thread holds N pending promises and N operator lists in memory — queueing delay + peak memory, no backpressure.
3. **Duplicate `getPage` for visible pages.** `open` fetches every page then `cleanup()`s it (`session.ts:190`) without caching; `PdfCanvas` re-fetches via `retainPage/getPage` (`pdf-canvas.tsx:32`, `session.ts:225-238`). First-visible pages pay parse + transfer twice; render cannot start until the second fetch resolves.
4. **`collectPdfFontFaces` await per page with 2 s fallback.** `resolveFontFace` waits on the `PDFObjects.get` callback or a `FONT_FACE_RESOLVE_MS = 2000` timer (`lib/pdf/extract-text.ts:80,109-142`), fanned out per distinct `fontName` (`extract-text.ts:145-166`). Pages whose fonts are not yet in `commonObjs` stall up to ~2 s each (parallel across fonts, but serial across the `await` before paint extraction continues on that page).
5. **Wasted `getFieldObjects()` round-trip.** Its result is discarded by the hole in `const [hasJavaScript, signatures, , calculationOrderIds]` (`session.ts:206-212`) — a full worker round-trip (`pdf.mjs:15756-15757`) that changes nothing.
6. **Worker cold start on first select.** `ensurePdfjsWorker` runs lazily inside `open` (`session.ts:84`); worker script + WASM + CMaps load on the critical path. Repeat selects reuse it; the first one does not.
7. **Three full operator-list walks per page.** Images, vectors, and text-paints each scan the entire `fnArray` independently (`extract-images.ts:144`, `extract-vectors.ts:519`, `extract-text-colors.ts:286`). Cost is 3× O(ops) with per-op branching, plus one `createId()` per emitted object.
8. **Form probes serialized after pages.** The four doc-level calls start only after every page extracted (`session.ts:206-212`), pushing `ready` later even though they are page-independent.

What is **not** the problem: `extractPdfForm` itself reuses fetched annotations (no second fetch); `getOperatorList` already uses `AnnotationMode.DISABLE` so it is not doing annotation rendering; `resetDocument` is a single synchronous `setState` (`store.ts:735-760`).

---

## Primary-source evidence

- Eager all-pages + triple fetch blocks ready: `lib/pdf/session.ts:112-131`, `lib/pdf/load-pdf.ts:19-25`, `components/editor/editor-shell.tsx:23-34`.
- Single worker port: `lib/pdf/pdfjs.ts:22-32`.
- `getOperatorList` pumps full op list per intent; `getTextContent` streams+concatenates; `getAnnotations` is a worker round-trip: `node_modules/pdfjs-dist/build/pdf.mjs:15982-16046`, `:15831-15838`; types at `node_modules/pdfjs-dist/types/src/display/api.d.ts:1501-1572`.
- Doc probes are transport round-trips: `pdf.mjs:15756-15769`, `16900-16918`.
- Pages dropped, not cached: `session.ts:190` vs cache path `session.ts:225-238`; re-fetch on paint `pdf-canvas.tsx:32-44`.
- Discarded `getFieldObjects`: `session.ts:206-212`.
- Font await + 2 s timer: `lib/pdf/extract-text.ts:80-82,109-166`.
- Triple op-list walk: `lib/pdf/extract-images.ts:135-144`, `lib/pdf/extract-vectors.ts:510-519`, `lib/pdf/extract-text-colors.ts:278-286`.
- Viewport is virtualized (only ~visible + `VIRTUAL_OVERSCAN` items paint) yet extraction is not: `components/editor/editor-viewport.tsx:46-79`; idle budget `session.ts:72-75`.
- Caps: `MAX_PDF_BYTES` 80 MB, `MAX_PDF_PAGES` 200 (`lib/editor/types.ts:545-546`).

---

## Recommendations (speed-up per effort)

1. **Two-phase open: first-visible page(s) → `ready` → background-extract rest.** (High speed-up, medium effort.) Extract page 0 (or the virtualizer's initial window) through the step-5 pipeline, call `resetDocument`, then extract remaining pages in bounded chunks and merge via a store append. Time-to-first-paint drops from O(N) to O(1); total work unchanged. Requires a store action to append pages + form model update.
2. **Cache `open` pages in `#pages` instead of `cleanup` + refetch.** (Medium speed-up, low effort.) Store fetched proxies in `#pages` (or at least the first window) so `PdfCanvas.retainPage` hits cache. Removes the 2× `getPage` on visible pages. Watch memory: cap retained idle pages (budget exists at `session.ts:72-75`).
3. **Delete the unused `getFieldObjects()` call.** (Small speed-up, trivial effort.) Remove it from the `Promise.all` at `session.ts:206-212`. One fewer worker round-trip on every open.
4. **Prewarm the worker at app idle.** (Small speed-up on first select, trivial effort.) Call `ensurePdfjsWorker()` on mount / `requestIdleCallback` instead of lazily in `open`. Moves worker spawn + script compile off the critical path (WASM/CMaps still fetch on `getDocument`).
5. **Bound concurrency (e.g. 4 pages at a time).** (Medium speed-up on large PDFs, low effort.) Replace N-wide `Promise.all(getPage)` with a chunked pool. Reduces worker queue head-of-line blocking and operator-list memory spikes; pairs with (1).
6. **Start form probes concurrently with page extraction.** (Small speed-up, low effort.) Hoist the `hasJSActions/getSignatures/getCalculationOrderIds` promises before the page loop instead of after it.
7. **Fuse the three operator-list walks.** (Medium speed-up on graphics-heavy pages, medium effort.) Single pass producing images + vectors + text paints. Touches three tested extractors — keep behavior parity via existing extract tests.
8. **Lazy `getOperatorList` for offscreen pages.** (High speed-up with (1), higher effort.) Offscreen pages need only `getTextContent` (+ optionally annotations) for search/select; defer `getOperatorList`-dependent extraction (images/vectors/paints) until the page enters the virtualizer window. Changes the `EditorPage` fill contract — needs placeholder/empty-object states.

Not recommended: `disableWorker` / fake-worker mode (moves parse to main thread, worse interactivity); lowering `MAX_PDF_PAGES` (hides the problem); caching operator lists across selects (stale after edits).

---

## Measurement plan

No timing exists today (no `performance.now`/`console.time` in `lib/pdf`). Verify with temporary marks:

1. Add `performance.now()` marks in `PdfSession.open`: after `loadingTask.promise`, after `getPage` all, per-page after the triple fetch and after extraction (log `sourceIndex`, `items.length`, `fnArray.length`), around `collectPdfFontFaces`, around the form `Promise.all`. Log deltas via `console.debug`; remove before merge.
2. Test corpus: (a) 1-page text PDF, (b) 50-page text PDF, (c) image-heavy 10-page PDF, (d) 200-page stress PDF. Record: file-open click → `ready` (spinner duration), `ready` → first `PdfCanvas` paint, per-stage totals from marks.
3. Success criteria: two-phase open makes (b)/(d) first-paint ≈ (a); caching removes the second `getPage` burst (visible in marks as zero re-fetch); deleting `getFieldObjects` shortens the form tail by one round-trip.
4. Cross-check worker contention: compare N-wide vs chunked-4 total `open` time on (d); expect lower variance and lower peak memory (Performance tab → JS heap).

---

## Sources

- `lib/pdf/session.ts` (`PdfSession.open`, `getPage`/`retainPage`, `close`)
- `lib/pdf/load-pdf.ts` (`loadPdfFile`)
- `lib/pdf/pdfjs.ts` (`ensurePdfjsWorker`, asset URLs)
- `lib/pdf/extract-text.ts` (`collectPdfFontFaces`, `resolveFontFace`, `FONT_FACE_RESOLVE_MS`)
- `lib/pdf/extract-text-colors.ts` (`extractPdfTextPaints`, `zipPdfTextItemPaints`)
- `lib/pdf/extract-images.ts`, `lib/pdf/extract-vectors.ts`, `lib/pdf/extract-annotations.ts`, `lib/pdf/extract-forms.ts`
- `lib/pdf/render-page.ts` (`renderPdfPage`)
- `components/editor/editor-shell.tsx`, `editor-viewport.tsx`, `pdf-canvas.tsx`
- `lib/editor/store.ts` (`resetDocument`), `lib/editor/types.ts` (caps)
- `node_modules/pdfjs-dist/build/pdf.mjs` (`getOperatorList`, `getTextContent`/`streamTextContent`, `getAnnotations`, doc probes), `node_modules/pdfjs-dist/types/src/display/api.d.ts`
