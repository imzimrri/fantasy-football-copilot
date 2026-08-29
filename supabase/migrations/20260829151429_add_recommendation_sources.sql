-- Adds source citations (not just reasoning) to recommendations, backing the
-- Perplexity research step: agents now record WHERE information came from,
-- not just WHY a recommendation was made.
alter table recommendations
  add column sources jsonb not null default '[]'::jsonb;

comment on column recommendations.sources is
  'Array of {title, url} citations from the research step that grounded this recommendation.';
