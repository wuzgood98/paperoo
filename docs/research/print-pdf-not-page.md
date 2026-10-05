# Bug: Print shows editor chrome instead of the edited PDF

Print is supposed to send the **edited PDF bytes** to the system print dialog. Reports say preview/output shows the Paperoo shell (toolbar, canvas chrome) instead.

Primary sources: paperoo `print-blob` / `run-print` / toolbar / hotkeys, MDN `Window.print` / Printing guide / `preventDefault` / `afterprint`, HTML Living Standard printing, mozilla/pdf.js print-iframe issues, Print.js iframe construction, prior [`print-button-toolbar.md`](./print-button-toolbar.md) / [`print-button-toolbar-extras.md`](./print-button-toolbar-extras.md).

---

## 1. Current implementation

### Pipeline

| Step | Module | Behavior |
| --- | --- | --- |
| Toolbar Print | [`editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) | `printPdf()` → `runPrint()` (errors → toast) |
| ⌘P / Ctrl+P | [`editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) | `printEditedPdf()` gates on `status === "ready"` and `!isExporting`, then `runPrint()` |
| Build bytes | [`run-print.ts`](../../lib/pdf/run-print.ts) + [`run-export.ts`](../../lib/pdf/run-export.ts) | `buildEditedPdfBytes()` (same worker/export path as download) → `new Blob([result], { type: "application/pdf" })` |
| Print helper | [`print-blob.ts`](../../lib/pdf/print-blob.ts) | Object URL → hidden iframe → `contentWindow.print()` → cleanup |

There is **no** `window.print()` on the editor shell in the Print path. Both UI entry points share `runPrint` → `printPdfBlob`.

### How `printPdfBlob` works today

From [`lib/pdf/print-blob.ts`](../../lib/pdf/print-blob.ts):

1. `URL.createObjectURL(blob)`.
2. Create `<iframe aria-hidden="true">` with:

   ```
   position:fixed;width:1px;height:1px;left:0;top:0;opacity:0;border:none;pointer-events:none;
   ```

3. Append to `document.body`, set `iframe.src = url`.
4. On `load`: require `iframe.contentWindow`; register `afterprint` + `beforeunload` (once) and a **60s** fallback timer; then `win.focus()` + `win.print()`.
5. On finish/fail: `iframe.remove()` + `URL.revokeObjectURL(url)`.

Unit coverage ([`test/print-pdf.test.ts`](../../test/print-pdf.test.ts)) asserts mount → `print` → cleanup on `afterprint` / timer with mocked DOM. It does **not** exercise a real PDF viewer or print dialog (same limit called out in [`print-button-toolbar-extras.md`](./print-button-toolbar-extras.md)).

This matches the plan in [`print-button-toolbar.md`](./print-button-toolbar.md) (blob → iframe → `contentWindow.print`), including the caveat that zero-size / fully hidden frames can fail to initialize a PDF viewer.

---

## 2. Why `contentWindow.print()` can still print (or look like) the parent

### Spec: `print()` is scoped to that Window’s document

[HTML Living Standard — Printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing): `window.print()` runs the printing steps for **this** Window’s associated `Document` (offer a physical form of **that** document). [MDN `Window.print()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/print) is the same: “print the current document,” no parameters.

Paperoo’s code calls `iframe.contentWindow.print()`, not the parent’s `window.print()` ([`print-blob.ts`](../../lib/pdf/print-blob.ts)). So a pure “wrong callee” bug is unlikely unless `contentWindow` is missing (then the helper rejects with “Could not open print preview”) or the UA ignores the frame and prints the focused browsing context (historical IE-style behavior; see below).

### Iframe is 1×1 px — PDF viewers often need more height

Paperoo uses `width:1px;height:1px;opacity:0`. That is stricter than battle-tested PDF print helpers:

**Print.js** ([`crabbly/Print.js` `src/js/init.js`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/init.js)) documents Firefox explicitly:

> Set the iframe to be visible on the page (guaranteed by fixed position) but hidden using opacity 0, because this works in Firefox. The height needs to be **sufficient for some part of the document other than the PDF viewer’s toolbar** to be visible in the page.

Their Firefox style is `width: 1px; height: 100px; … opacity: 0` — **not** `height: 1px`. Non-Firefox Print.js uses `visibility: hidden; height: 0; width: 0` for the frame chrome, then still delays before calling print (below).

Tim Down’s widely copied PDF print gist uses the same `1px × 100px` + `opacity: 0` pattern and a Firefox delay before `print()` ([gist](https://gist.github.com/timdown/cfacd32f6b5e439bb02aaf142343ce4c)).

[`print-button-toolbar.md`](./print-button-toolbar.md) already warned: browsers differ on whether `display: none` / zero-size iframes initialize the PDF viewer before print. Paperoo’s **1×1** box sits in that danger zone for Chromium/Firefox/Safari PDF plugins.

### `load` ≠ “PDF viewer ready to print”

`iframe` `load` fires when navigation completes. For `application/pdf` blob URLs, the UA then hands the stream to its PDF viewer (Chrome PDF plugin / Firefox pdf.js embedding / Safari PDF). That second stage is **not** guaranteed ready on the same tick as `load`.

Evidence:

- Print.js [`print.js`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/print.js): after PDF iframe load, **always** `setTimeout(…, 1000)` before `contentWindow.print()` (plus an older-Firefox extra 1000 ms path). Comment: Firefox needed ~1000 ms; 100 ms was not enough.
- mozilla/pdf.js [#5397](https://github.com/mozilla/pdf.js/issues/5397): maintainers/users note that `onload` does not mean the PDF has been rendered; people resorted to timeouts or clicking the viewer’s own print control.
- Chrome `display: none` iframes: Chromium change around Chrome 65 made `contentWindow.print()` on `display:none` frames print nothing usable; workaround was keep layout (`visibility: hidden` + positioning) so the frame can lay out ([SO / crrev discussion](https://stackoverflow.com/questions/49281164/chrome-65-cant-print-hidden-iframe)). Paperoo avoids `display:none`, but **1×1** still starves layout.

Calling `print()` too early on a PDF frame can yield blank preview, an incomplete plugin surface, or UA-specific fallbacks that look wrong to users. Combined with shell chrome still in the focused page, some UAs historically printed the **surrounding page** when the iframe was not a viable print target.

### Focus / “prints parent” class of bugs

Classic failure mode (especially older IE, still cited for iframe print): print follows the **focused** frame, so missing `focus()` prints the parent ([SO: print iframe](https://stackoverflow.com/questions/472951/how-do-i-print-an-iframe-from-javascript-in-safari-chrome); pdf.js [#10847](https://github.com/mozilla/pdf.js/issues/10847) — IE11 `contentWindow.print()` printed the surrounding page; fix discussed was `document.execCommand('print')`).

Paperoo already does `win.focus()` then `win.print()`. That is the right order for HTML iframes; it does **not** fix PDF-plugin readiness or undersized frames.

### Blob URL in iframe: origin and access quirks

[MDN `URL.createObjectURL`](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) / File API guidance: blob URLs created by the page can be assigned to an iframe `src`. Same-origin blob URLs avoid many cross-origin print blocks that hit remote PDF URLs ([`print-button-toolbar.md`](./print-button-toolbar.md)).

Firefox historically treated **built-in** pdf.js embeddings as a different security principal (`resource://pdf.js`), so accessing `contentWindow.print` (or `.document`) threw “Permission denied” ([Bugzilla 911444](https://bugzilla.mozilla.org/show_bug.cgi?id=911444), pdf.js [#5397](https://github.com/mozilla/pdf.js/issues/5397), [#10290](https://github.com/mozilla/pdf.js/issues/10290)). That usually surfaces as an exception (Paperoo would toast “Could not open the print dialog”), **not** as a successful shell print — but it is why “iframe + PDF MIME + `print()`” remains fragile across browsers.

Safari/Chrome still expect the print iframe to stay in the DOM until the dialog finishes; removing too early can print the parent ([printThis #152](https://github.com/jasonday/printThis/issues/152)). Paperoo’s `afterprint` + 60s fallback is aligned with [MDN’s Printing guide](https://developer.mozilla.org/en-US/docs/Web/Guide/Printing) (hidden iframe + `onafterprint` / `onbeforeunload` cleanup). Premature revoke is less likely the primary “chrome in preview” cause than size/timing — unless `afterprint` fires spuriously before the dialog shows (rare; fallback is long).

### Is `print()` somehow hitting `window`?

In source: only `win` from `iframe.contentWindow` is printed. Tests assert that mock’s `print` is called. There is no parent `window.print()` in `printPdfBlob` / `runPrint`.

If the **dialog shows the editor UI**, candidates are:

1. Native browser print of the shell (menu / failed ⌘P intercept) — §3.
2. UA printed the focused top document because the PDF iframe was not a valid print target (size / not ready / plugin quirks) — §2 above.
3. User perceives canvas-looking PDF pages as “the editor” (less likely if toolbar chrome is clearly in preview).

---

## 3. Hotkey path: does ⌘P / Ctrl+P reliably avoid shell print?

### What Paperoo does

[`lib/hotkeys.ts`](../../lib/hotkeys.ts): on match, **`event.preventDefault()` then** `handler`. Meta binding is `metaKey || ctrlKey`. Print binding is `{ key: "p", meta: true }` ([`editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx)).

[`print-button-toolbar-extras.md`](./print-button-toolbar-extras.md) already established:

- ⌘/Ctrl+P is the browser’s conventional “print this document” shortcut for the **focused document** (the shell).
- `preventDefault` on cancelable `keydown` is the workable reclaim path; Chromium generally honors it; MDN does **not** specially guarantee print cancellation.
- **File → Print** / browser chrome print still prints the shell — no app hook can redirect that to edited bytes.
- [`beforeprint`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event) cannot cancel print; it only observes / mutates content.

### Async gap after preventDefault

Hotkey handler is:

```ts
handler: () => {
  void printEditedPdf(); // async: await buildEditedPdfBytes() then printPdfBlob
},
```

`preventDefault` runs **synchronously** before the async work. Native print from that keydown should stay cancelled even while the export worker runs. If `status !== "ready"` or `isExporting`, the handler no-ops **after** preventDefault — so the shell print is suppressed and no custom dialog opens (empty action), not “print chrome.”

### When hotkeys alone explain “whole page”

| Scenario | Shell chrome in print? |
| --- | --- |
| ⌘P with hotkeys bound + cancelable keydown | Should **not** (preventDefault) |
| File → Print / OS menu | **Yes** — prints shell |
| Focus in DevTools / outside page | Key may never reach `bindHotkeys` → native print of whatever the browser considers current |
| Toolbar Print button | Does not use ⌘P; only `printPdfBlob` — if chrome appears here, blame iframe/PDF path, not hotkeys |

**Verdict:** Hotkey reclaim is implemented correctly for in-page ⌘P. It is **not** a complete explanation if the **toolbar Print** button also shows chrome. Prefer diagnosing `printPdfBlob` (size / timing / viewer) first; treat menu Print as a known non-goal.

---

## 4. Known working patterns (primary sources)

### MDN — print an external page via hidden iframe

[MDN Printing — “Print an external page without opening it”](https://developer.mozilla.org/en-US/docs/Web/Guide/Printing): create iframe, `onload` → set `onbeforeunload` / `onafterprint` cleanup on `contentWindow`, then `contentWindow.print()`. Example uses `display: "none"` for HTML pages. MDN also notes older IE could not print contents of a fully hidden iframe.

Paperoo already follows this shape (load → afterprint cleanup → print), but targets a **PDF blob**, not an HTML URL — PDF plugin rules apply on top of MDN’s HTML example.

### Print.js (library source)

1. Build local blob URL from PDF bytes ([`pdf.js`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/pdf.js)).
2. Firefox: **1×100** opacity-0 fixed iframe; others: visibility-hidden zero box ([`init.js`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/init.js)).
3. After load: **~1s delay**, `iframe.focus()`, then `contentWindow.print()` ([`print.js`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/print.js)).
4. Cleanup deferred (focus/mouseover on parent after dialog) rather than trusting `afterprint` alone on every browser ([`functions.js` `cleanUp`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/functions.js)).

### mozilla/pdf.js

- Prefer blob + iframe + delayed `contentWindow.print()` on Chromium ([#5397](https://github.com/mozilla/pdf.js/issues/5397) discussion).
- Firefox built-in viewer / principal issues made `print` access flaky for years ([911444](https://bugzilla.mozilla.org/show_bug.cgi?id=911444)); newer Firefox improved this, but load-vs-ready remains.
- IE “prints surrounding page” when focusing/print targeting fails ([#10847](https://github.com/mozilla/pdf.js/issues/10847)).

### Top-level window (`window.open(blobUrl)`)

Secondary pattern from [`print-button-toolbar.md`](./print-button-toolbar.md): open the blob URL in a new browsing context, then `print()`. The PDF is the **top-level** document, so plugin sizing quirks of a 1×1 iframe go away.

**Popup-blocker constraint for Paperoo:** `runPrint` **awaits** `buildEditedPdfBytes()` (fonts + worker) **before** `printPdfBlob`. That breaks the user-gesture chain. A bare `window.open(url)` after the await is often blocked. Reliable open requires opening `about:blank` (or a window) **synchronously** on click/keydown, then navigating to the blob URL when bytes are ready — more plumbing than fixing the iframe.

`<embed>` / `<object type="application/pdf">` have the same plugin/print-access issues as iframes in practice (pdf.js threads); they do not buy a cleaner API than iframe + blob for this app.

---

## 5. Recommended fix (one primary approach)

**Stay on the Blob → temporary frame → `print()` pipeline, but make the frame PDF-viewer-ready like Print.js — do not switch the primary path to post-await `window.open`.**

### Change in `printPdfBlob` only (keep `runPrint` / toolbar / hotkeys)

1. **Iframe geometry** — replace `1px × 1px` with a Print.js-style printable box, e.g.:

   ```
   position:fixed;left:0;top:0;width:1px;height:100px;opacity:0;border:none;pointer-events:none;
   ```

   Optionally use a larger off-screen box (`left:-10000px;width:800px;height:600px;opacity:0`) if 100px still fails in a target browser during manual QA. Avoid `display:none` for the PDF frame ([Chrome 65+ layout requirement](https://stackoverflow.com/questions/49281164/chrome-65-cant-print-hidden-iframe)).

2. **Delay after `load` before `print()`** — e.g. `await` a 500–1000 ms timeout (Print.js uses 1000 ms) so the UA PDF viewer can initialize. Keep `win.focus()` immediately before `win.print()`.

3. **Cleanup / revoke rules** (mostly keep current design):
   - Listen for `afterprint` on the iframe window (MDN).
   - Keep a long fallback timer (60s is fine) if `afterprint` never fires for PDF plugin documents.
   - **Do not** `revokeObjectURL` or `iframe.remove()` until after print finishes (or fallback) — early remove can cause parent print on some engines ([printThis #152](https://github.com/jasonday/printThis/issues/152)).
   - Idempotent `dispose` (already present) so afterprint + fallback cannot double-free.

4. **Hotkeys** — leave ⌘P → `preventDefault` + `runPrint` as-is. Accept File → Print still prints the shell ([extras research](./print-button-toolbar-extras.md)).

### Fallback (only if iframe still fails after size + delay)

Open a window **during the user gesture**, then navigate after build:

```ts
// sync on click / keydown
const printWindow = window.open("about:blank", "_blank");
// after await buildEditedPdfBytes()
const url = URL.createObjectURL(blob);
printWindow.location.href = url;
// on load: printWindow.print(); cleanup on afterprint + revoke
```

Use this only as Plan B: more UI flicker, still needs gesture-tied `open`, and cleanup/revoke rules are the same.

### Why not make `window.open` the primary fix

Export/print build is async and shared ([`buildEditedPdfBytes`](../../lib/pdf/run-export.ts)). Post-await `window.open` fights popup blockers; the iframe path does not. Prior research preferred iframe for toolbar gestures ([`print-button-toolbar.md`](./print-button-toolbar.md)). Fixing size + readiness keeps that design and matches Print.js / MDN primary patterns.

### Manual QA checklist

- Toolbar Print and ⌘P: preview is PDF pages only (no toolbar/tool rail).
- Multi-page edited PDF.
- Chromium, Firefox, Safari.
- Cancel dialog: iframe removed and blob revoked (no leak).
- File → Print: still shell (expected).

No application source changes in this research deliverable.

---

## Summary

| Question | Finding |
| --- | --- |
| How does print work today? | Edited bytes → blob URL → **1×1 opacity-0 iframe** → immediate `contentWindow.print()` → afterprint/60s cleanup |
| Why shell chrome? | Most likely undersized / not-ready PDF iframe (or native File→Print); code does not call parent `print()` |
| ⌘P? | `preventDefault` is correct for in-page hotkeys; cannot own menu print |
| Fix | Enlarge iframe (≥100px height / off-screen), delay after `load`, then focus+print; revoke only after afterprint/fallback |

---

## Sources

### Repo

- [`lib/pdf/print-blob.ts`](../../lib/pdf/print-blob.ts) — iframe styles, load → focus/print, cleanup
- [`lib/pdf/run-print.ts`](../../lib/pdf/run-print.ts) — Blob + `printPdfBlob`
- [`lib/pdf/run-export.ts`](../../lib/pdf/run-export.ts) — `buildEditedPdfBytes`
- [`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) — Print button
- [`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) — ⌘P → `runPrint`
- [`lib/hotkeys.ts`](../../lib/hotkeys.ts) — `preventDefault` before handler
- [`test/print-pdf.test.ts`](../../test/print-pdf.test.ts) — mocked iframe print/cleanup
- [`docs/research/print-button-toolbar.md`](./print-button-toolbar.md)
- [`docs/research/print-button-toolbar-extras.md`](./print-button-toolbar-extras.md)

### Web / specs / upstream

- [MDN Window.print()](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- [MDN Printing guide (iframe example)](https://developer.mozilla.org/en-US/docs/Web/Guide/Printing)
- [MDN afterprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event)
- [MDN Event.preventDefault()](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
- [MDN URL.createObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
- [HTML Living Standard — Printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing)
- [Print.js `init.js` / `print.js` / `pdf.js`](https://github.com/crabbly/Print.js) — iframe size + delay
- [mozilla/pdf.js #5397](https://github.com/mozilla/pdf.js/issues/5397), [#10847](https://github.com/mozilla/pdf.js/issues/10847), [#10290](https://github.com/mozilla/pdf.js/issues/10290)
- [Bugzilla 911444](https://bugzilla.mozilla.org/show_bug.cgi?id=911444) — Firefox PDF iframe `print` access
- [Chrome hidden iframe print](https://stackoverflow.com/questions/49281164/chrome-65-cant-print-hidden-iframe)
