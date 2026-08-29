-- Adds a "matchup" category for the weekly win/loss-confidence outlook (qualitative,
-- not a fabricated numeric win probability — see lib/agents/roster-analysis.ts) shown
-- on the dashboard alongside per-player start/sit recommendations.
alter table recommendations
  drop constraint recommendations_category_check;

alter table recommendations
  add constraint recommendations_category_check
  check (category in ('start_sit', 'waiver', 'trade', 'news', 'matchup'));
