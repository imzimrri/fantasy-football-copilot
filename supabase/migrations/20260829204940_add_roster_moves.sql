-- roster_moves: waiver/free-agent adds & drops synced from Sleeper's transactions
-- endpoint (trade-type transactions already go into `trades`). Lets the user see, in
-- hindsight, whether an AI waiver suggestion (or a move they made on their own) was
-- actually a good call, by comparing the real points scored by the added vs. dropped
-- player from the transaction week forward.
create table roster_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  sleeper_transaction_id text not null unique,
  type text not null check (type in ('waiver', 'free_agent')),
  status text not null check (status in ('pending', 'complete', 'failed')),
  week integer not null,
  -- adds/drops mirror Sleeper's own shape: { sleeper_player_id: sleeper_roster_id }.
  adds jsonb not null default '{}'::jsonb,
  drops jsonb not null default '{}'::jsonb,
  -- Set when this move matches a prior pending waiver recommendation (fuzzy name
  -- match on addPlayer/dropCandidate) — lets the UI show "you followed this
  -- suggestion" and surface the AI's original reasoning next to the real outcome.
  matched_recommendation_id uuid references recommendations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table roster_moves enable row level security;

create policy "users manage their own roster moves"
  on roster_moves for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger roster_moves_set_updated_at
  before update on roster_moves
  for each row execute function set_updated_at();

create index roster_moves_league_week_idx on roster_moves (league_id, week);
