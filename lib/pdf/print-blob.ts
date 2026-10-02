const PRINT_CLEANUP_FALLBACK_MS = 60_000;
const PRINT_VIEWER_SETTLE_MS = 1000;

/** Print.js-style box: enough height for the PDF viewer, opacity-hidden (not display:none). */
const PRINT_IFRAME_STYLE =
  "position:fixed;left:0;top:0;width:1px;height:100px;opacity:0;border:none;pointer-events:none;";

const wait = (ms: number): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- timer-based settle delay for PDF viewer
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const printPdfBlob = async (blob: Blob): Promise<void> => {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = PRINT_IFRAME_STYLE;

  // oxlint-disable-next-line promise/avoid-new -- iframe load / afterprint are event-driven
  await new Promise<void>((resolve, reject) => {
    let cleaned = false;
    let loadHandled = false;
    let fallbackId: ReturnType<typeof setTimeout> | undefined;

    const dispose = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      if (fallbackId !== undefined) {
        clearTimeout(fallbackId);
      }
      iframe.remove();
      URL.revokeObjectURL(url);
    };

    const finish = (): void => {
      dispose();
      resolve();
    };

    const fail = (error: Error): void => {
      dispose();
      reject(error);
    };

    iframe.addEventListener("load", () => {
      if (loadHandled) {
        return;
      }
      loadHandled = true;

      void (async () => {
        try {
          await wait(PRINT_VIEWER_SETTLE_MS);
          if (cleaned) {
            return;
          }

          const win = iframe.contentWindow;
          if (!win) {
            fail(new Error("Could not open print preview."));
            return;
          }

          // Register after settle and before print — print() blocks until the dialog
          // closes, so afterprint must already be listening. Do not use beforeunload:
          // PDF viewer init can unload the frame during settle and tear down early.
          win.addEventListener("afterprint", finish, { once: true });
          fallbackId = setTimeout(finish, PRINT_CLEANUP_FALLBACK_MS);

          win.focus();
          win.print();
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error("Could not open the print dialog.")
          );
        }
      })();
    });

    iframe.addEventListener("error", () => {
      fail(new Error("Could not load PDF for printing."));
    });

    document.body.append(iframe);
    iframe.src = url;
  });
};
