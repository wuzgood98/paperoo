# Page Up / Page Down hotkeys

How unmodified PageUp/PageDown should step between pages in Paperoo’s continuous multi-page PDF editor viewport.

Primary sources: W3C UI Events key values, MDN `KeyboardEvent.key` / key-value tables / `scrollIntoView`, Chromium PDF `viewport.ts`, Mozilla PDF.js `web/app.js` + `pdfjs-dist` `BaseViewer`, Adobe Acrobat keyboard-shortcuts help, paperoo editor store / hotkeys / viewport, prior [`viewport-page-scroll.md`](./viewport-page-scroll.md).

---

## Spec / browser meaning

[W3C UI Events KeyboardEvent key Values §3.4 Navigation keys](https://www.w3.org/TR/uievents-key/#keys-navigation):

| Key value    | Meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `"PageDown"` | Page Down key — scroll down or display next page of content |
| `"PageUp"`   | Page Up key — scroll up or display previous page of content |

Same definitions in [MDN — Keyboard event key values → Navigation keys](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values#navigation_keys). [MDN — `KeyboardEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key) is the property that returns these strings.

They are distinct from `"Home"` / `"End"` (start/end of content) and from `"ArrowUp"` / `"ArrowDown"` (line / unit movement).

### Unmodified vs modified in scrollable regions

In a normal `overflow: auto` scroller, unmodified PageUp/PageDown are **navigation keys**: the UA’s default action pages the focused scroll container by roughly one viewport. Calling `preventDefault()` on `keydown` cancels that default ([MDN `KeyboardEvent.key` sequence notes](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key); UI Events cancelable `keydown`).

Modified chords (Ctrl/Meta/Shift/Alt + Page) are left to the app or OS (browser tab switching, Acrobat “next page”, etc.). There is no W3C requirement that unmodified Page keys map 1:1 to PDF page indices.

---

## PDF viewer conventions

### Chromium built-in PDF viewer

Source: [`chrome/browser/resources/pdf/viewport.ts`](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/resources/pdf/viewport.ts) (`handleDirectionalKeyEvent`, `pageUpDownSpaceHandler_`).

- Unmodified only: `PageUp` / `PageDown` with `hasKeyModifiers(e)` → not handled (return `false`).
- **Paged mode** (`FIT_TO_PAGE` / `FIT_TO_HEIGHT`): `goToNextPage()` / `goToPreviousPage()` + `preventDefault()`.
- **Non-paged (continuous / other zoom)**: scroll by `±0.875 × viewport height` (same fraction as Chromium’s `cc::kMinFractionToStepWhenPaging`) — **not** discrete document-page steps.
- Boundaries: `goToPageAndXy` clamps page index to `[0, pageCount - 1]` (no wrap).
- Arrow Up/Down change pages only in fullscreen presentation; otherwise they scroll by a fixed increment. Left/Right change pages when there is no horizontal scrollbar.
- Space shares the PageUp/Down handler; Space is skipped when a form field is focused. Page keys still run the handler.

### Mozilla PDF.js default viewer

Sources: [PDF.js FAQ — keyboard shortcuts](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions), [`web/app.js` keydown](https://raw.githubusercontent.com/mozilla/pdf.js/master/web/app.js), [`pdfjs-dist` `BaseViewer.nextPage` / `previousPage`](https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/web/pdf_viewer.mjs).

- FAQ: Home, End, Page up, Page down, and arrow keys navigate; dedicated next/prev are also `n`/`j` and `p`/`k`.
- Unmodified PageUp (keyCode 33) / PageDown (34): if a vertical scrollbar is enabled, `turnOnlyIfPageFit = true` — so they call `previousPage` / `nextPage` **only** when `currentScaleValue === "page-fit"` (or presentation mode for related keys). Otherwise the handler does **not** claim the key; focus is moved to the viewer and native/continuous scroll proceeds.
- Early return when focus is in `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable` (except Escape).
- `nextPage` / `previousPage` clamp at first/last page and return `false` at the boundary (no wrap).
- When the handler claims the key, it `preventDefault()`s.

### Adobe Acrobat

[Adobe Help — Keyboard shortcuts](https://helpx.adobe.com/acrobat/using/keyboard-shortcuts.html) (“Keys for scrolling, zooming and jumping between PDF pages”):

| Action | Windows / UNIX | macOS |
| --- | --- | --- |
| Go to previous **screen** | Page Up | Page Up |
| Go to next **screen** | Page Down | Page Down |
| Go to previous **page** | Left Arrow or Ctrl + Page Up | Left Arrow or ⌘ + Page Up |
| Go to next **page** | Right Arrow or Ctrl + Page Down | Right Arrow or ⌘ + Page Down |
| First / last page | Home / End (and Shift+Ctrl+Page chords) | Home / End (and Shift+⌘+Arrow) |

Unmodified Page keys are **screen** (viewport) paging; discrete page jumps use Ctrl/⌘ + Page or Left/Right arrows.

### Takeaway for Paperoo

Major viewers disagree on continuous mode:

- Chromium continuous → fractional viewport scroll
- PDF.js continuous → leave Page keys to native scroll unless page-fit
- Acrobat → unmodified Page = screen; modified Page / arrows = page

Paperoo’s multi-page plan ([`viewport-page-scroll.md`](./viewport-page-scroll.md)) reserved **unmodified** PageUp/PageDown for discrete `setCurrentPage` + scroll, and left Arrow keys for object nudge. That is a deliberate product choice (closer to Chromium **paged** mode / Acrobat’s “next page” intent), not a copy of continuous Chromium/PDF.js defaults.

---

## Current Paperoo codebase

### Hotkey matching — [`lib/hotkeys.ts`](../../lib/hotkeys.ts)

- Matches `event.key` case-insensitively → use `"PageUp"` / `"PageDown"`.
- `meta?: boolean` — when omitted/false, Ctrl/Meta must **not** be pressed (`Boolean(hotkey.meta) !== isMetaPressed(event)`).
- `shift: false` — Shift+Page must not match (Acrobat uses Shift+Ctrl+Page for first/last).
- No `alt` check — Alt+Page currently matches if other conditions hold (minor gap vs Chromium’s `hasKeyModifiers`).
- On match: always `preventDefault()` before the handler.
- Skips `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable` unless `allowInInput`.
- Ignores `event.repeat`, `event.defaultPrevented`, and `event.isComposing`.

### Existing bindings — [`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx)

- ArrowUp/Down/Left/Right → nudge selected objects (Shift increases distance). **Do not** reuse for page nav.
- PageUp / PageDown already bound (when present in tree):

```ts
{ key: "PageUp", shift: false, handler: () => editorStore.stepCurrentPage(-1) }
{ key: "PageDown", shift: false, handler: () => editorStore.stepCurrentPage(1) }
```

(handlers also gate on `status === "ready"`).

### Store — [`lib/editor/store.ts`](../../lib/editor/store.ts)

`setCurrentPage(pageId, options?: { syncFitZoom?: boolean })`:

- Default `syncFitZoom: true` (sidebar thumbnail click).
- Clears selection ids; uses `setState` (no undo entry).
- Scrollspy / pointer-down use `{ syncFitZoom: false }` so mixed page sizes do not recompute fit zoom mid-nav ([`viewport-page-scroll.md`](./viewport-page-scroll.md)).

`stepCurrentPage(delta: 1 | -1)`:

- Finds `currentPageId` in `document.pages`, picks `pages[index + delta]`.
- Missing neighbor → no-op (no wrap).
- Calls `setCurrentPage(next.id, { syncFitZoom: false })`.

Covered by [`test/viewport-page-scroll.test.ts`](../../test/viewport-page-scroll.test.ts).

### Viewport scroll path — [`components/editor/editor-viewport.tsx`](../../components/editor/editor-viewport.tsx)

When `currentPageId` changes and the change did **not** come from scrollspy:

1. Set `ignoreScrollSpyUntil = now + 500ms`.
2. `pageEl.scrollIntoView({ behavior: "instant", block: "nearest" })`.

Hotkeys only need to change `currentPageId` via `stepCurrentPage`; no separate scroll API. Sidebar clicks use the same path (with default `syncFitZoom: true`).

[`scrollIntoView` `block: "nearest"`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView): scrolls the minimum amount to make the element visible; if already fully visible, no scroll. Acceptable for sidebar parity; taller-than-viewport pages may not jump to page top.

### Scroll-snap (related, out of scope)

[`viewport-page-scroll.md`](./viewport-page-scroll.md) left CSS `scroll-snap` out of scope — it fights free pan when a page is taller than the scroller. PageUp/Down do **not** need snap: discrete `scrollIntoView` already moves to the target page frame. Do not add snap as part of this hotkey.

---

## Recommended behavior

| Input | Action |
| --- | --- |
| Unmodified `PageDown` | Next page in `document.pages` order |
| Unmodified `PageUp` | Previous page |
| First / last / missing id | No-op (no wrap) — same as PDF.js `nextPage`/`previousPage` and Chromium clamp |
| Arrow keys | Unchanged (object nudge only) |
| Ctrl / Meta / Shift + Page | Do not navigate (matcher already enforces meta/shift; Alt optional follow-up) |
| Focus in input / contenteditable | Ignored (`bindHotkeys`) |
| Key repeat (held key) | Ignored (`event.repeat`) |
| Fit zoom | `{ syncFitZoom: false }` (scrollspy-style, **not** sidebar default `true`) |
| Scroll | Existing viewport effect (`block: "nearest"`, suppress scrollspy) |
| `preventDefault` | Yes — required so the `overflow-auto` scroller does not native-page |

Rationale for `syncFitZoom: false`: PageUp/Down are continuous-stack navigation like scrollspy, not an explicit “open this page and fit it” like a thumbnail click. Recomputing fit on every step jumps zoom on mixed page sizes.

---

## Concrete API / files

Already the right shape:

1. **`editorStore.stepCurrentPage(±1)`** in [`lib/editor/store.ts`](../../lib/editor/store.ts) → `setCurrentPage(id, { syncFitZoom: false })`.
2. Bind unmodified Page keys in [`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) (gate `status === "ready"`).
3. Rely on [`editor-viewport.tsx`](../../components/editor/editor-viewport.tsx) `currentPageId` → `scrollIntoView` effect — **no viewport changes required**.
4. Keep store tests in [`test/viewport-page-scroll.test.ts`](../../test/viewport-page-scroll.test.ts).

Optional polish (not required for the feature):

- Exclude `altKey` in `matches()` (align with Chromium `hasKeyModifiers`).
- Consider `block: "start"` later if “jump to page top” is preferred over sidebar-parity `nearest`.

### Out of scope

- Home / End first/last page
- Key-repeat page flipping
- Chromium-style fractional viewport scroll instead of page step
- Acrobat-style Ctrl/⌘+Page for page (Paperoo uses unmodified Page)
- Binding Arrow keys for page nav
- Mandatory CSS scroll-snap
- Changing sidebar’s default `syncFitZoom: true`
