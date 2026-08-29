-- Trade offers synced from Sleeper's transactions endpoint (FR14-17, Growth phase).
-- adds/drops mirror Sleeper's own shape: { sleeper_player_id: sleeper_roster_id }.
create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  sleeper_transaction_id text not null unique,
  status text not null check (status in ('pending', 'complete', 'failed')),
  week integer not null,
  roster_ids_involved integer[] not null,
  adds jsonb not null default '{}'::jsonb,
  drops jsonb not null default '{}'::jsonb,
  draft_picks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table trades enable row level security;

create policy "users manage their own trades"
  on trades for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger trades_set_updated_at
  before update on trades
  for each row execute function set_updated_at();

create index trades_league_status_idx on trades (league_id, status);
