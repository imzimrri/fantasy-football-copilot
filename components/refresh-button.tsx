"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshFromSleeper } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Manual sync trigger — the app otherwise only refreshes from Sleeper on the cron
 * schedule (daily), which means a real move made directly in the Sleeper app doesn't
 * show up here until the next scheduled run. This button runs that same sync on
 * demand, so "I just dropped X and added Y in Sleeper, why doesn't this reflect that"
 * has a direct fix instead of a wait.
 */
export function RefreshButton() {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await refreshFromSleeper();
      setFeedback(
        result.ok
          ? { ok: true, text: result.summary }
          : { ok: false, text: result.error },
      );
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={isPending} onClick={refresh}>
        <RefreshCw size={13} className={cn("mr-1.5", isPending && "animate-spin")} />
        {isPending ? "Syncing…" : "Refresh from Sleeper"}
      </Button>
      {feedback && (
        <span
          className={cn(
            "text-xs",
            feedback.ok ? "text-foreground/50" : "text-destructive",
          )}
        >
          {feedback.text}
        </span>
      )}
    </div>
  );
}
