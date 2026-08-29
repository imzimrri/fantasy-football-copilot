"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markRecommendationStatus } from "@/app/(app)/history/actions";
import type { RecommendationStatus } from "@/lib/types";

/** FR23: buttons to mark a recommendation followed/not followed/dismissed. */
export function HistoryActions({
  id,
  status,
}: {
  id: string;
  status: RecommendationStatus;
}) {
  const [isPending, startTransition] = useTransition();

  const setStatus = (next: RecommendationStatus) => {
    startTransition(() => {
      markRecommendationStatus(id, next);
    });
  };

  if (status !== "pending") {
    return <span className="text-xs text-foreground/60 capitalize">{status.replace("_", " ")}</span>;
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => setStatus("followed")}
      >
        Followed
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => setStatus("not_followed")}
      >
        Didn&apos;t follow
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => setStatus("dismissed")}
      >
        Dismiss
      </Button>
    </div>
  );
}
