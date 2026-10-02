#!/usr/bin/env node
// imd-schedule-pack checker. Node 20+, no dependencies: only fs, path and the global fetch.
//
// Validates every bodies/*.json against the limits in the Schedule body section of
// https://imd.fun/docs, then sends each one to the free POST /requests/check and records the
// verdict in results.json. Nothing here signs, quotes or pays for anything.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BODIES_DIR = join(ROOT, "bodies");
const RESULTS_FILE = join(ROOT, "results.json");
const DEFAULT_API = "https://api.imd.fun";

const PRICE_PER_RUN_IMD = 0.5;
const PRICE_PER_RUN_WEI = 500000000000000000n;
const SUGGESTED_MAX_RUNS = 7;
const MAX_RETRIES = 3; // after the first attempt, so at most 4 attempts per body
const RETRY_DELAY_MS = 3000; // at least 3 seconds between attempts
const PACE_MS = 2100; // the API allows 30 checks a minute per IP
const ORACLE_DRAFT_PACE_MS = 3500;
const TIMEOUT_MS = 30000;

const EXPERIMENTAL =
  "Experimental, commissioned as a test of the IMD swarm. It may not work as described. " +
  "Read the code, start with small amounts, no warranty.";

const HELP = `imd-schedule-pack check

${EXPERIMENTAL}

Usage:
  node bin/check.mjs              validate every bodies/*.json, send each to
                                  POST <api>/requests/check, write results.json
  node bin/check.mjs --validate   validate locally only; no network, no results.json
  node bin/check.mjs --table      print the README table (runs x ${PRICE_PER_RUN_IMD} IMD)
  node bin/check.mjs --help       this text

Options:
  --api <url>   API origin (default ${DEFAULT_API}, or $IMD_API)

The check is free and holds no price. Each body is retried up to ${MAX_RETRIES} times,
${RETRY_DELAY_MS / 1000} seconds apart (3.5 for oracle drafts), on network errors, timeouts, 429 and 5xx. If the API
cannot be reached, results.json records "unreachable" and the error instead of a verdict.
Exit code: 0 when every body passed local validation, none was blocked or refused,
and no oracle draft was unreachable.`;

// ---------- documented limits ----------

const SCHEDULE_FIELDS = new Set(["action", "input", "cadence", "runs", "label", "continue", "startAt"]);
const ANSWER_TYPES = new Set(["bool", "address", "bytes32", "uint256", "address[]", "bytes32[]"]);
const JOB_REFUSED = ["onchain", "parentJobId", "projectId", "deploymentLaunchId", "submissionKey", "expiresAt"];
const FLOOR_MINUTES = { "oracle.request": 10, "job.open": 30 };

const isInt = (n) => Number.isInteger(n);
const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

export function validate(body) {
  const p = [];
  if (!isObj(body)) return ["body is not a JSON object"];

  for (const k of Object.keys(body)) if (!SCHEDULE_FIELDS.has(k)) p.push(`unknown field "${k}"`);

  const { action, input, cadence, runs, label, startAt } = body;
  if (action !== "oracle.request" && action !== "job.open") p.push(`action must be oracle.request or job.open`);
  if (!isInt(runs) || runs < 1 || runs > 1_000_000) p.push("runs must be an integer 1-1,000,000");
  if (label !== undefined && (typeof label !== "string" || label.length < 1 || label.length > 120))
    p.push("label must be 1-120 characters");
  if (body.continue !== undefined) {
    if (typeof body.continue !== "boolean") p.push("continue must be a boolean");
    if (action !== "job.open") p.push("continue is for jobs only");
  }
  if (startAt !== undefined) {
    const ok = typeof startAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(startAt) &&
      !Number.isNaN(Date.parse(startAt));
    if (!ok) p.push("startAt must be an ISO 8601 date-time with an offset");
  }

  const gap = cadenceGapMinutes(cadence, p);
  const floor = FLOOR_MINUTES[action];
  if (gap !== null && floor && gap < floor)
    p.push(`cadence fires ${gap} min apart; the floor for ${action} is ${floor} min`);

  if (!isObj(input)) p.push("input must be an object");
  else if (action === "oracle.request") validateOracle(input, p);
  else if (action === "job.open") validateJob(input, p);
  return p;
}

function validateOracle(i, p) {
  if (i.v !== 1) p.push("input.v must be 1");
  if (typeof i.question !== "string" || i.question.length < 1 || i.question.length > 2000)
    p.push("input.question must be 1-2,000 characters");
  if (!isInt(i.chainId) || i.chainId < 1) p.push("input.chainId must be a positive integer");
  const w = i.window;
  const okWindow = isObj(w) && (
    (isInt(w.hours) && w.hours >= 1 && w.hours <= 720 && Object.keys(w).length === 1) ||
    (isInt(w.fromBlock) && isInt(w.toBlock) && w.fromBlock <= w.toBlock));
  if (!okWindow) p.push("input.window must be {hours: 1..720} or {fromBlock, toBlock}");
  if (!ANSWER_TYPES.has(i.answerType)) p.push("input.answerType is not a documented type");
  if (!isInt(i.panelSize) || i.panelSize < 5 || i.panelSize > 100) p.push("input.panelSize must be 5-100");
  if (!isInt(i.quorum) || i.quorum < 2 || (isInt(i.panelSize) && i.quorum > i.panelSize))
    p.push("input.quorum must be 2..panelSize");
  if (!isInt(i.validForSeconds) || i.validForSeconds < 60 || i.validForSeconds > 2_592_000)
    p.push("input.validForSeconds must be 60-2,592,000");
  if (i.evidence !== undefined && i.evidence !== "chain" && i.evidence !== "panel")
    p.push("input.evidence must be chain or panel");
  if (i.head !== undefined && (!isInt(i.head) || i.head < 1 || i.head > 32)) p.push("input.head must be 1-32");
  if (i.toleranceBps !== undefined && (!isInt(i.toleranceBps) || i.toleranceBps < 0 || i.toleranceBps > 10000))
    p.push("input.toleranceBps must be 0-10,000");
  if (i.definitions !== undefined) {
    if (!isObj(i.definitions)) p.push("input.definitions must be a map");
    else for (const [k, v] of Object.entries(i.definitions))
      if (k.length < 1 || k.length > 64 || typeof v !== "string" || v.length < 1 || v.length > 512)
        p.push(`input.definitions.${k}: keys 1-64, values 1-512 characters`);
  }
  if ("submissionKey" in i) p.push("input.submissionKey is not accepted on the paid route");
}

function validateJob(i, p) {
  if (typeof i.objective !== "string" || i.objective.length < 1 || i.objective.length > 8000)
    p.push("input.objective must be 1-8,000 characters");
  for (const k of JOB_REFUSED) if (k in i) p.push(`input.${k} is refused in a scheduled job`);
  const modes = ["skill", "steps", "template"].filter((k) => k in i);
  if (modes.length > 1) p.push(`input may use only one of skill, steps, template (has ${modes.join(", ")})`);
  if (i.skill !== undefined && (typeof i.skill !== "string" || i.skill.length > 64)) p.push("input.skill max 64");
}

// ---------- cadence ----------

// Smallest gap between runs in minutes, or null when it cannot be worked out locally.
function cadenceGapMinutes(c, p) {
  if (!isObj(c)) { p.push("cadence must be {every} or {cron, tz}"); return null; }
  const hasEvery = "every" in c, hasCron = "cron" in c;
  if (hasEvery === hasCron) { p.push("cadence must have exactly one of every or cron"); return null; }
  if (hasEvery) {
    if (Object.keys(c).length !== 1) p.push("cadence {every} takes no other fields");
    const m = durationMinutes(c.every);
    if (m === null) p.push(`cadence.every "${c.every}" is not an ISO 8601 duration`);
    return m;
  }
  for (const k of Object.keys(c)) if (k !== "cron" && k !== "tz") p.push(`unknown cadence field "${k}"`);
  if (c.tz !== undefined) {
    try { new Intl.DateTimeFormat("en", { timeZone: c.tz }); } catch { p.push(`cadence.tz "${c.tz}" is not an IANA zone`); }
  }
  try { return cronGapMinutes(c.cron); } catch (e) { p.push(`cadence.cron: ${e.message}`); return null; }
}

// Shortest length a duration can have; a month counts as 28 days and a year as 365.
function durationMinutes(s) {
  const m = typeof s === "string" &&
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s);
  if (!m || s === "P" || s.endsWith("T")) return null;
  const [y, mo, w, d, h, mi, se] = m.slice(1).map((x) => Number(x ?? 0));
  const total = ((y * 365 + mo * 28 + w * 7 + d) * 24 + h) * 60 + mi + se / 60;
  return total > 0 ? total : null;
}

function cronField(src, min, max) {
  const out = new Set();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cannot read "${part}" (names and L/W/# are not evaluated here)`);
    let [lo, hi] = m[1] === "*" ? [min, max] : m[1].split("-").map(Number);
    if (hi === undefined) hi = m[2] ? max : lo;
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`"${part}" is out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

// Walks four years of calendar days (UTC wall clock) and returns the smallest gap between
// fires. Daylight-saving shifts in tz can move a slot by an hour; the floors here are far
// below any gap that would matter for that.
function cronGapMinutes(expr) {
  const f = typeof expr === "string" ? expr.trim().split(/\s+/) : [];
  if (f.length !== 5) throw new Error("needs five fields, minute to day of week");
  const minutes = cronField(f[0], 0, 59), hours = cronField(f[1], 0, 23);
  const doms = cronField(f[2], 1, 31), months = cronField(f[3], 1, 12);
  const dows = cronField(f[4], 0, 7);
  if (dows.has(7)) dows.add(0);
  const domStar = f[2] === "*", dowStar = f[4] === "*";
  const daySlots = [];
  for (const h of [...hours].sort((a, b) => a - b))
    for (const m of [...minutes].sort((a, b) => a - b)) daySlots.push(h * 60 + m);

  let prev = null, gap = Infinity;
  const start = Date.UTC(2024, 0, 1);
  for (let day = 0; day < 4 * 366; day++) {
    const d = new Date(start + day * 86400000);
    if (!months.has(d.getUTCMonth() + 1)) continue;
    const domHit = doms.has(d.getUTCDate()), dowHit = dows.has(d.getUTCDay());
    const hit = domStar || dowStar ? domHit && dowHit : domHit || dowHit;
    if (!hit) continue;
    for (const s of daySlots) {
      const t = day * 1440 + s;
      if (prev !== null) gap = Math.min(gap, t - prev);
      prev = t;
    }
  }
  if (prev === null) throw new Error("never fires");
  return gap === Infinity ? null : gap;
}

// ---------- table ----------

function loadBodies() {
  return readdirSync(BODIES_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const path = join(BODIES_DIR, f);
    let body = null, parseError = null;
    try { body = JSON.parse(readFileSync(path, "utf8")); } catch (e) { parseError = e.message; }
    return { file: relative(ROOT, path), body, parseError };
  });
}

const costImd = (runs) => String(runs * PRICE_PER_RUN_IMD);
const cadenceText = (c) => (c.every ? `every ${c.every}` : `cron \`${c.cron}\` ${c.tz ?? "UTC"}`);

function table(items) {
  const rows = ["| File | What it does | Action | Cadence | Runs | Total cost |", "|---|---|---|---|---:|---:|"];
  let runs = 0;
  for (const { file, body } of items) {
    runs += body.runs;
    const what = body.label + (body.continue ? " (continue: each run builds on the last)" : "");
    rows.push(`| [${file.split("/").pop()}](${file}) | ${what} | \`${body.action}\` | ${cadenceText(body.cadence)} | ${body.runs} | ${costImd(body.runs)} IMD |`);
  }
  rows.push(`| **All ${items.length}** | | | | **${runs}** | **${costImd(runs)} IMD** |`);
  return rows.join("\n");
}

// ---------- network check ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkOne(api, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    if (attempt > 1) await sleep(payload.action === "oracle.request" ? ORACLE_DRAFT_PACE_MS : RETRY_DELAY_MS);
    try {
      const res = await fetch(`${api}/requests/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* recorded as text below */ }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}${json?.error ? ` ${json.error}` : ""}`;
        continue;
      }
      return { attempts: attempt, status: res.status, json, text: json ? undefined : text.slice(0, 500) };
    } catch (e) {
      lastError = e.cause?.code ?? e.cause?.message ?? e.name + ": " + e.message;
    }
  }
  return { attempts: 1 + MAX_RETRIES, error: lastError };
}

function verdictOf(r) {
  if (r.error) return "unreachable";
  if (r.status === 200 && r.json) return r.json.blockers?.length ? "blocked" : "accepted";
  return "refused";
}

async function runChecks(api, items) {
  const results = [];
  for (const [n, { file, body, problems }] of items.entries()) {
    if (n > 0) await sleep(PACE_MS);
    const r = await checkOne(api, { action: "schedule.create", input: body });
    const verdict = verdictOf(r);
    const entry = {
      file, label: body.label, action: body.action, runs: body.runs,
      costImd: costImd(body.runs), localProblems: problems,
      verdict, checkedAt: new Date().toISOString(), attempts: r.attempts,
    };
    if (r.error) entry.error = r.error;
    else {
      entry.httpStatus = r.status;
      if (r.json) {
        const { blockers, suggestions, unitAmount, runs, amount, terms, error, detail, problems: ps } = r.json;
        Object.assign(entry, { blockers, suggestions, unitAmount, quotedRuns: runs, amount, terms, error, detail, problems: ps });
        if (amount !== undefined) entry.amountMatchesTable = BigInt(amount) === PRICE_PER_RUN_WEI * BigInt(body.runs);
      } else entry.response = r.text;
    }
    console.log(`${verdict.padEnd(11)} ${file}${r.error ? `  (${r.error})` : ""}`);
    results.push(entry);
  }
  return results;
}

async function runOracleDraftChecks(api, items) {
  const drafts = items.filter(({ body }) => body?.action === "oracle.request").slice(0, 6);
  const results = [];
  for (const { file, body } of drafts) {
    await sleep(ORACLE_DRAFT_PACE_MS);
    const input = Object.fromEntries(["question", "panelSize", "answerType", "evidence", "chainId", "head"]
      .filter((key) => body.input[key] !== undefined).map((key) => [key, body.input[key]]));
    const r = await checkOne(api, { action: "oracle.request", input });
    const verdict = verdictOf(r);
    const entry = { file, verdict, action: "oracle.request", checkedAt: new Date().toISOString(), attempts: r.attempts, input };
    if (r.error) Object.assign(entry, { error: r.error, blockers: [], suggestions: [] });
    else {
      entry.httpStatus = r.status;
      if (r.json) {
        entry.blockers = r.json.blockers ?? [];
        entry.suggestions = r.json.suggestions ?? [];
        entry.liveResponseBody = JSON.stringify(r.json);
      } else {
        entry.blockers = [];
        entry.suggestions = [];
        entry.liveResponseBody = r.text;
      }
    }
    console.log(`${verdict.padEnd(11)} ${file} (draft)`);
    results.push(entry);
  }
  return results;
}

// ---------- main ----------

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(HELP); return 0; }
  const apiIdx = argv.indexOf("--api");
  const api = (apiIdx >= 0 ? argv[apiIdx + 1] : process.env.IMD_API || DEFAULT_API)?.replace(/\/+$/, "");
  if (!api) { console.error("--api needs a URL"); return 2; }

  const items = loadBodies();
  let localOk = true;
  for (const it of items) {
    it.problems = it.parseError ? [`invalid JSON: ${it.parseError}`] : validate(it.body);
    if (it.problems.length) localOk = false;
  }

  if (argv.includes("--table")) {
    if (!localOk) { console.error("fix the bodies first: node bin/check.mjs --validate"); return 1; }
    console.log(table(items));
    return 0;
  }

  console.error(`${EXPERIMENTAL}\n`);
  for (const it of items) {
    const advice = it.body && it.body.runs > SUGGESTED_MAX_RUNS ? `  (note: ${it.body.runs} runs; start with ${SUGGESTED_MAX_RUNS} or fewer)` : "";
    console.log(`${it.problems.length ? "INVALID" : "valid  "}     ${it.file}${advice}`);
    for (const pr of it.problems) console.log(`              - ${pr}`);
  }
  if (argv.includes("--validate")) return localOk ? 0 : 1;

  console.log(`\nChecking ${items.length} bodies against ${api}/requests/check ...`);
  const checkable = items.filter((it) => it.body);
  const results = await runChecks(api, checkable);
  console.log(`\nChecking ${Math.min(6, items.filter(({ body }) => body?.action === "oracle.request").length)} oracle drafts (at least ${ORACLE_DRAFT_PACE_MS / 1000}s apart) ...`);
  const oracleDraftChecks = await runOracleDraftChecks(api, checkable);
  const count = (v) => results.filter((r) => r.verdict === v).length;
  const draftCount = (v) => oracleDraftChecks.filter((r) => r.verdict === v).length;
  const summary = {
    accepted: count("accepted"), blocked: count("blocked"), refused: count("refused"), unreachable: count("unreachable"),
    draftAccepted: draftCount("accepted"), draftBlocked: draftCount("blocked"),
    draftRefused: draftCount("refused"), draftUnreachable: draftCount("unreachable"),
  };
  const out = {
    tool: "imd-schedule-pack bin/check.mjs",
    api: `${api}/requests/check`,
    checkedAt: new Date().toISOString(),
    network: summary.unreachable + summary.draftUnreachable === results.length + oracleDraftChecks.length ? "unreachable" : "reached",
    summary,
    results,
    oracleDraftChecks,
  };
  writeFileSync(RESULTS_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n${JSON.stringify(summary)} -> ${relative(process.cwd(), RESULTS_FILE) || "results.json"}`);
  return localOk && !summary.blocked && !summary.refused &&
    !summary.draftBlocked && !summary.draftRefused && !summary.draftUnreachable ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
