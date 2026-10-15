# PDF text edit baseline shift

Why PDF text moves up a few pixels when inline edit opens, and stays moved after Enter commits a change.

Primary sources: [CSS 2.1 §10.8.1 "Leading and half-leading"](https://www.w3.org/TR/CSS21/visudet.html#leading), [HTML canvas `TextMetrics`](https://html.spec.whatwg.org/multipage/canvas.html#textmetrics) (`fontBoundingBoxAscent`, `emHeightAscent`), paperoo [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx), [`object-utils.ts`](../../lib/editor/object-utils.ts), [`measure-text.ts`](../../lib/fonts/measure-text.ts), and measurements in the running app (Chrome 152, DPR 1.25, `sample.pdf`).

---

## Symptom

1. Double-click a text run. The cover plate hides the original glyphs and an `<input>` redraws the text.
2. The redrawn text sits above the original.
3. Type and press Enter. The dirty-run preview `<div>` sits at the same raised spot.

Measured on the `sample.pdf` heading (font 18.97 CSS px):

|  | baseline (viewport y) |
| --- | --- |
| Original glyphs on the page canvas (`D` ink bottom, from canvas pixels) | 136.76 |
| Inline edit `<input>` | 134.85 |
| Dirty preview `<div>` after Enter | 134.85 |

Shift: −1.91 CSS px (about 2.4 device px), in both states.

## Cause — the offset assumes the baseline sits one ascent below the box top

- `pdfTextCssInkOffsetFromRunTop` sets the element top to `baseline − fontSize × ratio`. The ratio came from `cssFontAscentRatio`: canvas `emHeightAscent || fontBoundingBoxAscent`.
- `emHeightAscent` is `null` in this Chrome, so the ratio is `fontBoundingBoxAscent` = 0.91.
- Both elements use `line-height: 1` (`pdfTextInkStyle`). CSS 2.1 §10.8.1 adds half-leading `(line-height − (A + D)) / 2` above the ascent. For Liberation Sans A + D ≈ 1.12em, so half-leading is negative and the baseline lands above `A`.
- Baseline from the top of a `line-height: 1` box, measured with a zero-size inline-block probe:

  | font px       | 8     | 10.9  | 12    | 18.97 | 24    | 40    | 100   |
  | ------------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
  | baseline / em | 0.800 | 0.807 | 0.867 | 0.801 | 0.833 | 0.840 | 0.848 |

  Chrome snaps ascent and descent to the pixel grid, so the ratio changes with size. No constant is right. Measure at the rendered size.

## Ruled out — the `<input>`

A probe `<input>` and `<div>` with the same font, `line-height: 1` and height paint on the same baseline. Swapping element types does not help.

## Secondary — ratio measured in the wrong face

`cssFontAscentRatio` used `fontFamilyCss(object.fontFamily)` (Liberation). The text is drawn with `pdfTextPreviewFontCss(object, text)`, which can be the PDF's embedded face with other metrics.

## Fix

1. `cssLineBoxBaselineRatio(fontCss, weight, italic, fontSizePx)` in `measure-text.ts`: lay out a hidden `line-height: 1` div in the exact drawing font, read the baseline from a zero-size inline-block, divide by font size. Cached per font and size; cache cleared when fonts finish loading.
2. Without a DOM, fall back to Liberation's half-leading baseline `(1 + A − D) / 2` ≈ 0.847, not the bare ascent 0.905.
3. `pdf-text-layer.tsx` passes the ratio for the same font family string and CSS size that `pdfTextInkStyle` uses, for both the editor and the dirty preview.
