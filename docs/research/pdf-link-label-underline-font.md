# PDF link label — underline through glyphs and fallback font after edit

Follows on from [pdf-link-label-baseline.md](./pdf-link-label-baseline.md) and [pdf-link-label-visibility.md](./pdf-link-label-visibility.md). After a label edit, the redrawn rule cut through the bottoms of the letters, and the new label was drawn in Liberation Sans instead of the PDF's own Arial.

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`.

Primary sources: ISO 32000-1:2008 §8.4.3.2 (stroke centered on the path), §9.7.4–§9.7.5 (Type0 / CIDFont `/W`), §9.10.3 (`ToUnicode`). PDF.js `PageViewport` (`offsetX`/`offsetY`), `getOperatorList`, and `commonObjs` font `name`. The repo's [`extract-text.ts`](../../lib/pdf/extract-text.ts), [`sample-pdf-text-cover.ts`](../../lib/pdf/sample-pdf-text-cover.ts) and [`probe-pdf-font.ts`](../../lib/pdf/probe-pdf-font.ts).

Reproduced on a Google Docs résumé export. Link run `https://bozomalabs.com`: 11 pt `BAAAAA+ArialMT` (Type0 `Identity-H`, with `/ToUnicode`), baseline 9.958 pt below the run top.

---

## What the user sees

| Before edit | After edit |
| --- | --- |
| The rule sits about 0.6 pt below the baseline | The rule touches the baseline and covers the bottoms of the letters |
| Arial glyphs (the PDF's embedded subset) | Liberation Sans: same widths, different shapes |

The text baseline itself is right. A CSS baseline probe puts it at 9.953 pt, and the PDF says 9.958 pt.

---

## Why the underline moves up

The original rule is a stroked line in the content stream: `0.75 0 0 0.75 72 551.08 cm`, `LW 1.333`, path y = 15.2255. In displayed space that is a centre at **11.06 pt** below the run top and a **1.0 pt** width (ISO 32000-1 §8.4.3.2: the stroke is centred on the path).

On commit, [`sampleLinkCaptionFromPage`](../../lib/pdf/sample-link-caption-from-page.ts) re-read the rule from the page canvas at the **view zoom**. What it stored depended on that zoom:

| Zoom | Stored centre | Stored width | Stored colour            |
| ---- | ------------- | ------------ | ------------------------ |
| 187% | 11.01 pt      | 0.85 pt      | `#1155cc`                |
| 87%  | **10.44 pt**  | 0.91 pt      | `#4c7fd9` (anti-aliased) |

At 87%, one point is about 1.2 device px, so the 1 pt rule is a single anti-aliased row. Several effects add up:

- `displayedRectToCanvasPixels` floors the top edge.
- The old sampler kept the first two-row streak of one colour bucket. It scanned upward from a band that started at 0.65 of the box height, which is above the baseline.
- So it could only snap to whole pixel rows, and it read the lighter anti-aliased colour.

The result is 0.6 pt too high. Preview and export both draw the bar there, which is through the bottoms of the glyphs.

Vector detection (`findCaptionUnderlineDecoration`) does not help on this file:

- Google Docs sets an ExtGState (`LW`, `LC`, `LJ`, `CA`, `BM`) before every path.
- [`extractPdfVectorObjects`](../../lib/pdf/extract-vectors.ts) marks any `setGState` as unsafe, so the page has **zero** vector objects.

---

## Why the font changes

`embeddedFontCanDraw` lets preview and export reuse the PDF's font only when the run's `reusableFontGlyphs` covers the new text. That list comes from `probeReusableFontGlyphs(sourceIndex, baseFontName)`, which opens page `sourceIndex` with pdf-lib.

`measurePdfTextForEdit` passed **`object.sourceIndex`**:

- On a `PdfTextObject`, that field is the run's index among the page's text items (`extractPdfTextObjects`), not the page index.
- For this link it is far past the page count, so the probe returned `""`.
- Every run after the first item or two fell back to Liberation Sans in preview and export.

The font itself is reusable. `reusableCodePoints(page 0, "BAAAAA+ArialMT")` returns 71 code points, and the ToUnicode `bfrange <0044> <005D> <0061>` covers a–z. The unit test missed this because its fixture used `sourceIndex: 0` for both the run and the page.

---

## Fix

| Piece | Change |
| --- | --- |
| Font probe | [`measurePdfTextForEdit`](../../lib/pdf/sample-pdf-text-cover.ts) passes `page.sourceIndex` |
| Sample source | [`renderPdfPageRegion`](../../lib/pdf/render-page.ts) renders just the run strip at a fixed 8 px/pt. It uses a PDF.js viewport offset, so pixel row 0 is exactly the run top, at any zoom |
| Search band | From the PDF baseline (`pdfTextBaselineDisplayed`) down to 0.5 em below it, past the run box |
| Rule detection | [`sampleCaptionInk`](../../lib/pdf/sample-caption-ink.ts) takes the first run of rows inked across ≥ 60% of the width below the baseline. Glyph bottoms stay above the search band; descenders leave gaps |
| Centre / width | Ink-weighted centroid and total ink ÷ peak-row ink, so anti-aliased edges count fractionally |
| Colour | Darkest pixel in the peak row (the rule's solid core) |
| No rule found | `underline: null`. `pdfLinkTextAppearance` keeps the sampled fill and falls back to the vector or default rule |

After the fix at 87%, the stored rule is centred at 11.06 pt, 1.00 pt wide, `#1155cc`, and the label renders in `g_d0_f2` (the PDF's ArialMT).

Not changed: `extractPdfVectorObjects` still treats every ExtGState as unsafe. Applying `LW`/`LC`/`LJ` from safe ExtGStates would make Google Docs rules editable vectors and give an exact vector underline, but it changes vector editing for many PDFs.

---

## Tests

- [`test/sample-caption-ink.test.ts`](../../test/sample-caption-ink.test.ts) covers four cases:
  - glyph stems above the baseline are ignored;
  - a 1 px rule with an anti-aliased row lands between rows;
  - descenders alone are not a rule;
  - a 2 px rule is measured as 2 px.
- [`test/pdf-text-measure.test.ts`](../../test/pdf-text-measure.test.ts) checks that the probe receives the page index, not the run's item index.
