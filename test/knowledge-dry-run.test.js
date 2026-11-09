// 2026-11-07 设置页测试键：整理试跑与三路回放试跑只在临时副本上进行，任何正式文件都不能被写入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {KnowledgeConsolidator} from '../lib/knowledge/consolidate.js';
import {KnowledgeEvaluator} from '../lib/knowledge/evaluate.js';
import {trialConsolidation, trialReplay} from '../lib/knowledge/dry-run.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const imp = () => ({level: 'medium', class: 'stable', holdDays: 30, reason: 'r'});
const item = (subject, kind, stage, content) => ({subject, kind, stage, content, eventText: ''});
const src = (key, text) => ({key, store: 'life', origin: 'her-life', visibility: 'shared', reviewed: false, text, hash: 'h-' + key, eventAt: Date.parse('2026-11-01T10:00:00+08:00'), learnedAt: Date.parse('2026-11-01T10:00:00+08:00')});
// Every file under home with its content, so any write (new file or changed bytes) is detected.
const snapshot = home => { const out = {}; (function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(home, p)] = fs.readFileSync(p, 'utf8'); } })(home); return out; };

function consolidatorFor(home, {fail = false, rows} = {}) {
  const c = new KnowledgeConsolidator({home, now: () => Date.parse('2026-11-07T10:00:00+08:00'), sourceOptions: () => ({}),
    generate: async (_p, _s, input) => {
      if (fail) throw Object.assign(Error('Gemini HTTP 402'), {httpStatus: 402});
      return {decisions: input.sources.map(s => s.text.includes('天气') ? {sourceKey: s.sourceKey, relation: 'irrelevant', changeType: 'formed', reason: '与岑舒无关'} : {sourceKey: s.sourceKey, relation: 'new', changeType: 'formed', reason: '新的打算', item: item('岑舒', 'plan', 'intended', s.text), importance: imp()})};
    }});
  // Source reading is replaced; the real one is exercised by the sources tests.
  c.sync = function (index) { for (const r of rows) index.sources[r.key] = {...r, processedHash: null}; index.stores = {life: {ok: true, count: rows.length}}; return rows.map(r => index.sources[r.key]); };
  return c;
}

test('consolidation trial shows decisions and writes nothing (index, vectors, status)', async () => {
  const home = tmp('kn-dry-');
  const c = consolidatorFor(home, {rows: [src('life:a', '岑舒想周末去试拍胶片'), src('life:b', '今天天气预报说有雨')]});
  const formal = c.load(); formal.items.k1 = {id: 'k1', subject: '岑舒', kind: 'interest', stage: 'in-progress', content: '在学做饭', status: 'active', visibility: 'shared', sources: [], links: [], history: []}; c.save(formal);
  let vectorSaves = 0;
  c.vectorStore = {localVectors: async () => null, geminiVectors: async () => null, save: () => { vectorSaves++; }};
  const before = snapshot(home);
  const r = await trialConsolidation({consolidator: c, sourceOptions: () => ({}), sample: 6});
  assert.equal(r.ok, true); assert.equal(r.written, false); assert.equal(r.sampled, 2);
  const plan = r.decisions.find(d => d.relation === 'new'), noise = r.decisions.find(d => d.relation === 'irrelevant');
  assert.equal(plan.item.created, true); assert.match(plan.item.content, /试拍胶片/);
  assert.equal(noise.item, null);
  assert.deepEqual(snapshot(home), before, 'no file under DSH_HOME changed');
  assert.equal(vectorSaves, 0, 'vector cache is not persisted');
  assert.equal(Object.keys(c.load().items).length, 1, 'formal index still has only the original item');
  fs.rmSync(home, {recursive: true, force: true});
});

test('consolidation trial: a 402 is reported without putting the formal index into backoff', async () => {
  const home = tmp('kn-dry-');
  const c = consolidatorFor(home, {fail: true, rows: [src('life:a', '岑舒想学游泳')]});
  c.save(c.load());
  const before = snapshot(home);
  const r = await trialConsolidation({consolidator: c, sourceOptions: () => ({}), sample: 6});
  assert.equal(r.ok, false); assert.equal(r.stage, 'model'); assert.match(r.error, /402/);
  assert.equal(r.sampled, 1, 'the store was still read before the model step failed');
  assert.deepEqual(snapshot(home), before);
  assert.equal(c.load().status?.retryAt, undefined, 'no backoff written');
  fs.rmSync(home, {recursive: true, force: true});
});

test('replay trial without an answer model reports why and writes nothing', async () => {
  const home = tmp('kn-dry-');
  const ev = new KnowledgeEvaluator({home, generate: async () => { throw Error('should not be called'); }, answer: null});
  const r = await trialReplay({evaluator: ev, index: null, ranking: {rows: []}});
  assert.equal(r.ok, false); assert.equal(r.stage, 'answer'); assert.match(r.error, /作答模型/);
  assert.deepEqual(snapshot(home), {});
  fs.rmSync(home, {recursive: true, force: true});
});

test('replay trial never learns regressions, proposes strategies or saves evaluation results', async () => {
  const home = tmp('kn-dry-');
  // Gemini consolidates the synthetic fixture; the answer model is down, so every lane is a call error.
  const generate = async (_p, _s, input) => input?.sources ? {decisions: input.sources.map(s => ({sourceKey: s.sourceKey, relation: 'new', changeType: 'formed', reason: 'r', item: item('岑舒', 'plan', 'intended', s.text.slice(0, 200)), importance: imp()}))} : {equivalent: false, reason: 'x'};
  let answers = 0;
  const ev = new KnowledgeEvaluator({home, generate, answer: async () => { answers++; throw Error('作答模型 HTTP 503'); }, answerModel: () => 'test/model'});
  const r = await trialReplay({evaluator: ev, index: null, ranking: {rows: []}});
  assert.ok(answers > 0, 'the answer model was actually exercised');
  assert.equal(r.ok, false); assert.equal(r.stage, 'answer'); assert.match(r.error, /503/);
  assert.equal(r.replay.status, 'done'); assert.equal(r.replay.cases.length > 0, true);
  assert.equal(r.realSkipped, true);
  assert.ok(r.calls.gemini > 0 && r.calls.answer === answers);
  assert.deepEqual(snapshot(home), {}, 'no evaluation, strategy or learned-case file was created');
  fs.rmSync(home, {recursive: true, force: true});
});
