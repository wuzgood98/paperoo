import { toastManager } from "@/components/ui/toast-manager";
import { confirmRedactions } from "@/lib/editor/redaction-gate";
import type { ExportOptions } from "@/lib/pdf/run-export";
import { siteConfig, supportMailto } from "@/lib/site";

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
    const message = error instanceof Error ? error.message : "Export failed.";
    toastManager.add({
      actionProps: {
        children: "Email support",
        onClick: () => {
          window.location.href = supportMailto({
            body: `My export failed with this message:\n\n${message}\n\nWhat I was doing:\n`,
            subject: "Paperoo export failed",
          });
        },
      },
      description: `${message} If it keeps happening, email ${siteConfig.supportEmail}.`,
      title: "Export failed",
      type: "error",
    });
    return false;
  }
};
