import { toastManager } from "@/components/ui/toast-manager";
import { loadPdfFile } from "@/lib/pdf/load-pdf";

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
