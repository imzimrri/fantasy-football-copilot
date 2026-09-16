-- Chat now runs a live, message-specific Perplexity research step (in addition to
-- the roster/notes/watchlist context it already had), so an assistant reply can cite
-- real sources — same pattern as recommendations.sources.
alter table chat_messages
  add column sources jsonb not null default '[]'::jsonb;

comment on column chat_messages.sources is
  'Array of {title, url} citations from the live research step behind an assistant reply. Always empty on user-role rows.';
