# Print button + icon-only Export/Print in the editor toolbar

How to add a Print control next to Export PDF, convert both to `icon-sm` + `ToolbarTip`, and print the **edited** PDF bytes (same pipeline as export) rather than the editor chrome.

Primary sources: paperoo toolbar/button/export modules, Lucide React exports, MDN `Window.print` / Blob / object URLs / `aria-label`, HTML Living Standard printing.

---

## Current toolbar patterns

[`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx):

| Control | Pattern | Notes |
| --- | --- | --- |
| Open | `size="sm"` `variant="outline"` + icon + **visible label** `"Open"` | Wrapped in `ToolbarTip label="Open PDF"` |
| Undo / Redo / Zoom | `size="icon-sm"` `variant="ghost"` + icon only | `ToolbarTip` supplies the visible tip; **no** `aria-label` on these buttons today |
| Fit / Width | `Toggle` `size="sm"` with text | Sticky pressed mode |
| Export PDF | `ml-auto` group, `size="sm"` **default** variant, icon + label `"Export PDF"` | Uses `loading={isExporting}`, `disabled={!ready \|\| isExporting}`; **not** wrapped in `ToolbarTip` |

`ToolbarTip` is a thin wrapper around Base UI tooltip primitives from [`components/ui/tooltip.tsx`](../../components/ui/tooltip.tsx): `Tooltip` → `TooltipTrigger render={children}` → `TooltipPopup` with optional `Kbd` shortcut.

The tool rail ([`tool-rail.tsx`](../../components/editor/tool-rail.tsx)) and inspector Bold/Italic ([`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx)) set `aria-label` on icon-only / letter-only controls. That is the safer a11y pattern when converting Export (and adding Print) to icon-only — tooltips are not a substitute for accessible names ([MDN `aria-label`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label): buttons with SVG and no text need an accessible name).

---

## Button sizes / loading

[`components/ui/button-variants.ts`](../../components/ui/button-variants.ts):

- `icon-sm`: `size-8 sm:size-7` — matches Undo/Redo/Zoom
- `sm`: height + horizontal padding for labeled buttons

[`components/ui/button.tsx`](../../components/ui/button.tsx):

- `loading` sets `disabled`, `data-loading`, and overlays a `Spinner`; text becomes transparent via `data-loading:text-transparent`
- `pressable` adds `editor-pressable` (used on toolbar actions)

For icon-only Export, `loading={isExporting}` still works: the spinner replaces the invisible icon while `data-loading` is set.

---

## Existing export flow (bytes already suitable for print)

1. Toolbar `exportPdf()` → [`runExport()`](../../lib/pdf/run-export.ts) ([`editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) lines 33–44, 174–187).
2. `runExport` gates on `pdfSession.bytes` + non-empty pages, then `editorStore.setExporting(true)` ([`store.ts`](../../lib/editor/store.ts) `isExporting` / `setExporting`).
3. Fonts + dirty image assets are prepared; a module worker ([`export.worker.ts`](../../lib/pdf/export.worker.ts)) runs [`exportDocument`](../../lib/pdf/export-pdf.ts) (pdf-lib) and posts back an `ArrayBuffer`.
4. Download path today:

```ts
const blob = new Blob([result], { type: "application/pdf" });
const url = URL.createObjectURL(blob);
// <a download="…-edited.pdf"> click + revoke
```

So export already produces an `application/pdf` `Blob` and a blob object URL. Print should reuse the **same** bytes (edited document), not `window.print()` on the editor page.

`exportDocument` returns `Promise<Uint8Array>` ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts)); the worker copies that into a transferable `ArrayBuffer`. No separate “print” serializer exists.

**Refactor hint for implementation:** split `runExport` into (a) build edited PDF `ArrayBuffer`/`Blob` under `isExporting`, and (b) either download or print. Sharing one build avoids double work and keeps Print and Export identical.

---

## Existing print functionality in this repo

Grep of app sources for `print`, `window.print`, `@media print`, `PrinterIcon` finds **no** editor/print feature. The only `print` hits are PDF.js wasm `Module["print"]` console hooks under `public/pdfjs/wasm/`, unrelated to user printing.

Conclusion: Print is net-new UI + a small client helper; no existing print stylesheet or dialog path to extend.

---

## Browser APIs: print the PDF, not the page

### `Window.print()`

[MDN `Window.print()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/print): opens the print dialog for the **current document**. No parameters. Blocks while the dialog is open. Spec: [HTML Living Standard — Printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing).

Calling `window.print()` on the Paperoo shell would print toolbar/chrome/canvas UI — **wrong** for “print the edited PDF.”

### Blob + object URL (already used by export)

[MDN `Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob): construct with `new Blob([arrayBuffer], { type: "application/pdf" })`.

[MDN `URL.createObjectURL`](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) / [Using files from web applications — object URLs for PDF](https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications): blob URLs can be assigned to an `<iframe src>` to embed a PDF; revoke with `URL.revokeObjectURL` when done.

### Recommended approach for this app

1. Build the same edited PDF `ArrayBuffer` as export.
2. `const blob = new Blob([bytes], { type: "application/pdf" })`.
3. `const url = URL.createObjectURL(blob)`.
4. Create a temporary `<iframe>`, set `src = url`, append to `document.body`.
5. On load, call `iframe.contentWindow?.print()` (the iframe’s window — still MDN `Window.print`, but scoped to the PDF document the browser’s PDF viewer presents).
6. Clean up: listen for [`afterprint`](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event) on that window when available, then `revokeObjectURL` and remove the iframe. Fall back to a delayed cleanup if `afterprint` is unreliable for the PDF viewer frame.

Caveats (implementation notes, not repo code):

- Browsers differ on whether a fully `display: none` / zero-size iframe initializes the PDF viewer before print; some need a near-invisible but non-zero box.
- Blob URLs are same-origin to the page that created them, which avoids cross-origin iframe print blocks that affect remote PDF URLs.
- Do **not** rely on `@media print` CSS for the editor document; the goal is the PDF content stream, not a print stylesheet of the React UI.

`window.open(url)` then print is a secondary fallback (popup blockers); prefer the iframe path for a toolbar button gesture.

---

## Lucide icons

Installed: `lucide-react@^1.48.0` ([`package.json`](../../package.json)).

Runtime exports confirmed:

- `DownloadIcon` — already imported in the toolbar for Export
- `PrinterIcon` / `Printer` — available; use `PrinterIcon` to match the project’s `*Icon` import style (`DownloadIcon`, `Undo2Icon`, etc.)

No `PrinterIcon` usage in app code yet.

---

## Accessibility

| Concern | Guidance |
| --- | --- |
| Icon-only Export / Print | Set `aria-label="Export PDF"` / `aria-label="Print"` (or shorter `"Export"` / `"Print"`) on the `Button`, matching tool-rail / inspector |
| Tooltip | Wrap both in `ToolbarTip` so sighted users get the label that was previously visible text |
| Loading | Keep `loading` / `disabled` tied to `isExporting` (or a shared busy flag) so both buttons disable during the shared export build |
| Focus | Native `<button>` via `Button` already; no `role` hacks |

MDN explicitly calls out SVG-only buttons as needing `aria-label` ([aria-label](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label)). Tooltip content alone is not guaranteed to become the accessible name.

Optional follow-up (out of scope for Print): add `aria-label` to existing Undo/Redo/Zoom icon buttons for consistency.

---

## Recommended UX for Paperoo

Place both actions in the existing `ml-auto` group as a horizontal `flex` with a small gap:

```tsx
<div className="ml-auto flex items-center gap-1">
  <ToolbarTip label="Print">
    <Button
      pressable
      aria-label="Print"
      disabled={!ready || isExporting}
      loading={isExporting /* or dedicated isPrinting if split */}
      onClick={…}
      size="icon-sm"
      variant="ghost" // or default for Export only — see below
    >
      <PrinterIcon />
    </Button>
  </ToolbarTip>
  <ToolbarTip label="Export PDF">
    <Button
      pressable
      aria-label="Export PDF"
      disabled={!ready || isExporting}
      loading={isExporting}
      onClick={…}
      size="icon-sm"
      variant="ghost" // or keep default primary for Export
    >
      <DownloadIcon />
    </Button>
  </ToolbarTip>
</div>
```

UX choices:

1. **Both icon-sm + ToolbarTip** — matches the user’s request; frees horizontal space next to Fit/Width.
2. **Print prints edited PDF** — same bytes as Export download; never `window.print()` on the shell.
3. **Variant:** Undo/Zoom use `ghost`; current Export uses primary `default`. For a quiet pair, both `ghost` is consistent with the rest of the toolbar; keeping Export as `default` `icon-sm` preserves a stronger “primary action” cue if desired.
4. **Busy state:** one shared `isExporting` (or rename to `isBusyExport`) for both, since both wait on the same worker build. Toast on Print success is optional (“Opened print dialog”); errors should mirror Export’s toast path.
5. **Open stays labeled** — only Export (and new Print) become icon-only; Open’s text label remains useful for first-run discoverability.

---

## Implementation sketch (do not apply in this research pass)

1. Extract `buildEditedPdfBlob(): Promise<Blob>` from [`run-export.ts`](../../lib/pdf/run-export.ts) (fonts, assets, worker, `setExporting`).
2. `runExport` = build + download link click (current behavior).
3. `runPrint` = build + iframe object-URL + `contentWindow.print()` + cleanup.
4. Toolbar: icon-sm Print + Export with `ToolbarTip` + `aria-label` in `ml-auto flex`.

No application source changes in this research deliverable.

---

## Sources

### Repo

- [`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) — `ToolbarTip`, Export button, icon-sm patterns
- [`components/ui/button.tsx`](../../components/ui/button.tsx), [`button-variants.ts`](../../components/ui/button-variants.ts) — `icon-sm`, `loading`, `pressable`
- [`lib/pdf/run-export.ts`](../../lib/pdf/run-export.ts), [`export-pdf.ts`](../../lib/pdf/export-pdf.ts), [`export.worker.ts`](../../lib/pdf/export.worker.ts) — edited PDF bytes → Blob download
- [`lib/editor/store.ts`](../../lib/editor/store.ts) — `isExporting` / `setExporting`
- [`components/editor/tool-rail.tsx`](../../components/editor/tool-rail.tsx), [`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx) — icon-only + `aria-label`
- `lucide-react` package exports — `DownloadIcon`, `PrinterIcon`

### Web / specs

- [MDN Window.print()](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- [MDN Window: afterprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event)
- [MDN Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
- [MDN URL.createObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
- [MDN Using files from web applications](https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications) (object URLs + PDF in iframe)
- [MDN aria-label](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label)
- [HTML Living Standard — Printing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing)
