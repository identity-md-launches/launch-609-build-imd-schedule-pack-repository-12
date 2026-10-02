# Changelog

## Revision — 2026-10-02

- Fixed the request wrapper: schedules send top-level `schedule.create`, while bodies
  01-06 send top-level `oracle.request` with the six supported draft fields.
- Added draft verdict counts to the summary and network calculation; blocked, refused,
  or unreachable drafts now cause a nonzero exit.
- Applied the 3.5-second draft delay before the first draft and every retry.
- Added regression checks in `bin/tests/check.test.mjs` and retained live GET responses
  and draft POST bodies beside them in `bin/tests/live/`; scratch files are not submitted.
- Regenerated `results.json` using `npm run check` against the live API and re-verified
  the README claim: all six genuine drafts were judged with no blockers or suggestions.
  The first run returned a wording suggestion for body 05; the unchanged repeat did not.
  Both runs are retained (`bin/tests/live/initial-run.json` and the final draft fixtures).

## 2026-10-02

- Updated `bin/check.mjs` to run standalone `oracle.request` draft checks for oracle bodies 01-06,
  using the question, panel size, answer type, evidence, chain ID, and optional head fields.
- Added a 3.5-second delay between consecutive oracle draft check requests and included each draft's
  input, blockers, suggestions, and live response body in `oracleDraftChecks`.
- Regenerated `results.json` with the checker against the live API: all 12 schedules were accepted,
  but the six purported draft responses were malformed schedule checks (corrected above).
- Made read-only GET requests to the API root and `/requests/check`; the live response bodies used
  for that verification were saved in temporary `test/scratch/` and were not submitted.
  The revision above retains its evidence under `bin/tests/live/`.

- Draft-checked all six oracle questions through the live `oracle.request` check and recorded
  the requests and responses in `results.json`; each final draft has no `wording` or
  `not_answerable` suggestion.
- Rewrote the six oracle questions to state their time window and answer criteria while
  preserving their schedule purposes, cadences, and run counts.
- Rechecked all 12 bodies through the live `schedule.create` check and recorded the accepted
  results in `results.json`.
- Corrected the README to explain that `schedule.create` checks cover the schedule, while the
  standalone `oracle.request` check covers the oracle wording and answerability screen.
