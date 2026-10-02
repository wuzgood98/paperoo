import { printPdfBlob } from "@/lib/pdf/print-blob";
import { buildEditedPdfBytes } from "@/lib/pdf/run-export";

export const runPrint = async (): Promise<void> => {
  const result = await buildEditedPdfBytes();
  const blob = new Blob([result], { type: "application/pdf" });
  await printPdfBlob(blob);
};
