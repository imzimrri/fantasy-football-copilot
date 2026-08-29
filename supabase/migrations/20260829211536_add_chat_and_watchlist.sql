-- Chat with the copilot (real conversational Q&A + directives, not just cron-agent
-- output), a running log of team-wide strategy directives the chat can persist for
-- every agent to read (e.g. "keep exactly 2 rostered QBs" — a roster-construction
-- policy, distinct from `player_notes`' per-player reasoning), and a free-agent
-- watchlist for players worth tracking even when they're not this week's top
-- trending-add.

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table chat_messages enable row level security;

create policy "users manage their own chat messages"
  on chat_messages for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index chat_messages_user_created_idx on chat_messages (user_id, created_at);

-- ---------------------------------------------------------------------------

create table team_strategy_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

alter table team_strategy_notes enable row level security;

create policy "users manage their own team strategy notes"
  on team_strategy_notes for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index team_strategy_notes_user_created_idx on team_strategy_notes (user_id, created_at);

-- ---------------------------------------------------------------------------

create table watchlist_players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sleeper_player_id text not null references players(sleeper_player_id),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, sleeper_player_id)
);

alter table watchlist_players enable row level security;

create policy "users manage their own watchlist"
  on watchlist_players for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
