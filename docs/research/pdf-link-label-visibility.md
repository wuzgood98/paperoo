# PDF link label — label disappears after edit

Follow-on to [pdf-link-label-style.md](./pdf-link-label-style.md) and [pdf-text-edit-fidelity.md](./pdf-text-edit-fidelity.md). Editing a link's **Label** in the Edit Link popover made the new caption invisible. What was left: a long underline, a sliver of blue ink where the `|` separator was, and a sliver at the right end of the old URL.

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`.

Primary sources: Paperoo `pdfLinkOverlappingTextRuns`, `commitPdfLinkLabel`, `PdfTextLayer`, `drawDirtyPdfText`. Text runs were extracted with PDF.js `getTextContent` from the reporter's resume, a "Company | URL" line.

---

## What PDF.js extracts

The line `Bozoma Labs | https://bozomalabs.com` comes out as several runs. Page space is y-down, in points:

| Run                      | x      | width  | y      | height |
| ------------------------ | ------ | ------ | ------ | ------ |
| `Bozoma Labs`            | 72     | 71.46  | 649.17 | 12.71  |
| `" "`                    | 143.46 | 4.07   | 659.12 | **0**  |
| `\|`                     | 146.51 | 2.86   | 649.17 | 12.71  |
| `" "`                    | 149.37 | 4.07   | 659.12 | **0**  |
| `https://bozomalabs.com` | 152.42 | 116.09 | 649.17 | 12.71  |

The link quad starts at x = 149.369. The `|` run ends at x = 149.371, so it overlaps the link by **0.002 pt**. PDF.js inserts the space runs itself: they have zero height and sit at the baseline.

---

## Why the label vanished

1. **Too many runs joined the label.** `pdfLinkOverlappingTextRuns` accepted any intersection with a quad. It sorted by `y` first, which put the zero-height space after the URL. The link's runs came out as `|`, the URL, then `" "`, and the label as `|https://bozomalabs.com ` (the `|` the reporter saw in the Label field).
2. **The label landed on the wrong run.** `commitPdfLinkLabel` writes the whole new label onto `runs[0]`, here the 2.86 pt `|` run, and empties the other runs (`text: ""`). The emptied runs are still dirty.
3. **Covers painted over the label.** `PdfTextLayer` drew each dirty run as cover, then text, then underline, in array order with no z-index. The URL run comes after the `|` run, so its opaque cover, sized to the old URL glyphs, was painted on top of the new label. Only ink outside that cover stayed visible.
4. **Extra underlines.** Emptied runs still got a link appearance, so they drew their own 100%-width underlines. The covers had been measured before the edit, when no underline was known, so the page's original underline was never covered.
5. **Export had the same order.** `drawDirtyPdfText` drew cover then text for each run in turn, so the saved PDF had the same problem.

---

## Fix

- **Which runs are in the link** (`object-utils.ts`):
  - a quad must cover at least half of a run's width and height before the run counts as part of the link;
  - runs on one line are ordered by x, and a zero-height run counts as on the line when its y falls inside the other run's box;
  - blank runs at either end of the label are dropped.
- **Two passes, preview and export:**
  - `PdfTextLayer` paints every dirty run's covers first, then all text, underlines and the inline editor;
  - `exportDocument` draws every cover before any `drawDirtyPdfText`;
  - runs whose text is empty draw no text.
- **No link appearance for emptied runs:** `pdfLinkForDirtyCaptionRun` returns nothing when `run.text === ""`.
- **Original underline covered:** `pdfLinkPrimaryCoverRects` adds a band over the sampled underline, spanning the link quads and runs, to the primary run's `coverRects` at commit.

Tests:

- `test/export-pdf-link.test.ts`: a fixture with a split URL and a grazing separator checks the label, that the emptied run has no appearance, and that the export has no fill operators after the label's `showText`;
- `test/object-utils.test.ts`: the resume geometry from the table above.
