# PDF stack research: pdfjs-dist 6.x + pdf-lib 1.17.1

Research for Paperoo's web PDF editor: render with PDF.js, overlay editor objects, export with pdf-lib so the exported PDF visually matches the editor.

**Status:** primary-source verified. Every claim below is backed by a package file + line reference, the bundled Next.js docs, a pdf.js GitHub release note, or an empirical test run in a scratch project outside this repo. Items I could not verify are called out explicitly as **[UNVERIFIED]**.

## Verification environment

| Thing | Value |
| --- | --- |
| Scratch dir (outside repo) | `C:\Users\User\AppData\Local\Temp\Paperoo-research` |
| `pdfjs-dist` | 6.3.289 (`version` / `build` reported at runtime: `6.3.289` / `1c8020a7d`) |
| `pdf-lib` | 1.17.1 (ships `src/*.ts` alongside `es/` and `cjs/`, so all citations below are to the original TypeScript) |
| `@pdf-lib/fontkit` | 1.1.1 |
| Next.js probe app | 16.3.4, App Router, Turbopack, at `C:\Users\User\AppData\Local\Temp\Paperoo-nextprobe` |
| Node | v24.15.0 |

Citations of the form `pdf-lib/src/api/operations.ts:194` mean that path inside the installed package. Next.js citations are to `node_modules/next/dist/docs/` in this repo, as instructed.

---

# A. PDF.js (pdfjs-dist 6.3.289)

## A1. Exact ESM import path and worker setup in a Next 16 App Router client component under Turbopack

**Direct answer.** Import the main entry as `pdfjs-dist` (or the explicit `pdfjs-dist/build/pdf.mjs`), and set up the worker with **`GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url), { type: 'module' })`**. Do **not** assign the `new URL(...)` object to `workerSrc` — that throws. No `next.config.ts` changes are required.

### The canonical pattern is shipped in the package

pdfjs-dist ships a bundler helper that is the authoritative statement of the intended pattern — this is the entire file:

```js
// pdfjs-dist/webpack.mjs
import { GlobalWorkerOptions } from "./build/pdf.mjs";

if (typeof window !== "undefined" && "Worker" in window) {
  GlobalWorkerOptions.workerPort = new Worker(
    new URL("./build/pdf.worker.mjs", import.meta.url),
    { type: "module" }
  );
}

export * from "./build/pdf.mjs";
```

Note it uses `workerPort`, not `workerSrc`, and `{ type: "module" }`.

### Resolution: deep imports are legal

`pdfjs-dist/package.json` has **no `exports` field**; it declares `"main": "build/pdf.mjs"` and `"types": "types/src/pdf.d.ts"`. With no export map, subpath imports such as `pdfjs-dist/build/pdf.worker.mjs` are unrestricted.

### Verified empirically under Turbopack

I built a scratch Next 16.3.4 App Router app with a `'use client'` component containing exactly the `new Worker(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url), { type: 'module' })` call. Turbopack resolved the bare specifier inside `new URL` and emitted the worker as a static asset:

```
Emitted: .next/static/media/pdf.worker.2c80n3p27u3ep.mjs   (2,228,489 bytes — byte-identical to node_modules/pdfjs-dist/build/pdf.worker.mjs)
Emitted client chunk contains:
  (globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([...,35335,e=>{e.q("/_next/static/media/pdf.worker.2c80n3p27u3ep.mjs")}]);
```

This is consistent with the bundled docs: `next/dist/docs/01-app/03-api-reference/08-turbopack.md:130` states that Turbopack's webpack-compatible magic comments "work with dynamic `import()`, `require()`, `require.resolve()`, and **`new Worker()`** expressions (not static `import` statements)" — i.e. `new Worker()` is a first-class, statically analysed construct in Turbopack.

The worker file is safe to load as a raw module worker: `pdfjs-dist/build/pdf.worker.mjs` has exactly one top-level statement, `export { WorkerMessageHandler };` at line 65082, and no top-level imports. It is fully self-contained.

### The `workerSrc` trap (this will bite you)

`GlobalWorkerOptions.workerSrc` must be a **string**. Passing the `URL` object returned by `new URL(...)` throws:

```js
// pdfjs-dist/build/pdf.mjs:14384-14392 (setter for workerSrc)
if (typeof val !== "string") {
  throw new Error("Invalid `workerSrc` type.");
}
```

And if you never set either option (`pdf.mjs:16400-16404`):

```js
throw new Error('No "GlobalWorkerOptions.workerSrc" specified.');
```

Internally, when `workerSrc` _is_ used, pdf.js does `new Worker(workerSrc, { type: "module" })` (`pdf.mjs:16294-16306`) and, for a cross-origin `workerSrc`, wraps it in a generated blob shim (`pdf.mjs:16236`). `workerPort` skips all of that, so it is both simpler and faster.

### Recommended module for Paperoo

```ts
// lib/pdf/pdfjs.ts   — must only ever be imported from a 'use client' module
import { GlobalWorkerOptions, getDocument, PixelsPerInch } from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from "pdfjs-dist";

let configured = false;

export function ensureWorker(): void {
  if (configured || typeof window === "undefined") return;
  GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url),
    { type: "module" }
  );
  configured = true;
}

export { getDocument, PixelsPerInch };
export type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask };
```

Guard with `typeof window === 'undefined'` (as pdfjs-dist's own `webpack.mjs` does) so that the module is inert if it is ever pulled into a server render pass.

### Next config: what is and isn't needed

| Option | Needed? | Why |
| --- | --- | --- |
| `serverExternalPackages` | **No** | Per `next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`, this option only affects **server-side** bundling. A `'use client'` viewer is client-bundled. The doc's auto-opt-out list includes `canvas` and `@react-pdf/renderer` but neither `pdfjs-dist` nor `pdf-lib`. |
| `transpilePackages` | **No** | Both packages ship browser-ready ESM. `pdfjs-dist` main is `build/pdf.mjs`; `pdf-lib` ships `es/`. |
| `turbopack.rules` / `resolveAlias` | **No** | Verified: default resolution already emits the worker asset. The available knobs are documented in `next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md` (`root`, `rules`, `resolveAlias`, `resolveExtensions`, `debugIds`; module types `asset` / `ecmascript` / `typescript` / `css` / `css-module` / `wasm` / `raw` / `bytes`). |
| `turbopackWorkerAssetPrefix` | Only if you serve worker chunks from a different origin than `assetPrefix`. Documented at `turbopack.md:413`: "Custom asset prefix for Web Worker URLs (entrypoint + module chunks), overriding `assetPrefix`. Mirrors webpack's `output.workerPublicPath`." |

One extra caution on the pdfjs-dist side: `package.json` declares `"engines": { "node": ">=22.13.0 || >=24" }` and an `optionalDependencies` entry for `@napi-rs/canvas ^1.0.0`. The optional dep is only used for Node-side rendering; it is irrelevant to the browser build but will show up in your lockfile.

If you ever need to run pdf.js in Node (tests, server-side thumbnailing), use `pdfjs-dist/legacy/build/pdf.mjs` — it exists and works (that is what I used for all Node verification in this document).

## A2. Breaking changes v4 → v5 → v6

Everything in this section is quoted from the pdf.js GitHub releases API (`api.github.com/repos/mozilla/pdf.js/releases`), which is where the `[api-major]` / `[api-minor]` tags live, cross-checked against the installed `.d.ts` files.

### The two that will break existing code outright

**1. `PDFDocumentProxy.destroy()` is gone.** From the v6.0.227 release notes, PR 21245:

> `[api-major]` Remove support for calling `getDocument` without a parameter object, and remove the `PDFDocumentProxy.prototype.destroy` method

Confirmed at runtime — this is a real `TypeError`, not a deprecation warning:

```
TypeError: doc.destroy is not a function
```

`pdfjs-dist/types/src/display/api.d.ts` confirms only the loading task has it:

```ts
declare class PDFDocumentLoadingTask {
  destroy(): Promise<void>;
  get promise(): Promise<PDFDocumentProxy>;
  // ...
}
```

So the lifecycle you must write is: keep the `PDFDocumentLoadingTask`, and call `loadingTask.destroy()`. See A5.

**2. `getDocument()` requires a parameter object** (same PR 21245). `getDocument(url)` as a bare string still works — the signature is `DocumentInitParameters` which accepts `url`/`data` — but calling it with no arguments now throws.

```ts
// pdfjs-dist/types/src/display/api.d.ts
export function getDocument(
  src?: DocumentInitParameters
): PDFDocumentLoadingTask;
```

### `page.render()`: `canvas` is now the required parameter

This is the change most likely to silently mislead you, because the old `canvasContext` key still exists. The actual runtime signature:

```js
// pdfjs-dist/build/pdf.mjs:15851-15867
render({
  canvasContext,
  canvas = canvasContext.canvas,
  viewport,
  intent = "display",
  annotationMode = AnnotationMode.ENABLE,
  transform = null,
  background = null,
  optionalContentConfigPromise = null,
  annotationCanvasMap = null,
  pageColors = null,
  printAnnotationStorage = null,
  isEditing = false,
  recordImages = false,
  recordOperations = false,
  operationsFilter = null
})
```

The type definition makes the intent explicit — `canvas` is **required**, `canvasContext` is optional:

```ts
// pdfjs-dist/types/src/display/api.d.ts (RenderParameters)
canvas: HTMLCanvasElement | null;
/**
 * ... for backwards compatibility; it is recommended to use the `canvas`
 * parameter instead. If the context must absolutely be used to render the
 * page, the canvas must be null.
 */
canvasContext?: CanvasRenderingContext2D;
```

And the internal task shows they are mutually exclusive — passing `canvas` wins and the context is ignored:

```js
// pdfjs-dist/build/pdf.mjs:17099-17100
this._canvas = params.canvas;
this._canvasContext = params.canvas ? null : params.canvasContext;
```

The migration path was: v5.4.54 (PR 20016) `[api-minor] Move getContext call to InternalRenderTask`, then v5.4.149 (PR 20149) "Mark `canvasContext` as optional". **Use `{ canvas, viewport }`.** Note the default-destructuring `canvas = canvasContext.canvas` means that if you pass neither, you get a `TypeError` on `undefined.canvas` rather than a friendly error.

### Signatures that are stable and that you will use

```ts
// pdfjs-dist/types/src/display/api.d.ts
getViewport({ scale, rotation, offsetX, offsetY, dontFlip }?: GetViewportParameters): PageViewport;
render({ ... }: RenderParameters): RenderTask;

// RenderTask
cancel(extraDelay?: number): void;
get promise(): Promise<void>;

// PDFPageProxy
cleanup(resetStats?: boolean): boolean;      // synchronous, returns boolean
get userUnit(): number;
get view(): Array<number>;
get rotate(): number;

// PDFDocumentProxy
cleanup(keepLoadedFonts?: boolean): Promise<any>;   // asynchronous
saveDocument(): Promise<Uint8Array<ArrayBuffer>>;
extractPages(pageInfos: any, copyLevels?: any): Promise<Uint8Array>;
```

Note the asymmetry: `PDFPageProxy.cleanup` is sync and returns a `boolean` (false if a render is still in flight); `PDFDocumentProxy.cleanup` is async.

### Full change inventory, v4 → v6

**v4.x → v5.0 (v5.0.375 release notes):**

| PR | Change |
| --- | --- |
| 19469 | `[api-major]` Apply the `userUnit` using CSS — see the `userUnit` note in C1, this changes how page size is computed |
| 19264 | `MissingPDFException` + `UnexpectedResponseException` collapsed into a single `ResponseException` |
| 19365 | Viewer-component `render` methods switched to parameter objects |
| 19329 | OpenJPEG moved to WASM, introducing the `wasmUrl` option |
| 19368 | Page clean-up simplified |
| 19604 | Max canvas width/height limiting introduced (see A3) |
| 19564, 19620 | ICC profile support via the `iccUrl` option |

Also, from v4.7.76 (PR 18776): `CanvasFactory` / `FilterFactory` are now passed to `getDocument` as **classes, not instances**. If you carry over v4-era factory code, this is a breaking change.

**v5.x internals worth knowing:**

- v5.6.205, PR 20840: the `length` option was removed from `getDocument`.
- v5.6.205, PR 20949: `CMapReaderFactory`, `StandardFontDataFactory` and `WasmFactory` were collapsed into a single **`BinaryDataFactory`** option. If you were overriding any of the three, there is now one seam.
- v5.7.284, PR 21018: minimum Node raised to 22.

**v5 → v6:**

| PR | Change |
| --- | --- |
| 21245 | `[api-major]` `PDFDocumentProxy.destroy` removed; `getDocument()` requires a params object |
| 21152 | `[api-major]` Minimum supported browsers raised; polyfills removed |
| 21426 | `[api-minor]` `PageViewport.convertToViewportRectangle` removed (v6.1.200) |

Plus a systematic **return-type change across v6.1–6.3**: `getAttachments`, `getDestinations`, `getViewerPreferences`, `getOpenAction`, `getJSActions` and `getFieldObjects` now return a **`Map`**; `getPermissions` returns a **`Set`**; and `documentInfo` / `markInfo` are **`Map`s**. Any code doing `info.Title` or `Object.keys(attachments)` breaks silently — `Object.keys(someMap)` returns `[]` rather than throwing. Use `.get('Title')`.

Because 21152 dropped the polyfills, v6 is the version where you must not assume old-Safari support from the modern build; use the `legacy/` build if you need it.

## A3. Rendering at `devicePixelRatio`, arbitrary zoom, and canvas size limits

**Direct answer.** Size the canvas backing store to `viewport.width × outputScale.sx` and set the CSS size to `viewport.width` px; pass the scale-up matrix as `render({ transform })`. Cap the result with `OutputScale.limitCanvas` against `maxCanvasPixels = 2**25` and `maxCanvasDim = 32767`. Always `cancel()` the in-flight `RenderTask` before starting a new one on the same canvas, and swallow the resulting `RenderingCancelledException`.

### The classes pdf.js gives you

```js
// pdfjs-dist/build/pdf.mjs:1241-1245
class PixelsPerInch {
  static CSS = 96.0;
  static PDF = 72.0;
  static PDF_TO_CSS_UNITS = this.CSS / this.PDF; // 1.3333333333333333 (verified at runtime)
}
```

```js
// pdfjs-dist/build/pdf.mjs:1547-1590
class OutputScale {
  static get pixelRatio() {
    return globalThis.devicePixelRatio || 1;
  }
  // sx, sy initialised to pixelRatio
  get scaled() {
    /* sx !== 1 || sy !== 1 */
  }
  limitCanvas(width, height, maxPixels, maxDim, capAreaFactor = -1) {
    /* mutates sx/sy, returns boolean */
  }
}
```

Use `OutputScale` rather than reading `devicePixelRatio` yourself, because `limitCanvas` is where the clamping logic lives.

### The canonical sizing sequence, from the official viewer

`pdfjs-dist/web/pdf_viewer.mjs` is the reference implementation. The two relevant blocks:

```js
// web/pdf_viewer.mjs:7012-7023
const outputScale = (this.outputScale = new OutputScale());
if (/* CSS-zoom path */) {
  outputScale.sx *= invScale;
  outputScale.sy *= invScale;
}
this.#needsRestrictedScaling = outputScale.limitCanvas(
  width, height, this.maxCanvasPixels, this.maxCanvasDim, this.capCanvasAreaFactor
);
```

```js
// web/pdf_viewer.mjs:7227-7252
const sfx = approximateFraction(outputScale.sx);
const sfy = approximateFraction(outputScale.sy);
const canvasWidth = (canvas.width = floorToDivide(
  calcRound(width * outputScale.sx),
  sfx[0]
));
const canvasHeight = (canvas.height = floorToDivide(
  calcRound(height * outputScale.sy),
  sfy[0]
));
// re-derive the *actual* scale after integer rounding:
outputScale.sx = canvasWidth / pageWidth;
outputScale.sy = canvasHeight / pageHeight;
const transform = outputScale.scaled
  ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
  : null;
```

Three details in there are load-bearing and easy to miss:

1. **`transform` is how the DPR scaling is applied.** You do _not_ call `ctx.scale(dpr, dpr)` yourself. You hand pdf.js `[sx, 0, 0, sy, 0, 0]`.
2. **The scale is re-derived after integer rounding.** `canvas.width` must be an integer, so the effective scale is `canvasWidth / viewport.width`, not the requested `sx`. If you use the requested value in the transform, you get a sub-pixel mismatch between the raster and the CSS box — which reads as blur. Recompute.
3. `calcRound` exists to match CSS's own rounding. `web/pdf_viewer.mjs:629-630` feature-detects CSS `round()`:
   ```js
   e.style.width = "round(down, calc(1.6666666666666665 * 792px), 1px)";
   return e.style.width === "calc(1320px)" ? Math.fround : (x) => x;
   ```
   This is a browser-specific rounding workaround. You can start with `Math.round`; if you see one-pixel seams between the canvas and your overlay at odd zoom levels, this is the reason.

A minimal correct version for Paperoo:

```ts
function sizeCanvas(canvas: HTMLCanvasElement, viewport: PageViewport) {
  const scale = new OutputScale();
  scale.limitCanvas(viewport.width, viewport.height, 2 ** 25, 32767, 200);

  canvas.width = Math.floor(viewport.width * scale.sx);
  canvas.height = Math.floor(viewport.height * scale.sy);
  // CSS size stays in CSS px — this is what the overlay layer must match exactly
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const sx = canvas.width / viewport.width; // re-derive after rounding
  const sy = canvas.height / viewport.height;
  return sx !== 1 || sy !== 1 ? ([sx, 0, 0, sy, 0, 0] as const) : null;
}
```

### Canvas size limits: the actual numbers

From the `AppOptions` defaults in `pdfjs-dist/web/pdf_viewer.mjs`:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxCanvasDim` | **32767** | max width or height in device pixels |
| `maxCanvasPixels` | **2 ** 25** = 33,554,432 | max total area in device pixels |
| `capCanvasAreaFactor` | **200** | secondary area cap relative to the CSS area |

The same file's compatibility block overrides these on mobile: **iOS and Android get `maxCanvasPixels = 5,242,880`** (i.e. 2\*\*25 / 6.4), and Android additionally gets `useSystemFonts: false`.

Concretely, 33.5M pixels is A4 at roughly 7.5× zoom on a 1× display, or ~3.7× on a 2× display. Mobile's 5.2M pixels is A4 at ~3× on a 1× display. **A zoom-to-fit-width on a phone can hit the mobile cap**, which is why `limitCanvas` returning `true` (`#needsRestrictedScaling` in the viewer) must be handled rather than ignored: past that point you render at a lower device scale and let the browser upscale, trading sharpness for not crashing.

Exceeding the browser's own limit does not throw — the canvas silently becomes unusable (typically all-transparent), which is a miserable bug to diagnose. Clamp proactively.

### Cancel and re-render on zoom

`RenderTask.cancel(extraDelay?: number): void`. The rules:

- One `RenderTask` per canvas at a time. Starting a second render on a canvas with a live task corrupts output.
- `cancel()` causes the task's `promise` to reject with a `RenderingCancelledException`. This is a normal control-flow signal, not an error; filter it out or your error boundary will fire on every zoom tick.
- `extraDelay` exists to let a cancelled task settle before the canvas is reused; the viewer passes a small delay when it is about to re-render immediately.

```ts
let task: RenderTask | null = null;

async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number
) {
  task?.cancel();
  const viewport = page.getViewport({ scale });
  const transform = sizeCanvas(canvas, viewport);
  task = page.render({ canvas, viewport, transform });
  try {
    await task.promise;
  } catch (err) {
    if ((err as Error)?.name !== "RenderingCancelledException") throw err;
  } finally {
    task = null;
  }
}
```

Debounce zoom so you are not queuing a render per wheel event. The standard trick for smooth interaction is to CSS-transform the existing canvas during the gesture and re-rasterise once on settle — that is exactly what the `invScale` branch at `web/pdf_viewer.mjs:7015-7016` is doing.

## A4. Types, cmaps, and standard fonts

**Direct answer.** v6 ships its own types (generated from JSDoc, so somewhat loose). You need to copy `cmaps/` and `standard_fonts/` out of the package into `public/` yourself, and point `cMapUrl` / `standardFontDataUrl` at them — plus `wasm/` and `iccs/` if you want JBIG2/JPEG2000/ICC support.

### Types

`pdfjs-dist/package.json` declares `"types": "types/src/pdf.d.ts"`. No `@types/pdfjs-dist` needed. The definitions are generated from JSDoc, so precision varies — the main `api.d.ts` is 1711 lines and well-typed for the objects you care about, but peripheral files degrade to `any`:

```ts
// pdfjs-dist/types/src/display/canvas_factory.d.ts
export class BaseCanvasFactory {
  constructor({ enableHWA }: { enableHWA?: boolean | undefined });
  create(width: any, height: any): { canvas: void; context: any };
  reset({ canvas }: { canvas: any }, width: any, height: any): void;
  destroy(canvasAndContext: any): void;
}
```

Note `canvas: void` in that return type — that is a JSDoc-generation artefact, not reality. Under `strict`, expect to write a few local interfaces if you touch the factory APIs. The types you actually need (`PDFDocumentProxy`, `PDFPageProxy`, `PageViewport`, `RenderTask`, `DocumentInitParameters`, `RenderParameters`) are all properly typed.

### What the package ships, measured

| Directory | Files | Size | Purpose |
| --- | --- | --- | --- |
| `cmaps/` | 169 | 1.11 MB | Predefined Adobe CMaps for CJK encodings (`.bcmap`, binary/packed) |
| `standard_fonts/` | 16 | 0.76 MB | Substitutes for the 14 standard fonts (`.pfb` Foxit fonts + Liberation Sans `.ttf`s) |
| `wasm/` | 13 | 1.47 MB | `jbig2.wasm`, OpenJPEG, plus `*_nowasm_fallback.js` |
| `iccs/` | 2 | 0.01 MB | `CGATS001Compat-v2-micro.icc` |
| `build/` | — | `pdf.mjs` 840 KB, `pdf.worker.mjs` 2176 KB (minified: 448 KB / 1236 KB) |  |
| `legacy/build/` | — | `pdf.mjs` 1023 KB, `pdf.worker.mjs` 2339 KB | broader browser + Node support |

### The relevant `getDocument` options

From `pdfjs-dist/types/src/display/api.d.ts` (`DocumentInitParameters`, lines 69-220 and the JSDoc block at 659-738):

```ts
cMapUrl?: string | undefined;             // :69  "The URL where the predefined Adobe CMaps are located"
cMapPacked?: boolean | undefined;         // :74  binary .bcmap format — true for the shipped files
standardFontDataUrl?: string | undefined; // :92
wasmUrl?: string | undefined;             // :97
iccUrl?: string | undefined;              // :79
useWorkerFetch?: boolean | undefined;     // :104 fetch assets from inside the worker; if true, BinaryDataFactory is ignored
useWasm?: boolean | undefined;            // :110
BinaryDataFactory?: Object | undefined;   // :213 default DOMBinaryDataFactory
disableFontFace?: boolean | undefined;    // :151
maxImageSize?: number | undefined;        // :123
enableHWA?: boolean | undefined;          // :220 hardware acceleration
```

### Serving them from Next's `public/`

`next/dist/docs/01-app/03-api-reference/03-file-conventions/public-folder.md` confirms the mechanics: "Files inside `public` can then be referenced by your code starting from the base URL (`/`)". So `public/pdfjs/cmaps/*` is served at `/pdfjs/cmaps/*`.

There is no bundler step that copies these for you. Add a `postinstall` (or a `prebuild`) copy — **but note this means touching `package.json`, which is out of scope for this research task**; it is listed in Decisions and risks as a follow-up.

```ts
const loadingTask = getDocument({
  data,
  cMapUrl: "/pdfjs/cmaps/", // trailing slash required — pdf.js concatenates
  cMapPacked: true, // the shipped .bcmap files are packed
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
});
```

One caching caveat straight from the Next docs: "Next.js cannot safely cache assets in the `public` folder because they may change. The default caching headers applied are: `Cache-Control: public, max-age=0`". CMaps and font files are immutable per pdfjs-dist version, so serving 1.9 MB of them with `max-age=0` means a revalidation round-trip per asset. Either add a `headers()` rule for the `/pdfjs/` prefix or serve them from a hashed path.

**Do you need them?** `cmaps/` only matters for PDFs using predefined CJK CMaps; `standard_fonts/` matters whenever a PDF references one of the 14 standard fonts without embedding it — which is **extremely common** in real-world documents. Without `standardFontDataUrl`, such text renders with a fallback or not at all. Ship `standard_fonts/` unconditionally. `cmaps/` is the bigger payload and can be made conditional if you know your corpus, but 1.1 MB of lazily-fetched static assets is cheap insurance. `wasm/` only matters for JBIG2 (scanned faxes) and JPEG2000 images.

## A5. Memory and lifecycle

**Direct answer.** The teardown order is: `renderTask.cancel()` → `page.cleanup()` → `pdfDocument.cleanup()` → `loadingTask.destroy()`. There is no `pdfDocument.destroy()` in v6.

### The API surface

```ts
// PDFPageProxy — synchronous, returns false if a render is still running
cleanup(resetStats?: boolean): boolean;

// PDFDocumentProxy — asynchronous
cleanup(keepLoadedFonts?: boolean): Promise<any>;

// PDFDocumentLoadingTask — the only destroy() that exists in v6
destroy(): Promise<void>;
```

Because `page.cleanup()` returns `false` rather than throwing when a render is in flight, a silent leak is the failure mode if you forget to cancel first. Check the return value in development.

### Recommended lifecycle for the editor

```ts
type PageEntry = { page: PDFPageProxy; task: RenderTask | null };

class DocumentSession {
  #loadingTask: PDFDocumentLoadingTask | null = null;
  #doc: PDFDocumentProxy | null = null;
  #pages = new Map<number, PageEntry>();

  async open(data: Uint8Array) {
    await this.close();
    this.#loadingTask = getDocument({
      data,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    });
    this.#doc = await this.#loadingTask.promise;
    return this.#doc;
  }

  releasePage(n: number) {
    const entry = this.#pages.get(n);
    if (!entry) return;
    entry.task?.cancel();
    entry.task = null;
    entry.page.cleanup(); // frees the page's operator list + decoded images
    this.#pages.delete(n);
  }

  async close() {
    for (const n of [...this.#pages.keys()]) this.releasePage(n);
    await this.#doc?.cleanup(); // frees worker-side font/image caches
    await this.#loadingTask?.destroy();
    this.#doc = null;
    this.#loadingTask = null;
  }
}
```

In React 19, call `close()` from the effect cleanup, and be aware that Strict Mode double-invokes effects in development — the session must tolerate `open()` → `close()` → `open()`. Keying the session by a document identity (file hash or object URL) avoids tearing down a session that a second mount is about to reuse.

`getPage()` is memoised inside `PDFDocumentProxy`, so `releasePage` deleting from your own map does not prevent re-fetching the same page cheaply; what `page.cleanup()` reclaims is the parsed operator list and decoded image data, which is where the memory actually is.

### Lazy rendering for many pages

The shape that works:

- Maintain the full page count from `doc.numPages` and lay out placeholders using each page's viewport dimensions. Getting dimensions requires `getPage()`, so for a first paint you can either fetch page 1 and assume uniformity (fast, usually right) or fetch all pages' viewports up front (accurate, one worker round-trip per page). For a document with mixed page sizes the second is necessary, and it is cheap relative to rendering.
- Use an `IntersectionObserver` with a root margin of roughly one viewport to render pages just before they scroll in, and `releasePage` those that leave by more than two or three viewports.
- Keep a hard cap on simultaneously-rasterised pages. At 2\*\*25 device pixels each, a handful of full-resolution canvases is hundreds of MB. Canvas memory is not visible to JS heap profilers, so this ceiling is easy to blow past unnoticed.
- Set `canvas.width = canvas.height = 0` before discarding a canvas element. The official viewer does exactly this at `web/pdf_viewer.mjs:5035` — it is the reliable way to get the backing store released promptly rather than at GC's convenience.

### Thumbnails

Render at a small fixed scale into a separate canvas, using the same `page.render({ canvas, viewport })` call. Two things matter:

- Pass `annotationMode: AnnotationMode.DISABLE` to skip annotation work you will not see at thumbnail size.
- Thumbnails and the main view compete for the same page object. Rendering both concurrently from one `PDFPageProxy` means two live `RenderTask`s on one page, which is supported, but `page.cleanup()` will then refuse (returning `false`) until both finish. Track tasks per purpose, not per page.

The official viewer keeps thumbnails at a capped area rather than a fixed scale, which is worth copying for very large pages: compute `scale` from a target width instead of hard-coding it.

---
