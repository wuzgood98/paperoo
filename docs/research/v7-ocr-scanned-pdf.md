# V7 OCR for scanned PDFs

Client-side OCR for image-only pages, layered on the existing PDF.js / pdf-lib editor. This note follows [v7-OCR-for-scanned-PDF.md](../../v7-OCR-for-scanned-PDF.md). Research notes live under `docs/research/`, next to [v6-pdf-form-capabilities.md](./v6-pdf-form-capabilities.md).

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json))
- `pdf-lib@1.17.1` ([package.json](../../package.json))
- Next.js `16.3.4`
- No OCR package was installed. Implementation uses `tesseract.js@7.0.0` with `tesseract.js-core@7`.

OCR text is a third source beside native PDF text (`pdf-text`) and user-created overlay text. Recognition results stay off `EditorDocument` so undo does not wipe them.

---

## Engine

Tesseract.js 7.0.0. `createWorker` runs recognition in its own Web Worker. Default output is `text` only (`src/worker-script/constants/defaultOutput.js`); word geometry requires `recognize(image, {}, { blocks: true })`. Hierarchy: `Page.blocks[]` → `Block.paragraphs[]` → `Paragraph.lines[]` → `Line.words[]`. Each level has `text`, `confidence`, and `bbox: { x0, y0, x1, y1 }` in image pixels, origin top-left ([v7 index.d.ts](https://github.com/naptha/tesseract.js/blob/v7.0.0/src/index.d.ts)). Lines also have `baseline: { x0, y0, x1, y1 }`.

Accepted images: canvas, blob, `OffscreenCanvas`. Not `ImageData`. Not a PDF file.

Progress: `logger` messages `{ status, progress }`. Status strings include `loading tesseract core`, `loading language traineddata`, `recognizing text`.

Page segmentation: call `setParameters` with `tessedit_pageseg_mode` `PSM.AUTO` (`3`). The v7 API table defaults to `PSM.SINGLE_BLOCK` (`6`), which is wrong for a full page.

There is no per-job cancel. `terminate()` destroys the worker and does not document rejecting an in-flight `recognize`. Drop stale results with a generation token.

An empty page resolves with no words.

### Local assets (no CDN)

If `langPath` is omitted, the worker fetches `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`. That gzip is 2,952,873 bytes and uncompresses to 5,199,098 bytes. npm `@tesseract.js-data/eng@1.0.0` unpacks to about 13.2 MB and is not this LSTM file — do not install it.

If `corePath` is omitted, [getCore.js](https://github.com/naptha/tesseract.js/blob/v7.0.0/src/worker-script/browser/getCore.js) loads `tesseract.js-core@v7` from jsDelivr and picks `tesseract-core-relaxedsimd-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`, or `tesseract-core-lstm.wasm.js` from SIMD detection. Point `corePath` at a local directory that contains all three plus their `.wasm` files.

Set `workerPath` as well. The v7 FAQ says bundlers throw `Cannot find module` when they move the default worker script.

Transformers.js has an `image-to-text` pipeline. That returns a caption for the whole image, not word boxes, and downloads models from the Hugging Face hub. It is not used.

---

## Invisible text export

pdf-lib 1.17.1 exports `TextRenderingMode.Invisible = 3` and `setTextRenderingMode` ([operators.ts at v1.17.1](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/operators.ts)). [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) already uses that operator for stroked PDF text.

`PDFPage.drawText` has no rendering-mode option. `opacity: 0` is a transparent fill, not mode 3. `Tr` has to sit inside `BT`…`ET`. ISO 32000-1 §9.3.6 mode 3 is neither fill nor stroke.

Export copies the original page (`copyPagesWithAcroForm`) then appends operators. The scan is not rasterized. Forms and annotations stay as they are.

Installed PDF.js `getTextContent` does not branch on `setTextRenderingMode`, so mode 3 text is extracted. It skips whitespace glyphs unless `keepWhiteSpace` is set. Paperoo opens files with `getTextContent()` and no options.

`drawDirtyPdfText` fills glyphs with `drawText` when stroke is off. OCR export must not go through that path, or existing mode-3 text would become visible.

The export worker ([lib/pdf/export.worker.ts](../../lib/pdf/export.worker.ts)) receives `{ assets, bytes, document, fontBytes }` from [lib/pdf/run-export.ts](../../lib/pdf/run-export.ts). OCR words are an extra field on that message. They are not on `EditorDocument`.

Place exported text on the line baseline (`displayedPointToUserSpace`). The bottom of a word box is not the baseline. `DEFAULT_ASCENT_RATIO` (0.8) is only the fallback when a line baseline is missing.

Reopening the export yields normal `pdfTextObjects`. Glyph widths follow the embedded font, so boxes can differ slightly from in-editor OCR boxes. The scan pixels do not change.

---

## Coordinates

[lib/pdf/session.ts](../../lib/pdf/session.ts) stores displayed size from `getViewport({ scale: 1 })`, `cropBox` from `page.view`, and `sourceRotate`. Editor zoom and extra `page.rotation` are CSS in [editor-page-frame.tsx](../../components/editor/editor-page-frame.tsx).

Do not OCR the on-screen canvas. That bitmap is `renderPdfPage` at the current zoom, with `sourceRotate + page.rotation` and device pixel ratio. Recognition uses a separate offscreen render at `sourceRotate` only, about 150 DPI, long edge capped.

Tesseract `bbox` is pixels, origin top-left, y downward. tesseract.js boxes are already in the image passed to `recognize`. Recognize the full page bitmap; do not apply the C++ `SetRectangle` crop offset ([pageiterator.h](https://github.com/tesseract-ocr/tesseract/blob/5.5.1/include/tesseract/pageiterator.h)).

For a bitmap from `getViewport({ scale: s, rotation: sourceRotate })`:

```ts
displayed.x = bbox.x0 / s;
displayed.y = bbox.y0 / s;
displayed.width = (bbox.x1 - bbox.x0) / s;
displayed.height = (bbox.y1 - bbox.y0) / s;
user = displayedToUserSpace(displayed, cropBox, sourceRotate);
```

Do not store zoom or the user’s view rotation in the OCR boxes.

---

## Detection

Installed PDF.js has no scanned-page detector. `hasTextContent` is an annotation flag and defaults to false. Do not use PDF.js `TextLayer`.

A page is **native** when trimmed concatenated `pdfTextObjects` text is at least 40 characters. It is **scanned** when text is below that and some image covers at least 45% of the page. Otherwise it is **plain** (blank or vector-only). Only scanned pages are OCR’d. A one-line scanner banner stays under the text threshold.

---

## History and selection

`HistorySnapshot` clones `EditorDocument` only ([history.ts](../../lib/editor/history.ts)). Recognition does not call `commit`.

A scanned page’s image covers the page. [overlay-pdf-hit.ts](../../components/editor/overlay-pdf-hit.ts) picks form, then annotation, then native text, then image. OCR word hit-testing runs before the image hit, and only when the point is inside a word. Margin clicks still select the scan.

---

## Out of scope

Handwriting, signatures, form-field detection, tables, layout reconstruction, translation, cloud OCR, extra language models.
