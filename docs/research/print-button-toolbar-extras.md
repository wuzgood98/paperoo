# Print toolbar extras: shortcut, icon-only Open, DOM tests

Follow-ups previously out of scope in [`print-button-toolbar.md`](./print-button-toolbar.md): keyboard Print, converting Open to icon-only, and what Node/Vitest can assert about iframe + `print()` cleanup.

Primary sources: paperoo hotkeys/toolbar modules, `package.json` / `vitest.config.ts` / `test/`, MDN KeyboardEvent / preventDefault / beforeprint / afterprint / aria-label, HTML Living Standard printing.

---

## 1. Keyboard shortcut for Print

### How existing shortcuts are registered

[`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) mounts once from [`editor-shell.tsx`](../../components/editor/editor-shell.tsx) and calls [`bindHotkeys`](../../lib/hotkeys.ts) in a `useEffect`.

Relevant bindings today:

| Action | Definition | Notes |
| --- | --- | --- |
| Undo | `{ key: "z", meta: true }` → `editorStore.undo()` | Tip shows `⌘Z` |
| Redo | `{ key: "z", meta: true, shift: true }` and `{ key: "y", meta: true }` | Tip shows `⇧⌘Z` only |
| Zoom in/out | `=` / `-` with `meta: true` | No tip shortcuts on zoom buttons |
| Open | `{ key: "o", meta: true }` → click `#editor-open-input` | Empty state shows `⌘O` ([`empty-state.tsx`](../../components/editor/empty-state.tsx)) |
| Export | **none** | Toolbar-only today |

There is **no** Export or Print hotkey yet.

### Platform modifiers (⌘ vs Ctrl)

[`lib/hotkeys.ts`](../../lib/hotkeys.ts):

```ts
const isMetaPressed = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey;
```

When a definition sets `meta: true`, a match requires that flag to equal “either Meta **or** Control is down.” So Mac ⌘ and Windows/Linux Ctrl are both covered by one binding. Tooltip/`Kbd` copy still uses Mac glyphs (`⌘Z`, `⌘O`) — display-only, not binding logic.

On match, `bindHotkeys` always calls `event.preventDefault()` before the handler ([`lib/hotkeys.ts`](../../lib/hotkeys.ts) lines 64–65). It skips when `event.defaultPrevented`, `event.repeat`, or `event.isComposing`, and skips input/contenteditable targets unless `allowInInput` is set.

MDN: [`KeyboardEvent.metaKey`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/metaKey) is ⌘ on Mac / Windows key on Windows; [`ctrlKey`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/ctrlKey) is Control. [`preventDefault()`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault) cancels the user agent’s default action when the event is cancelable.

### Does the browser steal Cmd/Ctrl+P?

Yes — that chord is the **conventional** “print this document” shortcut. The browser’s default action is to open the print UI for the **focused document** (the Paperoo shell), which would print editor chrome — the opposite of the edited-PDF iframe plan in [`print-button-toolbar.md`](./print-button-toolbar.md).

[`beforeprint`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event) / [`afterprint`](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event) fire around print/preview; MDN documents them for mutating page content (or preferring `@media print`), **not** for canceling print. Listening to `beforeprint` alone does not replace a custom Print pipeline.

Intercepting **keydown** Ctrl/Cmd+P and calling `preventDefault()` (which `bindHotkeys` already does) is the workable path when the page has focus and the event is cancelable. Limits that remain true regardless of Paperoo code:

- Browser **File → Print** / menu print still prints the shell document.
- Some browsers only deliver key events when the page (not DevTools/chrome) has focus.
- Reliability of canceling the native print default for `P` is UA-dependent; Chromium generally honors a cancelable `keydown` `preventDefault`, but this is not something MDN guarantees specifically for print.

So: the convention **is** Cmd/Ctrl+P; the browser **does** own it by default; Paperoo can reclaim the **keyboard** path via the existing hotkey helper, but cannot own every print entry point.

### Recommended pattern

**Intercept Ctrl/Cmd+P and call `runPrint` — do not invent a custom chord.**

Rationale:

1. Matches user expectation and empty-state-style discoverability (`ToolbarTip` + `Kbd` as `⌘P`).
2. Fits the existing API: `{ key: "p", meta: true, handler: () => { void runPrint(); } }` in `editor-hotkeys.tsx`.
3. `preventDefault` from `bindHotkeys` is exactly what you want to suppress the shell print dialog on that key path.
4. A custom chord (e.g. Shift+⌘P) would avoid fighting the browser but would be invisible to users who always press ⌘P, and would leave the shell-print default intact on the common chord — worse UX for a PDF editor whose Print action must print **edited bytes**.

Implementation notes (for a later change, not this research pass):

- Gate like Export: no-op or toast when `status !== "ready"` / already exporting; mirror button `disabled` semantics.
- Keep Print disabled-in-inputs via default `allowInInput` false (typing “p” in overlays should not print).
- Optional: also handle `beforeprint` only if you later want a soft warning when the user prints via the browser menu (cannot redirect that path to the PDF iframe reliably).

---

## 2. Convert Open from labeled to icon-only + tooltip

### Current Open control

[`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) lines 97–107:

```tsx
<ToolbarTip label="Open PDF">
  <Button
    pressable
    onClick={() => inputRef.current?.click()}
    size="sm"
    variant="outline"
  >
    <FileUpIcon />
    Open
  </Button>
</ToolbarTip>
```

Hidden file input: `#editor-open-input` / `accept="application/pdf"`. Hotkey Cmd/Ctrl+O already triggers that input ([`editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx)).

### Consistency with Export / Print plan

[`print-button-toolbar.md`](./print-button-toolbar.md) recommends Export + Print as:

- `size="icon-sm"`
- `ToolbarTip` with label
- `aria-label` on the button
- Prefer `variant="ghost"` for a quiet pair (or keep Export primary)

Open today is the odd one out: **visible text** + `outline` + `sm`. Converting Open to the same icon-sm + tip pattern makes the left cluster (Open / Undo / Redo) match the planned right cluster (Print / Export).

### Recommended Open shape

```tsx
<ToolbarTip label="Open PDF" shortcut="⌘O">
  <Button
    pressable
    aria-label="Open PDF"
    onClick={() => inputRef.current?.click()}
    size="icon-sm"
    variant="ghost"
  >
    <FileUpIcon />
  </Button>
</ToolbarTip>
```

| Decision | Guidance |
| --- | --- |
| Size | `icon-sm` — same as Undo/Redo/Zoom and planned Export/Print ([`button-variants.ts`](../../components/ui/button-variants.ts)) |
| Variant | `ghost` — matches Undo/Redo; dropping `outline` avoids a lone bordered control once the label is gone. Keeping `outline` is a valid alternative if Open should stay more “file-ish,” but it would still be inconsistent with the rest of the icon rail |
| Tooltip | Keep `label="Open PDF"`; **add** `shortcut="⌘O"` so tip parity matches Undo and the empty-state hint |
| `aria-label` | **Required** once text `"Open"` is removed. Tooltips are not a reliable accessible name ([MDN `aria-label`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label)). Mirror tool-rail / inspector (`aria-label={item.label}` in [`tool-rail.tsx`](../../components/editor/tool-rail.tsx)) |
| Discoverability tradeoff | Losing the visible word “Open” is acceptable because ⌘O is already taught on the empty state and the tip will show label + shortcut |

No change needed to the sr-only file input or the Open hotkey.

---

## 3. Unit/integration tests for iframe + `window.print` DOM behavior

### How this repo tests today

[`package.json`](../../package.json):

- `"test": "vitest run"`
- DevDependency: `vitest@^5.0.1`
- **No** `jsdom`, `happy-dom`, `@testing-library/react`, or Playwright/Cypress packages

[`vitest.config.ts`](../../vitest.config.ts):

```ts
test: {
  environment: "node",
  include: ["test/**/*.test.ts"],
}
```

All suites under `test/*.test.ts` are **Node** unit tests: store/history, pdf-lib export, PDF.js extract/render via [`test/pdfjs-node.ts`](../../test/pdfjs-node.ts) (sets `GlobalWorkerOptions.workerSrc` to the legacy worker file). Grep of `test/` finds **no** `vi.fn` / `stubGlobal` / DOM mocks — the suite does not currently stub `document` or workers for UI helpers.

Node itself (verified in this environment): `Blob` and `URL.createObjectURL` exist; `document` is **undefined**. So any helper that calls `document.createElement` will throw unless tests inject mocks or add a DOM environment.

[`run-export.ts`](../../lib/pdf/run-export.ts) already uses the browser DOM for download (`document.createElement("a")`, `URL.createObjectURL`, `link.click()`, `revokeObjectURL`) and is **not** covered by automated tests today — only lower-level export/pdf-lib paths are.

### What is realistically testable in Node

| Concern | Testable in current Vitest/Node? | How |
| --- | --- | --- |
| Build edited PDF bytes / Blob construction from an `ArrayBuffer` | Yes (already pattern for export tests) | Keep export-worker / `exportDocument` tests; Print should share that build |
| `URL.createObjectURL` / `revokeObjectURL` call order | Yes with stubs | Stub `URL.createObjectURL` / `revokeObjectURL`; assert create then revoke once |
| Create iframe, set `src`, append to body | Yes with a minimal `document` mock | Fake `createElement` returning `{ src, style, contentWindow, addEventListener, … }`; fake `body.appendChild` / `removeChild` |
| Call `contentWindow.print()` after load | Yes | Provide `contentWindow: { print: vi.fn(), addEventListener }` and fire a synthetic `load` |
| Cleanup on `afterprint` | Yes | Assert listener registered for `"afterprint"`; invoke it; expect revoke + remove |
| Fallback delayed cleanup if `afterprint` missing | Yes | Fake window without firing `afterprint`; advance timers (`vi.useFakeTimers`) |
| Real browser PDF viewer + print dialog | **No** | Manual / optional future e2e |
| UA-specific iframe visibility / PDF plugin quirks | **No** | Manual |
| That Cmd/Ctrl+P opens the system print UI for the PDF frame | **No** in Node | Manual; hotkey matching can be unit-tested separately against `bindHotkeys` with synthetic `KeyboardEvent` if a minimal `window` listener host is mocked |

### Recommended concrete approach (repo conventions)

1. **Extract a pure-ish helper** (e.g. `lib/pdf/print-blob.ts` or next to `run-export`) that accepts the PDF `Blob`/`ArrayBuffer` and performs: createObjectURL → iframe → print → cleanup. Keep `runPrint` as “build edited bytes then call helper.” That mirrors the export split already suggested in [`print-button-toolbar.md`](./print-button-toolbar.md).

2. **Add** `test/print-blob.test.ts` (or `test/run-print.test.ts`) under the existing `test/**/*.test.ts` include — same style as [`test/history-flags.test.ts`](../../test/history-flags.test.ts) / [`test/bytes.test.ts`](../../test/bytes.test.ts): `import { expect, test, vi, afterEach } from "vitest"`, no React render.

3. **Do not** add jsdom/happy-dom solely for this unless more UI tests land later. Prefer dependency injection or a tiny fake document:

```ts
// Sketch — illustrative, not committed
test("printBlob mounts iframe, prints, cleans up on afterprint", () => {
  const print = vi.fn();
  const revoke = vi.fn();
  const removeChild = vi.fn();
  let afterPrintHandler: (() => void) | undefined;

  const iframe = {
    src: "",
    style: {},
    contentWindow: {
      print,
      addEventListener: (type: string, handler: () => void) => {
        if (type === "afterprint") afterPrintHandler = handler;
      },
    },
    addEventListener: (type: string, handler: () => void) => {
      if (type === "load") handler();
    },
  };

  // Inject createElement → iframe, body.appendChild, URL.createObjectURL/revokeObjectURL
  // Call printBlob(blob)
  expect(print).toHaveBeenCalledOnce();
  afterPrintHandler?.();
  expect(revoke).toHaveBeenCalledOnce();
  expect(removeChild).toHaveBeenCalledWith(iframe);
});
```

4. **Optional companion:** `test/hotkeys-print.test.ts` only if `bindHotkeys` is exercised with a stubbed `window.addEventListener` — assert `meta: true` + key `"p"` calls preventDefault and the handler. Not required for the iframe helper itself.

5. **Leave manual:** end-to-end “print dialog shows edited PDF,” Safari/Firefox iframe quirks, and browser-menu File → Print behavior.

Adding jsdom would enable fuller DOM integration but is a project-wide testing-policy change; it is unnecessary for the iframe helper if the helper is written to be injectable / mock-friendly.

---

## Summary recommendations

| Item | Recommendation |
| --- | --- |
| Print shortcut | Register `{ key: "p", meta: true }` → `runPrint`; tip `⌘P`. Rely on `bindHotkeys` `preventDefault`. Accept that menu Print still hits the shell. |
| Open button | Convert to `icon-sm` + `ghost` + `ToolbarTip` (`Open PDF` / `⌘O`) + `aria-label="Open PDF"`. |
| Tests | Node Vitest unit test of an extracted print-blob helper with mocked `document`/`URL`/`print`; do not expect real print dialog coverage without a new browser e2e stack. |

No application source changes in this research deliverable.

---

## Sources

### Repo

- [`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) — Undo/Redo/Zoom/Open bindings
- [`lib/hotkeys.ts`](../../lib/hotkeys.ts) — `meta` = Ctrl \|\| Meta, `preventDefault` on match
- [`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) — Open labeled outline button, `ToolbarTip`
- [`components/editor/empty-state.tsx`](../../components/editor/empty-state.tsx) — `⌘O` / `⌘Z` teaching
- [`components/editor/tool-rail.tsx`](../../components/editor/tool-rail.tsx) — icon-only + `aria-label`
- [`components/ui/button-variants.ts`](../../components/ui/button-variants.ts) — `icon-sm`, `ghost`, `outline`
- [`lib/pdf/run-export.ts`](../../lib/pdf/run-export.ts) — Blob + `createElement("a")` download (untested DOM)
- [`package.json`](../../package.json) — `"test": "vitest run"`, no jsdom/happy-dom
- [`vitest.config.ts`](../../vitest.config.ts) — `environment: "node"`, `test/**/*.test.ts`
- [`test/pdfjs-node.ts`](../../test/pdfjs-node.ts), [`test/history-flags.test.ts`](../../test/history-flags.test.ts), [`test/bytes.test.ts`](../../test/bytes.test.ts) — Node test conventions
- [`docs/research/print-button-toolbar.md`](./print-button-toolbar.md) — Print iframe + icon-only Export plan

### Web / specs

- [MDN KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)
- [MDN Event.preventDefault()](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
- [MDN Window: beforeprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event)
- [MDN Window: afterprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event)
- [MDN Window.print()](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- [MDN aria-label](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label)
- [HTML Living Standard — Printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing)
