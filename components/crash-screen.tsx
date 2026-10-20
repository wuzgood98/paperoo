"use client";

import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  MailIcon,
  RotateCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { siteConfig, supportMailto } from "@/lib/site";
import { cn } from "@/lib/utils";

const COPIED_RESET_MS = 1600;

const TEAR_POINTS = "40,78 52,72 64,80 76,73 88,81 100,74 112,80 130,73";

const PAGE_PATH =
  "M54 22H104L124 42V118A8 8 0 0 1 116 126H54A8 8 0 0 1 46 118V30A8 8 0 0 1 54 22Z";

const PageBody = () => (
  <>
    <path
      className="fill-card stroke-foreground/25"
      d={PAGE_PATH}
      strokeLinejoin="round"
      strokeWidth={1.5}
    />
    <path
      className="fill-muted stroke-foreground/25"
      d="M104 22V38A4 4 0 0 0 108 42H124"
      strokeLinejoin="round"
      strokeWidth={1.5}
    />
    <rect
      className="fill-muted-foreground/25"
      height={4}
      rx={2}
      width={36}
      x={58}
      y={50}
    />
    <rect
      className="fill-muted-foreground/15"
      height={4}
      rx={2}
      width={52}
      x={58}
      y={60}
    />
    <rect
      className="fill-muted-foreground/15"
      height={4}
      rx={2}
      width={46}
      x={58}
      y={92}
    />
    <rect
      className="fill-muted-foreground/15"
      height={4}
      rx={2}
      width={52}
      x={58}
      y={102}
    />
    <rect
      className="fill-muted-foreground/15"
      height={4}
      rx={2}
      width={30}
      x={58}
      y={112}
    />
  </>
);

const TearEdge = () => (
  <polyline
    className="stroke-foreground/25"
    fill="none"
    points={TEAR_POINTS}
    strokeLinejoin="round"
    strokeWidth={1.5}
  />
);

/** A Paperoo page torn across the middle; the lower half drops on mount. */
const TornPage = () => (
  <svg
    aria-hidden
    className="size-40 overflow-visible drop-shadow-sm"
    fill="none"
    viewBox="0 0 160 140"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <clipPath id="crash-page-top">
        <polygon points={`40,4 130,4 130,73 ${TEAR_POINTS} 40,78`} />
      </clipPath>
      <clipPath id="crash-page-bottom">
        <polygon points={`${TEAR_POINTS} 130,140 40,140`} />
      </clipPath>
    </defs>
    <rect
      className="fill-muted stroke-foreground/10"
      height={104}
      rx={8}
      strokeWidth={1.5}
      transform="rotate(-9 85 74)"
      width={78}
      x={46}
      y={22}
    />
    <g clipPath="url(#crash-page-top)">
      <PageBody />
    </g>
    <TearEdge />
    <g className="crash-tear">
      <g clipPath="url(#crash-page-bottom)">
        <PageBody />
      </g>
      <TearEdge />
    </g>
  </svg>
);

const errorDetails = (error: Error & { digest?: string }): string => {
  const lines = [error.message || "Unknown error"];
  if (error.digest) {
    lines.push(`Reference: ${error.digest}`);
  }
  return lines.join("\n");
};

/** What people see when Paperoo crashes: reload, or tell support. */
export const CrashScreen = ({
  error,
}: {
  error: Error & { digest?: string };
}) => {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  const details = errorDetails(error);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(
      () => setCopied(false),
      COPIED_RESET_MS
    );
  };

  return (
    <main className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center text-center transition duration-300 ease-out starting:opacity-0 motion-safe:starting:translate-y-1.5">
        <TornPage />
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-balance">
          This page got jammed
        </h1>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          Something broke inside Paperoo. Your edits are autosaved in this
          browser, so reloading should bring them back.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            pressable
            onClick={() => {
              window.location.reload();
            }}
          >
            <RotateCwIcon />
            Reload Paperoo
          </Button>
          <a
            className={cn(
              buttonVariants({ variant: "outline" }),
              "editor-pressable"
            )}
            href={supportMailto({
              body: `Paperoo crashed.

${details}

What I was doing:
`,
              subject: "Paperoo crashed",
            })}
          >
            <MailIcon />
            Email support
          </a>
        </div>
        <details className="group/details mt-8 w-full text-left">
          <summary className="text-muted-foreground hover:text-foreground mx-auto flex w-fit cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors select-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform duration-200 ease-out group-open/details:rotate-90" />
            Error details
          </summary>
          <div className="bg-muted/60 border-border mt-3 flex items-start gap-2 rounded-lg border p-3">
            <pre className="text-muted-foreground min-w-0 flex-1 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {details}
            </pre>
            <Button
              aria-label={copied ? "Copied" : "Copy error details"}
              onClick={copyDetails}
              size="icon-xs"
              variant="ghost"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </details>
        <p className="text-muted-foreground mt-3 text-xs">
          Or write to{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href={`mailto:${siteConfig.supportEmail}`}
          >
            {siteConfig.supportEmail}
          </a>
        </p>
      </div>
    </main>
  );
};
