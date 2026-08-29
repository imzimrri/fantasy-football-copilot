-- User's own stated reasoning for holding a player (e.g., "handcuff in case the
-- starter gets hurt"). Agents that touch this player must explicitly address it —
-- confirm it holds up or push back with specific counter-reasoning — rather than
-- silently ignoring it. One note per (user, player); editing overwrites.
create table player_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sleeper_player_id text not null,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sleeper_player_id)
);

alter table player_notes enable row level security;

create policy "users manage their own player notes"
  on player_notes for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger player_notes_set_updated_at
  before update on player_notes
  for each row execute function set_updated_at();
