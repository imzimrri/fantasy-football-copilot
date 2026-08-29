import type { RecommendationSource } from "@/lib/types";

/**
 * Defense in depth: `lib/perplexity.ts` already filters to http(s) URLs before
 * storage, but this renders whatever's in the DB — validate again here so a bad row
 * (old data, a direct DB write) can't produce a `javascript:`-scheme link.
 */
function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Answers "where" (not just "why") — the citations from the Perplexity research step. */
export function SourcesList({ sources }: { sources: RecommendationSource[] }) {
  const safeSources = sources.filter((source) => isSafeHttpUrl(source.url));
  if (safeSources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/50">
      <span>Sources:</span>
      {safeSources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground truncate max-w-[200px]"
        >
          {source.title}
        </a>
      ))}
    </div>
  );
}
