# Inline editing for selected PDF text

How to move PDF text string edits from the inspector Input onto the selected/dirty run (double-click → edit in place), while keeping the inspector for font family/size only.

This note follows [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md), [pdf-text-edit-style-loss.md](./pdf-text-edit-style-loss.md), and [pdf-text-preview-weight.md](./pdf-text-preview-weight.md). Primary sources are paperoo editor/overlay/store code, the dirty PDF text layer, and known browser constraints for carets under CSS transforms. It does not implement the feature.

---

## Symptom / goal

**Today:** Click a PDF run → outline + [`PdfTextInspector`](../../components/editor/pdf-text-inspector.tsx) string `Input`. Every keystroke calls [`patchPdfText`](../../lib/editor/store.ts) (history per change). Dirty runs redraw via white cover + CSS text in [`PdfTextLayer`](../../components/editor/pdf-text-layer.tsx).

**Goal (UX already decided):** Edit the string **inline on the run**. Inspector keeps font family / size only. Match the feel of overlay text (double-click → editable → commit on blur) where that pattern fits PDF constraints.

---

## Current flow

```text
extractPdfTextObjects (session)
  → hitTestPdfText on overlay root pointerdown (select tool)
  → selectPdfText(id)
  → inspector Input onChange → patchPdfText({ text })  [history each stroke]
  → isPdfTextDirty → PdfTextLayer white cover + CSS redraw
  → export drawDirtyPdfText (white mask + drawText)
```

### Selection → store

1. [`EditorOverlay`](../../components/editor/editor-overlay.tsx) `onPointerDown` when `tool === "select"` and `event.target === currentTarget` calls [`hitTestPdfText`](../../lib/editor/object-utils.ts) then [`editorStore.selectPdfText`](../../lib/editor/store.ts).
2. PDF text chrome is `pointer-events-none` ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx)), so hits always go to the overlay root — geometry is pure JS hit-test against stored `x`/`y`/`width`/`height` (source box; **not** the dirty fitted box).
3. [`InspectorBar`](../../components/editor/inspector-bar.tsx) renders `PdfTextInspector` when `selectedPdfTextId` resolves.

### Dirty overlay → export

- Dirty iff text / fontFamily / fontSize differ from originals ([`isPdfTextDirty`](../../lib/editor/object-utils.ts)).
- Dirty paint: absolute wrapper via [`objectWrapperStyle`](../../lib/editor/coordinates.ts) with **rotation forced to 0**; inner white `bg-white`; text div with `whitespace-nowrap`, color/weight/family, `fontSize: pageToCss(...)`, and `transform: scaleX(horizontalScale) rotate(...)` with `transformOrigin: left center` ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx)).
- Box width grows with measured Liberation width when dirty ([`pdfTextOverlayBox`](../../lib/editor/object-utils.ts) / [`fittedPdfTextBox`](../../lib/editor/object-utils.ts); RTL shifts `x`).
- Export only rewrites dirty runs ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts) `drawDirtyPdfText`).

---

## Overlay text editing today (reuse vs diverge)

| Concern | Overlay text | PDF text today |
| --- | --- | --- |
| Enter edit | Double-click → local `editingId` ([`overlay-object.tsx`](../../components/editor/overlay-object.tsx)) | Inspector Input only |
| Editor surface | `contentEditable` on the object div ([`object-view.tsx`](../../components/editor/objects/object-view.tsx)) | Controlled `Input` in inspector |
| Commit | `onBlur` → `commitObject(..., true)` once | `patchPdfText` every `onChange` |
| Pointer while editing | `stopPropagation` on pointerdown when `editing` | N/A (inspector) |
| Hotkeys | [`bindHotkeys`](../../lib/hotkeys.ts) skips when `isContentEditable` / INPUT | Same when inspector Input focused |
| Drag conflict | Object nodes capture pointer for drag; edit mode hides resize chrome | PDF text has no drag; only select |

**Reuse:** local editing id, double-click to enter, blur to commit one history entry, stopPropagation while editing, ContentEditable/input treated as “in input” by hotkeys.

**Diverge:** PDF text is not an `EditorObject`; chrome is `pointer-events-none`; dirty path uses white cover + `scaleX`/`rotate` on the glyph div; clean runs still show PDF.js canvas ink; runs are single-line (`whitespace-nowrap`); `dir` / RTL box growth; hit-test is on the root, not the chrome node.

---

## Feasibility: editor on the dirty overlay

| Constraint | Implication |
| --- | --- |
| `pointer-events-none` on dirty + chrome | Must flip to `pointer-events-auto` (or a sibling hit target) **only while editing**, or clicks never reach the editor. |
| White cover | Required as soon as edit starts — even for clean text — otherwise CSS/input glyphs sit on top of PDF.js ink. |
| `scaleX(horizontalScale)` + `rotate` on the text node | Known caret/selection misalignment under CSS transforms (Firefox/WebKit/Edge reports). Overlay text avoids scaleX; PDF dirty paint does not. Prefer **not** putting `contentEditable` / `<input>` on the same node that has `scaleX`. |
| Zoom | Font size already via `pageToCss`; wrapper size via `objectWrapperStyle` — same as dirty preview. |
| Measured width | Live typing must grow the white cover (`pdfTextOverlayBox` + `canvasTextWidth`); commit path already does this after dirty. |
| Overlay root `select-none` | During edit, editable must allow text selection (`select-text` / `user-select: text`) or caret selection fails. |
| Multiline | Dirty CSS is `whitespace-nowrap`; PDF items are glyph runs, not paragraphs ([v2](./v2-pdf-text-capabilities.md)). Treat as single-line; block Enter from inserting `\n`. |

**contentEditable vs input vs textarea**

- **textarea:** wrong default (multiline); avoid.
- **contentEditable:** matches overlay; easy to insert newlines / rich paste — need `whitespace-nowrap`, Enter→commit, sanitize paste to plain text.
- **`<input type="text">`:** single-line by default; simpler commit (`value`); easier to keep transforms on a **non-editable** preview layer or on a parent that does not own the caret. Slightly better fit for PDF runs.

Either input or contentEditable works if transforms are handled carefully; prefer **`<input>`** for PDF runs to avoid newline/`innerText` pitfalls.

---

## Interaction model

Recommended (aligned with overlay, minimal new gestures):

1. **Single click** (existing): `selectPdfText` — outline + font/size inspector. Do **not** enter edit.
2. **Double-click** on a PDF text hit (select tool): set `editingPdfTextId`, focus the inline editor. If already selected, still works; if not, select then edit.
3. **Blur:** commit draft via one `patchPdfText` (or no-op if unchanged); clear `editingPdfTextId`.
4. **Enter:** prevent default; blur / commit (single-line).
5. **Escape:** discard draft, exit edit, keep selection. Today Escape is ignored while focus is in an input/contentEditable ([`hotkeys.ts`](../../lib/hotkeys.ts) — no `allowInInput` on Escape), so handle Escape **on the editor element** (or `allowInInput` for Escape that exits edit only).
6. **Drag / marquee:** PDF text is not draggable. While editing, `stopPropagation` on the editor so overlay root does not clear selection / start unrelated gestures. Clicking empty page still clears selection (existing) and should end edit via blur.

Do **not** start edit on first click — that conflicts with “select then change font/size in inspector.”

---

## Clean text: promote before editor?

Clean runs: canvas still paints original glyphs; dirty overlay is absent (`isPdfTextDirty` false). Putting an editor over the canvas without a white cover doubles glyphs.

**Required:** on edit start, paint the **dirty visual path** for that id (white cover + Liberation/CSS metrics) even if store fields still match originals.

Two store options:

| Option | Behavior |
| --- | --- |
| A. UI-only force | `editingPdfTextId` makes `PdfTextLayer` render white+CSS for that id without flipping dirty until text/font/size actually change. Export unchanged until dirty. |
| B. Synthetic dirty | Patch something that marks dirty immediately — there is no “editing” flag on `PdfTextObject`; dirty is only text/family/size. Forcing dirty without a real change would need a new field or a fake mutation (bad). |

**Prefer A.** Keep undo/export semantics: blank edit session that restores original string leaves the run clean.

Draft text can live in React state until blur; layer reads `draft ?? object.text` while editing so the cover grows live without per-keystroke history.

---

## Inspector

- **Remove** the string `Input` from [`pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx).
- **Keep** font family `Select` and font size number `Input` (still `patchPdfText`, with no-op guards as today).
- **Autofocus:** removing the string field stops the bar from stealing focus on select (today the text Input is first focusable in the bar). Font/size controls should not autoFocus. Inline editor focuses on double-click only.
- While `editingPdfTextId` is set, family/size patches should restyle the live inline editor (same object fields the layer already reads).

---

## Recommended approach (one path)

1. Add `editingPdfTextId: string | null` in [`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) (separate from overlay `editingId`).
2. On select-tool double-click over a `hitTestPdfText` hit: `selectPdfText` + set `editingPdfTextId` + `ensureEditorFonts`.
3. Extend [`PdfTextLayer`](../../components/editor/pdf-text-layer.tsx) (or a small sibling) so when `editingPdfTextId === object.id` **or** `isPdfTextDirty(object)`:
   - Render white cover + text chrome.
   - If editing: render a single-line `<input>` (preferred) with matching font/color/size/weight/italic, `dir` from `object.dir`, `pointer-events-auto`, `user-select: text`, draft value; **do not** apply `scaleX` on the input — keep `scaleX`/`rotate` on a non-caret visual wrapper only when `horizontalScale !== 1` / `rotation !== 0`, or accept unscaled edit for stretched/rotated runs (document visual jump). Simplest shippable: apply `rotate` on the outer frame via `objectWrapperStyle(..., rotation)` while editing; leave `horizontalScale` as layout widening only (measure × scale) without CSS `scaleX` on the input.
4. Commit on blur/Enter: one `patchPdfText` with final string; clear editing id. Escape: clear draft + editing id, no patch if never committed.
5. Strip string Input from inspector; keep family/size.
6. Optionally update [`hitTestPdfText`](../../lib/editor/object-utils.ts) to use `pdfTextOverlayBox` when dirty/editing so clicks on grown text still hit.

Undo: one history entry per edit session (like overlay `commitObject`), not per keystroke.

---

## Implementation touch points

| Area | Path |
| --- | --- |
| Double-click / editing state | [`components/editor/editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) |
| Dirty + editable paint | [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) |
| Dirty / box / hit-test | [`lib/editor/object-utils.ts`](../../lib/editor/object-utils.ts) |
| Patch + history | [`lib/editor/store.ts`](../../lib/editor/store.ts) (`patchPdfText`) |
| Inspector string removal | [`components/editor/pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx) |
| Hotkey Escape while editing | [`lib/hotkeys.ts`](../../lib/hotkeys.ts) / editor element `onKeyDown` |
| Overlay reference pattern | [`overlay-object.tsx`](../../components/editor/overlay-object.tsx), [`object-view.tsx`](../../components/editor/objects/object-view.tsx) |
| Fonts preload | [`lib/fonts/measure-text.ts`](../../lib/fonts/measure-text.ts) (`ensureEditorFonts`) |
| Export (unchanged contract) | [`lib/pdf/export-pdf.ts`](../../lib/pdf/export-pdf.ts) |

---

## Risks / out of scope

- **Caret under CSS transform:** avoid `scaleX` on the focused control; rotated runs need careful wrapper rotation testing.
- **Live width growth:** draft must drive `measuredPdfTextWidth` / white cover every keystroke in UI state.
- **Hit-test vs dirty box:** source-box hit-test misses grown dirty text until hit-test is updated.
- **RTL / `dir`:** `fittedPdfTextBox` already shifts `x` for RTL; editor `dir` attribute should match.
- **ttb / vertical:** `PdfTextDir` includes `ttb`; inline horizontal input is wrong — leave vertical out of scope or keep inspector-only for `ttb`.
- **Multiline / paragraph edit:** out of scope (runs are not paragraphs).
- **Per-keystroke undo:** current inspector behavior; inline should **not** preserve it.
- **Color / stretch fidelity:** already covered by style-loss / preview notes; inline edit does not fix color pickers.
- **Overlay `editingId` unification:** optional later; keep IDs separate first to avoid selecting overlay text and PDF text with one string space.

---

## Sources

- [`components/editor/editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) — select hit-test, `editingId` for overlay only
- [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) — dirty white cover, `pointer-events-none`, `scaleX`/`rotate`, `whitespace-nowrap`
- [`components/editor/pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx) — string Input → `patchPdfText`
- [`components/editor/inspector-bar.tsx`](../../components/editor/inspector-bar.tsx) — PDF text inspector routing
- [`components/editor/overlay-object.tsx`](../../components/editor/overlay-object.tsx) — double-click → edit
- [`components/editor/objects/object-view.tsx`](../../components/editor/objects/object-view.tsx) — `contentEditable` + blur commit
- [`lib/editor/store.ts`](../../lib/editor/store.ts) — `selectPdfText`, `patchPdfText` + history
- [`lib/editor/object-utils.ts`](../../lib/editor/object-utils.ts) — `isPdfTextDirty`, `pdfTextOverlayBox`, `hitTestPdfText`
- [`lib/editor/types.ts`](../../lib/editor/types.ts) — `PdfTextObject` / `dir`
- [`lib/editor/coordinates.ts`](../../lib/editor/coordinates.ts) — `objectWrapperStyle`, `pageToCss`
- [`lib/hotkeys.ts`](../../lib/hotkeys.ts) — skips INPUT / contentEditable unless `allowInInput`
- [`lib/pdf/extract-text.ts`](../../lib/pdf/extract-text.ts) / [`lib/pdf/export-pdf.ts`](../../lib/pdf/export-pdf.ts) — extract originals / dirty export
- Browser: CSS `transform` on caret hosts (Firefox [848808](https://bugzilla.mozilla.org/show_bug.cgi?id=848808), WebKit [94985](https://bugs.webkit.org/show_bug.cgi?id=94985)); MDN [transform](https://developer.mozilla.org/en-US/docs/Web/CSS/transform)
- Prior: [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md), [pdf-text-edit-style-loss.md](./pdf-text-edit-style-loss.md), [pdf-text-preview-weight.md](./pdf-text-preview-weight.md)
