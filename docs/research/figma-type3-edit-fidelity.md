# Figma Type3 export — edit fidelity and QA bugs

Why editing a Figma-exported PDF (`__qa-roadmap.pdf`) gives Replacements in the wrong font, size and color, with Covers that erase artwork and the old text still searchable. Also covers the interaction bugs found in the same QA pass. For each one: the cause with file:line, the fix options, and a recommendation. This note does not change product code.

Related: [pdf-text-edit-fidelity.md](./pdf-text-edit-fidelity.md) (font reuse, cover geometry, cover color), [pdf-text-extract-colors.md](./pdf-text-extract-colors.md), [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md), [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md).

Installed: `pdfjs-dist@6.3.289` (line numbers below refer to `build/pdf.worker.mjs` and `build/pdf.mjs`), `pdf-lib@1.17.1`, `@pdf-lib/fontkit@1.1.1`. Terms follow [GLOSSARY.md](../../GLOSSARY.md): Run, Dirty run, Replacement, Original ink, Removal, Cover.

**Verified** means I checked it in source or ran it against the test file (probe scripts used pdf-lib and the pdf.js legacy build in Node). **Proposal** and **Hypothesis** are marked as such.

---

## How Figma builds the page (verified)

Every text node is drawn twice:

```
q 1 0 0 1 425 156.23 cm  /C1 cs 0.1 0.1 0.1 scn   <glyph outlines> f   Q     ← visible: filled vector path
q 1 0 0 1 425 156.23 cm  BT 14.2457 0 0 14.2457 0 -0.23 Tm /F1 1 Tf [ (…) 120.67 (…) … ] TJ ET Q   ← invisible Type3 text
```

- Every font is `/Type3`, `FontMatrix [1 0 0 1 0 0]`, `FontBBox [0 0 0 0]`, `Tf` size **1**. The real size sits in `Tm` (14.2457 / 8 / 18).
- **All 997 CharProcs contain only `d1`** (e.g. `/C0`: `0.596 0 0.029 -0.015 0.546 0.774 d1`). They paint nothing, so the TJ only serves search and copy. Under ISO 32000-1 §9.6.5 (Type 3 fonts; Table 113 `d0`/`d1`), a glyph procedure that paints nothing is legal.
- **One Type3 font holds several faces, and it allocates a new code for each glyph occurrence.** On page 1, `/F1` maps 62 Unicode characters to 243 codes. 38 characters have more than one code. `o` has 12 codes. Codes 0, 38 and 100 have the same width (0.585) and the same `d1` bbox. That is one glyph registered three times. Width clusters show at least three faces in one font: `n` 0.566 vs 0.555, `i` 0.23 vs 0.209, and a 0.65 set for digits and letters (probably monospace).
- Raw operator counts on page 4 match pdf.js exactly: `f` 43 + `n` 43 = 86 `constructPath`; 12 `TJ` = 12 `showText`. pdf.js converts the ICCBased `scn` fill into `setFillRGBColor` (`#1a1a1a`, `#737373` in the op list).
- **Because the outline is an ordinary top-level filled path, Paperoo already extracts it as an editable `PdfVectorObject`.** Its `sourceIndex` is that `constructPath` ([`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts) 784–866). This is the link that lets us treat the outline as the run's Original ink.

---

## 1. Findings

| ID | Symptom | Root cause | Sev |
| --- | --- | --- | --- |
| F6 | Replacement ~24–42% too big | `fontSize = \|item.height\|` ([`coordinates.ts`](../../lib/editor/coordinates.ts) 305, 327; [`extract-text.ts`](../../lib/pdf/extract-text.ts) 315–332). For Type3 fonts pdf.js multiplies the text-item height by the glyph-bbox height (worker 35870–35879). See §2c | High |
| F5 | Every run reads `#000000` | `extractPdfTextPaints` samples the fill state at `showText` ([`extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts) 280–318). The TJ sits in its own `q…Q` with no color set, so the default black is read (`defaultState` 166–173). The visible ink is the previous path's fill | High |
| F5b | Page 5 colors fail closed | 37 `showText` vs 42 paintable items. pdf.js splits one TJ into several items at wide gaps, so the count-based zip (`zipPdfTextItemPaints` 421–494) rejects the page | Med |
| F3 | Replacement in Liberation Sans, semibold → regular | Type3 is excluded twice: `embeddedFontUnavailable` ([`extract-text.ts`](../../lib/pdf/extract-text.ts) 284–285) and `matchBaseFont` ([`reuse-pdf-font.ts`](../../lib/pdf/reuse-pdf-font.ts) 400). Weight comes from the face name (`resolvePdfFontWeight` 197–208), and a Type3 face has none. Reuse would not help anyway: these CharProcs are empty, so reused codes would print nothing. `invertToUnicodeCMap` keeps the first code per character (line 27), which would also mix faces | High |
| F11 | Cover erases an arrowhead near "Evals" (p4) | Covers are measured in Liberation at the inflated size (`glyphInkRects` → `pdfTextCanvasFont`, [`object-utils.ts`](../../lib/editor/object-utils.ts) 1218–1240), plus 0.15 em left pad (868) and 1 pt bleed (1097). They are clipped only against other text runs (`measurePdfTextCoverRects` 1335–1385), not against vectors | High |
| F10 | Exported PDF finds both "Structuring Data" and "Structuring Info" | **Paperoo never does Removal, for any run.** Export only appends covers and new text (`drawDirtyPdfTextCovers` [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 339–364; comment at 340: "leaves the original operators"). `sourceOperatorIndices` is written ([`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts) 864) but nothing reads it. Dirty vectors are covered by repainting the same path in white (`drawDirtyPdfVector` 717–757). This is not Type3-specific. Any covered run stays searchable | Med (High for redaction-like intent) |
| F4 | Inline PDF-text edit lost on click-outside | `PdfTextEditor` commits only in `onBlur` ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) 182–189). Root `pointerdown` runs `selectPdfObjectAtPoint` + `clearInlineEditing` ([`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) 300–314), which unmounts the input during the same discrete event. Inference (not traced in the browser): focus would move on the later `mousedown` default action, but the input is already gone and React fires no blur for removed nodes | High |
| F7 | Overlay text can't be re-edited by double-click | Child `onDoubleClick` calls `setEditingId(id)` ([`overlay-object.tsx`](../../components/editor/overlay-object.tsx) 59–63) without `stopPropagation`. The root handler then calls `setEditingId(null)` ([`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) 226–236), and the last batched update wins | Med |
| F8 | First keystrokes after placing text are lost | `contentEditable={editing}` is never focused ([`object-view.tsx`](../../components/editor/objects/object-view.tsx) 27–31) | Med |
| F9 | Unused "Text" placeholders export | `createTextObject` seeds `content: "Text"` ([`object-utils.ts`](../../lib/editor/object-utils.ts) 1789). Nothing removes an untouched object | Low |
| F2 | Clicks select the page background; one Delete removes it | The white page rect (op 3, `0 0 792 612`) is an unclipped top-level fill, so it is extracted. Most other art is clipped, in forms or under unsafe ExtGState and is skipped (`extract-vectors.ts` 788–790). `hitTestPdfVector` `findLast` ([`object-utils.ts`](../../lib/editor/object-utils.ts) 1690–1700) then often finds only the background. Each click of a double-click runs `selectPdfObjectAtPoint`, so a text miss falls through to it | Med |
| F1 | Uncaught `Error: Invalid canvas size` from `beginSMaskMode` | Our race, not a pdf.js bug: see §3 F1 | Med |
| M1 | React nesting error | `<p>` wraps the `<Slider>` `<div>` ([`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx) 239–241) | Low |
| M2 | Size field shows `18.604825429999998` | Raw float bound to `<Input value>` ([`pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx) 127–139; [`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx) 129–141) | Low |
| M3 | Unlabelled controls | Font `Select` and size `Input` lack `aria-label` (`inspector-bar.tsx` 120–141; `pdf-text-inspector.tsx` 101–139). Thumbnails need a check | Low |

---

## 2. Core fidelity (F3 / F5 / F6 / F10 / F11)

### 2a. Treat the outline path as the run's Original ink

**Detection (proposal).** All four conditions must hold. A Run is an _outline-backed Type3 run_ when:

1. The face is `isType3` (already on `PdfFontFaceMeta`, [`extract-text.ts`](../../lib/pdf/extract-text.ts) 59–65).
2. The CharProcs the run uses are paint-free: each stream is only `d0`/`d1`. The main thread can't see CharProcs through pdf.js (`charProcOperatorList` stays in the worker, worker 37578), so check this with pdf-lib in the existing lazy probe ([`probe-pdf-font.ts`](../../lib/pdf/probe-pdf-font.ts), loaded on first edit by [`sample-pdf-text-cover.ts`](../../lib/pdf/sample-pdf-text-cover.ts) 81–88). Do not key on the `FigmaPDF` registry string: other exporters build the same pattern.
3. Op-list pairing in the walk that already exists: the run's `beginText` has a CTM equal to the CTM of the last filled `constructPath` in the immediately preceding sibling `save…restore` group, and no `showText` comes between them.
4. Geometry agrees: the path's `minMax` x-range ≈ `[0, item.width]` in that CTM, within ~1 em.

Pairing gives `inkVectorSourceIndex` → the `PdfVectorObject` with that `sourceIndex`. With that link:

| Use | How | Effort |
| --- | --- | --- |
| **Color (F5)** | Take the paired path's fill (already in `PdfVectorObject.fill`). Fixes all runs, including page 5, because pairing works by position, not by count | S |
| **Exact ink box (F11)** | Paired vector `x/y/width/height` from `pathMinMaxToDisplayedBox`, not Liberation measuring. No left pad: the ink is known | S |
| **Path-shaped Cover (F11)** | Mark the paired vector covered and reuse `drawDirtyPdfVector`'s path repaint ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 717–757) and its preview in `pdf-vector-layer.tsx`. Use the sampled `coverColor`, not white (`pdfVectorCoverPathStyle` is hard-coded `#ffffff`, [`object-utils.ts`](../../lib/editor/object-utils.ts) 720–735). Only the glyph shapes get painted, so neighbouring arrows survive. Add a hairline stroke of the same color to hide antialiasing fringes | S–M |
| **True Removal (F10 + F11)** | Drop the outline's paint op (`f` → `n`, which keeps the path but paints nothing; §8.5.3.1) and the TJ (blank its string) in the page `/Contents` | M–L |
| **Hit / selection** | Hide the paired vector from vector hit-testing and the vector layer, so the outline can't be selected and deleted on its own, leaving invisible text behind | S |

**Removal feasibility.** pdf-lib has no content-stream parser ([pdf-text-edit-fidelity.md §3](./pdf-text-edit-fidelity.md)), so we need a small tokenizer (ISO 32000-1 §7.8.2, Annex A). Two things make this file easier than the general case:

- On page 4 the counts line up one to one (verified above): the _n_-th raw paint op (`f`, `f*`, `S`, `B`, `n`, …) is the _n_-th `constructPath`, and the _n_-th `Tj`/`TJ`/`'`/`"` is the _n_-th `showText`. On page 1 there are 11 `Do`, and pdf.js inlines form content into the op list (`paintFormXObjectBegin`). The mapping therefore has to recurse into forms, or the rewrite must be limited to pages or segments with no form between the target and the stream start.
- The edit can be minimal and the same length in spirit: replace `f` with `n` and replace the TJ array with `[]`. Nothing has to be re-positioned, because each Figma text block sits in its own `q…Q` with an absolute `cm` and `Tm`.

Guard rails: verify each target token before editing it (the paint op follows a path whose bbox equals pdf.js `minMax`; the TJ decodes to the run's text through ToUnicode). If any check fails, use the path-shaped Cover. Copy-on-write when `/Contents` streams are shared between pages.

**Recommendation.** Ship detection + color + exact box + path-shaped Cover first. That fixes the visible damage. Then do Removal behind the verify-or-fall-back gate for top-level ops. It fixes F10 for every run type, and the GLOSSARY already treats it as the preferred path.

### 2b. Keeping the original font

| Option | What | Feasibility | Trade-offs |
| --- | --- | --- | --- |
| **(i) Rebuild a Type3 font from outlines** | Split the paired path into closed subpaths. Give each subpath to a glyph by its x-center against pen positions from widths, TJ adjustments and `Tm`. pdf.js `showText` args already carry per-glyph `width` and the TJ numbers (seen in the op list: `T 120.67 r 36.90 a …`). Each glyph's `d1` bbox (exact, from pdf-lib) bounds its slice. Key the inventory by (font ref, width, d1 bbox), not by code, because codes repeat per occurrence. Group faces with union-find over codes that appear in the same TJ, so `n` from a semibold heading never lands in body text. Emit a new `/Type3` dict with CharProcs `w 0 llx lly urx ury d1 <path> f`, `/Widths`, `/ToUnicode` (pdf-lib `context.obj` / `flateStream` / `register`, `node_modules/pdf-lib/cjs/core/PDFContext.js` 44, 110, 145–153) | Medium–High. Plain geometry, no font parsing. Risks: overlapping contours (the dot of `i` is fine; kerned overlaps like `Ty` need the center test); contextual glyphs (code 102 maps to `i` with width 0.593: likely a ligature such as `fi`, so skip codes whose width is out of range for their character) | Pixel-exact face and weight. **Covers only characters that appear somewhere on the page or document in the same face.** "Info" works only if `I`, `n`, `f`, `o` occur in that face |
| **(ii) Identify the face, embed a bundled OFL font** | Figma's default is Inter (OFL). Compare the Type3 width clusters with Inter Regular/SemiBold advances (`hmtx` / unitsPerEm) through fontkit. Embed via `embedFont(bytes, { subset: true })` (already used, [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 197–216, fontkit registered at 1018) | Low–Medium. **Not verified:** Inter is not in `public/fonts` (only Liberation) or `node_modules`, and I did not download it. The width match is a hypothesis to test | Any character works. Correct only if the face really is Inter. Adds bundle weight per weight shipped (lazy-load like Liberation). Kerning and tracking differ slightly from Figma's output |
| **(iii) Honest fallback** | Liberation at the true size (§2c) and the paired color, plus a weight guessed from the width cluster (heavier cluster → 600/700) | Trivial | Visibly different face. The inspector says why |

**Recommendation.** Use **(i)** when every character of the Replacement is in the run's face inventory. Otherwise use **(ii)** if the product owner accepts Inter as an approximation and the width test confirms Inter for that cluster. Otherwise use **(iii)**. Never mix sources inside one run (same rule as [pdf-text-edit-fidelity.md §1](./pdf-text-edit-fidelity.md)). Inspector copy should name the case: "Using the document's own glyphs" / "Approximated with Inter (Figma default)" / "Original glyphs missing for 'I'; using a substitute". The preview has no FontFace for Type3 (`pdf.mjs` 12064–12066), so (i) previews as an SVG/canvas path draw of the sliced glyphs. The same slices can feed `measurePdfTextGlyphInk`'s role.

Why not reuse the Type3 resource (today's reuse path): its glyphs are empty. Even ignoring that, it fails on the per-occurrence code allocation.

### 2c. True font size

**Cause (verified).** `getCurrentTextTransform` (worker 35870–35879):

```js
if (
  font.isType3Font &&
  (textState.fontSize <= 1 || font.isCharBBox) &&
  !isArrayEqual(textState.fontMatrix, FONT_IDENTITY_MATRIX)
) {
  const glyphHeight = font.bbox[3] - font.bbox[1];
  if (glyphHeight > 0) tsm[3] *= glyphHeight * textState.fontMatrix[3];
}
```

`FontBBox [0 0 0 0]` → `loadType3Data` collects the union of every `d1` bbox into `font.bbox` and sets `isCharBBox` (worker 37549–37602, `#removeType3ColorOperators` 37591–37602). `FONT_IDENTITY_MATRIX` is `[0.001,…]` (worker 32), so Figma's `[1 0 0 1 0 0]` passes the check. `Tf` = 1 passes too. The item height is then `hypot(trm[2], trm[3])` (35907). Measured unions: page 1 `/F1` y −0.240…1.066 → **1.306** (14.2457 × 1.306 = 18.605, 8 × 1.306 = 10.448, both matching the item transforms). Pages 2–4 and 6 → **1.240** (18 × 1.24 = 22.32 for "It's The Evals, Stupid"). Page 5 `/F1` → 1.418. Upstream added this on purpose for text-selection height ([pdf.js #15133](https://github.com/mozilla/pdf.js/pull/15133), issue [#14999](https://github.com/mozilla/pdf.js/issues/14999); `d0` variant [#19625](https://github.com/mozilla/pdf.js/pull/19625)). It is not a bug we can expect to be "fixed".

**The main thread can't undo it from font info.** The exported `bbox` is serialized as Int16 (`pdf.mjs` 8498–8499): the union `[-0.002,-0.24,0.78,1.066]` comes back as `[0,0,0,1]` (verified through `commonObjs`).

**Options:**

1. **From the op list (recommended):** in the same walk as 2a, record each `showText`'s `Tm` × `Tfs` × CTM (and `Tz`). Size = `Tfs × hypot(Tm·CTM column 2)`; that gives 14.2457 and 8.0. Exact, and it handles non-uniform `Tm`.
2. **Cheap fallback:** for `isType3` faces, `fontSize = hypot(transform[0], transform[1])` (the x column carries no inflation). Wrong only when `Tz ≠ 100` or `Tm` is non-uniform.
3. Pass a corrected `height` into `textItemToDisplayedBox` so `x/y/height` follow. For outline-backed runs, the vertical box should come from the paired path's ink box. Store `originalFontSize` from the corrected value. Fix `ascentRatio` as well: Type3 styles report `ascent: null` (verified), so `DEFAULT_ASCENT_RATIO` 0.8 applies. Prefer the d1-union `y1` (~1.0 here) parsed with pdf-lib, or the ink box.

---

## 3. Other bugs — fix approach

- **F4** ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx)): keep the latest draft in a ref and commit on unmount (cleanup) unless `discardRef` is set. Commit is idempotent (`next !== object.text`), so StrictMode double cleanup is harmless. Belt and braces: in the root `pointerdown` ([`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) ~300), call `(document.activeElement as HTMLElement | null)?.blur()` before changing selection. Same treatment for the overlay `contentEditable` (`object-view.tsx` 30).
- **F7**: `event.stopPropagation()` in `overlay-object.tsx` `onDoubleClick` (59) is not enough on its own. Verified in the browser: the first click starts a drag with pointer capture on the overlay root, so the real `dblclick` is retargeted to the root and never reaches the box. The root handler must hit-test overlay text boxes itself (`document.elementsFromPoint`, which respects rotation and z-order) before falling through to PDF text.
- **F8**: `useEffect` in `ObjectView` text case: when `editing` turns true, `focus()` and put the caret at the end (Selection/Range), as `PdfTextEditor` does (137–147).
- **F9**: create with `content: ""` and a CSS `:empty::before` placeholder. On commit, delete the object when the trimmed content is empty (no history entry). Export also skips empty text objects.
- **F2**: (a) Don't extract fills whose box covers ≥ ~95% of the crop box and whose color is page-white, or mark them `locked`. (b) Put vector hits behind text and image in hover too (already the order in `selectPdfObjectAtPoint`). (c) For "Delete", require the object to be selected through the vector inspector, or confirm when the area is ≥ 50% of the page. Product decision (Q2). Progressive hydration ([`session.ts`](../../lib/pdf/session.ts) 205–242): each page's text and vectors are built together (448–458), so a page is all-or-nothing. The early miss is more likely the inflated or misaligned text box than hydration order (hypothesis; not reproduced).
- **F1**: `beginSMaskMode` allocates a scratch canvas the size of the **target canvas** (`pdf.mjs` 11488–11497), and `BaseCanvasFactory.create` throws on ≤ 0 (9219–9222). [`PdfCanvas`](../../components/editor/pdf-canvas.tsx) cleanup runs `releaseCanvas` (width/height = 0, [`render-page.ts`](../../lib/pdf/render-page.ts) 64–67), but `taskRef.current` is set only _after_ the render resolves (`pdf-canvas.tsx` 44–51). The cleanup cancels the previous finished task, not the one in flight, and that render keeps running on a 0×0 canvas. On these pages (40 soft-mask groups) the next soft-mask op throws. The error rejects `draw()`, which is `void`ed (54), hence "uncaught". Fix: have `renderPdfPage` expose the task (callback or return the `RenderTask` before awaiting) so cleanup can `cancel()` it, and only then `releaseCanvas`, after the task settles. Catch and report errors in `draw()`. No upstream issue fits; the closest are [#8330](https://github.com/mozilla/pdf.js/issues/8330) and [#10778](https://github.com/mozilla/pdf.js/issues/10778) (caller-side zero sizes). **Black flash (hypothesis, unverified):** `sizeCanvas` resets the bitmap to transparent black before `beginDrawing` fills white (`pdf.mjs` 10973–10977). Render into an offscreen canvas and swap, or give the canvas a white CSS background.
- **M1**: change the `<p>` at `inspector-bar.tsx` 239 to `<div>` (or `<label>`). **M2**: show `Math.round(size * 100) / 100` and keep full precision in the store. **M3**: add `aria-label="Font family"` / `"Font size"` / `"Text color"` and a page label on each thumbnail button.
- Text runs can't be moved or deleted: by design ([v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md)). Not a bug.

---

## 4. Implementation plan

Each phase ships on its own. Tests use Vitest in `test/` with `test/pdfjs-node.ts`.

**Fixture (prerequisite).** `test/figma-type3-fixture.ts` builds a 1-page PDF with pdf-lib low-level APIs. It has a Type3 font (`FontMatrix [1 0 0 1 0 0]`, `FontBBox [0 0 0 0]`, d1-only CharProcs whose union height is 1.3, a ToUnicode mapping `n` to two codes with widths 0.566/0.555). It has two blocks: `q cm rg <outline> f Q q cm BT Tm /F1 1 Tf [..] TJ ET Q` with `#737373` and `#1a1a1a`. Add a page-sized white rect first and an "arrow" path 1 pt from a heading. About 1 KB, and it keeps the 800 KB QA file out of the repo.

| Phase | Scope | Tests |
| --- | --- | --- |
| **P0 — quick UX fixes** | F4, F7, F8, F9, F1, M1–M3 | F4: unmount without blur commits the draft; Escape still discards. F7: double-click on an overlay text keeps `editingId`. F9: an untouched placeholder is removed and not exported. F1: unmount mid-render cancels the in-flight task, with no rejection (`render-page.test.ts`) |
| **P1 — true size** | §2c op-list size (+ `hypot(t0,t1)` fallback for Type3), ascent fix | Fixture run reports `fontSize` 14.2457 not 18.6. Box height from ink. Non-Type3 runs unchanged (snapshot existing `extract-text.test.ts`) |
| **P2 — outline-backed runs** | §2a detection + pairing; color from the path; exact ink box; path-shaped Cover in `coverColor`; paired vector hidden from hit-testing; position-based paint zip (fixes F5b generally) | `extract-text-colors.test.ts`: fixture colors `#737373`/`#1a1a1a`. `export-pdf-text.test.ts`: after editing the heading, the arrow path's pixels/ops survive (no rect intersects it). The cover op is the path, not a rect |
| **P3 — Removal** | Content-stream tokenizer, verify-then-edit `f`→`n` and TJ→`[]` for top-level ops. Falls back to the P2 Cover | The exported fixture's `getTextContent` no longer contains the old string. A corrupt or mismatched target falls back to the cover and leaves the stream byte-identical. A form-XObject page is not rewritten |
| **P4 — font retention** | §2b (i) inventory + Type3 rebuild. Optional (ii) behind a flag after the Inter width check | Replacement made of inventory characters exports as a new Type3 whose glyph paths equal the source slices; weight cluster respected (`n` semibold vs regular). Missing character → whole run falls back, inspector message names it |
| **P5 — background vector guard** | F2 rule (Q2) | White full-page rect not selectable or deletable; art paths still are |

---

## 5. Decisions (product owner, 2026-10-16)

1. **Font target.** Rebuild the face from the document's own outlines (§2b (i)). The glyph inventory spans the whole document, matched by width and d1 box; glyphs from the run's own page win. If any character is missing, the whole run falls back and the inspector names the missing character. Never mix sources in one run.
2. **Preview.** Draw the rebuilt glyphs live while typing, so the preview matches the export.
3. **Fallback face.** Bundle Inter Regular and SemiBold (`.ttf` in `public/fonts/` with `OFL.txt`; add Liberation's licence file too), loaded only when needed. Use Inter only when the width check confirms it ("Approximated with Inter"); otherwise use Liberation at the true size, color and weight.
4. **Removal.** Remove old ink for every edited run in every PDF, top-level content first. Form-XObject content falls back to the Cover. When only a Cover was possible, show a badge on the run in the inspector and a toast on export.
5. **Background vectors.** A filled path covering ≥ 95% of the crop box, any color, unclipped and drawn before any text, is not selectable. Deleting any other vector covering > 50% of the page asks for confirmation. Also found in phase 0 QA: while the page background is selected, its drag wrapper covers the page and swallows every click until Escape.
6. **Glyph-outline vectors.** Owned by their text run: hidden from vector selection, changed only through text edits.
7. **Outline-only text** (page 2 callouts). Leave as vectors for now; OCR editing is a separate follow-up after the font work.
8. **Inline edits.** Clicking outside commits; Escape cancels.
9. **Delivery.** One `fix/` branch and PR per phase, in plan order, each waiting for the previous merge. Tests use the small generated fixture; each phase ends with a browser pass on the real QA PDF.

---

## Sources

- Repo: files and lines cited inline. Probe scripts (pdf-lib parse of CharProcs, ToUnicode, widths and raw operator counts; pdf.js legacy `getTextContent` / `getOperatorList` / `commonObjs`) were run against `public/ocr/__qa-roadmap.pdf` and not committed.
- pdf.js 6.3.289 worker: `FONT_IDENTITY_MATRIX` 32; text item transform/height 35870–35912; `handleSetFont` 34771–34780; `loadFont` Type3 branch 34985–34996; `translateFont` Type3 bbox default 37380; `loadType3Data` 37526–37589; `#removeType3ColorOperators` 37591–37640. Display: `FontInfo.bbox` Int16 8498–8499; canvas factory 9212–9245; `checkSMaskState` 11382–11391; `beginSMaskMode` 11488–11504; `beginDrawing` 10967–10992; render-task `_next` catch 17191.
- pdf.js upstream: [PR #15133](https://github.com/mozilla/pdf.js/pull/15133), [issue #14999](https://github.com/mozilla/pdf.js/issues/14999), [PR #19625](https://github.com/mozilla/pdf.js/pull/19625), [#8330](https://github.com/mozilla/pdf.js/issues/8330), [#10778](https://github.com/mozilla/pdf.js/issues/10778).
- pdf-lib 1.17.1: `cjs/core/PDFContext.js` 44, 110, 145–153; `cjs/core/structures/PDFPageLeaf.js` 30, 77, 105.
- [ISO 32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf): §7.8.2 content streams; §8.5.3.1 path painting (`n`); §9.3 text state (`Tf`, `Tz`); §9.4.2 text matrices; §9.4.3 text-showing operators (TJ adjustments in thousandths of text space); §9.6.5 Type 3 fonts (FontMatrix, FontBBox, CharProcs, Table 113 `d0`/`d1`); §9.10.3 ToUnicode.
- Inter: [rsms/inter](https://github.com/rsms/inter) (OFL-1.1). The metric comparison is not yet done.
