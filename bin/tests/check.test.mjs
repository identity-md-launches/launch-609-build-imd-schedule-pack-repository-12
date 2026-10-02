import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Exercise the real CLI logic with a virtual clock and captured writes, without
// changing results.json or waiting through retry delays.
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(new URL('../check.mjs', import.meta.url), 'utf8')
  .replace('const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");', `const ROOT = ${JSON.stringify(root)};`)
  .replace('if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])', 'if (false)')
  .replace('const sleep = (ms) => new Promise((r) => setTimeout(r, ms));', 'const sleep = async (ms) => { globalThis.elapsed += ms; };')
  .replace('writeFileSync(RESULTS_FILE, JSON.stringify(out, null, 2) + "\\n");', 'globalThis.output = out;') + '\nexport { main };';
const { main } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const originalFetch = globalThis.fetch;
const originalLog = console.log;
console.log = () => {};
try {
  for (const mode of ['ok', 'blocked', 'refused', 'unreachable', 'retry', 'schedules-unreachable', 'all-unreachable']) {
    globalThis.elapsed = 0;
    const calls = [];
    let retried = false;
    globalThis.fetch = async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ payload, at: elapsed });
      assert.equal(url, 'http://mock/requests/check');
      const draft = payload.action === 'oracle.request';
      assert.ok(draft || payload.action === 'schedule.create');
      if (!draft) {
        assert.ok(payload.input.runs);
        if (mode.endsWith('schedules-unreachable') || mode === 'all-unreachable') throw new Error('offline');
      }
      if (draft) {
        assert.ok(payload.input.question);
        assert.ok(Object.keys(payload.input).every(k => ['question', 'panelSize', 'answerType', 'evidence', 'chainId', 'head'].includes(k)));
        if ((mode === 'unreachable' || mode === 'all-unreachable')) throw new Error('offline');
        if (mode === 'retry' && !retried) { retried = true; return new Response('{}', { status: 429 }); }
      }
      return new Response(JSON.stringify({ action: payload.action, judged: draft, blockers: draft && mode === 'blocked' ? [{ code: 'invalid_input' }] : [], suggestions: [] }), { status: draft && mode === 'refused' ? 400 : 200 });
    };
    const code = await main(['--api', 'http://mock']);
    assert.equal(calls.filter(c => c.payload.action === 'schedule.create').length, ['schedules-unreachable', 'all-unreachable'].includes(mode) ? 48 : 12);
    assert.equal(output.oracleDraftChecks.length, 6);
    assert.equal(code, ['ok', 'retry', 'schedules-unreachable'].includes(mode) ? 0 : 1);
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].payload.action === 'oracle.request') assert.ok(calls[i].at - calls[i - 1].at >= 3500);
    }
    assert.equal(output.summary.draftAccepted, ['ok', 'retry', 'schedules-unreachable'].includes(mode) ? 6 : 0);
    assert.equal(output.network, mode === 'all-unreachable' ? 'unreachable' : 'reached');
    if (['blocked', 'refused', 'unreachable'].includes(mode)) assert.equal(output.summary['draft' + mode[0].toUpperCase() + mode.slice(1)], 6);
  }
} finally { globalThis.fetch = originalFetch; console.log = originalLog; }
console.log('Payload, draft failures, summary, and request spacing checks passed.');
