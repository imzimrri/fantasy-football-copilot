"use client";

import { useState, useTransition } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { savePlayerNote } from "@/app/(app)/roster/actions";
import { cn } from "@/lib/utils";

/**
 * "Why I'm holding this player" — the user's own reasoning, which agents are required
 * to explicitly address (see lib/agents/waiver-research.ts). Distinct from agent-
 * generated reasoning: this is the ONE place in the app that's the user's voice, not
 * the AI's.
 */
export function PlayerNoteEditor({
  sleeperPlayerId,
  initialNote,
}: {
  sleeperPlayerId: string;
  initialNote: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={cn(
          "flex items-center gap-1.5 text-xs rounded-md px-2 py-1 transition-colors",
          initialNote
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
            : "text-foreground/40 hover:text-foreground/70 hover:bg-muted/50",
        )}
      >
        <StickyNote size={13} />
        {initialNote ? "Your reasoning: " + initialNote : "Add your reasoning"}
      </button>
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Why are you holding this player? e.g. &quot;Handcuff in case the starter gets hurt&quot;"
        className="w-full text-sm border rounded-md p-2 bg-background resize-none"
        rows={2}
        autoFocus
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await savePlayerNote(sleeperPlayerId, value);
              setEditing(false);
            })
          }
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setValue(initialNote ?? "");
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
