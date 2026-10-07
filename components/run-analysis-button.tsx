"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { runAnalysisNow } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LastRun {
  status: "ok" | "error";
  error: string | null;
  finishedAt: string;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Shows whether the last start/sit analysis succeeded, and lets the user re-run it on
 * demand — crons only run once a day, and a failed run used to leave the dashboard
 * silently empty until the next morning.
 */
export function RunAnalysisButton({ lastRun }: { lastRun: LastRun | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await runAnalysisNow();
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" disabled={isPending} onClick={run}>
          <Sparkles size={13} className={cn("mr-1.5", isPending && "animate-pulse")} />
          {isPending ? "Analyzing… (up to a minute)" : "Run analysis now"}
        </Button>
        {lastRun && !isPending && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              lastRun.status === "ok" ? "text-foreground/50" : "text-destructive",
            )}
          >
            {lastRun.status === "ok" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            Last analysis {lastRun.status === "ok" ? "ran" : "failed"} {timeAgo(lastRun.finishedAt)}
          </span>
        )}
      </div>
      {(error ?? (lastRun?.status === "error" ? lastRun.error : null)) && !isPending && (
        <p className="text-xs text-destructive break-words">
          {error ?? lastRun?.error}
        </p>
      )}
    </div>
  );
}
