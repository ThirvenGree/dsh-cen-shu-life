import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedMemories} from '../lib/memory-writeback.js';
import {trustedSituation, situationPrompt} from '../lib/situation.js';
import {resolveTimeRange, parseTimeRange} from '../lib/knowledge/time-range.js';
import {rhythmPrompt} from '../lib/rhythm.js';

const source = '我下个月要搬去杭州了';
const memory = extra => ({text: '青枔下个月搬去杭州', quote: '下个月要搬去杭州', kind: 'fact', stance: 'fact', importance: 40, confidence: 60, keep: true, ...extra});
test("the model's keep decides, whatever scores it gave", () => {
  assert.equal(approvedMemories({decision: 'proceed', memories: [memory()]}, source, 75, {dynamic: true}).length, 1);
  assert.equal(approvedMemories({decision: 'proceed', memories: [memory({keep: false, importance: 100, confidence: 100})]}, source, 75, {dynamic: true}).length, 0);
});
test('the words must still be really there, and the old gate stays when dynamic review is off', () => {
  assert.equal(approvedMemories({decision: 'proceed', memories: [memory({quote: '编出来的话'})]}, source, 75, {dynamic: true}).length, 0);
  assert.equal(approvedMemories({decision: 'skip', memories: [memory()]}, source, 75, {dynamic: true}).length, 0);
  assert.equal(approvedMemories({decision: 'proceed', memories: [memory()]}, source, 75, {dynamic: false}).length, 0);
  assert.equal(approvedMemories({decision: 'proceed', memories: [memory({importance: 80, confidence: 95})]}, source, 75, {dynamic: false}).length, 1);
});
const situation = extra => ({version: 1, confidence: 40, needsCare: true, careResolved: false, confession: false, offense: false, flirt: false, romance: false, interpretation: 'clear', assessment: {}, resolvedModes: [], durationMinutes: {}, assessmentMinutes: 20, ...extra});
test('a situation is trusted on what the model says it understood, not on a number', () => {
  const kept = trustedSituation(situation());
  if (Object.keys(kept).length) assert.equal(kept.needsCare, true);
  assert.deepEqual(trustedSituation(situation({interpretation: 'uncertain', confidence: 95})), {});
  assert.match(situationPrompt, /interpretation 写 uncertain/);
});
const NOW = Date.parse('2026-11-09T12:00:00+08:00');
test('the rules answer first and the model is not called', async () => {
  const hit = await resolveTimeRange('上个月', NOW, {generate: async () => { throw Error('不应调用'); }});
  assert.deepEqual(hit, parseTimeRange('上个月', NOW));
});
test('the model reads what the rules cannot, and only valid dates count', async () => {
  let asked; const summer = await resolveTimeRange('去年夏天', NOW, {earliest: Date.parse('2025-12-01T12:00:00+08:00'), generate: async (_p, _s, input) => { asked = input; return {known: true, from: '2025-06-01', to: '2025-08-31', label: '去年夏天'}; }});
  assert.deepEqual([asked.today, asked.earliest], ['2026-11-09', '2025-12-01']);
  assert.equal(summer.from, Date.parse('2025-06-01T00:00:00+08:00')); assert.equal(summer.to, Date.parse('2025-09-01T00:00:00+08:00') - 1); assert.equal(summer.label, '去年夏天');
  for (const reply of [{known: false, from: '', to: '', label: ''}, {known: true, from: '昨天', to: '今天', label: 'x'}, {known: true, from: '2026-02-01', to: '2026-01-01', label: 'x'}]) assert.equal(await resolveTimeRange('那阵子', NOW, {generate: async () => reply}), null);
  assert.equal(await resolveTimeRange('那阵子', NOW, {generate: async () => { throw Error('down'); }}), null, 'a failure means no time limit');
  assert.equal(await resolveTimeRange('那阵子', NOW, {}), null);
  const year = parseTimeRange('去年', NOW);
  assert.equal((await resolveTimeRange('去年夏天', NOW, {generate: async () => ({known: false, from: '', to: '', label: ''})})).from, year.from, 'what the rule did read is still used');
  assert.equal((await resolveTimeRange('去年夏天', NOW, {generate: async () => { throw Error('down'); }})).to, year.to);
});
test('the rhythm prompt no longer forbids the night', () => { assert.ok(!rhythmPrompt.includes('02至06点')); assert.match(rhythmPrompt, /没有固定的禁止时段/); });
