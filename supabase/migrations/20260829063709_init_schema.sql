-- Fantasy Football Copilot — initial schema
-- Tables are user-scoped (auth.uid() = user_id) per architecture.md's RLS-on-every-
-- table rule, except `players`, which is public NFL reference data (not personal),
-- so it's readable by any authenticated user and writable only by the service role.

-- Shared helper: keep updated_at current on every UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- players: global Sleeper player reference cache (public data, service-role writes only)
-- ---------------------------------------------------------------------------
create table players (
  sleeper_player_id text primary key,
  full_name text not null,
  position text,
  team text,
  status text,
  updated_at timestamptz not null default now()
);

alter table players enable row level security;

create policy "players are readable by any authenticated user"
  on players for select
  to authenticated
  using (true);

create trigger players_set_updated_at
  before update on players
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------
create table leagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sleeper_league_id text not null,
  name text,
  season text,
  scoring_settings jsonb,
  roster_positions jsonb,
  settings jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sleeper_league_id)
);

alter table leagues enable row level security;

create policy "users manage their own leagues"
  on leagues for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger leagues_set_updated_at
  before update on leagues
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- rosters
-- ---------------------------------------------------------------------------
create table rosters (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sleeper_roster_id integer not null,
  sleeper_owner_id text,
  is_own_team boolean not null default false,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  points_for numeric not null default 0,
  points_against numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, sleeper_roster_id)
);

alter table rosters enable row level security;

create policy "users manage their own rosters"
  on rosters for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger rosters_set_updated_at
  before update on rosters
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- roster_players: which players sit on which synced roster
-- ---------------------------------------------------------------------------
create table roster_players (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references rosters(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sleeper_player_id text not null references players(sleeper_player_id),
  roster_slot text,
  is_starter boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_id, sleeper_player_id)
);

alter table roster_players enable row level security;

create policy "users manage their own roster players"
  on roster_players for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger roster_players_set_updated_at
  before update on roster_players
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- matchups
-- ---------------------------------------------------------------------------
create table matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week integer not null,
  roster_id uuid not null references rosters(id) on delete cascade,
  opponent_roster_id uuid references rosters(id) on delete set null,
  points numeric,
  opponent_points numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, week, roster_id)
);

alter table matchups enable row level security;

create policy "users manage their own matchups"
  on matchups for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger matchups_set_updated_at
  before update on matchups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- recommendations: agent output, doubles as history (status tracks "followed?")
--
-- NOTE: architecture.md originally sketched a separate `recommendation_history`
-- table; collapsed into one table with a `status` column during schema design —
-- a second table would just duplicate this data for no benefit. FR22 (weekly
-- summary) and FR23 (history + followed/not) are both served by filtering this
-- one table by week/status.
-- ---------------------------------------------------------------------------
create table recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  category text not null check (category in ('start_sit', 'waiver', 'trade', 'news')),
  week integer,
  title text not null,
  reasoning text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'followed', 'not_followed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table recommendations enable row level security;

create policy "users manage their own recommendations"
  on recommendations for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger recommendations_set_updated_at
  before update on recommendations
  for each row execute function set_updated_at();

create index recommendations_user_week_idx on recommendations (user_id, week);
