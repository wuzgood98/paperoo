import { printPdfBlob } from "@/lib/pdf/print-blob";
import { buildEditedPdfBytes, reportFlattened } from "@/lib/pdf/run-export";

export const runPrint = async (): Promise<void> => {
  const edited = await buildEditedPdfBytes();
  const { bytes: result } = edited;
  const blob = new Blob([result], { type: "application/pdf" });
  await printPdfBlob(blob);
  reportFlattened(edited);
};
