import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {outputProblem,googleStructured,withMoreRoom} from '../lib/situation.js';
import {addRollup,observeGemini,telemetryFile} from '../lib/gemini-telemetry.js';
import {applyDecision,consolidationPrompt} from '../lib/knowledge/consolidate.js';
import {rhythmPrompt} from '../lib/rhythm.js';

const c = (finishReason, extra = {}) => ({candidates: [{finishReason}], ...extra});
test('cut-off, blocked and empty replies are told apart from good ones', () => {
  assert.equal(outputProblem('{"a":1}', c('STOP')), null);
  assert.equal(outputProblem('{"a"', c('MAX_TOKENS')), 'truncated');
  assert.equal(outputProblem('', c('MAX_TOKENS')), 'truncated');
  assert.equal(outputProblem('', c('SAFETY')), 'blocked');
  assert.equal(outputProblem('', {promptFeedback: {blockReason: 'OTHER'}}), 'blocked');
  assert.equal(outputProblem('', c('STOP')), 'empty');
});

const withHome = async fn => { const old = process.env.DSH_HOME, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-')); process.env.DSH_HOME = dir; try { await fn(dir); } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old; } };
const reply = (text, finishReason) => ({ok: true, status: 200, json: async () => ({candidates: [{finishReason, content: {parts: text ? [{text}] : []}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}})});
const config = {semanticModel: 'gemini-test'};
const schema = {type: 'object', properties: {a: {type: 'integer'}}};
const key = async () => 'k';
test('a call given its own fetcher reports the problem through the error, unchanged for callers', async () => {
  await assert.rejects(googleStructured('s', schema, {}, config, {fetcher: async () => reply('{"a"', 'MAX_TOKENS'), keyReader: key}), e => e.code === 'MODEL_OUTPUT_FORMAT');
  assert.deepEqual(await googleStructured('s', schema, {}, config, {fetcher: async () => reply('{"a":1}', 'STOP'), keyReader: key}), {a: 1});
});
test('a cut-off structured reply gets one more try with more room, nothing else does', async () => {
  const limits = [], cut = meta => async limit => { limits.push(limit); if (limits.length === 1) { meta.outputProblem = 'truncated'; throw Object.assign(Error('x'), {code: 'MODEL_OUTPUT_FORMAT'}); } delete meta.outputProblem; return {a: 1}; };
  const meta = {}; assert.deepEqual(await withMoreRoom(meta, 500, true, cut(meta)), {a: 1}); assert.deepEqual(limits, [500, 1500]); assert.equal(meta.truncatedRetry, 1);
  let calls = 0; const once = (m, error) => async () => { calls++; throw error; };
  const a = {outputProblem: 'empty'}; await assert.rejects(withMoreRoom(a, 500, true, once(a, Error('e')))); assert.equal(calls, 1, 'empty is not a space problem');
  calls = 0; const b = {outputProblem: 'truncated'}; await assert.rejects(withMoreRoom(b, 16000, true, once(b, Error('e')))); assert.equal(calls, 1, 'already at the cap');
  calls = 0; const d = {outputProblem: 'truncated'}; await assert.rejects(withMoreRoom(d, 500, false, once(d, Error('e')))); assert.equal(calls, 1, 'plain text callers handle their own');
  calls = 0; const f = {outputProblem: 'truncated'}; await assert.rejects(withMoreRoom(f, 500, true, once(f, Object.assign(Error('e'), {httpStatus: 402})))); assert.equal(calls, 1, 'a refused request is never repeated');
});
test('telemetry names the problem instead of calling it malformed JSON, and the day counts it', async () => withHome(async () => {
  await assert.rejects(observeGemini('f', 'm', async meta => { meta.outputProblem = 'truncated'; throw Object.assign(Error('模型返回的 JSON 格式无效'), {code: 'MODEL_OUTPUT_FORMAT'}); }));
  const data = JSON.parse(fs.readFileSync(telemetryFile(), 'utf8')), row = data.rows[0];
  assert.equal(row.outputProblem, 'truncated'); assert.match(row.diagnosis, /截断/);
  assert.equal(Object.values(Object.values(data.rollup)[0])[0].cutoff, 1);
  const r = addRollup({}, {at: Date.parse('2026-11-09T12:00:00+08:00'), feature: 'f', model: 'm', status: 'success', truncatedRetry: 1});
  assert.equal(r['2026-11-09']['f|m'].cutoff, 1, 'a reply that needed the extra room still shows up');
}));

test('an earlier source that is the backstory of a later item stays a stage, not a new item', () => {
  assert.match(consolidationPrompt, /前情或更早阶段/);
  const index = {sources: {}, items: {}, ignored: {}}, importance = {level: 'low', class: 'experience', holdDays: 30, reason: 'r'};
  const later = index.sources.b = {key: 'b', store: 'life', text: '试拍了', visibility: 'shared', hash: 'hb', eventAt: 5000};
  applyDecision(index, later, {sourceKey: 'b', relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '岑舒', kind: 'experience', stage: 'done', content: '岑舒去公园试拍了'}, importance}, 6000);
  const item = Object.values(index.items)[0], earlier = index.sources.a = {key: 'a', store: 'life', text: '想学摄影', visibility: 'shared', hash: 'ha', eventAt: 1000};
  applyDecision(index, earlier, {sourceKey: 'a', relation: 'progress', itemId: item.id, changeType: 'changed', reason: 'r', item: {subject: '岑舒', kind: 'interest', stage: 'intended', content: '岑舒想学摄影'}, importance}, 7000);
  assert.equal(Object.keys(index.items).length, 1); assert.equal(item.content, '岑舒去公园试拍了'); assert.equal(item.priorValues[0].content, '岑舒想学摄影'); assert.ok(item.sources.includes('a'));
});
test('the rhythm prompt treats the computer as a signal only', () => { assert.match(rhythmPrompt, /computer/); assert.match(rhythmPrompt, /不等于人不在/); });
