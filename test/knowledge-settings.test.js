// 2026-11-06：长期知识页签的设置与接口。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {validateConfig} from '../lib/engine.js';
import {createKnowledgeService} from '../lib/knowledge/service.js';
import {collectSources} from '../lib/knowledge/sources.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const mk = (id, over = {}) => ({id, subject: '岑舒', kind: 'interest', stage: 'intended', content: '岑舒想学摄影', status: 'active', visibility: 'shared', sources: [], links: [], history: [{at: 1, changeType: 'formed', reason: 'r'}], importance: {level: 'high', class: 'stable', holdDays: 3650, reason: 'r'}, ...over});

test('config: knowledge settings have defaults and are validated', () => {
  const c = validateConfig({});
  assert.equal(c.knowledgeEnabled, true); assert.equal(c.knowledgeContextEnabled, true); assert.equal(c.knowledgeContextLimit, 10); assert.equal(c.knowledgeGeminiEmbedding, true); assert.equal(c.knowledgeEvaluationDays, 7); assert.equal(c.knowledgeOpenVikingRoot, '');
  assert.deepEqual(Object.keys(c.knowledgeStores), ['engram', 'lingshu', 'mnemon', 'openviking', 'memoryEvolve', 'life', 'innerLife', 'agency', 'mood']);
  assert.equal(validateConfig({knowledgeStores: {mnemon: false}}).knowledgeStores.engram, true, 'partial store toggles merge with defaults');
  assert.throws(() => validateConfig({knowledgeContextLimit: 0}), /1 到 30/);
  assert.throws(() => validateConfig({knowledgeEvaluationDays: 120}), /1 到 90/);
  assert.throws(() => validateConfig({knowledgeOpenVikingRoot: 'relative/path'}), /绝对路径/);
  assert.throws(() => validateConfig({knowledgeStores: {unknown: true}}), /无效记忆库开关/);
  assert.throws(() => validateConfig({knowledgeGeminiEmbedding: 'yes'}), /布尔值/);
});

test('store toggles: a disabled store is not read and is reported as disabled', async () => {
  const home = tmp('kset-r-');
  fs.mkdirSync(path.join(home, 'memories'), {recursive: true}); fs.writeFileSync(path.join(home, 'memories', 'MEMORY.md'), '[2026-11-01] 岑舒喜欢旧书');
  const on = await collectSources({home, homedir: home, sessionIds: []});
  assert.equal(on.sources.filter(s => s.store === 'memory-evolve').length, 1);
  const off = await collectSources({home, homedir: home, sessionIds: [], stores: {memoryEvolve: false}});
  assert.equal(off.sources.filter(s => s.store === 'memory-evolve').length, 0); assert.deepEqual(off.status.memoryEvolve, {ok: false, disabled: true, count: 0});
  fs.rmSync(home, {recursive: true, force: true});
});

test('service: settings change context offering; items list filters and marks private; view reports settings', async () => {
  const home = tmp('kset-s-'), kdir = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(kdir, {recursive: true});
  const items = {}; for (let n = 0; n < 15; n++) items['s' + n] = mk('s' + n, {content: '岑舒的第' + n + '件事'});
  items.p = mk('p', {visibility: 'private', content: '日记里写摄影光圈很难'}); items.old = mk('old', {status: 'superseded', content: '青枔周三考试'});
  fs.writeFileSync(path.join(kdir, 'index.json'), JSON.stringify({revision: 2, sources: {}, items, status: {state: 'idle'}}));
  fs.writeFileSync(path.join(kdir, 'ranking.json'), JSON.stringify({rows: Object.keys(items).filter(k => k !== 'old').map((id, n) => ({id, score: 100 - n}))}));
  const config = {...validateConfig({}), enabled: true, semanticEnabled: true, sessionIds: ['session-a']};
  const engine = {home, now: () => Date.now(), config, bound: id => id === 'session-a', log() {}};
  const svc = createKnowledgeService({engine, generateBase: async () => { throw Error('no model in this test'); }});
  const lines = () => svc.context('session-a').split('\n').filter(l => l.startsWith('- ')).length;
  assert.equal(lines(), 10, 'default limit');
  config.knowledgeContextLimit = 3; assert.equal(lines(), 3);
  config.knowledgeContextEnabled = false; assert.equal(svc.context('session-a'), '', 'not offered to the budget');
  config.knowledgeContextEnabled = true; config.knowledgeEnabled = false; assert.equal(svc.context('session-a'), ''); config.knowledgeEnabled = true;
  const all = svc.items({}); assert.equal(all.total, 17); assert.equal(all.items.find(i => i.id === 'p').visibility, 'private', 'owner page shows private items, labelled');
  assert.deepEqual(svc.items({status: 'superseded'}).items.map(i => i.id), ['old']);
  assert.deepEqual(svc.items({visibility: 'private'}).items.map(i => i.id), ['p']);
  assert.ok(svc.items({q: '考试'}).items.some(i => i.id === 'old'));
  assert.ok(svc.items({}).items[0].history.length >= 1, 'history included for the detail view');
  const v = svc.view();
  assert.equal(v.config.knowledgeContextLimit, 3); assert.equal(v.items, 17); assert.equal(v.byStatus.superseded, 1); assert.equal(typeof v.retrieval.geminiAllowed, 'boolean');
  config.knowledgeGeminiEmbedding = false; assert.equal(svc.view().retrieval.geminiAllowed, false);
  fs.rmSync(home, {recursive: true, force: true});
});

test('service: "立即整理" clears the backoff once and reports failures without breaking anything', async () => {
  const home = tmp('kset-c-'), kdir = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(kdir, {recursive: true});
  fs.writeFileSync(path.join(kdir, 'index.json'), JSON.stringify({version: 1, revision: 1, sources: {}, items: {}, ignored: {}, status: {state: 'retry', retryAt: Date.now() + 3600000, failures: 2}}));
  const config = {...validateConfig({}), enabled: true, semanticEnabled: true, sessionIds: ['session-a'], knowledgeStores: {engram: false, lingshu: false, mnemon: false, openviking: false, memoryEvolve: false, life: false, innerLife: false, mood: false}};
  const engine = {home, now: () => Date.now(), config, bound: () => true, log() {}};
  const svc = createKnowledgeService({engine, generateBase: async () => { throw Error('should not be needed with nothing pending'); }});
  const r = await svc.consolidateNow();
  assert.deepEqual(r, {pending: 0}, 'backoff cleared and a pass ran'); assert.equal(svc.view().consolidation.state, 'idle');
  fs.rmSync(home, {recursive: true, force: true});
});
