-- Generic response cache for expensive external calls (Perplexity research, LLM
-- reasoning) — cost control per the PRD, and specifically to avoid re-spending tokens
-- every time an agent is re-run against unchanged data (e.g., repeated manual testing).
-- Service-role only: RLS enabled with zero policies means only the service-role client
-- (which bypasses RLS) can read/write — no user ever needs to see this table directly.
create table api_cache (
  cache_key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

alter table api_cache enable row level security;

comment on table api_cache is
  'Best-effort cache for external API responses (Perplexity, LLM calls), keyed by a hash of the request. A cache miss/failure never breaks the caller.';
