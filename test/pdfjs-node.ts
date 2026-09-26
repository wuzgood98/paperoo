import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  )
).href;

export const loadPdfJsDocument = (data: Uint8Array) =>
  getDocument({
    data,
    standardFontDataUrl: `${
      pathToFileURL(
        path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")
      ).href
    }/`,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
  });
