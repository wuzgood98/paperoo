# V4 complex vector transform bug

Why resizing (or moving) one object in a dense overlapping PDF vector cluster (e.g. `vector-test.pdf` spirograph / circular mesh, stroke width 0.5) makes the colorful mesh vanish from the main canvas while a thin circle remains inside the selection box, and why the page thumbnail still shows the full artwork.

This note follows [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md), [v4-thin-stroke-vector-preview.md](./v4-thin-stroke-vector-preview.md), and [v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md). It diagnoses the live editor transform path (cover + SVG preview + gestures). It does not implement the fix.

Research notes live under `docs/research/`.

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json))
- `pdf-lib@1.17.1` ([package.json](../../package.json))

Primary sources are Paperoo editor/PDF modules, the installed PDF.js worker/display builds, pdf-lib usage in export, and prior research notes that cite those sources. Secondary blog write-ups are not used.

---

## Symptom

1. **BEFORE** move/resize: user selects a region that visually contains a dense multi-colored (blue→red) circular mesh of intersecting thin lines; inspector shows Stroke navy, Width `0.5`; selection handles enclose the mesh (and concentric circles near the center).
2. **AFTER** resize: the colorful mesh disappears from the main canvas; only a thin single circle outline remains inside the selection box; handles still work.
3. **Thumbnail** for page 1 still shows the original colorful mesh.

Root suspicion (confirmed below): dirty/transform state paints an **axis-aligned white rectangle** over the selected object’s **original path bbox**, which blanks every sibling `constructPath` still painted by the PDF.js page canvas under that rectangle. The SVG preview redraws **only the selected object’s commands** (a circle), so the mesh never comes back on the overlay. The thumbnail never mounts the vector overlay, so it keeps showing the untouched PDF.js render.

---

## Pipeline under investigation

| Stage | What happens |
| --- | --- |
| Extract | One `OPS.constructPath` paint → one `PdfVectorObject` ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 654–736; [v4 capabilities](./v4-pdf-vector-capabilities.md) line 408) |
| Unmodified UI | No cover, no preview; PDF.js canvas is the only paint ([v4 capabilities](./v4-pdf-vector-capabilities.md) “Unmodified: draw nothing”) |
| Select | `hitTestPdfVector` walks objects top-most first (`toReversed`) ([object-utils.ts](../../lib/editor/object-utils.ts) 466–478) |
| Gesture start | `transformingId` set; `shouldPaintPdfVectorCover` / `Preview` become true ([object-utils.ts](../../lib/editor/object-utils.ts) 220–230) |
| During gesture | `writeNodeBox` updates **only** the selection DOM node ([overlay-gestures.ts](../../components/editor/overlay-gestures.ts) 120–136, 204–231); cover + preview read **store** geometry ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 213–239) |
| Commit | `finishGesture` → `commitPdfVector(pdfVectorWithGestureBox(...))` ([overlay-gestures.ts](../../components/editor/overlay-gestures.ts) 181–188; [object-utils.ts](../../lib/editor/object-utils.ts) 232–242; [store.ts](../../lib/editor/store.ts) 267–284) |
| Dirty | `isPdfVectorDirty` true when current box ≠ `original*` ([object-utils.ts](../../lib/editor/object-utils.ts) 113–121) |

---

## Exact root cause

### 1. Extract does **not** merge the mesh into one object

Each real paint via `constructPath` pushes a separate object with that op’s `commands`, `minMax` box, and stroke/fill from graphics state ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 654–736). Explicit rule: “Do not emit one object per DrawOPS command. One `constructPath` paint → one editor object.” ([v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) line 408).

A blue→red gradient mesh cannot be one stroked object with a single `stroke.color`. Frame 1’s colorful ink is therefore **many sibling objects** still on the PDF.js canvas. The inspector’s single navy `0.5` stroke is the **selected** object’s style only.

PDF.js emits one operator-list entry per consume:

```text
OPS.constructPath, [paintFn, [Float32Array(pathBuffer)], pathMinMax.slice()]
```

([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35671–35684).

### 2. Dirty / transforming paints an AABB white cover over the **original** box

```ts
shouldPaintPdfVectorCover → object.deleted || isPdfVectorDirty(...) || id === transformingId
pdfVectorCoverBox → expandRect(original*, PDF_VECTOR_COVER_BLEED + strokePad)
```

([object-utils.ts](../../lib/editor/object-utils.ts) 168–208, 220–224; layer [pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 214–219: `bg-white` div).

As soon as a resize starts (`transformingId`) or geometry commits (`isPdfVectorDirty`), that white rectangle hides **everything the PDF.js canvas painted under that AABB**—including sibling mesh strokes that were never selected and are not part of the dirty object’s `commands`.

This was already flagged as a known risk: “Overlapping graphics … white cover hides everything under the bbox” ([v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) line 437). The V4 product spec also warns: “be careful with covering vectors using a solid rectangle” / “A simple white mask is therefore not always safe” ([v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md) lines 562–575).

Export uses the same AABB strategy: `drawDirtyPdfVector` white-`drawRectangle`s `pdfVectorCoverBox` then redraws **only that object** ([export-pdf.ts](../../lib/pdf/export-pdf.ts) 454–488). The live bug and the export damage are the same mechanism.

### 3. SVG preview only redraws **this** object’s commands

`shouldPaintPdfVectorPreview` gates a `PdfVectorPreview` that builds one SVG `path` from `object.commands` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 56–121, 147–180, 222–239). Sibling mesh constructPaths are never included.

Frame 2 (thin circle tangent to a square selection box) matches a **stroked circular path** whose displayed AABB is the selection square. After cover blanks the mesh under that square, the overlay correctly shows “only what this object owns”: the circle.

### 4. Why the thumbnail still shows the mesh

Page thumbnails call `renderPdfPage` on a canvas only—no `PdfVectorLayer`, no white covers ([page-thumbnail.tsx](../../components/editor/page-thumbnail.tsx) 52–60). Dirty editor state does not mutate the source PDF bytes until export. Thumbnail = pristine PDF.js paint of all constructPaths.

### 5. Hit-test makes “select the enclosing circle” easy when clicking the mesh

For non-`line` kinds, after coarse stroke/segment tests fail, hit-test falls back to **full rotated AABB**:

```ts
if (object.kind === "line") {
  return false;
}
return pointInRotatedRect(point, object);
```

([object-utils.ts](../../lib/editor/object-utils.ts) 460–463). Circles/ellipses from Béziers classify as `path` (no `kind: "circle"`) ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 344–390; [v4 capabilities](./v4-pdf-vector-capabilities.md) lines 414–415).

So a click on colorful mesh ink often selects a **large enclosing path** (outer circle) whose bbox covers the whole mesh, not the thin mesh stroke under the cursor—especially when curve hit approximation misses. Spec already required distance / point-in-path accuracy and warned against large boxes around thin geometry ([v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md) lines 655–657; [v4 capabilities](./v4-pdf-vector-capabilities.md) line 421).

This is a **selection amplifier**, not the cover mechanism itself: once that circle is dirty, the AABB cover still blanks siblings.

### 6. Live gesture: selection node moves; cover/preview stay on store (secondary)

`writeNodeBox` only styles `nodeRefs.get(object.id)`—the **selected** wrapper with handles ([overlay-gestures.ts](../../components/editor/overlay-gestures.ts) 120–136). Vector cover and preview are **separate** absolute divs keyed from store `objects` ([pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 213–239). Preview is **not** nested inside the selected node.

Contrast images: dirty preview for the selected image is rendered **inside** the selected wrapper, so `writeNodeBox` moves the bitmap with the handles ([pdf-image-layer.tsx](../../components/editor/pdf-image-layer.tsx) 122–155).

During a vector resize, handles move live while cover stays on `original*` and preview stays on last committed store box until `finishGesture` / `commitPdfVector`. That causes mid-gesture desync; it does **not** by itself explain Frame 2’s permanent “mesh gone, circle only” after commit—sibling AABB cover does.

### 7. Ruled out as the primary cause of Frame 2

| Candidate | Why not primary here |
| --- | --- |
| Thin-stroke pad / hairline clipping | Pad helpers (`pdfVectorStrokePad`, `pdfVectorPreviewBox`) enlarge cover/preview wrappers ([object-utils.ts](../../lib/editor/object-utils.ts) 170–218; [v4-thin-stroke-vector-preview.md](./v4-thin-stroke-vector-preview.md)). They do not drop sibling paths. Symptom is whole mesh missing, not a hairline stroke clipped. |
| Extract merging many ops into one object | Opposite: one constructPath → one object ([extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 711–736). |
| Export/redraw mapping alone | Symptom is live canvas + overlay; export uses the same AABB cover pattern but is not required to reproduce Frame 2. |
| SVG incomplete vs a single merged mesh object | Selected object’s SVG is complete for **its** commands; incompleteness is relative to **sibling** canvas paint under the cover. |

---

## Causal chain (matches screenshots)

```text
Many constructPath paints (mesh + circles) on PDF.js canvas
        ↓
User selects one path (often large circle via AABB hit fallback)
        ↓
Resize → transformingId / dirty
        ↓
White AABB cover over that object's original* box
        ↓
Canvas mesh siblings under that box are hidden
        ↓
SVG preview draws only selected commands → thin circle
        ↓
Thumbnail (no overlay) still shows full mesh
```

---

## Recommended fix (one approach)

**Replace the rectangular white cover with a path-shaped white cover that paints only this object’s original ink (stroke and/or fill matching `originalStroke` / `originalFill` / `paint`), then keep the existing SVG (editor) / pdf-lib (export) redraw of the dirty object.**

### Where

1. **Editor** — [pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) cover pass (214–219): stop using a `bg-white` div sized to `pdfVectorCoverBox`. Instead render a white `PdfVectorPreview`-style SVG at **original** geometry (`originalX/Y/width/height`, `originalRotation`, `commands` mapped with scale 1 relative to `original*`), using white stroke/fill and stroke width ≥ `originalStroke.width` plus a small AA pad (reuse `PDF_VECTOR_COVER_BLEED` / `pdfVectorStrokePad` as extra half-width, not as an AABB for siblings).

2. **Export** — [export-pdf.ts](../../lib/pdf/export-pdf.ts) `drawDirtyPdfVector` (454–488): replace `page.drawRectangle` white AABB with white path operators for the **original** box/commands/styles (same idea as `vectorPathOperators` + white paint), then redraw the current object as today.

3. **Keep** one-object-per-`constructPath`, dirty flags, and SVG preview of the dirty object. Do **not** merge the spirograph into a compound object for this bug.

4. **Optional follow-up (same PR only if cheap):** nest the dirty vector preview inside the selected node like images ([pdf-image-layer.tsx](../../components/editor/pdf-image-layer.tsx) 153–155) so `writeNodeBox` moves preview live. Not required to restore the mesh.

5. **Optional follow-up (separate):** tighten `hitTestPdfVector` so stroked `path` kinds do not fall back to full AABB ([object-utils.ts](../../lib/editor/object-utils.ts) 460–463)—reduces mis-selecting the outer circle when aiming at mesh strokes. Does not fix cover damage if the user intentionally transforms an overlapping circle.

### Why this fix (not alternatives)

| Approach | Why not primary |
| --- | --- |
| Redraw all intersecting siblings over the AABB cover | Works visually but still destroys underlays at export unless every intersected clean sibling is also rewritten; O(n²) intersection and z-order replay; larger than the bug. |
| Compound/group all overlapping constructPaths | Spec and capabilities say one paint → one object; grouping is a product feature, not a cover fix. |
| Drop cover and only draw SVG on top | Leaves original canvas ink visible under transforms (double paint / wrong position). |
| Inflate stroke pad further | Does not restore siblings blanked by AABB. |

Path-shaped cover matches the V4 mandate to use the “least destructive masking/replacement strategy possible” ([v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md) lines 562–575) while staying inside cover-then-redraw (pdf-lib still cannot delete original ops).

### Impact

| Area | Effect |
| --- | --- |
| Dense overlapping strokes | Transforming one circle no longer whites out the mesh under its bbox |
| Filled shapes | White fill of the path still covers that fill’s ink (acceptable; same ownership) |
| Thin strokes | Slightly thicker white stroke for AA—same class as bleed today |
| Busy / non-white backgrounds | Still imperfect where original ink had transparency or sat on photos (document; same class as V2/V3) |
| Hit-test | Unchanged unless optional follow-up lands |

---

## What NOT to change

- Do **not** invent `kind: "circle"` or merge constructPaths into compounds for this bug ([v4 capabilities](./v4-pdf-vector-capabilities.md) classification).
- Do **not** switch to full-page raster preview or content-stream rewrite.
- Do **not** remove `PDF_VECTOR_COVER_BLEED` / stroke pad for thin-line preview; those fix a different bug ([v4-thin-stroke-vector-preview.md](./v4-thin-stroke-vector-preview.md)). Apply pad to **path-shaped** cover stroke extent, not as a substitute for path-shaped masking.
- Do **not** change image cover (images own their full painted rectangle; AABB is appropriate there).

---

## Minimal tests to add

1. **Unit / layer helper** — given two overlapping stroked vectors (large circle AABB contains a chord of a second path), `shouldPaintPdfVectorCover` for the circle must not imply a rectangle that is the only way to hide the circle: assert the cover painter uses path geometry (or a pure helper `pdfVectorCoverPathStyle(object)` returns white stroke of original width + pad, not only `pdfVectorCoverBox` for painting).
2. **`test/export-pdf-vector.test.ts`** — dirty circle overlapping another path: exported page operators include white path cover (or equivalent) rather than only a cover rectangle the size of `pdfVectorCoverBox` when asserting draw sequence; or snapshot that sibling path ink is redrawn / not permanently blanked if the test harness can inspect ops.
3. **Regression** — existing thin-stroke / `pdfVectorStrokePad` tests ([object-utils.test.ts](../../test/object-utils.test.ts)) still pass; path cover still outsets stroke for AA.

---

## Claim → source index

| Claim | Source |
| --- | --- |
| One constructPath → one editor object | [extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 654–736; [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) line 408 |
| Dirty / transforming triggers cover + preview | [object-utils.ts](../../lib/editor/object-utils.ts) 113–121, 220–230 |
| Cover is white AABB on original* + bleed/pad | [object-utils.ts](../../lib/editor/object-utils.ts) 168–208; [pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 214–219 |
| Preview SVG uses only `object.commands` | [pdf-vector-layer.tsx](../../components/editor/pdf-vector-layer.tsx) 56–180, 222–239 |
| `writeNodeBox` only updates selection node | [overlay-gestures.ts](../../components/editor/overlay-gestures.ts) 120–136, 204–231 |
| Commit merges gesture box into store vector | [overlay-gestures.ts](../../components/editor/overlay-gestures.ts) 181–188; [store.ts](../../lib/editor/store.ts) 267–284 |
| Path hit-test falls back to full AABB | [object-utils.ts](../../lib/editor/object-utils.ts) 460–463 |
| Bézier circles stay `kind: "path"` | [extract-vectors.ts](../../lib/pdf/extract-vectors.ts) 344–390 |
| Thumbnail = PDF.js only, no vector overlay | [page-thumbnail.tsx](../../components/editor/page-thumbnail.tsx) 52–60 |
| Export AABB white rect then redraw one object | [export-pdf.ts](../../lib/pdf/export-pdf.ts) 454–488 |
| Overlap / solid-rect cover risk documented | [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md) line 437; [v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md) 562–575 |
| Images nest preview in selected node (contrast) | [pdf-image-layer.tsx](../../components/editor/pdf-image-layer.tsx) 122–155 |
| PDF.js constructPath emit | [pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) 35671–35684 |

---

## Bottom line

**Root cause:** transforming one extracted vector whites out its **original axis-aligned bbox**, which hides sibling constructPath paints still on the PDF.js canvas; the overlay SVG only redraws the selected object’s path (here a circle), so the dense mesh disappears on the main canvas while the thumbnail (no overlay) stays correct.

**Fix:** cover with a **white path** matching the object’s original stroke/fill (editor + export), not a white rectangle over the bbox; then redraw the dirty object as today.
