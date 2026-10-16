# Figma outline-only text — OCR to make it editable

Why the callout labels on page 2 of the Figma QA file ("Launched first version, sucked", "Tried a new model, got worse!", …) can't be selected or edited, and how to make them editable with the existing OCR engine plus the Figma glyph rebuild. Covers detection, recognition, face matching, Removal/Cover of the old outline, opacity, and searchability. This note does not change product code.

Follows decision 7 in [figma-type3-edit-fidelity.md](./figma-type3-edit-fidelity.md) ("Outline-only text … OCR editing is a separate follow-up"). Related: [v7-ocr-scanned-pdf.md](./v7-ocr-scanned-pdf.md), [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md).

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`, `tesseract.js@7.0.0` (local worker, core and `eng.traineddata.gz` under `public/ocr/`). Terms follow [GLOSSARY.md](../../GLOSSARY.md): Run, Dirty run, Replacement, Original ink, Removal, Cover.

**Verified** means I ran it against `ai-engineer-roadmap_qeny18.pdf` (pdf.js legacy build in Node through Vitest; Tesseract in the browser pane against the dev server). Probe scripts were not committed. **Proposal** and **Hypothesis** are marked as such.

---

## How the labels are drawn (verified)

Page 2, op list from `getOperatorList()`:

```
95  save
96  setGState [["ca", 0.8]]                   ← fill opacity 80 %
97  transform [1 0 0 1 101.05 285.04]
98  setFillRGBColor #1a1a1a
99  constructPath fill  (1831 numbers)        ← "Launched first / version, sucked", both lines, one path
101 restore
```

- **There is no Type3 text for these labels at all.** Page 2 has 4 `showText` ops (title, subtitle, handle, URL), each paired with its outline (`textInk`). The 8 callouts and the 2 zone captions are only filled paths.
- **Every outline-only label in the file sets `ca` < 1** (0.6, 0.8, 0.89, 0.9). Every label at full opacity has its Type3 search layer. _Hypothesis:_ Figma drops the text layer for text whose layer opacity is below 100 %. Not proven beyond this file, so detection must not depend on it.
- **One path per text node, all lines together.** A two-line callout is a single `constructPath`; lines are separated only by geometry.
- **They are not even vectors in Paperoo today.** `applyGState` marks any `ca` < 1 as unsafe ([`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts) 609–614), and unsafe paths are skipped (880). So page 2 yields 20 `PdfVectorObject`s out of 74 `constructPath`s, and the labels can't be clicked, selected or deleted.
- The paths are top-level page content (not in a form, not clipped), except one code block on page 1 drawn inside a form XObject.

### Inventory across the QA file (verified)

Outline paths that OCR reads with ≥ 80 % confidence and ≥ 2 letters, minus those already paired with Type3 text:

| Page | Labels | `ca` |
| --- | --- | --- |
| 1 | Contract, Proposal, Presentation, Email, Invoice, Memo (document tags); a 5-line JSON code block (inside a form XObject) | 0.6, 0.7 |
| 2 | 8 callouts (2 lines each except the zone captions "The Vibes-Only Trough", "The Eval Slope") | 0.8–0.9 |
| 3 | "Time" (axis label) | 0.9 |
| 4 | Improves, Fed back into, Helps increase, Captured as, Increases, Benchmark using ×2 | 0.89 |
| 5, 6 | none | — |

About 23 labels on 4 of 6 pages. All are set in Inter, the same face as the document's Type3-backed runs.

---

## OCR on the isolated outline (verified)

The existing OCR path renders the whole page and recognizes it ([`lib/ocr/render-page.ts`](../../lib/ocr/render-page.ts)). For outlines we already have the exact vector, so the probe instead filled **only that path**, black on white, at 4× (≈ 288 DPI) with 4 pt padding, and ran Tesseract with `PSM.SINGLE_BLOCK` (6).

| Label | Read | Conf | Time |
| --- | --- | --- | --- |
| p2 "Launched first / version, sucked" | `Launched first` / `version, sucked` | 95 | 94 ms |
| p2 "Tried a new model, / got worse!" | exact | 95 | 102 ms |
| p2 "Added up/down votes, / listened to feedback" | exact | 96 | 147 ms |
| p2 "Added evals! Wow, should / have done that sooner" | exact | 94 | 160 ms |
| p2 "New model came out, / tested it with evals!" | exact | 92 | 167 ms |
| p1 tags, p4 labels | exact | 95–96 | < 100 ms |
| p1 JSON block | `cost: 140.20 / currency: GBP / status: "in transit" / tracking_number: "1Z99…" / }` | 79–96 per line | — |

Times are after the worker is warm; first use also loads the ~3 MB traineddata and the wasm core.

Why this beats page OCR: no background art, no neighbouring arrows, perfect contrast, and the box is known before recognition, so there is nothing to map back from a page bitmap.

**Errors seen.** `AI` read as `Al` (Inter's capital I and lowercase l are both plain bars), and `www.aihero.dev` as `ww.aihero.dev` at 48 % conf (tiny type). Both are the kind of error the glyph match below corrects or rejects.

**False positives.** Icons and arrows OCR as `>`, `©)`, `CC)`, `oo`, `BB`, mostly below 70 % conf. Rule that removed every one on this file: confidence ≥ 80 and at least two letters (`\p{L}`). `DB` inside a database icon passes (96 %), but it is real lettering.

---

## Design

### 1. Detection (proposal)

Two stages, so OCR only runs on likely text:

1. **Geometric candidate, at load.** In `extractPdfVectorObjects`, a top-level filled path whose only "unsafe" reason is `ca`/`CA` < 1 is still extracted, carrying `fillOpacity` (no longer skipped). Then it is a candidate when: single solid fill, not `textInk`, not `pageBackground`, ≥ 4 closed subpaths, and its subpaths fall into one or more rows of similar height (glyph rows). Opaque paths qualify too: the opacity is a Figma quirk, not the test. Paths in forms or under clips stay skipped in v1 (§4 explains Cover-only for them).
2. **OCR confirmation.** Rasterize the path alone, recognize, keep it when conf ≥ 80, ≥ 2 letters, and the glyph check in §3 agrees. Otherwise it stays a plain vector.

Candidates do not change selection until confirmed: before OCR the path behaves as a vector (selectable once it is extracted, which itself is new for translucent paths).

### 2. Recognition (proposal)

Reuse `createTesseractEngine` / `createOcrService` ([`lib/ocr/service.ts`](../../lib/ocr/service.ts)) unchanged. New input: `renderOutlineForOcr(commands, box)` that fills a `Path2D` on an `OffscreenCanvas`, as in the probe. New PSM per call (`SINGLE_BLOCK`), since the scanned-page flow sets `AUTO`. The OCR controller today only accepts pages classified `scanned` ([`controller.ts`](../../lib/ocr/controller.ts) 135); outline jobs need their own queue entry type (`{ kind: "outline", vectorId }`) that skips the classifier. Results stay off `EditorDocument` like scanned OCR, so undo never drops them.

Line boxes come back from Tesseract in pixels; map with the same `bbox / scale + offset` arithmetic as `ocrImageBoxToDisplayed`.

### 3. Glyph slicing and face match — reuse the Figma rebuild (proposal)

The Type3 slicer ([`type3-glyphs.ts`](../../lib/pdf/type3-glyphs.ts) 394) needs pen positions from TJ, which these labels lack. Instead:

1. **Split the path into subpaths** (same `moveTo` split the slicer uses), assign each to an OCR line by vertical center.
2. **Cluster each line into glyphs** by horizontal overlap (the dot of `i` overlaps its stem; `"` and `%` need a small gap tolerance). Accept only when cluster count equals the line's non-space character count; that pairs each cluster with a character.
3. **Match a document face.** For each `GlyphFace` built from the document's Type3 runs ([`glyph-face.ts`](../../lib/pdf/glyph-face.ts)), compare each label glyph's ink box with the face glyph's `box` for the same character. Same face ⇒ the ratios (label ink / face em box) agree, and that ratio is the font size. Accept when the median ratio's spread is small (≤ ~3 %) over ≥ 4 characters, and the outlines coincide after scaling (sample points, max distance ≤ ~2 % em).
4. **Correct OCR from shape.** For ambiguous characters (`I`/`l`/`1`, `O`/`0`), pick the face glyph whose scaled outline matches. This fixes `Al` → `AI`.

With a matched face, the label becomes a run that uses everything already shipped: `rebuiltGlyphLayout` / `pushRebuiltType3Text` when the face has every character, else `figmaFallbackFor` (Inter when widths prove it, else Liberation). Pen positions within the label come from the matched face's advances and learned pairs; check them against the cluster x-positions to confirm the size.

Without a matched face (non-Figma outlined text, or a face the document's text never uses), the label still gets edited, with a fallback chosen from the label's own clusters: `guessFaceWeight` on a pseudo-face built from the label's glyphs, Liberation at the measured size. The inspector says "Recognized text; original font unavailable".

### 4. Removing or covering the old outline (proposal)

Terms per GLOSSARY: **Removal** takes the original ink out of the page; **Cover** paints over it when Removal is not possible.

- **Removal, whole label.** The label path is top-level, so it gets a `PdfPathRemovalTarget` exactly like a `textInk` outline (`attachRemovalTargets`), and `planOutlineEdit` / `unpaintPath` ([`remove-original-ink.ts`](../../lib/pdf/remove-original-ink.ts) 296, 358) turn its `f` into `n`, after the same `pathMatches` verification. Op counts are unaffected: `readRawContent` (317) already counts every paint op, translucent or not. There is no text-show op to empty, so `removeOriginalInk`'s "show first" loop (384–431) needs an outline-only branch.
- **Multi-line labels, one line edited.** The path holds every line. Options:
  - **(a) Unpaint the whole path, redraw untouched lines from their own subpaths** (original commands, same fill and opacity). Pixel-identical, simple. **Recommended.**
  - (b) Rewrite the path in place, deleting the edited line's `m … h` segments. Exact too, but needs a subpath-level tokenizer match per segment.
  - (c) Path-shaped Cover of only the edited line's subpaths in the sampled background color (`pdfVectorCoverPathStyle`, [`object-utils.ts`](../../lib/editor/object-utils.ts) 720). Leaves the text recoverable and fails on the translucent zone backgrounds (`ca` 0.05/0.1 over the page).
- **Cover fallback.** Paths inside forms (page 1 JSON block) or whose verification fails get a path-shaped Cover of the edited line's subpaths, as dirty `textInk` runs do today, plus the existing "only a Cover was possible" badge and export toast (decision 4).

### 5. Opacity (proposal)

The Replacement must keep the label's `ca`, or edited text turns darker than its neighbours (#1a1a1a at 0.89 vs 1.0). Store `fillOpacity` on the run; export through an ExtGState `ca` (pdf-lib `drawText({ opacity })` already writes one for overlay text, [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) ~320; `pushRebuiltType3Text` needs a `gs` before its `BT`). Preview: CSS `opacity` on the run. Redrawn untouched lines (§4a) reuse the same `gs`.

### 6. Searchability (proposal)

Today these labels are invisible to search and copy, both in Paperoo and in other viewers. Once recognized:

- In-editor search ([`lib/ocr/search.ts`](../../lib/ocr/search.ts)) can include recognized labels.
- Export can add invisible (`Tr 3`) text for every recognized label, edited or not, the same way scanned-page OCR export does. That changes the bytes of pages the user never touched; an alternative is to add it only for edited labels (where the Replacement is real text anyway).

### 7. When OCR runs (options)

| Option | Behaviour | Cost |
| --- | --- | --- |
| **(a) On click** | Candidate outlines show a text cursor; the first click recognizes that one label (~100 ms warm, ~1–2 s cold) and opens the inline editor | No download until used. Search can't find labels nobody clicked |
| (b) Background, visible pages | Like scanned-page OCR (`enqueueVisible`): recognize candidates on pages in view once idle | ~3 MB load on any Figma deck with candidates. Labels searchable without clicks |
| (c) Explicit action | "Recognize text in shapes" button per page | Discoverability |

**Recommendation:** (b) with the worker started lazily only when a page has candidates, and (a)'s click path always available so a click never waits behind the queue.

### 8. Data model (proposal)

A recognized label line becomes a `PdfTextObject` (so selection, inline edit, inspector, dirty tracking and export all work as for Type3 runs), with:

- `source: "outline-ocr"`, `inkVectorId` → the label's `PdfVectorObject` (now `textInk: true`, so it leaves vector hit-testing, [`object-utils.ts`](../../lib/editor/object-utils.ts) 1776), `inkLine` index, `fillOpacity`, `confidence`.
- No `removalTarget` for text (nothing to empty); `pdfTextRemovable` (1450) answers from the outline target.
- Created outside history, like OCR words; edits to them go through history as for any run.

---

## Decisions (product owner, 2026-10-16)

1. **Trigger.** Recognize candidates in the background on visible pages; the OCR worker loads only when a page has candidates. A click on a candidate jumps the queue.
2. **Granularity.** One run per line. A centered line keeps its old center when its length changes.
3. **Scope.** Any PDF with outlined text, not only Figma. Without a matched face the edit uses the fallback and the inspector says the original font is unavailable.
4. **Doubtful labels.** Low confidence or no glyph match: the path stays a plain vector.
5. **Export search.** Invisible text for every recognized label, edited or not.
6. **Translucent fills.** Fills with `ca`/`CA` < 1 are extracted as vectors (selectable, opacity kept on export). Blend modes, soft masks and dashes stay skipped.
7. **Form XObject labels.** Path-shaped Cover plus the "only a Cover was possible" badge; Removal for top-level labels only.
8. **Delivery.** One `fix/` branch and PR for O1–O5, cut from `main`.
9. **Search.** Running a search queues recognition for candidates on every page; matches are added as they arrive. Nothing runs until a search does.
10. **Progress.** Background label recognition is silent (no page banner). A failed recognition after a click shows a toast.
11. **Glossary.** Add **Outline-only text**: text a PDF draws only as filled glyph outlines, with no text layer; Paperoo recognizes it with OCR. _Avoid_: vector text, shape text.

---

## Implementation notes (verified)

Things the QA file taught during implementation, beyond §3:

- **Empty pen-position subpaths.** Figma puts a zero-size `m … h` at every glyph's pen position inside the outline. Counted as glyphs, they doubled every cluster count. They are dropped (`inkedSubpaths`) before candidate checks, rasterizing, clustering and the redraw of kept lines.
- **Clustering by stacking and winding.** Horizontal overlap alone merged `f` and `i` in "Launched first". A subpath now joins a glyph only when it sits above or below it (dots, accents) or lies inside it and winds the other way (a counter, under nonzero fill; even-odd paths fall back to containment). Clusters are searched newest first, so a counter joins its own glyph, not a kerned neighbour.
- **Result on the QA file:** all 23 outline-only labels are recognized and matched to the document's Inter Regular face (seeded from page 1), including the page 1 JSON block inside a form XObject. Icons and arrows are rejected. Page 2 callouts come out at 13.04 pt, which agrees with their 13 pt baseline step.
- **Export, page 2, one line of a two-line callout edited:** the label's `f` became `n`, the untouched line was redrawn from its own subpaths at `ca` 0.8, the edited line is real (rebuilt Type3) text, and the untouched line is searchable through invisible text. No Cover was needed.
- **Centering** is applied when an edit commits; while typing, the draft is still left-anchored.

---

## Implementation plan (proposal)

| Phase | Scope | Tests |
| --- | --- | --- |
| **O1 — extract translucent fills** | Allow `ca`/`CA` < 1 on fills; carry `fillOpacity`; export repaint of a dirty translucent vector honours it | Fixture path with `ca 0.8` is extracted with opacity 0.8; export keeps it; other unsafe keys still skip |
| **O2 — candidates + OCR** | Candidate rule; `renderOutlineForOcr`; outline jobs in the OCR controller; conf/letters filter | Controller test with a fake engine: candidate recognized, icon rejected; no job for pages without candidates |
| **O3 — slice + face match** | Line/glyph clustering, ink-ratio face match, shape-based I/l fix | Fixture label set in the fixture Type3 face matches it at the right size; a mismatched face is rejected; `Al` → `AI` |
| **O4 — runs, edit, Removal** | `PdfTextObject` per line, inline edit, `f`→`n` Removal + redraw of untouched lines, Cover fallback, opacity in preview and export | Export of an edited label has no old outline paint, the other line's subpaths reappear byte-equal, `ca` applied; form path falls back to Cover |
| **O5 — search** | In-editor search; invisible text on export per Q4 | Exported label found by `getTextContent` |

Fixture: extend `test/figma-type3-fixture.ts` with a two-line outline-only label under `/GS0 gs` (`ca 0.8`) built from the fixture face's glyph outlines. Real-file check: browser pass on page 2 of the QA PDF.

---

## Sources

- Repo: files and lines cited inline. Probes (pdf.js op list and vector extraction per page; path → SVG → canvas → Tesseract) were run against `C:\Users\User\Documents\ai-engineer-roadmap_qeny18.pdf` and not committed.
- [Tesseract.js v7 API](https://github.com/naptha/tesseract.js/blob/v7.0.0/docs/api.md) (`setParameters`, `tessedit_pageseg_mode`), [index.d.ts](https://github.com/naptha/tesseract.js/blob/v7.0.0/src/index.d.ts) (block/line/word hierarchy).
- [ISO 32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf): §8.4.5 graphics state parameter dictionaries (`ca`, `CA`); §8.5.3.1 path painting (`n`); §9.3.6 text rendering mode 3; §11.3.7 constant alpha.
