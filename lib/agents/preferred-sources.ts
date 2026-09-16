/**
 * Sources the user personally follows and wants factored in alongside general
 * research, everywhere the app does a Perplexity search — not a replacement for
 * broader research (restricting to just these would lose real signal: injury news,
 * depth-chart changes, sources these two don't cover), just a standing instruction to
 * specifically check and cite them when they have something relevant to say.
 *
 * The blog publishes a new dated URL each week (e.g. .../fantasy-football-waiver-
 * wire-2026-week-2/) — deliberately described by pattern here, not a single hardcoded
 * URL, so this stays useful every week rather than pointing at one week-2 article
 * forever.
 */
export const PREFERRED_SOURCES_NOTE =
  "\n\nThe user also specifically follows these sources — check them and cite " +
  "whatever's current and relevant, alongside your broader research (don't treat " +
  "this as the only two sources to use):\n" +
  "- The Fantasy Football Almanac blog (thefantasyfootballalmanac.com), which " +
  "publishes a new dated weekly waiver-wire article each week (URL pattern: " +
  "thefantasyfootballalmanac.com/YYYY/MM/DD/fantasy-football-waiver-wire-YYYY-week-N/) " +
  "— find and use the CURRENT week's post, not an old one.\n" +
  "- Sal Vetri's fantasy football YouTube channel/videos.";
