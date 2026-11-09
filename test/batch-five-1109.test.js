import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {applyDecision, partitionDecisions, consolidationPrompt} from '../lib/knowledge/consolidate.js';
import {describe as describeItem, contextItems} from '../lib/knowledge/salience.js';
import {gateSuites, GATE_MIN_CASES, GATE_MAX_SUITES, GATE_SUITES} from '../lib/knowledge/evaluate.js';
import {roleContextBudget} from '../lib/context-budget.js';
import {addRollup} from '../lib/gemini-telemetry.js';
import {writebackFunnel, omissionSamples, validateOmission, writebackReport} from '../lib/reports/writeback.js';
import {moodRecords, validateMood, usageWeeks, userMessageTimes, decodeFrames, trendsReport} from '../lib/reports/trends.js';
import {PROBES, CATEGORIES} from '../lib/probes/bank.js';
import {runProbes, summarizeRun, callEstimate, bankCost, validateJudgment} from '../lib/probes/harness.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'five-'));
const put = (home, file, value) => { const p = path.join(home, file); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); };
const baseIndex = () => ({sources: {}, items: {}, ignored: {}});
const src = (index, key, extra = {}) => (index.sources[key] = {key, store: 'life', text: '青枔觉得这家店不好吃', visibility: 'shared', hash: 'h' + key, eventAt: 1000, ...extra});
const importance = {level: 'low', class: 'experience', holdDays: 30, reason: 'r'};

test('stance is kept as a field and shown wherever the item is read', () => {
  const index = baseIndex(), s = src(index, 'a');
  applyDecision(index, s, {sourceKey: 'a', relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '青枔', kind: 'preference', stage: 'n/a', content: '青枔觉得这家店不好吃', stance: 'opinion'}, importance}, 2000);
  const item = Object.values(index.items)[0];
  assert.equal(item.stance, 'opinion');
  assert.match(describeItem(index, item).stance, /主观判断/);
  assert.match(contextItems(index, {rows: [{id: item.id, score: 1}]})[0].text, /不是已证实的事实/);
  assert.match(consolidationPrompt, /stance/);
});
test('a source already marked by review keeps its stance when the model leaves it out; a fact shows nothing', () => {
  const index = baseIndex(), s = src(index, 'a', {stance: 'feeling'});
  applyDecision(index, s, {sourceKey: 'a', relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '青枔', kind: 'state', stage: 'n/a', content: '青枔那天很累'}, importance}, 2000);
  assert.equal(Object.values(index.items)[0].stance, 'feeling');
  const other = baseIndex(), t = src(other, 'b');
  applyDecision(other, t, {sourceKey: 'b', relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '青枔', kind: 'fact', stage: 'n/a', content: '青枔养猫', stance: 'fact'}, importance}, 2000);
  assert.equal(describeItem(other, Object.values(other.items)[0]).stance, undefined);
});
test('an invalid stance rejects only that decision', () => {
  const batch = [{key: 'a'}, {key: 'b'}], item = {subject: '青枔', kind: 'fact', stage: 'n/a', content: '内容'};
  const {valid, rejected} = partitionDecisions({decisions: [{sourceKey: 'a', relation: 'new', changeType: 'formed', reason: 'r', item: {...item, stance: 'guess'}, importance}, {sourceKey: 'b', relation: 'new', changeType: 'formed', reason: 'r', item, importance}]}, batch, new Map());
  assert.ok(rejected.has('a')); assert.ok(valid.has('b'));
});

test('the gate keeps generating suites until there are enough paired questions, within a cap', async () => {
  const suite = n => ({source: 'generated', cases: Array(n).fill({})});
  let made = 0; const more = async () => { made++; return suite(11); };
  const got = await gateSuites(suite(11), more, 4);
  assert.ok(got.reduce((n, s) => n + s.cases.length, 4) >= GATE_MIN_CASES); assert.ok(got.length <= GATE_MAX_SUITES && got.length >= GATE_SUITES);
  made = 0; const small = await gateSuites(suite(1), async () => { made++; return suite(1); });
  assert.equal(small.length, GATE_MAX_SUITES);
  const stopped = await gateSuites(suite(11), async () => ({source: 'builtin', cases: []}));
  assert.equal(stopped.length, 1, 'never pads the comparison with the built-in suite');
});

// A minimal agent for the budget: raw history holds two recall snapshots, the projected basis only the newer one.
const recallMessage = text => ({role: 'user', source: {kind: 'dsh-mnemon', form: 'recall'}, content: [{type: 'text', text: '<runtime-memory-snapshot target="memory">\n' + text + '\n</runtime-memory-snapshot>'}]});
function budgetRun({plan, basisOf = m => m, messages}) {
  const session = {id: 's', deriveMessages: () => messages, requestContext: () => ({contextWindow: 200000, model: 'm', provider: 'p'}), requestHeader: () => ({config: {model: 'm', provider: 'p'}})};
  const b = roleContextBudget({plan, resolveTurn: () => 't1', prepareBasis: async ({request}) => ({...request, messages: basisOf(request.messages)})});
  return {b, agent: {session, id: 's'}};
}
test('recall messages dropped by the history cap are no longer offered as candidates', async () => {
  const oldOne = recallMessage('很久以前的记忆'), newOne = recallMessage('最近的记忆');
  let seen = null;
  const {b, agent} = budgetRun({messages: [oldOne, newOne], basisOf: list => list.filter(m => m !== oldOne), plan: async input => { seen = input.candidates; return {order: [], recall: [], allocations: {life: {tokens: 100, reason: 'r'}, inner: {tokens: 0, reason: 'r'}, agency: {tokens: 0, reason: 'r'}}, sourceAllocations: [{source: 'external:dsh-mnemon', tokens: 100, reason: 'r'}], reason: 'r'}; }});
  await b.add({sections: [], contexts: []}, agent, 'contexts', 'cen-shu-life', [{text: '可选资料', owner: 'life', key: 'k1'}], null, {});
  const texts = seen.map(c => c.excerpt).join('|');
  assert.ok(texts.includes('最近的记忆')); assert.ok(!texts.includes('很久以前的记忆'));
  b.dispose();
});
test('reusing a previous decision does not restart its one-hour limit', async () => {
  let clock = 1_000_000, fail = false, turn = 0;
  const session = {id: 's', deriveMessages: () => [], requestContext: () => ({contextWindow: 200000, model: 'm', provider: 'p'}), requestHeader: () => ({config: {model: 'm', provider: 'p'}})}, agent = {session, id: 's'};
  const b = roleContextBudget({now: () => clock, resolveTurn: () => 't' + turn, plan: async input => { if (fail) throw Object.assign(Error('down'), {httpStatus: 503}); return {order: input.candidates.filter(c => !c.required).map(c => c.id), recall: [], allocations: {life: {tokens: 1000, reason: 'r'}, inner: {tokens: 0, reason: 'r'}, agency: {tokens: 0, reason: 'r'}}, sourceAllocations: [], reason: 'ok'}; }});
  const step = async () => { turn++; await b.add({sections: [], contexts: []}, agent, 'contexts', 'cen-shu-life', [{text: '资料', owner: 'life', key: 'k1'}], null, {}); return b.status()[0].mode; };
  assert.equal(await step(), 'model');
  fail = true; clock += 40 * 60000; assert.equal(await step(), 'previous');
  clock += 40 * 60000; assert.equal(await step(), 'local', 'the original decision is now over an hour old');
  b.dispose();
});
test('older turns are labelled historical even when no plan succeeded', () => {
  const body = '<engram_memory_context source="turn_start">\nIMPORTANT:\n- a\n- b\n- c\n\nx\n</engram_memory_context>\n<current_user_request>\n旧请求\n</current_user_request>';
  const old = {role: 'user', source: {kind: 'plugin:dsh-engram', form: 'snapshot', sections: [{name: 'dsh-engram', text: body}]}, content: [{type: 'text', text: body}]};
  const b = roleContextBudget({});
  const out = b.prepareRequest({sessionId: 's', model: 'm', messages: [old, {role: 'user', content: [{type: 'text', text: '新消息'}]}]});
  assert.match(out.messages[0].content[0].text, /historical_user_request/); assert.match(out.messages[0].source.sections[0].text, /historical_user_request/);
  b.dispose();
});

test('daily totals count every call and token, and keep sixty days', () => {
  const at = Date.parse('2026-11-09T12:00:00+08:00'), r = {};
  addRollup(r, {at, feature: 'f', model: 'm', status: 'success', usage: {promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 10, thoughtsTokenCount: 5}});
  addRollup(r, {at, feature: 'f', model: 'm', status: 'error'});
  addRollup(r, {at, feature: 'f', model: 'm', status: 'paused'});
  assert.deepEqual(r['2026-11-09']['f|m'], {calls: 3, errors: 1, paused: 1, cutoff: 0, input: 100, cached: 40, output: 15});
  for (let d = 1; d <= 70; d++) addRollup(r, {at: at + d * 86400000, feature: 'f', model: 'm', status: 'success'});
  assert.equal(Object.keys(r).length, 60); assert.ok(!r['2026-11-09']);
});

test('the writeback funnel counts what the records can show and the audit validates ids', async () => {
  const home = tmp();
  put(home, 'cen-shu-life/memory-writeback.json', {sources: [{id: 'a', state: 'reviewed', text: '我下个月要搬去杭州了', at: 5, proposed: 1, accepted: 0, choice: {decision: 'proceed', reason: 'r'}}, {id: 'b', state: 'reviewed', text: '好', at: 1, accepted: 0, skipReason: 'legacy'}, {id: 'c', state: 'pending', text: 'x', at: 9}, {id: 'd', state: 'reviewed', text: '我不吃香菜', at: 7, proposed: 1, accepted: 1, choice: {decision: 'proceed', reason: 'r'}}], facts: [{id: 'f', sourceId: 'd', text: '青枔不吃香菜', stance: 'fact', backends: {memory: {state: 'saved'}}}]});
  const f = writebackFunnel(home);
  assert.equal(f.review.reviewed, 3); assert.equal(f.review.accepted, 1); assert.equal(f.review.withNothingKept, 2); assert.equal(f.facts.backends.memory.saved, 1); assert.equal(f.knowledge, null);
  const samples = omissionSamples(home); assert.deepEqual(samples.map(s => s.text), ['我不吃香菜', '我下个月要搬去杭州了'], 'newest first, retired rows left out'); assert.deepEqual(samples[0].saved, ['青枔不吃香菜']);
  assert.throws(() => validateOmission({}, new Set()));
  let asked = null;
  const out = await writebackReport({home, generate: async (_p, _s, input) => { asked = input; return {summary: '有一条漏了', items: [{id: 'w2', missed: [{point: '要搬去杭州', level: 'high', why: '长期影响'}, {point: 'x', level: 'bogus', why: ''}]}, {id: 'nope', missed: [{point: 'y', level: 'high', why: ''}]}]}; }});
  assert.equal(asked.samples.length, 2); assert.equal(out.audit.withMisses, 1); assert.equal(out.audit.high, 1); assert.equal(out.audit.medium, 0);
  assert.equal((await writebackReport({home, generate: null})).audit, null);
});

test('usage weeks come from message times and only what 青枔 sent counts', () => {
  const at = text => Date.parse(text + '+08:00');
  const line = (kind, time) => JSON.stringify({type: 'user/message', seq: 1, time, data: {role: 'user', content: [], ...(kind ? {source: {kind}} : {})}});
  const times = userMessageTimes([line('user', 1), line(null, 2), line('runtime-context', 3), line('dsh-mnemon', 4), '{"type":"assistant/message","time":5}'].join('\n'));
  assert.deepEqual(times, [1, 2]);
  const weeks = usageWeeks([at('2026-11-09T01:00:00'), at('2026-11-09T01:20:00'), at('2026-11-09T22:00:00'), at('2026-11-11T22:00:00')]);
  assert.deepEqual(weeks, [{week: '2026-11-09', messages: 4, activeDays: 2, sittings: 3, minutes: 22, lateNightShare: 0.5}]);
  const frames = Buffer.concat([zlib.zstdCompressSync(Buffer.from('a\n')), zlib.zstdCompressSync(Buffer.from('b\n'))]);
  assert.equal(decodeFrames(frames), 'a\nb\n');
});
test('mood strands reference real records and their span comes from the records', async () => {
  const home = tmp(), day = Date.parse('2026-11-01T12:00:00+08:00'), DAY = 86400000;
  put(home, 'feiyu-mood/state.json', {moods: {censhu: {mixedMoodHistory: [{at: day, summary: '有点想他', components: [{label: '想念'}]}, {at: day + 3 * DAY, summary: '还是想', components: ['想念']}]}}});
  const rec = moodRecords(home), byId = new Map(rec.map(r => [r.id, r]));
  assert.deepEqual(rec[0].feelings, ['想念']); assert.deepEqual(rec[1].feelings, ['想念']);
  const v = validateMood({summary: 's', strands: [{name: '想念', recordIds: ['m1', 'm2'], course: 'lingering', note: 'n'}, {name: '坏', recordIds: ['m9'], course: 'lingering', note: ''}]}, byId);
  assert.equal(v.strands.length, 1); assert.equal(v.strands[0].spanDays, 3);
  const out = await trendsReport({home, generate: async () => ({summary: 'ok', strands: []})}); assert.equal(out.mood.records, 2); assert.equal(out.usage.messages, 0);
  assert.match((await trendsReport({home, generate: null})).mood.skipped, /未调用/);
});

test('the bank has comfort questions and long conversations', () => {
  assert.equal(PROBES.filter(p => p.category === 'comfort').length, 6); assert.ok(CATEGORIES.comfort && CATEGORIES.long);
  const long = PROBES.filter(p => p.turns); assert.equal(long.length, 3); for (const p of long) { assert.equal(p.turns.at(-1), p.text); assert.ok(p.turns.length >= 10); }
  assert.equal(new Set(PROBES.map(p => p.id)).size, PROBES.length);
  const bank = [{id: 'a'}, {id: 'b', turns: ['1', '2', '3']}];
  assert.deepEqual(callEstimate({...bankCost(bank), layers: 2, judges: 2}), {replies: 8, judgments: 12});
});
test('a long conversation carries its history and reports how the character changed', async () => {
  const j = n => ({intent: 'i', knowledge: n, style: n, inCharacter: n, contradicts: false, contradiction: '', response: 'comfort', note: ''}), seen = [];
  const bank = [{id: 'l', category: 'long', text: '3', turns: ['1', '2', '3']}, {id: 'c', category: 'comfort', text: '难过'}];
  const rows = await runProbes({bank, layers: ['full'], parts: [{text: '资料'}], profile: {}, reply: async (_s, p) => { seen.push(p.history.length); return '回复' + p.text; }, judges: {g: async input => j(input.question === '1' ? 5 : 3)}});
  assert.deepEqual(seen, [0, 1, 2, 0]);
  assert.equal(rows[0].firstReply, '回复1'); assert.equal(rows[0].reply, '回复3');
  const s = summarizeRun(rows); assert.equal(s.layers.full.drift.style, -2); assert.equal(s.layers.full.drift.n, 1); assert.equal(s.layers.full.response.comfort, 1);
  assert.equal(validateJudgment({...j(3), response: 'nope'}).response, undefined);
});
