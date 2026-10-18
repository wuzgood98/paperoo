import { toastManager } from "@/components/ui/toast-manager";

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

export const openPdfFromList = async (
  files: FileList | null | undefined
): Promise<void> => {
  const file = files?.[0];
  if (!file) {
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
