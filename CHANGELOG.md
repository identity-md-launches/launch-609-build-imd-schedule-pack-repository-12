# Changelog

## 2026-10-02

- Updated `bin/check.mjs` to run standalone `oracle.request` draft checks for oracle bodies 01-06,
  using the question, panel size, answer type, evidence, chain ID, and optional head fields.
- Added a 3.5-second delay between consecutive oracle draft check requests and included each draft's
  input, blockers, suggestions, and live response body in `oracleDraftChecks`.
- Regenerated `results.json` with the checker against the live API: all 12 schedules were accepted,
  and all six drafts had no suggestions.
- Made read-only GET requests to the API root and `/requests/check`; the live response bodies used
  for verification are saved with the scratch checks under `test/scratch/`.

- Draft-checked all six oracle questions through the live `oracle.request` check and recorded
  the requests and responses in `results.json`; each final draft has no `wording` or
  `not_answerable` suggestion.
- Rewrote the six oracle questions to state their time window and answer criteria while
  preserving their schedule purposes, cadences, and run counts.
- Rechecked all 12 bodies through the live `schedule.create` check and recorded the accepted
  results in `results.json`.
- Corrected the README to explain that `schedule.create` checks cover the schedule, while the
  standalone `oracle.request` check covers the oracle wording and answerability screen.
