# PDF inline text edit — out-of-scope follow-ups

Research for the five items left out of [pdf-text-inline-edit.md](./pdf-text-inline-edit.md) after the single-run horizontal inline editor shipped. Primary sources are the current editor/overlay/store/PDF extract+export code and installed PDF.js / pdf-lib types. This note does not implement product code.

Related: [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md), [pdf-text-font-weight.md](./pdf-text-font-weight.md), [pdf-text-preview-weight.md](./pdf-text-preview-weight.md). (`pdf-text-edit-style-loss.md` is cited by the inline-edit note but is not in the tree; color limits live in the v2 note. `lib/pdf/extract-text-colors.ts` does not exist yet.)

Installed versions (same as v2):

- `pdfjs-dist@6.3.289`
- `pdf-lib@1.17.1` / `@pdf-lib/fontkit@1.1.1`

---

## Current baseline (post inline edit)

Inline edit for **horizontal** PDF runs is in place:

| Piece | Behavior |
| --- | --- |
| Double-click | [`beginPdfTextEditAtPoint`](../../components/editor/overlay-pdf-hit.ts) — rejects `dir === "ttb"` |
| Editing state | `editingPdfTextId` in [`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx); overlay text keeps separate `editingId` |
| Surface | [`PdfTextEditor`](../../components/editor/pdf-text-layer.tsx) — single-line `<input>`, draft until blur/Enter, Escape discards |
| Inspector | [`PdfTextInspector`](../../components/editor/pdf-text-inspector.tsx) — font family + size only (no string field, no color) |
| Dirty | [`isPdfTextDirty`](../../lib/editor/object-utils.ts) — `text` / `fontFamily` / `fontSize` vs originals only |
| Preview / export color | Hardcoded `REPLACEMENT_COLOR` / `REPLACEMENT_TEXT_COLOR` `#111827` in [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) and [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) `drawDirtyPdfText` |
| Drag | PDF text has none; images/vectors use `GestureTarget` drag in [`overlay-gestures.ts`](../../components/editor/overlay-gestures.ts) |

---

## 1. Color picker (dirty preview + export)

### Current code state

- `PdfTextObject` has **no** `color` / `originalColor` ([`types.ts`](../../lib/editor/types.ts) `PdfTextObject`).
- Extract stores weight/italic from `commonObjs` faces, not fill color ([`extract-text.ts`](../../lib/pdf/extract-text.ts)).
- Dirty CSS and export always paint `#111827`.
- Overlay text and PDF vectors already use [`ColorField`](../../components/editor/color-field.tsx) via [`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx) / [`pdf-vector-inspector.tsx`](../../components/editor/pdf-vector-inspector.tsx).
- `pdf-lib` `drawText` accepts `color` ([`PDFPageDrawTextOptions`](../../node_modules/pdf-lib/src/api/PDFPageOptions.ts)); overlay `drawTextObject` already passes `object.color`.

### What APIs support or block

| Source | Color? |
| --- | --- |
| `TextItem` / `TextStyle` | No color fields ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) 312–378). Confirmed in [v2](./v2-pdf-text-capabilities.md). |
| `getOperatorList` | Has `setFillRGBColor`, `setFillGray`, … and `showText` / `showSpacedText` / `nextLineShowText` ([util.d.ts](../../node_modules/pdfjs-dist/types/src/shared/util.d.ts) 263–293). Vector extract already tracks fill RGB ([`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts)). |
| Session open | Already awaits `getTextContent` + `getOperatorList` before `cleanup()` ([`session.ts`](../../lib/pdf/session.ts)). |
| Correlation | `showText` glyph runs ≠ `getTextContent` items 1:1 (whitespace inserts, bidi, `hasEOL`, form XObjects). Matching by paint order is approximate. |
| Text rendering mode | Stroke-only / fill+stroke text (`setTextRenderingMode`) needs stroke color tracking; default fill path covers most body text. |

There is no `extract-text-colors.ts` today.

### Feasibility and risks

**Picker without extraction** is straightforward and low risk: default both `color` and `originalColor` to `#111827`, wire `ColorField`, fold color into dirty + preview + export. Clean canvas ink stays correct until dirty; after any edit the user can set a color (same default as today).

**Extraction** is medium–high risk: second op-list walk, order skew vs text items, patterns / transparency / Type3, stroke text. Wrong extracted color is worse than a known default.

### Recommended approach

1. Add `color` + `originalColor` on `PdfTextObject`; extract sets both to `#111827` (or a shared constant next to `REPLACEMENT_TEXT_COLOR`).
2. Extend `isPdfTextDirty` with `object.color !== object.originalColor`.
3. Replace hardcoded replacement color in `PdfTextLayer` / `PdfTextEditor` / `drawDirtyPdfText` with `object.color`.
4. Add `ColorField` to `PdfTextInspector` → `patchPdfText({ color })`.
5. Op-list color recovery: [`lib/pdf/extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts) — see [pdf-text-extract-colors.md](./pdf-text-extract-colors.md) (count-gated zip + fail-closed / same-color recovery).

### Touch points

| Area | Path |
| --- | --- |
| Type + dirty | [`lib/editor/types.ts`](../../lib/editor/types.ts), [`lib/editor/object-utils.ts`](../../lib/editor/object-utils.ts) |
| Extract defaults | [`lib/pdf/extract-text.ts`](../../lib/pdf/extract-text.ts) |
| Preview / inline input | [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) |
| Inspector | [`components/editor/pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx), reuse [`color-field.tsx`](../../components/editor/color-field.tsx) |
| Export | [`lib/pdf/export-pdf.ts`](../../lib/pdf/export-pdf.ts) `drawDirtyPdfText` |
| Optional extract | new `lib/pdf/extract-text-colors.ts` + [`session.ts`](../../lib/pdf/session.ts) |
| Tests | [`test/extract-text.test.ts`](../../test/extract-text.test.ts), dirty helpers |

### Dependencies

None of the other four items. Color extraction (phase 2) can reuse vector color reading helpers but should not block the picker.

---

## 2. Multi-run / paragraph edit

### Current code state

- Each PDF.js `TextItem` → one `PdfTextObject` with `sourceIndex`, `hasEOL` ([`extract-text.ts`](../../lib/pdf/extract-text.ts)).
- Hit-test / select / inline edit operate on **one** id ([`hitTestPdfText`](../../lib/editor/object-utils.ts), [`beginPdfTextEditAtPoint`](../../components/editor/overlay-pdf-hit.ts)).
- Dirty paint and export rewrite **one** run’s box; neighbors stay on the canvas ([v2](./v2-pdf-text-capabilities.md): items are glyph runs, not paragraphs).
- Dirty CSS is `whitespace-nowrap`; inline editor is `<input type="text">` (no `\n`).
- `fittedPdfTextBox` grows width on the edited run only; no reflow of following runs.

### What APIs support or block

| Signal | Use |
| --- | --- |
| `hasEOL` | Line break after this item — only reliable grouping edge from PDF.js. |
| Inserted `" "` items | Tracking gaps; not semantic words. |
| Same baseline / font / size | Heuristic only; not in the type. |
| Paragraph reconstruction | Explicitly out of V2; still unsupported by libraries. |

pdf-lib still cannot delete original operators; multi-run edit means white-covering **every** participating original box and drawing one (or many) replacement strings.

### Feasibility and risks

High product complexity, medium library risk. Hard parts are UX grouping (which runs belong together), caret spanning multiple boxes, commit that rewrites N objects without leaving uncovered glyphs, and **no reflow** — lengthening a “paragraph” still overlaps neighbors unless those are also covered/blanked.

### Recommended approach

Treat a **line cluster**, not a full paragraph:

1. On double-click, expand from the hit run along `sourceIndex` neighbors that share page, roughly the same baseline (`y`/`height` epsilon), same `fontName`/`fontSize`/`dir`, and stop at `hasEOL` / large gap / style change.
2. UI-only `editingGroupIds: string[]` (or a transient group id); one draft string = join of member `text` values (preserve interstitial space items as spaces).
3. While editing / after commit: force dirty paint for **all** members — cover each original box; draw the joined string once at the first run’s origin (Liberation metrics), or split back into per-run strings only if lengths allow (prefer one replacement string + blank covers on the rest with empty text / white-only).
4. Commit: one history entry via a new `patchPdfTextGroup` (or batched commit) that updates every member; mark trailing members `text: ""` (dirty) so export covers them without redrawing glyphs.
5. Keep inspector single-run for family/size applied to the whole group.

Do not attempt true paragraph reflow or vertical merging across lines in the first cut.

### Touch points

| Area | Path |
| --- | --- |
| Cluster helper | new in [`lib/editor/object-utils.ts`](../../lib/editor/object-utils.ts) |
| Edit entry | [`overlay-pdf-hit.ts`](../../components/editor/overlay-pdf-hit.ts), [`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) |
| Multi-cover + one editor | [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) |
| Batched history | [`store.ts`](../../lib/editor/store.ts) |
| Export | [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) — ensure empty dirty runs still white-cover |

### Dependencies

Benefits from color (1) so the joined redraw uses the right ink. Should land **before** treating multi-run ttb. Orthogonal to editingId unification. Drag-move of a group needs this clustering or a separate multi-select.

---

## 3. ttb inline edit (`dir: "ttb"`)

### Current code state

- `PdfTextDir` includes `"ttb"`; extract maps `item.dir` ([`extract-text.ts`](../../lib/pdf/extract-text.ts) `toDir`).
- `TextStyle.vertical` exists in PDF.js but is **not** stored on `PdfTextObject`.
- [`textItemToDisplayedBox`](../../lib/editor/coordinates.ts) builds a horizontal advance-based rotation; it does not apply TextLayer’s `+ π/2` when `style.vertical` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) ~15226–15228).
- [`beginPdfTextEditAtPoint`](../../components/editor/overlay-pdf-hit.ts) returns false for `ttb`.
- Inline `<input>` sets `dir` to `rtl` or `ltr` only ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx)); HTML `dir="ttb"` is not a vertical writing mode.
- Dirty export `drawDirtyPdfText` draws horizontal `drawText` with **no** `rotate` from `object.rotation`.

### What APIs support or block

| Piece | Notes |
| --- | --- |
| `item.dir === "ttb"` | Bidi / direction flag from PDF.js text builder. |
| `style.vertical` | Vertical writing mode; TextLayer adds 90° and swaps scale axis (`canvasWidth = geom.height`). |
| CSS | Vertical edit needs `writing-mode: vertical-rl` (or similar) on a non-`scaleX` caret host — not a normal single-line horizontal input. |
| pdf-lib | `drawText({ rotate })` can place upright-in-vertical runs if box/baseline math is correct; current dirty path ignores rotation. |

### Feasibility and risks

Niche documents, high geometry risk. Hit boxes and chrome for vertical runs may already be wrong relative to canvas. Horizontal `<input>` is the wrong control. Export must learn rotation/vertical baseline before preview can match.

### Recommended approach

1. Persist `vertical: boolean` from `styles[fontName].vertical` at extract time.
2. Fix `textItemToDisplayedBox` (or a vertical branch) to match TextLayer’s angle/ascent offset when `vertical`.
3. For `dir === "ttb"` (or `vertical`): use a dedicated editor — `contentEditable` or `<textarea>` with `writing-mode: vertical-rl`, `pointer-events-auto`, white cover; keep transforms off the caret node (same rule as [inline-edit](./pdf-text-inline-edit.md)).
4. Export: pass `rotate: degrees(object.rotation)` (and verify baseline) in `drawDirtyPdfText` for rotated/vertical dirty runs — also fixes horizontal rotated runs as a side benefit.
5. Until then, keep blocking inline edit for `ttb`; optional: string field only in inspector for those runs (not required if rare).

### Touch points

| Area | Path |
| --- | --- |
| Extract + type | [`extract-text.ts`](../../lib/pdf/extract-text.ts), [`types.ts`](../../lib/editor/types.ts) |
| Box math | [`coordinates.ts`](../../lib/editor/coordinates.ts) `textItemToDisplayedBox` |
| Gate + editor UI | [`overlay-pdf-hit.ts`](../../components/editor/overlay-pdf-hit.ts), [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) |
| Export rotate | [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) `drawDirtyPdfText` |

### Dependencies

Should follow correct single-run dirty export for **rotation** (horizontal rotated runs already rotate in the CSS dirty path inconsistently vs export). Independent of color picker. Multi-run ttb is a later stacking of (2) + (3).

---

## 4. Drag-move of PDF text

### Current code state

- PDF text chrome is `pointer-events-none` except the inline input while editing ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx)).
- Select hits go through overlay root → [`hitTestPdfText`](../../lib/editor/object-utils.ts).
- [`GestureTarget`](../../components/editor/overlay-gestures.ts) is `EditorObject | PdfImageObject | PdfVectorObject` — **not** `PdfTextObject`.
- Images/vectors: selected node captures pointer, `kind: "drag"`, live `writeNodeBox`, commit via `commitPdfImage` / `commitPdfVector` with **original** box used for white cover ([`pdfImageOriginalBox`](../../lib/editor/object-utils.ts), vector equivalents).
- `PdfTextObject` has `x`/`y` but **no** `originalX`/`originalY`.
- `isPdfTextDirty` ignores position. `drawDirtyPdfText` covers `fittedPdfTextBox(object, …)` at the **current** `x`/`y`. Moving `x`/`y` without an original cover would leave canvas glyphs behind and mask the wrong place.

### What APIs support or block

| Concern | Status |
| --- | --- |
| Store geometry | Mutable `x`/`y` already on the object; export maps via `displayedToUserSpace`. |
| Dirty semantics | Must mirror images: dirty if position ≠ original; cover **original** box; draw text at **current** box. |
| Pointer target | Need a selected hit surface (`pointer-events-auto` + `cursor-move`) like [`pdf-image-layer.tsx`](../../components/editor/pdf-image-layer.tsx). |
| Conflict with inline edit | Double-click edits; drag on selected chrome — same split as overlay text (`overlay-object` drag vs `contentEditable`). |
| Rotation / RTL grow | Hit-test currently axis-aligned on overlay box; drag should move the stored origin consistently with `fittedPdfTextBox` RTL shift. |

### Feasibility and risks

Feasible by cloning the image/vector gesture path. Main risk is **cover vs draw** mismatch if originals are omitted. Secondary: drag while clean must enter the dirty visual path (white cover at original + CSS text at new position) even when string unchanged — same “promote before paint” idea as edit-start in the inline-edit note.

### Recommended approach

1. Add `originalX` / `originalY` (set equal to `x`/`y` at extract). Optionally keep width/height originals if resize is ever added; for move-only, position originals suffice.
2. `isPdfTextDirty` includes `x !== originalX \|\| y !== originalY`.
3. Export/preview: white cover uses **original** geometry (plus current fitted width growth rules carefully — cover max of original and text extent at original anchor, or original box ∪ text box); `drawText` / CSS at current `x`/`y`.
4. Extend `GestureTarget` with `PdfTextObject`; selected PDF text renders a move handle layer (image pattern); `finishGesture` → `commitPdfText` / `patchPdfText` with history once.
5. While `editingPdfTextId` is set, do not start drag (input already `stopPropagation`).

Skip resize/rotate for PDF text in the first move milestone.

### Touch points

| Area | Path |
| --- | --- |
| Type + dirty + boxes | [`types.ts`](../../lib/editor/types.ts), [`object-utils.ts`](../../lib/editor/object-utils.ts), extract |
| Gestures | [`overlay-gestures.ts`](../../components/editor/overlay-gestures.ts) |
| Selected chrome + pointer | [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) |
| Commit | [`store.ts`](../../lib/editor/store.ts) (`commitPdfText` parallel to image/vector if needed) |
| Export cover at original | [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) `drawDirtyPdfText` |

### Dependencies

Independent of color for basic move; color should still paint at the new location once (1) exists. Multi-run groups (2) need group drag later. Unifying editing ids (5) is unrelated. ttb move needs correct vertical boxes (3) first for those runs.

---

## 5. Unifying overlay `editingId` / `editingPdfTextId` namespaces

### Current code state

Two React states in [`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx):

- `editingId` — overlay `TextObject` contentEditable ([`overlay-object.tsx`](../../components/editor/overlay-object.tsx) / [`object-view.tsx`](../../components/editor/objects/object-view.tsx)).
- `editingPdfTextId` — passed into `PdfTextLayer` as prop name `editingId` (already a naming collision at the layer boundary).

Both are cleared together via `clearInlineEditing` on empty-page pointerdown; tool-text placement clears PDF editing; PDF double-click clears overlay editing.

Selection remains separate: `selectedObjectIds` vs `selectedPdfTextId` ([`store.ts`](../../lib/editor/store.ts)) — intentional so Delete/patch paths do not cross types ([v2](./v2-pdf-text-capabilities.md)).

Ids are `crypto.randomUUID()` ([`ids.ts`](../../lib/editor/ids.ts)) in disjoint arrays; practical string collision is negligible. The real hazard of a **single** string id is routing the wrong branch (treat PDF id as overlay object).

### What APIs support or block

No library constraint. Pure editor state design. Hotkeys already treat INPUT / contentEditable as “in input” ([`hotkeys.ts`](../../lib/hotkeys.ts)).

### Feasibility and risks

Low implementation risk, low product leverage. Wrong unification (one bare string) is **higher** bug risk than today’s two fields. Prop rename (`PdfTextLayer`’s `editingId` → `editingPdfTextId`) is a clarity win without merging namespaces.

### Recommended approach

Keep two ids. Optionally replace with one discriminated state:

```ts
type InlineEdit =
  { kind: "overlay"; id: string } | { kind: "pdf-text"; id: string } | null;
```

Expose setters that clear the other kind. Rename `PdfTextLayer`’s prop to `editingPdfTextId` to match the overlay state name. Do **not** merge into store selection ids; editing is ephemeral UI state and should stay out of undo snapshots.

### Touch points

| Area | Path |
| --- | --- |
| State | [`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) |
| Prop rename | [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) |
| Call sites | [`overlay-object.tsx`](../../components/editor/overlay-object.tsx), [`overlay-pdf-hit.ts`](../../components/editor/overlay-pdf-hit.ts) |

### Dependencies

None. Can be a tiny cleanup anytime; does not unlock (1)–(4).

---

## Priority recommendation

| Priority | Item | Why |
| --- | --- | --- |
| **1 — build next** | **Color picker** (store + inspector + dirty preview/export; default `#111827`) | Highest visible fidelity win; `ColorField` and export `color` path already exist; no op-list work required for v1. |
| **2 — next product feature** | **Drag-move** | Clear precedent from PDF image/vector gestures; mainly `originalX`/`originalY` + cover-at-original plumbing. |
| Later | Multi-run line clusters | Large UX/surface area; needs batched dirty covers. |
| Later | ttb | Niche; needs vertical box math + export rotate first. |
| Anytime / optional | editingId unify | Cleanup only; prefer discriminated union or prop rename, not a shared bare string. |

---

## Sources

- [`components/editor/editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) — dual editing state, double-click → PDF edit
- [`components/editor/overlay-pdf-hit.ts`](../../components/editor/overlay-pdf-hit.ts) — `beginPdfTextEditAtPoint` ttb gate
- [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) — inline input, dirty CSS, `#111827`
- [`components/editor/pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx) — family/size only
- [`components/editor/color-field.tsx`](../../components/editor/color-field.tsx), [`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx)
- [`components/editor/overlay-gestures.ts`](../../components/editor/overlay-gestures.ts), [`pdf-image-layer.tsx`](../../components/editor/pdf-image-layer.tsx) — drag precedent
- [`lib/editor/types.ts`](../../lib/editor/types.ts), [`object-utils.ts`](../../lib/editor/object-utils.ts), [`store.ts`](../../lib/editor/store.ts)
- [`lib/pdf/extract-text.ts`](../../lib/pdf/extract-text.ts), [`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts), [`session.ts`](../../lib/pdf/session.ts), [`export-pdf.ts`](../../lib/pdf/export-pdf.ts)
- PDF.js: `TextItem` / `TextStyle` / `OPS.showText*` in installed types; TextLayer vertical handling in `pdf.mjs` ~15226–15268
- Prior research: [pdf-text-inline-edit.md](./pdf-text-inline-edit.md), [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md), [pdf-text-font-weight.md](./pdf-text-font-weight.md)
