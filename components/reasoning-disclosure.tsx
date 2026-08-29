"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Expand-to-see-why control — serves FR6/FR12/FR16 (every recommendation must show its reasoning, not just a verdict). */
export function ReasoningDisclosure({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground"
      >
        <ChevronDown
          size={14}
          className={cn("transition-transform", open && "rotate-180")}
        />
        {open ? "Hide reasoning" : "Why?"}
      </button>
      {open && (
        <p className="mt-2 text-sm text-foreground/80 border-l-2 pl-3">{reasoning}</p>
      )}
    </div>
  );
}
