import { toastManager } from "@/components/ui/toast-manager";
import { confirmRedactions } from "@/lib/editor/redaction-gate";
import type { ExportOptions } from "@/lib/pdf/run-export";

/**
 * Export the edited PDF, or only `options.pageIds` (extract), and report
 * the outcome; true when it downloaded.
 */
export const exportPdfWithToast = async (
  options: ExportOptions = {}
): Promise<boolean> => {
  if (!(await confirmRedactions())) {
    return false;
  }
  try {
    // The export runner pulls in pdf.js and the export worker; load it on use.
    const { runExport } = await import("@/lib/pdf/run-export");
    await runExport(options);
    toastManager.add({
      title: options.pageIds ? "Extracted pages" : "Exported PDF",
      type: "success",
    });
    return true;
  } catch (error) {
    toastManager.add({
      description: error instanceof Error ? error.message : "Export failed.",
      title: "Export failed",
      type: "error",
    });
    return false;
  }
};
