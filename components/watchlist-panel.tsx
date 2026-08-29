"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Eye, Plus, X } from "lucide-react";
import {
  addToWatchlist,
  removeFromWatchlist,
  searchPlayers,
} from "@/app/(app)/waivers/actions";
import { PlayerAvatar } from "@/components/player-avatar";
import { Button } from "@/components/ui/button";

interface WatchedPlayer {
  sleeperPlayerId: string;
  fullName: string;
  position: string | null;
  team: string | null;
  note: string | null;
}

interface SearchResult {
  sleeper_player_id: string;
  full_name: string;
  position: string | null;
  team: string | null;
}

/**
 * Free-agent watchlist (FR10-13 extension): track a player before they're this week's
 * top trending-add — waiver-research always evaluates everyone here, regardless of
 * trending status. Search is a debounced Server Action call against the `players`
 * cache, not a live external lookup, so it's instant and free.
 */
export function WatchlistPanel({ initialWatchlist }: { initialWatchlist: WatchedPlayer[] }) {
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchPlayers(query);
        if (result.ok) setResults(result.data);
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const watchedIds = new Set(watchlist.map((w) => w.sleeperPlayerId));

  const add = (player: SearchResult) => {
    setWatchlist((prev) => [
      ...prev,
      {
        sleeperPlayerId: player.sleeper_player_id,
        fullName: player.full_name,
        position: player.position,
        team: player.team,
        note: null,
      },
    ]);
    setQuery("");
    setResults([]);
    startTransition(() => {
      addToWatchlist(player.sleeper_player_id);
    });
  };

  const remove = (sleeperPlayerId: string) => {
    setWatchlist((prev) => prev.filter((w) => w.sleeperPlayerId !== sleeperPlayerId));
    startTransition(() => {
      removeFromWatchlist(sleeperPlayerId);
    });
  };

  return (
    <div className="rounded-lg border p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Eye size={16} className="text-foreground/50" />
        <h2 className="font-medium text-sm">Watchlist</h2>
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a player to track (e.g. Barion Brown)…"
          className="w-full text-sm border rounded-md p-2 bg-background"
        />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md max-h-64 overflow-y-auto">
            {results.map((p) => (
              <button
                key={p.sleeper_player_id}
                type="button"
                disabled={watchedIds.has(p.sleeper_player_id)}
                onClick={() => add(p)}
                className="w-full flex items-center gap-2 p-2 text-left text-sm hover:bg-muted/50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <PlayerAvatar
                  sleeperPlayerId={p.sleeper_player_id}
                  fullName={p.full_name}
                  className="size-7"
                />
                <span className="flex-1 truncate">{p.full_name}</span>
                <span className="text-xs text-foreground/50">
                  {p.position ?? "?"} {p.team ?? "FA"}
                </span>
                {watchedIds.has(p.sleeper_player_id) ? (
                  <span className="text-xs text-foreground/40">Watching</span>
                ) : (
                  <Plus size={14} className="text-foreground/40" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {watchlist.length === 0 ? (
        <p className="text-xs text-foreground/40">
          Nothing tracked yet — search above to add a free agent you want considered
          before they trend.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {watchlist.map((w) => (
            <div
              key={w.sleeperPlayerId}
              className="flex items-center gap-2 text-sm rounded-md px-2 py-1.5 hover:bg-muted/40"
            >
              <PlayerAvatar sleeperPlayerId={w.sleeperPlayerId} fullName={w.fullName} className="size-7" />
              <div className="flex-1 min-w-0">
                <p className="truncate">{w.fullName}</p>
                <p className="text-xs text-foreground/50">
                  {w.position ?? "?"} {w.team ?? "FA"}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => remove(w.sleeperPlayerId)}
                aria-label={`Remove ${w.fullName} from watchlist`}
              >
                <X size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
