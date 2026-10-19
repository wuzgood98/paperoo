"use client";

import { HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PersistedMeta } from "@/lib/session/schema";

// IndexedDB and the restore path load only on the empty page, after paint.
const loadRestore = () => import("@/lib/session/restore");

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const savedAgo = (savedAt: number): string => {
  const format = relativeTime;
  const elapsed = Date.now() - savedAt;
  if (elapsed < HOUR_MS) {
    return format.format(
      -Math.max(0, Math.round(elapsed / MINUTE_MS)),
      "minute"
    );
  }
  if (elapsed < DAY_MS) {
    return format.format(-Math.round(elapsed / HOUR_MS), "hour");
  }
  return format.format(-Math.round(elapsed / DAY_MS), "day");
};

/** Offers the session autosaved before a crash, reload or closed tab. */
export const RestoreSessionBanner = () => {
  const [meta, setMeta] = useState<PersistedMeta | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { peekSavedSession } = await loadRestore();
      const saved = await peekSavedSession();
      if (!cancelled) {
        setMeta(saved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!meta) {
    return null;
  }

  const pages = meta.pageOrder.length;
  return (
    <div className="absolute inset-x-0 bottom-6 mx-auto w-[calc(100%-2rem)] max-w-md transition-[opacity,translate] duration-250 ease-out max-sm:static starting:opacity-0 motion-safe:starting:translate-y-2 [@media(max-height:640px)]:static">
      <Alert className="max-w-md text-left" variant="info">
        <HistoryIcon />
        <AlertTitle>Restore your last session?</AlertTitle>
        <AlertDescription>
          <span className="break-all">{meta.fileName}</span> · {pages}{" "}
          {pages === 1 ? "page" : "pages"} · saved {savedAgo(meta.savedAt)}.
          Unexported edits are kept in this browser until you export or discard
          them.
        </AlertDescription>
        {/* Not AlertAction: the long description needs the full width, so the
            buttons sit below it like a dialog footer. */}
        <div className="col-start-2 mt-2 flex justify-end gap-1">
          <Button
            disabled={restoring}
            onClick={async () => {
              const { discardSavedSession } = await loadRestore();
              await discardSavedSession();
              setMeta(null);
            }}
            size="sm"
            variant="ghost"
          >
            Discard
          </Button>
          <Button
            disabled={restoring}
            onClick={async () => {
              setRestoring(true);
              const { restoreSavedSession } = await loadRestore();
              await restoreSavedSession();
              setRestoring(false);
              setMeta(null);
            }}
            size="sm"
          >
            Restore
          </Button>
        </div>
      </Alert>
    </div>
  );
};
