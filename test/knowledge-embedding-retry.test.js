// 2026-11-07: a single "fetch failed" (ECONNRESET via the proxy) showed knowledge-embedding as
// "连接或本地配置异常". Momentary drops now get one retry, and telemetry keeps the network code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-embed-retry-'));
process.env.DSH_HOME = home;
const {createGeminiEmbedder, transientNetworkError} = await import('../lib/knowledge/embedding.js');
const {diagnosis, netCode, errorDetail} = await import('../lib/gemini-telemetry.js');

const dropped = () => Object.assign(new TypeError('fetch failed'), {cause: Object.assign(Error('read ECONNRESET'), {code: 'ECONNRESET'})});
const ok = n => ({ok: true, status: 200, json: async () => ({embeddings: Array.from({length: n}, () => ({values: [1, 0, 0]}))})});
const embedder = fetcher => createGeminiEmbedder({config: () => ({}), fetcher, keyReader: async () => 'fixture-key', dims: 3, retryDelayMs: 1});

test('one dropped connection is retried once and succeeds', async () => {
  let calls = 0;
  const vecs = await embedder(async () => { if (++calls === 1) throw dropped(); return ok(2); }).embed(['a', 'b']);
  assert.equal(calls, 2);
  assert.equal(vecs.length, 2);
});

test('a second drop is not retried again; HTTP errors and cancellation are never retried', async () => {
  let calls = 0;
  await assert.rejects(embedder(async () => { calls++; throw dropped(); }).embed(['a']), /fetch failed/);
  assert.equal(calls, 2);
  const controller = new AbortController(); controller.abort();
  assert.equal(transientNetworkError(dropped(), controller.signal), false);
  assert.equal(transientNetworkError(Object.assign(Error('This operation was aborted'), {name: 'AbortError'})), false);
  assert.equal(transientNetworkError(Error('Gemini 嵌入返回条数不符')), false);
});

test('telemetry names the network reason and redacts secrets and addresses', () => {
  assert.equal(netCode(dropped()), 'ECONNRESET');
  assert.match(diagnosis(dropped()), /网络连接中断（ECONNRESET）/);
  assert.match(diagnosis(Object.assign(Error('x'), {httpStatus: 402})), /预付余额不足/);
  assert.equal(netCode({code: 20}), '');
  const detail = errorDetail(Error('key AIzaSyFIXTUREFIXTURE123 at https://generativelanguage.googleapis.com/v1beta'));
  assert.ok(!detail.includes('AIza') && !detail.includes('googleapis'));
});

test('the retried call is recorded: failure first, then success', async () => {
  const dir = path.join(home, 'gemini-monitor');
  fs.rmSync(dir, {recursive: true, force: true});
  let calls = 0;
  await embedder(async () => { if (++calls === 1) throw dropped(); return ok(1); }).embed(['c']);
  await new Promise(r => setTimeout(r, 50));
  const rows = fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).rows);
  assert.deepEqual(rows.map(r => r.status), ['error', 'success']);
  assert.equal(rows[0].code, 'ECONNRESET');
  assert.equal(rows[0].detail, 'fetch failed');
});

// Last: a 402 pauses Gemini in this temporary home, which would block the tests above.
test('an HTTP error is never retried', async () => {
  let calls = 0;
  await assert.rejects(embedder(async () => { calls++; return {ok: false, status: 402, json: async () => ({})}; }).embed(['a']), /HTTP 402/);
  assert.equal(calls, 1);
});

test.after(() => fs.rmSync(home, {recursive: true, force: true}));
