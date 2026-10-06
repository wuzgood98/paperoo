import { editorStore } from "@/lib/editor/store";
import { isPdfBytes, pdfSession, readFileBytes } from "@/lib/pdf/session";

export const loadPdfFile = async (file: File): Promise<void> => {
  editorStore.setStatus("loading");
  editorStore.setFileName(file.name);

  try {
    if (file.type && file.type !== "application/pdf") {
      throw new Error("That file is not a PDF.");
    }

    const bytes = await readFileBytes(file);
    if (!isPdfBytes(bytes)) {
      throw new Error("This file does not look like a valid PDF.");
    }

    const { form, pages } = await pdfSession.open(bytes);
    if (pages.length === 0) {
      throw new Error("This PDF has no pages.");
    }

    editorStore.resetDocument(pages, file.name, form);
  } catch (error) {
    await pdfSession.close();
    const message =
      error instanceof Error ? error.message : "Could not open this PDF.";
    editorStore.clearDocument();
    editorStore.setStatus("error", message);
    throw error;
  }
};
