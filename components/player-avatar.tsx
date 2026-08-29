"use client";

import { useState } from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sleeper's public headshot CDN — same URL pattern their own web client uses
 * (no auth, no API call needed): https://sleepercdn.com/content/nfl/players/{id}.jpg
 */
function headshotUrl(sleeperPlayerId: string) {
  return `https://sleepercdn.com/content/nfl/players/${sleeperPlayerId}.jpg`;
}

export function PlayerAvatar({
  sleeperPlayerId,
  fullName,
  className,
}: {
  sleeperPlayerId: string;
  fullName: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={cn(
          "size-10 rounded-full bg-muted flex items-center justify-center shrink-0",
          className,
        )}
        title={fullName}
      >
        <User size={18} className="text-foreground/40" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external CDN, not a local/optimizable asset
    <img
      src={headshotUrl(sleeperPlayerId)}
      alt={fullName}
      className={cn("size-10 rounded-full bg-muted object-cover shrink-0", className)}
      onError={() => setFailed(true)}
    />
  );
}
