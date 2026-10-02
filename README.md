# imd-schedule-pack

> **Experimental, commissioned as a test of the IMD swarm. It may not work as described. Read the code, start with small amounts, no warranty.**

Twelve ready-to-use `schedule.create` bodies for the [IMD](https://imd.fun/docs) swarm, plus a
small Node 20 script that checks each one against the free `POST https://api.imd.fun/requests/check`
and records the verdict in [`results.json`](results.json).

A schedule is a standing order: one oracle question (`oracle.request`) or one job (`job.open`),
fired on a cadence, for a number of runs you buy up front. The bodies follow the
*Schedule body* section of https://imd.fun/docs: `action`, `input`, `cadence` (`{every}` as an
ISO 8601 duration, or `{cron, tz}`), `runs`, `label`, `continue` (jobs only) and `startAt`.

## The bodies

> **Warning: unused runs are not refunded.** You pay for every run up front, in one payment,
> and runs you never use stay spent. Start with **7 runs or fewer**, watch what the schedule
> produces, and add runs with `schedule.topup` once it is doing what you want. Every body
> here is set at 7 runs or fewer for that reason.

Price: **0.5 IMD per run**, so a body's total cost is `runs x 0.5 IMD`. Skipped runs (the
previous question or job still open) and failed runs cost nothing.

| File | What it does | Action | Cadence | Runs | Total cost |
|---|---|---|---|---:|---:|
| [01-hourly-imd-burn-canary.json](bodies/01-hourly-imd-burn-canary.json) | hourly canary: IMD burned on Ethereum mainnet | `oracle.request` | every PT1H | 7 | 3.5 IMD |
| [02-hourly-weth-wrapped-canary.json](bodies/02-hourly-weth-wrapped-canary.json) | hourly canary: ETH wrapped into WETH on Ethereum mainnet | `oracle.request` | every PT1H | 7 | 3.5 IMD |
| [03-hourly-imd-transfer-count-canary.json](bodies/03-hourly-imd-transfer-count-canary.json) | hourly canary: IMD transfer count on Ethereum mainnet | `oracle.request` | every PT1H | 5 | 2.5 IMD |
| [04-daily-weth-volume-leader.json](bodies/04-daily-weth-volume-leader.json) | daily WETH volume leader | `oracle.request` | cron `0 9 * * *` UTC | 7 | 3.5 IMD |
| [05-daily-imd-top-pools.json](bodies/05-daily-imd-top-pools.json) | daily top three IMD Uniswap v4 pools by volume | `oracle.request` | cron `30 9 * * *` UTC | 7 | 3.5 IMD |
| [06-daily-geth-release.json](bodies/06-daily-geth-release.json) | daily: did go-ethereum ship a stable release | `oracle.request` | cron `0 12 * * *` UTC | 7 | 3.5 IMD |
| [07-weekly-evm-testing-digest.json](bodies/07-weekly-evm-testing-digest.json) | weekly EVM testing digest (continue: each run builds on the last) | `job.open` | cron `0 8 * * 1` Europe/Lisbon | 7 | 3.5 IMD |
| [08-weekly-uniswap-v4-hooks-digest.json](bodies/08-weekly-uniswap-v4-hooks-digest.json) | weekly Uniswap v4 hooks digest (continue: each run builds on the last) | `job.open` | cron `0 8 * * 2` UTC | 7 | 3.5 IMD |
| [09-weekly-erc8004-agents-digest.json](bodies/09-weekly-erc8004-agents-digest.json) | weekly ERC-8004 agent ecosystem digest (continue: each run builds on the last) | `job.open` | cron `0 8 * * 3` UTC | 7 | 3.5 IMD |
| [10-monthly-ethereum-upgrades-review.json](bodies/10-monthly-ethereum-upgrades-review.json) | monthly Ethereum protocol upgrades review (continue: each run builds on the last) | `job.open` | cron `0 9 1 * *` UTC | 3 | 1.5 IMD |
| [11-monthly-defi-incidents-review.json](bodies/11-monthly-defi-incidents-review.json) | monthly DeFi security incidents review | `job.open` | cron `0 9 2 * *` UTC | 3 | 1.5 IMD |
| [12-monthly-oracle-design-review.json](bodies/12-monthly-oracle-design-review.json) | monthly on-chain oracle design review | `job.open` | cron `0 9 3 * *` UTC | 3 | 1.5 IMD |
| **All 12** | | | | **70** | **35 IMD** |

The table is generated from the files by `npm run table`, so it can be regenerated and
compared after editing a body.

What the mix covers:

- **Hourly on-chain canaries (01-03).** Cheap chain-evidence questions over the last hour
  (IMD burned, ETH wrapped into WETH, IMD transfer count). Each run's answer is
  reproduced from logs by the deployer before it is signed. A canary that stops being answered,
  or answers zero for a long stretch, says something about the chain, the token or the swarm.
- **Daily oracle questions (04-06).** Two chain-evidence rankings over the last 24 hours and
  one off-chain (panel) yes/no question checked against GitHub.
- **Weekly research digests (07-09).** `research-report` jobs with `continue: true`: each run
  starts from the schedule's last completed job, so the report is updated each week rather than
  rewritten from nothing.
- **Monthly reviews (10-12).** `research-report` jobs on the 1st, 2nd and 3rd of each month
  (UTC). 10 builds on its last review; 11 and 12 write a fresh review each month.

Addresses used: the IMD token `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` (from the IMD docs)
and WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`. Both were checked on Ethereum mainnet
on 2026-10-02 (`symbol()` returned `IMD` and `WETH`).

### Limits each body respects

All of these come from the IMD docs, and `npm run validate` checks them locally:

- `action` is `oracle.request` or `job.open`; `runs` is 1 to 1,000,000; `label` is 1 to 120 characters.
- `cadence` is exactly one of `{every}` or `{cron, tz}`, `tz` being an IANA zone.
- At least **10 minutes between questions** and **30 minutes between jobs**. The script
  works out the smallest gap a cron or interval can produce and refuses anything closer.
- `continue` only on jobs. `startAt` is an ISO 8601 date-time with an offset. None of the
  bodies set `startAt`, so an interval starts one interval after purchase and a cron starts at
  its next slot. Add one if you want a fixed first run.
- Job inputs carry no `onchain`, `parentJobId` or `projectId` (nor `deploymentLaunchId`).
  Use `continue` to build on earlier runs.
- Oracle inputs: `v: 1`, question 1 to 2,000 characters, `window` `{hours: 1..720}`, a documented
  `answerType`, `panelSize` 5 to 100, `quorum` 2 to `panelSize`, `validForSeconds` 60 to 2,592,000.
  A relative `window` is re-resolved before every run, so `{hours: 1}` is always the last hour.

The server applies the same checks as one paid `oracle.request` or `job.open`, plus some
this script cannot (for example the wording screen that refuses ambiguous questions). Its
verdict is the one that counts.

## Running the check

Needs Node 20 or later. There is nothing to install: the script uses only Node built-ins and
the global `fetch`.

```sh
npm run validate          # local limits only, no network
npm run check             # validate, then POST each body to /requests/check, write results.json
npm run table             # print the table above from bodies/*.json
node bin/check.mjs --help
node bin/check.mjs --api https://api.imd.fun   # or set IMD_API
```

For each body the check sends `{"action": "schedule.create", "input": <body>}`. A network
error, a 30 second timeout, a 429 or a 5xx is retried up to 3 times (4 attempts at most),
at least 3 seconds apart. Bodies are sent about 2 seconds apart to stay under the API's
30 checks a minute.

`results.json` holds one entry per body:

| Field | Meaning |
|---|---|
| `verdict` | `accepted` (no blockers), `blocked` (the API listed blockers), `refused` (the API returned 4xx, see `error`/`detail`/`problems`), or `unreachable` (no answer after every attempt, see `error`) |
| `checkedAt` | When that body was checked (ISO 8601, UTC) |
| `attempts` | How many requests it took |
| `blockers`, `suggestions` | As returned by the API |
| `unitAmount`, `quotedRuns`, `amount`, `terms` | The price the API would quote, in IMD base units (18 decimals) |
| `amountMatchesTable` | `true` when `amount` equals `runs x 0.5 IMD`, the figure in the table above |
| `localProblems` | Anything `npm run validate` objected to |

The top level records the API used, the time of the run, `network` (`reached`, or
`unreachable` when no body got an answer) and a count of each verdict. The committed
`results.json` is from a run on 2026-10-02 in which all 12 bodies were accepted.

The script exits 1 when a body fails local validation or the API blocks or refuses one, and
0 otherwise. An unreachable network alone does not fail it, because that is recorded in
`results.json` instead.

## Using a body

The check costs nothing and holds no price. To buy a schedule, quote and pay for
`schedule.create` with the body as `input`, following *Paid requests* in the IMD docs. This
repository does not sign, quote or pay for anything. Points worth knowing first, all from
the docs:

- **Who fires it:** IMD's scheduler, on your cadence. Each run that opens a question or job
  spends one of your runs. A run whose previous question or job is still open is skipped,
  and three failed runs in a row pause the schedule until it is topped up.
- **Who controls it:** the paying wallet owns the schedule but gets no controls. Pausing and
  cancelling stay with the IMD team, and a paid schedule never expires.
- **What you buy:** a question and its panel, not an answer. A panel that disagrees ends
  without one, and that run is still spent.
- **Topping up:** `schedule.topup` with `{scheduleId, runs}`, from any wallet, at that day's
  price per run.

## Layout

```
bodies/        12 schedule.create bodies, one per file
bin/check.mjs  validator, table generator and /requests/check client (Node 20, no dependencies)
results.json   the last check's verdicts
package.json   npm scripts for the above
```

Licence: MIT, see [LICENSE](LICENSE).

Commissioned through paid IMD swarm requests.
