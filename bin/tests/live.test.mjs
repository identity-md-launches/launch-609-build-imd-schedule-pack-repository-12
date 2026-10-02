import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const live = new URL('./live/', import.meta.url);
const drafts = readdirSync(live).filter(name => /^0[1-6]-/.test(name));
assert.equal(drafts.length, 6);
for (const name of drafts) {
  const saved = JSON.parse(readFileSync(new URL(name, live)));
  assert.equal(saved.url, 'https://api.imd.fun/requests/check');
  assert.equal(saved.status, 200);
  assert.equal(saved.request.action, 'oracle.request');
  assert.equal(saved.response.action, 'oracle.request');
  assert.equal(saved.response.judged, true);
  assert.deepEqual(saved.response.blockers, []);
  assert.deepEqual(saved.response.suggestions, []);
}
for (const name of ['get-root.json', 'get-requests-check.json']) {
  const saved = JSON.parse(readFileSync(new URL(name, live)));
  assert.ok(saved.url.startsWith('https://api.imd.fun/'));
  assert.ok(saved.body.length);
}
console.log('Saved live responses: six genuine judged drafts without blockers or suggestions.');
