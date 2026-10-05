# V4 thin-stroke vector preview bug

Why a color-only edit on a thin existing PDF vector paints white until the user resizes, and where to pad the box so the SVG preview matches the covered stroke.

This note follows [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) and [v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md). It diagnoses the live editor path (cover + SVG preview). It does not implement the fix.

Research notes live under `docs/research/`.

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json))
- `pdf-lib@1.17.1` ([package.json](../../package.json))

Primary sources are Paperoo editor/PDF modules, the installed PDF.js worker/display builds, and the existing image cover-bleed pattern. Secondary write-ups are not used.

---

## Symptom

1. User selects an existing thin stroked PDF vector (typical: axis-aligned line).
2. User changes **stroke color** only (no move/resize).
3. Overlay shows a white strip; the new color is missing.
4. After **resize**, the correct stroke color appears.

Root suspicion (confirmed below): dirty state paints a white cover over the original PDF.js canvas paint, while the SVG preview is sized to a near-zero **path** bbox (geometry only, not stroke thickness), so the new stroke is invisible until resize grows the box.

---

## Dirty cover + preview pipeline

`isPdfVectorDirty` is true when stroke style differs from `originalStroke`, including color-only edits ([object-utils.ts](../../lib/editor/object-utils.ts) lines 113–121, `sameStroke` at 95–111).

When dirty (or transforming):

| Layer | Gate | Box used | Paint |
| --- | --- | --- | --- |
| White cover | `shouldPaintPdfVectorCover` (193–197) | `pdfVectorCoverBox(object)` → **original** box + `PDF_VECTOR_COVER_BLEED` (168–191) | `bg-white` div ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 201–208) |
| SVG preview | `shouldPaintPdfVectorPreview` (199–203) | `objectWrapperStyle(object, zoom)` → **current** `x,y,width,height` (218–228, 265) | `PdfVectorPreview` path with `stroke` / `strokeWidth` (138–168) |

Unmodified vectors draw neither cover nor preview; the PDF.js canvas remains the only paint ([v4 capabilities](./v4-pdf-vector-capabilities.md) “Unmodified: draw nothing”).

So a color-only dirty line **always** whites out the original and must re-show the stroke via SVG. If that SVG is effectively zero-height/width, the user sees only white.

---

## Exact root cause

### 1. PDF.js `pathMinMax` is path geometry only (no stroke)

Worker `buildPath` updates `pathMinMax` with `Util.pointBoundingBox` / `rectBoundingBox` / `bezierBoundingBox` only ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35012–35078). Those helpers min/max point coordinates ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) `Util.pointBoundingBox` ~652–656); they never add `lineWidth`.

On stroke/fill consume, the worker emits:

```text
OPS.constructPath, [paintFn, [Float32Array(pathBuffer)], pathMinMax.slice()]
```

([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35671–35684; also [v4 capabilities](./v4-pdf-vector-capabilities.md) “Critical fact: constructPath”).

Display-side `CanvasGraphics.constructPath` optionally expands a dependency bbox by `lineWidth / 2` for stroke ops ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) ~11839–11851: `outerExtraSize = op === OPS.stroke ? this.current.lineWidth / 2 : 0`). That inflation is **not** written back into the operator-list `minMax` that extractors read.

ISO / PDF stroking: stroke paint extends half the line width beyond the path (line width in user space). The constructPath `minMax` Paperoo consumes does **not** include that extent.

### 2. Extract stores that path-only box, floored by `VECTOR_MIN_AXIS`

`pathMinMaxToDisplayedBox` transforms the four `minMax` corners through the CTM and `userPointToDisplayed`, then takes the axis AABB ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 393–447). For a horizontal user-space segment, both endpoints share `y`; after rotate-0 display (`y: crop.y + crop.height - point.y`, [coordinates.ts](../../lib/editor/coordinates.ts) 194–198) height is **0**.

Floor:

```ts
const VECTOR_MIN_AXIS = 1e-4;
// ...
height: Math.max(height, VECTOR_MIN_AXIS),
width: Math.max(width, VECTOR_MIN_AXIS),
```

([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 92, 438–444). A horizontal line becomes `height ≈ 1e-4`; a vertical line `width ≈ 1e-4`. **Stroke width is never added.**

Stroke style is captured separately from graphics state (`setLineWidth` → `current.lineWidth`, then `stroke.width` on the object) ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 563–570, 702–708, 712–735), but it is not applied to `width` / `height` / `original*`.

The V4 capabilities note already called for this pad and it was not done: “inflate by half `lineWidth` for stroke-only hit boxes if needed” ([v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) line 405).

### 3. Dirty white cover hides the real stroke; SVG sits in a degenerate box

Cover: `pdfVectorCoverBox` outsets the **original** path box by `PDF_VECTOR_COVER_BLEED = 1` only ([object-utils.ts](../../lib/editor/object-utils.ts) 168–191), same idea as `PDF_IMAGE_COVER_BLEED` (152–166). For a horizontal line, cover height ≈ `1e-4 + 2`. That is enough to hide a ~2 pt canvas stroke centered on the path, so the PDF.js paint disappears.

Preview wrapper: `objectWrapperStyle(object, zoom)` sets CSS `width` / `height` from `object.width` / `object.height` with **no overflow** ([coordinates.ts](../../lib/editor/coordinates.ts) 474–484). For the thin line that is ~`1e-4 * zoom` CSS pixels.

`PdfVectorPreview` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 138–168):

- SVG `width` / `height` = `object.width * zoom` / `object.height * zoom` (same near-zero).
- `viewBox={`0 0 ${Math.max(object.width, 1e-3)} ${Math.max(object.height, 1e-3)}`}` — still ~0.001 on the thin axis (or the raw `1e-4` width/height when above the max floor on the long axis only).
- `strokeWidth={object.stroke?.width ?? 0}` in SVG user units (e.g. `2`).
- `className` includes `overflow-visible`, `absolute inset-0`.

With a near-zero CSS viewport, the viewBox → device scale collapses; the stroked path does not show as a usable colored line. `overflow-visible` cannot recover a zero-area viewport. Parent wrappers do not set `overflow: hidden`, but the SVG element itself is effectively empty.

`mapCommandPoint` places path points relative to `originalX/Y` and scales by `width/originalWidth` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 36–50). For a horizontal line the path sits on the thin axis of the box (≈ `y = 0` in local SVG space). Padding the stored box by half stroke (and shifting origin) is what centers the stroke inside a non-degenerate viewBox.

### 4. Why resize “fixes” it

Resize updates `width` / `height` (and often `x` / `y`) via gestures (`pdfVectorWithGestureBox`, [object-utils.ts](../../lib/editor/object-utils.ts) 205–215). The preview wrapper and SVG viewport become non-degenerate; the same `strokeWidth` and color suddenly render. Color was never wrong in the model—only the preview box was.

---

## Image cover bleed as the pattern to mirror

Images already outset covers for scan-conversion / AA fringes:

```ts
/** Outset for white covers so scan-conversion / AA fringes of the original Do do not show. */
export const PDF_IMAGE_COVER_BLEED = 1;
```

([object-utils.ts](../../lib/editor/object-utils.ts) 152–166; tests in [object-utils.test.ts](../../test/object-utils.test.ts) / [export-pdf-image.test.ts](../../test/export-pdf-image.test.ts)).

Vectors copied the **AA bleed only** (`PDF_VECTOR_COVER_BLEED = 1`, [object-utils.ts](../../lib/editor/object-utils.ts) 168–191) but images’ placement box already includes the full painted image rectangle. Vector placement boxes are path-only; bleed of `1` is not a substitute for half stroke width when stroke is thick, and it is not applied to the **preview** wrapper at all.

Export already uses the same cover helper: `drawDirtyPdfVector` white-rects `pdfVectorCoverBox(object)` then redraws with pdf-lib ([export-pdf.ts](../../lib/pdf/export-pdf.ts) 454–488). Export does **not** pad the path bbox by stroke either; `paintVectorOperators` uses `object.stroke.width` (scaled by resize average, 423–433). Export can still look acceptable for ~2 pt strokes because cover bleed ≈ half of width `2` and the redraw paints the stroke. Preview has no redraw of the canvas—only SVG—so the missing pad is fatal in the editor.

---

## SVG overflow / clipping

| Surface | Overflow | Effect |
| --- | --- | --- |
| `PdfVectorPreview` `<svg>` | `overflow-visible` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 154) | Stroke may paint outside the SVG box **only if** the SVG has a usable viewport |
| Preview / selection wrappers | `objectWrapperStyle` — no `overflow` ([coordinates.ts](../../lib/editor/coordinates.ts) 474–484) | Default visible; not the clip source |
| Viewport scroll | `editor-viewport` `overflow-auto` | Clips page chrome, not the thin-axis collapse |
| Overlay object text/images | some `overflow-hidden` in object views | Not used for PDF vector preview |

Conclusion: do not treat “add overflow-visible” as the fix. The box must include stroke extent (or an equivalent non-degenerate SVG viewport tied to stroke).

---

## Recommended fix (one approach)

**Pad the displayed object box at extract time by half the stroke width (for stroked paints), then keep the existing AA cover bleed.**

### Where

1. **`lib/pdf/extract-vectors.ts`** — after `pathMinMaxToDisplayedBox` returns and stroke style is known (around 689–735), if `stroke` is non-null:

   - `pad = stroke.width / 2` (user-space line width as already stored; same units as today’s `stroke.width`).
   - `x -= pad`, `y -= pad`, `width += 2 * pad`, `height += 2 * pad`.
   - Assign both current and `original*` from that padded box (as today copies `box.*` into both).

2. **Leave `pathMinMaxToDisplayedBox` itself path-only** so the helper stays a pure minMax→display transform; unit-test the pad as a named step (e.g. `outsetDisplayedBoxByStroke(box, strokeWidth)` next to extract) for clarity.

3. **Keep `PDF_VECTOR_COVER_BLEED`** on `pdfVectorCoverBox` for AA, mirroring images ([object-utils.ts](../../lib/editor/object-utils.ts) 168–191). Do not replace half-stroke pad with bleed alone.

4. **Preview / selection** keep using `object` / `objectWrapperStyle(object)` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx)). Once extract pads `width`/`height`, SVG viewBox and CSS size become non-degenerate without SVG-only hacks. Keep `overflow-visible` as a safety net for later stroke-width increases.

5. **Export** — no strategy change: still white `pdfVectorCoverBox` then redraw ([export-pdf.ts](../../lib/pdf/export-pdf.ts) 454–488). Padded `original*` makes the cover cover the full original stroke automatically; redraw path mapping stays consistent because `mapVectorPointToLocal` / extract commands share the same original box.

### How much

| Term | Role |
| --- | --- |
| `stroke.width / 2` | Geometry outset so box contains the stroked ink (match PDF.js display `outerExtraSize` idea, [pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) ~11851) |
| `PDF_VECTOR_COVER_BLEED` (`1`) | Extra AA / fringe outset on **cover only**, like `PDF_IMAGE_COVER_BLEED` |

Use **original / extract-time** stroke width for the stored `original*` box (what the canvas still shows until covered). Current `stroke.width` already equals that until the user edits width.

### Original vs current stroke width

- **Color-only dirty:** widths equal → extract pad is enough for cover and preview.
- **Stroke width increase later:** preview may extend past the box; `overflow-visible` helps. Optional follow-up: outset the preview wrapper by `max(0, (current.width - original.width) / 2)` or grow the box on width edits. Not required to fix the reported color bug.
- **Cover** must always cover the **original** canvas stroke → pad from `originalStroke.width` (embedded in padded `original*` if extract pads once).

### CTM caveat

`lineWidth` is user-space; under non-uniform CTM, displayed stroke thickness is not exactly `lineWidth` ([v4 capabilities](./v4-pdf-vector-capabilities.md) risk “Stroke width under CTM”). Extract already stores raw `current.lineWidth` without CTM scale ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 707). Padding by that value matches today’s stroke field and identity/typical pages; a later CTM-aware scale can refine pad and `stroke.width` together—out of scope for this bug.

### Impact

| Area | Effect |
| --- | --- |
| Hit-testing | Already distance-based with `vectorStrokeHitThreshold` ([object-utils.ts](../../lib/editor/object-utils.ts) 331–332, 335–437); little change. Rect fill hit via `pointInRotatedRect` grows slightly for stroked rects—acceptable. |
| Selection handles | Larger box matching visible stroke—desired. |
| Hover outline | Uses `objectWrapperStyle(object)` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 315–323)—matches stroke. |
| Export | Slightly larger white cover (more underlay damage on busy backgrounds—same class of limit as V2/V3). Redraw unchanged. |
| Fill-only vectors | `stroke === null` → no half-width pad; path/fill bbox unchanged. |

### Alternatives considered (not recommended as primary)

| Approach | Why secondary |
| --- | --- |
| SVG-only larger viewBox / fixed min CSS height | Easy to desync from covers, handles, and export; fragile with `mapCommandPoint` origin |
| Pad only in `pdfVectorCoverBox` / preview helpers without changing `original*` | Cover improves; SVG mapping still treats path at the unpadded origin unless viewBox/local coords are dual-tracked |
| Inflate cover bleed to a large constant | Does not fix preview viewport; over-whites thick strokes unevenly |

---

## What NOT to change

- Do **not** invent `kind: "circle"` or new vector kinds ([v4 capabilities](./v4-pdf-vector-capabilities.md) classification; [v4 prompt](../../v4-existing-vector-graphics-editing.md)).
- Do **not** change export masking strategy broadly: keep white rectangle cover-then-redraw; do not switch to clip/erase operators or content-stream rewrite.
- Do **not** replace extract with `render({ recordOperations })` / `recordedBBoxes` ([v4 capabilities](./v4-pdf-vector-capabilities.md)).
- Do **not** remove `VECTOR_MIN_AXIS` for empty/degenerate path rejection; use it as a floor **before** or **with** stroke pad, not instead of pad.
- Do **not** rely on SVG `overflow-visible` alone as the product fix.
- Do **not** change image cover bleed semantics or PDF text/image dirty pipelines.

---

## Minimal tests to add

1. **`test/extract-vectors.test.ts`** — fixture or synthetic `constructPath` for a horizontal stroked line (`pathMinMax` with equal y): expect `height >= stroke.width` (and `y` shifted by half width). Mirror for a vertical line (`width >= stroke.width`).
2. **Same file or small unit** — fill-only path: box stays path AABB (no stroke pad).
3. **`test/object-utils.test.ts` or export vector test** — `pdfVectorCoverBox` still outsets padded `original*` by `PDF_VECTOR_COVER_BLEED * 2` (parallel to image cover tests).
4. Optional regression: color-dirty object with `height === stroke.width` (padded) and `width` ≫ height still has `shouldPaintPdfVectorPreview === true` and non-degenerate dimensions (store/helpers only; no DOM snapshot required).

Existing [export-pdf-vector.test.ts](../../test/export-pdf-vector.test.ts) hand-builds `height: 2` for a width-2 stroke—closer to the desired padded world than real extract’s `1e-4`. After the fix, real extract should align with that fixture shape.

---

## Claim → source index

| Claim | Source |
| --- | --- |
| Dirty includes stroke color change | [object-utils.ts](../../lib/editor/object-utils.ts) 113–121, 95–111 |
| Cover uses original + bleed; preview uses current object box | [object-utils.ts](../../lib/editor/object-utils.ts) 168–203; [pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 201–228 |
| SVG sizes to object box; strokeWidth from style | [pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 149–166 |
| `pathMinMax` from points only | [pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) 35012–35078, 35671–35684 |
| Display tracker pads half lineWidth; list minMax does not | [pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) ~11839–11851 |
| Extract floors thin axis to `1e-4`, no stroke pad | [extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 92, 393–447, 689–735 |
| Image bleed pattern | [object-utils.ts](../../lib/editor/object-utils.ts) 152–166 |
| Export cover-then-redraw, no stroke pad on box | [export-pdf.ts](../../lib/pdf/export-pdf.ts) 454–488, 418–451 |
| Prior research asked for half-lineWidth inflate | [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) line 405 |
| `objectWrapperStyle` has no overflow clip | [coordinates.ts](../../lib/editor/coordinates.ts) 474–484 |

---

## Bottom line

**Root cause:** extract stores PDF.js path-only `minMax` (≈ zero on one axis for thin lines); dirty UI whites out the canvas and draws an SVG preview in that degenerate box, so the new stroke is invisible until resize enlarges the box.

**Fix:** outset the displayed box by **half stroke width** when creating `PdfVectorObject` in `extract-vectors.ts`, keep `PDF_VECTOR_COVER_BLEED` on covers, leave export mask strategy as-is.
