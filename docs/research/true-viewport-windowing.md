# True viewport windowing for 100+ page docs

## Question

What should “true windowing” / virtualized long lists mean for Paperoo’s continuous vertical PDF page stack, and how should it be built correctly in this codebase?

Out of scope leftover from the multi-page viewport plan (see [`docs/research/viewport-page-scroll.md`](./viewport-page-scroll.md)): near-viewport `PdfCanvas` mount via IntersectionObserver + full-height placeholders is enough for typical docs (`MAX_PDF_PAGES = 200`); true windowing is the next step for 100+ page stress.

---

## Current state (cite file paths)

### Full page-frame stack, gated canvases

[`components/editor/editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) maps **every** `document.pages` entry into an `EditorPageFrame` inside one `overflow-auto` scroller:

```203:213:components/editor/editor-viewport.tsx
        <div className="flex min-w-full flex-col items-center gap-6 p-8">
          {pages.map((page) => (
            <EditorPageFrame
              displayZoom={displayZoom}
              key={page.id}
              page={page}
              pageRef={setPageEl}
              scrollerRef={scrollerRef}
              zoom={zoom}
            />
          ))}
```

Heights come from page geometry × zoom (and rotation swap), not from measuring painted PDF content:

```36:42:components/editor/editor-page-frame.tsx
  const pageWidth = page.width * zoom;
  const pageHeight = page.height * zoom;
  const displayWidth = page.width * displayZoom;
  const displayHeight = page.height * displayZoom;
  const swapped = page.rotation % 180 !== 0;
  const frameWidth = swapped ? displayHeight : displayWidth;
  const frameHeight = swapped ? displayWidth : displayHeight;
```

### Near-viewport PdfCanvas + overlay (IntersectionObserver)

Each frame observes itself against the scroller with `rootMargin: "100% 0px"` and only mounts `PdfCanvas` + `EditorOverlay` when intersecting (or when it is `currentPageId`):

```13:13:components/editor/editor-page-frame.tsx
const VISIBILITY_ROOT_MARGIN = "100% 0px";
```

```47:62:components/editor/editor-page-frame.tsx
  useEffect(() => {
    const node = rootRef.current;
    const root = scrollerRef.current;
    if (!node || !root) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setVisible(Boolean(entry?.isIntersecting || page.id === currentPageId));
      },
      { root, rootMargin: VISIBILITY_ROOT_MARGIN }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentPageId, page.id, scrollerRef]);
```

```111:130:components/editor/editor-page-frame.tsx
      {visible ? (
        <div
          className="relative"
          style={{
            height: canvasHeight,
            transform: previewing ? `scale(${rasterScale})` : undefined,
            transformOrigin: "center center",
            width: canvasWidth,
          }}
        >
          <PdfCanvas
            rotation={canvasRotation}
            scale={zoom}
            sourceIndex={page.sourceIndex}
          />
          <div className="absolute" style={overlayStyle}>
            <EditorOverlay page={page} zoom={zoom} />
          </div>
        </div>
      ) : null}
```

Unmount path releases the **canvas backing store** only (`releaseCanvas`), not the PDF.js page proxy:

```47:51:components/editor/pdf-canvas.tsx
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      releaseCanvas(canvas);
    };
```

```64:67:lib/pdf/render-page.ts
export const releaseCanvas = (canvas: HTMLCanvasElement): void => {
  canvas.width = 0;
  canvas.height = 0;
};
```

### Scrollspy + programmatic scroll

Viewport scrollspy uses a **second** `IntersectionObserver` on every page node (`rootMargin: "-35% 0px -35% 0px"`, multi-threshold) and calls `setCurrentPage(bestId, { syncFitZoom: false })` ([`editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) L12–14, L89–153). Non-scrollspy `currentPageId` changes call `scrollIntoView({ behavior: "instant", block: "nearest" })` (L155–169). Sidebar mirrors selection and scrolls its own thumbnail list similarly ([`page-sidebar.tsx`](../../components/editor/page-sidebar.tsx) L17–23, L71).

`setCurrentPage` clears selection and optionally recomputes fit zoom; scroll-driven activation must keep `syncFitZoom: false` ([`lib/editor/store.ts`](../../lib/editor/store.ts) L639–658; tests in [`test/viewport-page-scroll.test.ts`](../../test/viewport-page-scroll.test.ts)).

### Page size / cache limits

- `MAX_PDF_PAGES = 200` ([`lib/editor/types.ts`](../../lib/editor/types.ts) L318).
- Open path rejects docs above that and, while opening, loads every page’s text/ops then `page.cleanup()` ([`lib/pdf/session.ts`](../../lib/pdf/session.ts) L81–84, L90–150).
- Runtime render cache: `getPage` stores `PDFPageProxy` in `#pages`; `releasePage` calls `page.cleanup()` and deletes the entry (L157–177). **Call sites today:** only `close()` (L179–183). Grep shows no other `releasePage` usage in the app.

### Sidebar thumbs already IO-gate paint

[`page-thumbnail.tsx`](../../components/editor/page-thumbnail.tsx) uses IntersectionObserver + `rootMargin: "160px 0px"` and only paints when visible/selected — same pattern as viewport frames, but the sidebar still mounts one list item per page (up to 200).

### Prior research framing

[`docs/research/viewport-page-scroll.md`](./viewport-page-scroll.md) explicitly treated “virtualize full-page canvases (near-viewport mount only)” as the raster constraint for the first ship; continuous stack + IO scrollspy was the chosen approach.

---

## Costs of full placeholder stack

Even with gated `PdfCanvas`, these costs remain at `N = pages.length` (up to 200):

| Cost | What remains today | Primary evidence |
| --- | --- | --- |
| **React tree** | `N` `EditorPageFrame` instances always subscribe to store (`currentPageId`), own local state (`visible`, `snap`), and register refs | [`editor-page-frame.tsx`](../../components/editor/editor-page-frame.tsx) L28–31; [`editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) L204–213 |
| **DOM / layout** | `N` positioned frames with explicit `width`/`height`, plus flex column `gap-6` and `p-8`; browser must maintain full scroll height and participate in scroll/layout of the whole stack | Frame styles L104–109; stack chrome L203 |
| **IntersectionObserver fan-out** | **1 visibility IO per page** + **1 scrollspy IO observing all pages** = O(N) observations firing on scroll | Frame IO L53–61; scrollspy L121–147 |
| **PDF.js page memory** | Leaving the near-viewport zone unmounts canvas but **does not** `releasePage`; `#pages` grows for every page ever painted in the session until `close()` | [`session.ts`](../../lib/pdf/session.ts) L157–177, L179–183; [`pdf-canvas.tsx`](../../components/editor/pdf-canvas.tsx) L47–51 |
| **Canvas / overlay** | Bounded by IO + `rootMargin: 100%` (roughly one viewport of overscan above and below). Edit layers only exist on mounted pages | Frame L111–130; overlay is heavy ([`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx)) |
| **Scroll performance** | Full-height scrollport is fine at 200 for many machines; cost is React reconcile + IO callbacks + retained `PDFPageProxy`s, not necessarily layout of empty boxes alone | MDN: IO notifies asynchronously when targets cross thresholds ([Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)); Mozilla’s viewer still caps live page views precisely because canvas/proxy retention is expensive (below) |

**What “true windowing” means here:** stop mounting off-window `EditorPageFrame` (and their observers/overlays) entirely. Represent off-window pages only as **scroll offset math** (spacer / absolute offsets), not as placeholder React trees. Near-viewport canvas gating alone is **raster windowing**; true windowing is **DOM/React windowing** of the page stack.

At `MAX_PDF_PAGES = 200`, placeholders + IO are intentionally “enough for typical docs”; true windowing targets smoother scroll, lower observer/reconcile load, and bounded PDF.js page retention when users thrash through large docs.

---

## Primary-source techniques (cite URLs / source paths)

### TanStack Virtual (headless list virtualizer)

Official intro: only render items in (and slightly around) the viewport; parent gets `overflow: auto`; inner element height is `getTotalSize()`; items are absolutely positioned with `translateY(start)` ([TanStack Virtual — Introduction](https://tanstack.com/virtual/latest/docs/introduction)).

Relevant APIs ([Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)):

- **`estimateSize(index)`** — required; for dynamic measure, estimate high; Paperoo can usually return the **exact** CSS frame height from known `page.width/height × zoom` (+ rotation).
- **`overscan`** — extra rows above/below visible range (default `1`).
- **`gap`** — pixel spacing between items (maps to today’s `gap-6`).
- **`paddingStart` / `paddingEnd`** — maps to scroller padding (`p-8`).
- **`getVirtualItems()` / `getTotalSize()`** — render window + total scroll height.
- **`scrollToIndex(index, { align, behavior })`** — replaces `scrollIntoView` when nodes may be unmounted.
- **`measure()` / `resizeItem(index, size)` / `measureElement`** — invalidate or correct sizes when zoom/rotation changes item heights. Docs note measurement-affecting option changes invalidate the measurement cache; `measure()` “Resets any prev item measurements.”
- Dynamic example uses `estimateSize` then adjusts; also demonstrates `scrollToIndex` ([TanStack/virtual `examples/react/dynamic`](https://raw.githubusercontent.com/TanStack/virtual/main/examples/react/dynamic/src/main.tsx)).

### react-window

Component-oriented list virtualization with `rowCount`, `rowHeight` (number, %, function, or dynamic cache), `overscanCount`, and imperative scroll APIs ([react-window npm README](https://www.npmjs.com/package/react-window)). Docs warn: “Dynamic row heights are not as efficient as predetermined sizes. It's recommended to provide your own height values if they can be determined ahead of time.” Paperoo **can** determine heights ahead of time from `EditorPage` geometry × zoom — so either library works; TanStack’s headless model fits the existing custom scroller / frame chrome better.

### MDN Intersection Observer

Observers take an optional `root` (must be an ancestor scroll container), `rootMargin`, and `threshold`; callbacks report `intersectionRatio` / `isIntersecting` ([MDN Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)). Paperoo already uses this correctly with `root = scrollerRef`. After true windowing, **do not** observe all N pages: either observe only mounted virtual items, or derive `currentPageId` from scroll offset + known cumulative heights (no IO required).

### PDF.js viewer page buffer (Mozilla)

Current `web/pdf_viewer.js` (mozilla/pdf.js master):

- `DEFAULT_CACHE_SIZE = 10` ([raw source](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_viewer.js) L75).
- `PDFPageViewBuffer` is an insertion-ordered set; overflow destroys the oldest view (L160–180).
- On `update()`, cache size becomes `Math.max(DEFAULT_CACHE_SIZE, 2 * numVisiblePages + 1)`, keeping currently visible ids ([same file](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_viewer.js) L1982–2002).
- `PDFPageView.destroy()` resets the view and calls `this.pdfPage?.cleanup()` ([pdf_page_view.js](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_page_view.js) L426–428).

Maintainers treat larger buffers as a CPU/worker-parse issue, not only RAM ([mozilla/pdf.js#12104](https://github.com/mozilla/pdf.js/issues/12104)). Pattern for Paperoo: **small live window of mounted frames + explicit `releasePage` when a source index leaves the window**, analogous to `PDFPageViewBuffer` + `cleanup()`.

Also: `PagesCountLimit.PAUSE_EAGER_PAGE_INIT = 250` in the same viewer file (L77–81) — Mozilla starts being conservative around a few hundred pages, in the same ballpark as Paperoo’s hard cap of 200.

### CSS `content-visibility` (lighter alternative, not full windowing)

[`content-visibility: auto`](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) lets the UA skip layout/paint of off-screen subtrees while keeping nodes in the DOM/a11y tree. Pair with [`contain-intrinsic-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size) so skipped sections keep a placeholder size. This **does not** remove React component instances or IntersectionObservers; it is a browser-level paint/layout skip. Useful as a cheap intermediate, insufficient as “true windowing.”

---

## Constraints for Paperoo

1. **Known but variable page sizes** — each `EditorPage` has `width`/`height` at open ([`types.ts`](../../lib/editor/types.ts) L229–233; set from `page.getViewport({ scale: 1 })` in [`session.ts`](../../lib/pdf/session.ts) L99–127). Mixed sizes are real (tests use 612×792 vs 400×1200).
2. **Global zoom + pinch preview** — frame CSS size uses `displayZoom` (preview) while raster uses committed `zoom` ([`editor-page-frame.tsx`](../../components/editor/editor-page-frame.tsx) L34–39). Any virtualizer `estimateSize` must track `displayZoom` (and page rotation swap). On settle, `setZoom` changes all heights → call `virtualizer.measure()` or rebuild estimates.
3. **Scrollspy ↔ `currentPageId`** — must keep `syncFitZoom: false` ([`store.ts`](../../lib/editor/store.ts) L639–658; [`viewport-page-scroll.test.ts`](../../test/viewport-page-scroll.test.ts)).
4. **Programmatic navigation** — sidebar click / undo-restored page / `stepCurrentPage` today assume a mounted DOM node for `scrollIntoView` ([`editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) L155–169). With windowing, the target frame may not exist → use `scrollToIndex` (or equivalent offset math). Suppress scrollspy briefly during programmatic moves (existing `SCROLL_SPY_SUPPRESS_MS`).
5. **Edit overlays only on mounted pages** — already true; windowing must not mount overlays for off-window pages. Leaving a page unmounts overlay state (acceptable; selection is cleared on page change anyway).
6. **Pixel-snap margins** — tiny `marginLeft`/`marginTop` adjustments ([`editor-page-frame.tsx`](../../components/editor/editor-page-frame.tsx) L64–76, L104–108) are noise for estimates; either ignore in `estimateSize` or fold into `measureElement` if scroll drift appears.
7. **`MAX_PDF_PAGES = 200`** — hard product ceiling; windowing is about constant-cost scrolling within that bound, not infinite docs.
8. **PDF session cache** — `releasePage` exists but is unused on canvas unmount; windowing should pair unmount with release (with a small buffer matching Mozilla’s ~10 / `2×visible+1` idea).

---

## Recommended approach (concrete, one choice)

**Adopt `@tanstack/react-virtual` in `EditorViewport`, with predetermined row heights from page geometry × `displayZoom` (plus `gap` / padding options). Drop the all-pages placeholder React list. Keep a small overscan of fully mounted `EditorPageFrame`s (canvas + overlay). On window exit, unmount the frame and call `pdfSession.releasePage(sourceIndex)` with an LRU/buffer policy (~`max(10, 2×visible+1)`). Replace viewport `scrollIntoView` with `virtualizer.scrollToIndex`. Derive or limit scrollspy to the virtual window (prefer offset-based active page from cumulative heights to avoid O(N) observers).**

Rationale vs alternatives:

| Option | Verdict |
| --- | --- |
| **Stay on placeholders + IO only** | Acceptable under 200 for “typical” docs (already the plan leftover), but does not bound React/IO/`PDFPageProxy` growth when users scroll the whole doc. |
| **`content-visibility: auto` only** | Cheap paint win; still mounts 200 frames and observers ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility)). Not true windowing. |
| **Hand-rolled spacers** | Feasible because sizes are known, but reimplements `getTotalSize`, overscan, and `scrollToIndex` that TanStack already documents. |
| **react-window** | Fine for known heights; more opinionated markup than Paperoo’s existing scroller/InspectorBar layout. |
| **TanStack Virtual** | Headless, first-class `estimateSize` / `gap` / `padding*` / `scrollToIndex` / `measure`, matches continuous vertical stack ([docs](https://tanstack.com/virtual/latest/docs/api/virtualizer)). |

**What to keep of current IO gating:** once only ~overscan frames mount, per-frame visibility IO is largely redundant — virtualizer overscan _is_ the mount gate. Optionally keep a short grace (don’t unmount the current page) mirroring today’s `page.id === currentPageId` force-visible rule. Sidebar thumbnails can keep their own IO paint gate unchanged.

**Measurement strategy:** prefer **exact** `estimateSize` from `EditorPage` + `displayZoom` + rotation (same formula as `frameHeight` today). Use `virtualizer.measure()` when zoom settles or pages rotate/reorder. Do **not** treat heights as unknown dynamic content; that is the react-window / TanStack “dynamic” path and is unnecessary here.

**PDF page release:** mirror Mozilla’s buffer — retain proxies for the virtual window (+ small LRU), `releasePage` on eviction; always `releaseCanvas` on unmount (already done).

---

## Implementation sketch (files to touch, key APIs)

1. **Dependency:** add `@tanstack/react-virtual`.
2. **`components/editor/editor-viewport.tsx`**
   - `useVirtualizer({ count: pages.length, getScrollElement: () => scrollerRef.current, estimateSize: (i) => frameHeight(pages[i], displayZoom), gap: 24 /* gap-6 */, paddingStart/End: 32 /* p-8 */, overscan: 2, getItemKey: (i) => pages[i].id })`.
   - Inner wrapper: `height: virtualizer.getTotalSize()`, `position: relative`.
   - Map `virtualizer.getVirtualItems()` → `EditorPageFrame` with absolute/`translateY(start)`.
   - Programmatic nav: `virtualizer.scrollToIndex(index, { align: "nearest" /* or start */ })` instead of `node.scrollIntoView`.
   - Scrollspy: either observe only mounted virtual items, or compute active index from `scrollOffset` + prefix sums of `estimateSize` (preferred for O(1)/O(log N)).
   - On `displayZoom` / page list / rotation changes: ensure estimates refresh (`measure()` if needed).
3. **`components/editor/editor-page-frame.tsx`**
   - Remove or simplify per-frame IntersectionObserver if parent only mounts near-window pages.
   - Optionally accept `onEvict` / rely on unmount cleanup in `PdfCanvas`.
4. **`components/editor/pdf-canvas.tsx` + `lib/pdf/session.ts`**
   - On cleanup, after `releaseCanvas`, call `pdfSession.releasePage(sourceIndex)` **or** push through a small session-level buffer API (`touchPage` / `evictToBudget`) so thumbnail + viewport sharing the same `sourceIndex` does not thrash (sidebar thumbs also call `getPage`).
   - Careful: sidebar and viewport can need the same page concurrently — release only when **no** mounted consumer remains (refcount) or only release viewport-scale caches separately if thumbs keep proxies warm.
5. **`page-sidebar.tsx` / thumbs** — out of critical path for viewport windowing; optional later virtualization of the sidebar list.
6. **Tests:** extend [`test/viewport-page-scroll.test.ts`](../../test/viewport-page-scroll.test.ts) for store behavior; add unit helpers for `estimateSize` / prefix-sum scrollspy if extracted; integration tests for `scrollToIndex` need DOM (optional).

---

## Out of scope / non-goals

- Raising or removing `MAX_PDF_PAGES = 200`.
- Virtualizing the page sidebar thumbnail list (same techniques apply later).
- CSS scroll-snap, continuous page-spread / horizontal modes.
- Replacing Paperoo’s editor with Mozilla’s `PDFViewer` widget.
- Partial-page / detail canvas tiling (`enableDetailCanvas` in pdf.js) — separate zoom/memory topic.
- Changing fit-zoom semantics beyond keeping `syncFitZoom: false` on scroll-driven page changes.
- Hand-optimizing React with `memo` as a substitute for not mounting off-window frames.

---

## Sources

### Repo

- [`components/editor/editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) — full-stack map, scrollspy IO, `scrollIntoView`
- [`components/editor/editor-page-frame.tsx`](../../components/editor/editor-page-frame.tsx) — size math, visibility IO, gated canvas/overlay
- [`components/editor/pdf-canvas.tsx`](../../components/editor/pdf-canvas.tsx) — render + `releaseCanvas` only
- [`components/editor/page-thumbnail.tsx`](../../components/editor/page-thumbnail.tsx) — IO-gated thumb paint
- [`components/editor/page-sidebar.tsx`](../../components/editor/page-sidebar.tsx) — thumbnail list + sidebar `scrollIntoView`
- [`components/editor/editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) — overlay cost when mounted
- [`lib/editor/store.ts`](../../lib/editor/store.ts) — `setCurrentPage`, zoom/fit
- [`lib/editor/types.ts`](../../lib/editor/types.ts) — `EditorPage`, `MAX_PDF_PAGES`
- [`lib/pdf/session.ts`](../../lib/pdf/session.ts) — `getPage` / `releasePage` / open cleanup
- [`lib/pdf/render-page.ts`](../../lib/pdf/render-page.ts) — `releaseCanvas`, `renderPdfPage`
- [`test/viewport-page-scroll.test.ts`](../../test/viewport-page-scroll.test.ts)
- [`docs/research/viewport-page-scroll.md`](./viewport-page-scroll.md)

### External primary docs / upstream

- [TanStack Virtual — Introduction](https://tanstack.com/virtual/latest/docs/introduction)
- [TanStack Virtual — Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer) (`estimateSize`, `overscan`, `gap`, `padding*`, `scrollToIndex`, `measure`, `resizeItem`)
- [TanStack/virtual dynamic React example](https://raw.githubusercontent.com/TanStack/virtual/main/examples/react/dynamic/src/main.tsx)
- [react-window](https://www.npmjs.com/package/react-window) (known vs dynamic row heights)
- [MDN — Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [MDN — `content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility)
- [MDN — `contain-intrinsic-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size)
- [mozilla/pdf.js `web/pdf_viewer.js`](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_viewer.js) — `DEFAULT_CACHE_SIZE`, `PDFPageViewBuffer`, `update()` cache resize
- [mozilla/pdf.js `web/pdf_page_view.js`](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/pdf_page_view.js) — `destroy()` → `pdfPage.cleanup()`
- [mozilla/pdf.js#12104](https://github.com/mozilla/pdf.js/issues/12104) — why cache size stays small (CPU/worker parse, not only RAM)
