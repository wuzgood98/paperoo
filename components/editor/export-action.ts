import { focusPdfFormWidget } from "@/components/editor/form-focus";
import { toastManager } from "@/components/ui/toast-manager";
import {
  documentForm,
  emptyRequiredPdfFormFields,
} from "@/lib/editor/object-utils";
import { confirmOutput } from "@/lib/editor/output-gate";
import { editorStore } from "@/lib/editor/store";
import type { ExportOptions } from "@/lib/pdf/run-export";
import { siteConfig, supportMailto } from "@/lib/site";

/** After export: say how many required fields are empty, and show the first. */
const warnEmptyRequiredFields = (): void => {
  const { document } = editorStore.getState();
  const empty = emptyRequiredPdfFormFields(
    documentForm(document),
    document.pages.map((page) => page.id)
  );
  const [first] = empty;
  const firstWidget = first?.widgets[0];
  if (!firstWidget) {
    return;
  }
  toastManager.add({
    actionProps: {
      children: "Show",
      onClick: () => {
        focusPdfFormWidget(firstWidget);
      },
    },
    description: "The PDF was saved anyway.",
    title:
      empty.length === 1
        ? "1 required field is empty"
        : `${empty.length} required fields are empty`,
    type: "warning",
  });
};

/**
 * Export the edited PDF, or only `options.pageIds` (extract), and report
 * the outcome; true when it downloaded.
 */
export const exportPdfWithToast = async (
  options: ExportOptions = {}
): Promise<boolean> => {
  if (!(await confirmOutput())) {
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
    if (!options.pageIds) {
      warnEmptyRequiredFields();
    }
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
