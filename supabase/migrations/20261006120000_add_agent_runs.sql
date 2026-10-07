-- agent_runs: one row per agent/sync execution (cron or manual "Run analysis now").
-- Exists because agent failures were completely silent — roster-analysis failed most
-- days for weeks (truncated LLM output) and the only symptom the user saw was an empty
-- dashboard. The dashboard now reads the latest run per agent and shows its status.
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  agent text not null,
  status text not null check (status in ('ok', 'error')),
  summary text,
  error text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);

alter table agent_runs enable row level security;

create policy "users manage their own agent runs"
  on agent_runs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index agent_runs_user_agent_finished_idx on agent_runs (user_id, agent, finished_at desc);
