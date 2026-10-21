import { exportPdfWithToast } from "@/components/editor/export-action";
import { confirmReplaceDocument } from "@/components/editor/replace-document";
import { toastManager } from "@/components/ui/toast-manager";
import {
  supportsPdfEngine,
  UNSUPPORTED_BROWSER_MESSAGE,
} from "@/lib/browser-support";

// pdf.js, page extraction and OCR load on demand, not with the empty page.
const loadPdfModule = () => import("@/lib/pdf/load-pdf");

let prewarmed = false;

/**
 * Fetch the PDF code and spawn the pdf.js worker once the user shows intent
 * to open a file (hover, focus, drag), so visitors who never open one skip
 * the download and the first open skips worker spawn and script compile.
 */
export const prewarmPdfOpen = async (): Promise<void> => {
  if (prewarmed) {
    return;
  }
  prewarmed = true;
  const [{ ensurePdfjsWorker }] = await Promise.all([
    import("@/lib/pdf/pdfjs"),
    loadPdfModule(),
  ]);
  ensurePdfjsWorker();
};

const loadPdfFile = async (file: File): Promise<void> => {
  const { loadPdfFile: load } = await loadPdfModule();
  await load(file);
};

const fail = (message: string): void => {
  toastManager.add({
    description: message,
    title: "Upload failed",
    type: "error",
  });
};

/** False, after telling the user, when this browser cannot run pdf.js. */
const canOpenPdf = (): boolean => {
  if (supportsPdfEngine()) {
    return true;
  }
  fail(UNSUPPORTED_BROWSER_MESSAGE);
  return false;
};

/** False when the user keeps the open document instead. */
const mayReplaceDocument = async (): Promise<boolean> => {
  const choice = await confirmReplaceDocument();
  if (choice === "export") {
    return exportPdfWithToast();
  }
  return choice === "discard";
};

export const openPdfFromList = async (
  files: FileList | null | undefined
): Promise<void> => {
  const file = files?.[0];
  if (!file || !canOpenPdf() || !(await mayReplaceDocument())) {
    return;
  }
  try {
    await loadPdfFile(file);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not open this PDF.");
  }
};

export const openPdfFromUrl = async (
  url: string,
  fileName: string
): Promise<void> => {
  if (!canOpenPdf() || !(await mayReplaceDocument())) {
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Could not download that PDF.");
    }
    const bytes = await response.arrayBuffer();
    const file = new File([new Uint8Array(bytes)], fileName, {
      type: "application/pdf",
    });
    await loadPdfFile(file);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not open this PDF.");
  }
};
