import { toastManager } from "@/components/ui/toast-manager";

/** Export the edited PDF and report the outcome; true when it downloaded. */
export const exportPdfWithToast = async (): Promise<boolean> => {
  try {
    // The export runner pulls in pdf.js and the export worker; load it on use.
    const { runExport } = await import("@/lib/pdf/run-export");
    await runExport();
    toastManager.add({ title: "Exported PDF", type: "success" });
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
