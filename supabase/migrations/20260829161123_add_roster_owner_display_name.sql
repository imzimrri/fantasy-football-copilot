-- Adds the opponent's display name to rosters (from Sleeper's league users list) so
-- the schedule view can show "vs SkittlesSzn" instead of a bare roster/owner id.
alter table rosters
  add column owner_display_name text;
