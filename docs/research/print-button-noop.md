# Bug: Print toolbar button does nothing (no system dialog)

Clicking Print shows a brief busy/disabled state (`isExporting`), then returns to normal — **no** system print dialog, and usually **no** error toast.

Primary sources: paperoo `print-blob` / `run-print` / toolbar / export busy flag, MDN `beforeunload` / Printing guide / `afterprint` / `Window.print`, Print.js cleanup timing, prior [`print-pdf-not-page.md`](./print-pdf-not-page.md) / [`print-button-toolbar.md`](./print-button-toolbar.md).

---

## 1. Full click path

| Step | Module | Behavior |
| --- | --- | --- |
| Toolbar Print | [`editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) ~190–201 | `disabled={!ready \|\| isExporting}`; `onClick` → `printPdf()` → `runPrint()`; errors → toast |
| Busy flag | [`run-export.ts`](../../lib/pdf/run-export.ts) `buildEditedPdfBytes` | `setExporting(true)` for the whole build; `finally` → `setExporting(false)` |
| Orchestration | [`run-print.ts`](../../lib/pdf/run-print.ts) | `buildEditedPdfBytes()` → `Blob(application/pdf)` → `printPdfBlob(blob)` |
| Print helper | [`print-blob.ts`](../../lib/pdf/print-blob.ts) | Object URL → opacity-0 iframe (`1×100`) → on `load` register cleanup → **await 1000 ms** → `focus()` + `print()` |

Observed UX (“disabled while working, then nothing”) matches a **successful** path through `buildEditedPdfBytes` (busy clears) and a **silent resolve** inside `printPdfBlob` — not a thrown error (that would toast “Print failed”).

---

## 2. What `printPdfBlob` does today (read carefully)

From [`lib/pdf/print-blob.ts`](../../lib/pdf/print-blob.ts):

1. `URL.createObjectURL(blob)`; create iframe with Print.js-style geometry:

   ```
   position:fixed;left:0;top:0;width:1px;height:100px;opacity:0;border:none;pointer-events:none;
   ```

   (This already incorporates the size fix from [`print-pdf-not-page.md`](./print-pdf-not-page.md); geometry alone is unlikely to explain a total no-op.)

2. Append iframe, set `src = url`.

3. On iframe `load`:
   - Require `iframe.contentWindow` (else reject → toast).
   - **Immediately** register:
     - `win.addEventListener("afterprint", finish, { once: true })`
     - `win.addEventListener("beforeunload", finish, { once: true })`
     - `setTimeout(finish, 60_000)` fallback
   - `await wait(1000)` (`PRINT_VIEWER_SETTLE_MS`) for PDF viewer init.
   - **If `cleaned` already:** `return` with **no** `print()`, **no** throw — outer Promise already `resolve()`d via `finish`.
   - Else `win.focus(); win.print()`.

4. `finish` / `fail` → idempotent `dispose`: remove iframe, `revokeObjectURL`.

```47:72:lib/pdf/print-blob.ts
    iframe.addEventListener("load", () => {
      void (async () => {
        const win = iframe.contentWindow;
        if (!win) {
          fail(new Error("Could not open print preview."));
          return;
        }

        win.addEventListener("afterprint", finish, { once: true });
        win.addEventListener("beforeunload", finish, { once: true });
        fallbackId = setTimeout(finish, PRINT_CLEANUP_FALLBACK_MS);

        try {
          await wait(PRINT_VIEWER_SETTLE_MS);
          if (cleaned) {
            return;
          }
          win.focus();
          win.print();
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("Could not open the print dialog.")
          );
        }
      })();
    });
```

Unit tests ([`test/print-pdf.test.ts`](../../test/print-pdf.test.ts)) mock `load` → advance 1000 ms → assert `print`, then cleanup via `afterprint` / 60s timer. They **do not** fire `beforeunload` during the settle window, so this race is invisible to CI.

---

## 3. Likely root cause: `beforeunload` during PDF viewer settle

### The race

```
load fires
  → register beforeunload → finish (dispose)
  → start 1000 ms settle timer
  … PDF plugin / viewer replaces or navigates the frame document …
  → beforeunload fires
  → finish() → cleaned=true, iframe removed, blob revoked
  → settle timer ends
  → if (cleaned) return   // never print()
```

That produces exactly the reported bug: busy state from export, Promise resolves cleanly, **no dialog**, **no toast**.

### Why `beforeunload` is the wrong cleanup hook here

[MDN `Window: beforeunload`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event): fired when the window/document/resources are **about to be unloaded** (navigate away, reload, close). It is meant for “unsaved changes” confirmations — not as a general “work finished” signal. Any in-frame navigation or document replacement will fire it.

For `application/pdf` blob URLs, the UA hands the stream to its PDF viewer (Chrome PDF plugin / Firefox embedding). Viewer init commonly involves an extra embedded request / document handoff ([Chrome PDF double-request behavior](https://stackoverflow.com/questions/32725608/chrome-sends-two-requests-when-downloading-a-pdf-and-cancels-one-of-them); iframe PDF loaded twice reports). That handoff is **document unload** from the browsing context’s perspective → a registered `beforeunload` on `contentWindow` can run **during** the intentional 1000 ms settle, before `print()` ever runs.

Paperoo then treats that as “print finished” and tears down the frame.

### Contrast with MDN’s HTML iframe example

[MDN Printing — “Print an external page without opening it”](https://developer.mozilla.org/en-US/docs/Web/Guide/Printing) does set `contentWindow.onbeforeunload` / `onafterprint` cleanup, then calls `print()` — but **synchronously in the same `onload` turn**, for an **HTML** URL (`external-page.html`), with **no** settle delay:

```js
this.contentWindow.onbeforeunload = closePrint;
this.contentWindow.onafterprint = closePrint;
this.contentWindow.print();
```

Paperoo copied that shape **plus** a 1000 ms PDF settle delay **between** registering `beforeunload` and calling `print()`. That gap is where the race lives. MDN’s HTML example never leaves that window open.

### Contrast with Print.js (prior working intent)

From [`print-pdf-not-page.md`](./print-pdf-not-page.md) and Print.js source:

- [`print.js`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/print.js): after PDF iframe load, **delay**, then `focus` + `contentWindow.print()`. **No** `beforeunload` / `afterprint` listeners for teardown.
- [`functions.js` `cleanUp`](https://raw.githubusercontent.com/crabbly/Print.js/master/src/js/functions.js): after `print()` is invoked, defer iframe removal to a **parent** `focus` / `mouseover` handler (`onPrintDialogClose`) — cleanup is tied to returning to the host page, not to in-frame unload during viewer init.

So the settle delay Paperoo added (correct for PDF readiness) was combined with MDN’s `beforeunload` cleanup (safe only when `print()` follows immediately). That combination is what breaks.

---

## 4. Other hypotheses (ranked)

| Hypothesis | Fits symptoms? | Notes |
| --- | --- | --- |
| **`beforeunload` → dispose during settle → early `cleaned` return** | **Yes** — primary | Silent resolve; matches “busy then nothing” |
| `load` fires twice / second navigation | Contributing | WebKit/Chromium can fire iframe `load` more than once depending on attach/append order ([SO](https://stackoverflow.com/questions/10781880/dynamically-created-iframe-triggers-onload-event-twice)); PDF plugin may also re-request. A second navigation strengthens the `beforeunload` case |
| `contentWindow` null | No | Would `fail` → toast “Could not open print preview.” |
| `print()` throws / Permission denied (Firefox PDF principal) | Unlikely for “no toast” | Caught → toast “Could not open the print dialog.” ([Bugzilla 911444](https://bugzilla.mozilla.org/show_bug.cgi?id=911444) / pdf.js threads) |
| Undersized iframe only | No longer primary | Already `height:100px` + opacity-0; would more often yield blank/wrong preview than total silence |
| 60s fallback alone | No | Fallback is long; would not explain immediate no-op |
| Toolbar never calls `runPrint` | No | Wire-up is correct; `isExporting` gate proves build ran |

---

## 5. Recommended fix (one primary approach)

**Minimal change in `printPdfBlob` only: stop using `beforeunload` for cleanup; register `afterprint` only after the settle delay, immediately around `print()`.**

### Concrete steps

1. **Remove** `win.addEventListener("beforeunload", finish, …)` entirely. Do not use unload as a success/cleanup signal for PDF blob iframes.
2. **After** `await wait(PRINT_VIEWER_SETTLE_MS)`, if not already failed:
   - Re-read `iframe.contentWindow` (defensive; may have changed across viewer handoff).
   - Register `afterprint` → `finish` (`{ once: true }`).
   - Arm the 60s fallback timer here (not before settle).
   - `win.focus(); win.print();`
3. Keep idempotent `dispose` (remove iframe + revoke). Keep rejecting on missing window / `print` throw so real failures still toast.
4. Optionally harden later (not required for the noop): Print.js-style parent `focus` cleanup if some UAs never fire `afterprint` for PDF plugin documents — the 60s fallback already covers that.

### Why this is enough

- Restores the dialog: nothing tears down the iframe during the settle window.
- Aligns with Print.js (no `beforeunload`) while keeping MDN’s `afterprint` + long fallback from prior research.
- Avoids heavier Plan B (`window.open` after async build / popup blockers) already discouraged in [`print-pdf-not-page.md`](./print-pdf-not-page.md).

### Test gap to close when fixing

Extend [`test/print-pdf.test.ts`](../../test/print-pdf.test.ts):

- Simulate `beforeunload` (or a second navigation) during the 1000 ms settle and assert `print` is **still** called when `beforeunload` is no longer wired to `finish`.
- Assert `beforeunload` is **not** registered as a cleanup path (or is registered only after `print` if a safer secondary use is ever added).

### Manual QA

- Toolbar Print and ⌘P: system dialog opens with edited PDF pages.
- Cancel dialog: iframe eventually removed (afterprint or 60s).
- Chromium + Firefox at minimum (PDF plugin differences).

No application source changes in this research deliverable.

---

## Summary

| Question | Finding |
| --- | --- |
| Click path? | Toolbar → `runPrint` → `buildEditedPdfBytes` (`isExporting`) → `printPdfBlob` |
| Why no dialog? | `beforeunload` cleanup registered **before** the 1000 ms PDF settle; viewer init unloads the frame → `dispose` → `if (cleaned) return` skips `print()` with no error |
| Why busy then idle? | Export busy flag works; print Promise resolves via premature `finish` |
| Prior research? | Size + delay were the right readiness fixes; combining them with MDN-style `beforeunload` created this race. Print.js never does that |
| Fix | Drop `beforeunload` cleanup; attach `afterprint` + fallback only after settle, then `focus`/`print` |

---

## Sources

### Repo

- [`lib/pdf/print-blob.ts`](../../lib/pdf/print-blob.ts) — settle delay, `beforeunload`/`afterprint`, early `cleaned` return
- [`lib/pdf/run-print.ts`](../../lib/pdf/run-print.ts)
- [`lib/pdf/run-export.ts`](../../lib/pdf/run-export.ts) — `isExporting` around build
- [`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) — Print button ~190–201
- [`test/print-pdf.test.ts`](../../test/print-pdf.test.ts) — mocked path; no `beforeunload`-during-settle case
- [`docs/research/print-pdf-not-page.md`](./print-pdf-not-page.md) — iframe size + delay intent
- [`docs/research/print-button-toolbar.md`](./print-button-toolbar.md)

### Web / specs / upstream

- [MDN Window: beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
- [MDN Printing guide (iframe + onbeforeunload/onafterprint example)](https://developer.mozilla.org/en-US/docs/Web/Guide/Printing)
- [MDN Window: afterprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event)
- [MDN Window.print()](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- [HTML Living Standard — Printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing)
- [Print.js `print.js` / `functions.js`](https://github.com/crabbly/Print.js) — delay then print; cleanup via parent focus/mouseover, not `beforeunload`
- [Chrome PDF double request / embed handoff](https://stackoverflow.com/questions/32725608/chrome-sends-two-requests-when-downloading-a-pdf-and-cancels-one-of-them)
- [WHATWG: disallow print during beforeunload/unload](https://github.com/whatwg/html/issues/2683) — print and unload are hostile to each other
