import {
  copyFile,
  cp,
  mkdir,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, "..");
const publicOcr = path.join(root, "public", "ocr");
const publicCore = path.join(publicOcr, "core");

const tesseractPkg = require.resolve("tesseract.js/package.json");
const tesseractRoot = path.dirname(tesseractPkg);
const coreRoot = path.dirname(
  require.resolve("tesseract.js-core/package.json", {
    paths: [tesseractRoot, root],
  })
);

const traineddataUrl =
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz";

await mkdir(publicCore, { recursive: true });

await copyFile(
  path.join(tesseractRoot, "dist", "worker.min.js"),
  path.join(publicOcr, "worker.min.js")
);

const coreNames = await readdir(coreRoot);
await Promise.all(
  coreNames
    // With a core directory, tesseract.js loads only one `*-lstm.wasm.js`
    // (WASM inlined); the separate .js/.wasm variants are never fetched.
    .filter((name) => name.endsWith("-lstm.wasm.js"))
    .map((name) => cp(path.join(coreRoot, name), path.join(publicCore, name)))
);

const traineddataPath = path.join(publicOcr, "eng.traineddata.gz");
let hasTraineddata = false;
try {
  const info = await stat(traineddataPath);
  hasTraineddata = info.size > 0;
} catch {
  hasTraineddata = false;
}

if (!hasTraineddata) {
  const response = await fetch(traineddataUrl);
  if (!response.ok) {
    throw new Error(
      `Could not download English OCR data (${response.status}).`
    );
  }
  await writeFile(
    traineddataPath,
    new Uint8Array(await response.arrayBuffer())
  );
}

console.log(
  "Copied Tesseract.js worker, LSTM cores, and English traineddata into public/ocr"
);
