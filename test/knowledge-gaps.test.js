// 2026-11-06：补齐计划里的四处差异——主动进行适配器、预算选中反馈、私人生活会话里的私人知识、写回门槛交给 Gemini。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {validateConfig} from '../lib/engine.js';
import {collectSources} from '../lib/knowledge/sources.js';
import {KnowledgeSalience, score, contextBlock} from '../lib/knowledge/salience.js';
import {createKnowledgeService} from '../lib/knowledge/service.js';
import {roleContextBudget} from '../lib/context-budget.js';
import {approvedMemories} from '../lib/memory-writeback.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const DAY = 86400000;
const mk = (id, over = {}) => ({id, subject: '岑舒', kind: 'interest', stage: 'intended', content: '岑舒想学摄影', status: 'active', visibility: 'shared', sources: [], links: [], history: [{at: 1, changeType: 'formed', reason: 'r'}], importance: {level: 'medium', class: 'experience', holdDays: 30, reason: 'r'}, ...over});

test('agency adapter: reads choices, outcomes, current activity and notes; skips runtime noise', async () => {
  const home = tmp('kgap-a-'), root = path.join(home, 'censhu-agency'); fs.mkdirSync(root, {recursive: true});
  const h = (id, type, detail) => ({timelineId: id, at: 1793800000000, sessionId: 'session-a', type, detail});
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({notes: [{id: 'n1', text: '周末去河边拍芦苇', cancelWhen: '下雨'}], history: [
    h('t1', '调用工具', 'compress'),
    h('t2', '工具报错', 'compress · Error: failed'),
    h('t3', '本次处境与结果', '生活有变化\n尚未形成选择，稍后重新交还'),
    h('t4', '本次处境与结果', '心情、兴趣或打算发生变化\n调用工具 · compress\n工具报错 · compress · Error: x'),
    h('t5', '本次处境与结果', '想把旧书里的书签理一理\n调用工具 · censhu_agency_context_page\n整理书签 · 在做'),
    h('t6', '机会等待', '生活会话正在处理其他事情'),
  ]}));
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({sessionId: 'session-a', run: 'r1', at: 1793800000000, activity: '开台灯翻旧书', judgment: '一个人待着不难受', thought: ''}));
  const {sources, status} = await collectSources({home, homedir: home, sessionIds: ['session-a']});
  const ag = sources.filter(s => s.store === 'agency');
  assert.equal(status.agency.ok, true);
  assert.deepEqual(ag.map(s => s.recordId).sort(), ['current:r1', 'note:n1', 'timeline:t5']);
  const outcome = ag.find(s => s.recordId === 'timeline:t5').text;
  assert.match(outcome, /书签/); assert.doesNotMatch(outcome, /调用工具|compress/, 'tool lines are stripped');
  assert.ok(ag.every(s => s.visibility === 'shared' && s.origin === 'her-life'));
  const off = await collectSources({home, homedir: home, sessionIds: [], stores: {agency: false}});
  assert.equal(off.sources.filter(s => s.store === 'agency').length, 0); assert.deepEqual(off.status.agency, {ok: false, disabled: true, count: 0});
  fs.rmSync(home, {recursive: true, force: true});
});

test('config: agency store toggle and dynamic writeback have defaults and are validated', () => {
  const c = validateConfig({});
  assert.equal(c.knowledgeStores.agency, true);
  assert.equal(c.memoryWritebackDynamic, true);
  assert.equal(validateConfig({knowledgeStores: {agency: false}}).knowledgeStores.agency, false);
  assert.throws(() => validateConfig({memoryWritebackDynamic: 'yes'}), /布尔值/);
});

test('salience: budget selection is a weak, expiring signal and never resets the fade clock', () => {
  const home = tmp('kgap-s-'); let t = 1793800000000;
  const s = new KnowledgeSalience({home, now: () => t});
  s.recordUse(['k1'], 'selected'); s.recordUse(['k1'], 'selected');
  let a = s.activity().items.k1;
  assert.equal(a.selected, 2); assert.equal(a.lastUsedAt, undefined, 'selection does not refresh the fade clock'); assert.equal(a.lastSelectedAt, t);
  s.recordUse(['k1'], 'recalled'); a = s.activity().items.k1; assert.equal(a.lastUsedAt, t);
  const item = mk('k1', {eventAt: t, updatedAt: t});
  const plain = score(item, null, t), sel = score(item, {selected: 50, lastSelectedAt: t}, t), rec = score(item, {recalled: 1}, t);
  assert.ok(sel > plain && sel <= plain * 1.2 + 1e-9, 'bounded bump (at most +0.2)');
  assert.ok(rec - plain > score(item, {selected: 1, lastSelectedAt: t}, t) - plain, 'one recall weighs more than one selection');
  assert.equal(score(item, {selected: 50, lastSelectedAt: t - 8 * DAY}, t), plain, 'selection weight expires after 7 days');
  fs.rmSync(home, {recursive: true, force: true});
});

function serviceFixture() {
  const home = tmp('kgap-v-'), kdir = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(kdir, {recursive: true});
  fs.mkdirSync(path.join(home, 'censhu-inner-life'), {recursive: true});
  fs.writeFileSync(path.join(home, 'censhu-inner-life', 'display-session.json'), JSON.stringify({sessionId: 'session-private'}));
  const items = {a: mk('a', {content: '岑舒想学摄影'}), b: mk('b', {content: '青枔的考试改到周五', subject: '青枔'}), p: mk('p', {visibility: 'private', content: '日记里写想学游泳'})};
  fs.writeFileSync(path.join(kdir, 'index.json'), JSON.stringify({revision: 1, updatedAt: 1, sources: {}, items, status: {state: 'idle'}}));
  fs.writeFileSync(path.join(kdir, 'ranking.json'), JSON.stringify({rows: [{id: 'p', score: 9}, {id: 'a', score: 5}, {id: 'b', score: 4}]}));
  const config = {...validateConfig({}), enabled: true, semanticEnabled: true, sessionIds: ['session-a']};
  const engine = {home, now: () => Date.now(), config, bound: id => id === 'session-a', log() {}};
  const svc = createKnowledgeService({engine, generateBase: async () => { throw Error('no model in this test'); }, idOf: a => a?.id});
  return {home, svc, config};
}

test('service: budget selection feedback records only knowledge the budget actually chose', () => {
  const {home, svc} = serviceFixture();
  const act = () => svc.salience.activity().items;
  svc.selected({sessionId: 'session-a', decided: true, keys: ['knowledge:long-term']});
  assert.deepEqual(act(), {}, 'nothing offered yet');
  svc.context('session-a');
  svc.selected({sessionId: 'session-a', decided: false, keys: ['knowledge:long-term']});
  assert.deepEqual(act(), {}, 'fallback (no model decision) is not usage');
  svc.selected({sessionId: 'session-a', decided: true, keys: ['knowledge:long-term', 'weather']});
  assert.deepEqual(Object.keys(act()).sort(), ['a', 'b'], 'only the shared items that were offered');
  assert.equal(act().a.selected, 1);
  svc.selected({sessionId: 'session-a', decided: true, keys: ['knowledge:long-term']});
  assert.equal(act().a.selected, 1, 'one offer counts once');
  svc.context('session-a');
  svc.selected({sessionId: 'session-a', decided: true, keys: ['weather']});
  assert.equal(act().a.passed, 1, 'offered but not chosen is recorded as passed (for Gemini to weigh)');
  assert.equal(act().a.selected, 1);
  fs.rmSync(home, {recursive: true, force: true});
});

test('service: private knowledge only in the private-life session (context and recall tool)', async () => {
  const {home, svc} = serviceFixture();
  assert.doesNotMatch(svc.context('session-a'), /游泳/, 'role session: shared only');
  assert.equal(svc.privateContext('session-a'), '', 'role session gets no private block');
  const priv = svc.privateContext('session-private');
  assert.match(priv, /游泳/); assert.match(priv, /摄影/); assert.match(priv, /私人生活会话/);
  assert.equal(svc.isPrivateSession('private'), true, 'session- prefix is normalised');
  const call = (id, args) => svc.tool.execute(args, {agent: {id}}).then(JSON.parse);
  assert.equal((await call('session-a', {id: 'p'})).found, false);
  assert.equal((await call('session-private', {id: 'p'})).found, true);
  assert.ok((await call('session-private', {query: '游泳'})).items.some(i => i.id === 'p'));
  assert.ok(!(await call('session-a', {query: '游泳'})).items.some(i => i.id === 'p'));
  await assert.rejects(call('session-other', {query: '摄影'}), /未绑定/);
  fs.rmSync(home, {recursive: true, force: true});
});

test('contextBlock: private items only with allowPrivate', () => {
  const index = {sources: {}, items: {a: mk('a'), p: mk('p', {visibility: 'private', content: '日记'})}};
  const ranking = {rows: [{id: 'p', score: 2}, {id: 'a', score: 1}]};
  assert.deepEqual(contextBlock(index, ranking).ids, ['a']);
  assert.deepEqual(contextBlock(index, ranking, {allowPrivate: true}).ids, ['p', 'a']);
});

test('context budget: reports the selected keys after a model decision, and decided=false on outage', async () => {
  const agent = {session: {id: 'session-a', requestContext: () => ({contextWindow: 32768, model: 'model'}), requestHeader: () => ({config: {model: 'model', maxTokens: 2048}}), deriveMessages: () => [{role: 'user', content: '最近在学什么'}]}};
  const base = {sections: [{name: 'cosplay', text: '身份'}], contexts: [], tools: []};
  const parts = [{text: '本轮必须保留', required: true}, {text: '天气晴', priority: 95, key: 'weather'}, {text: '【跨记忆库整理的长期知识】岑舒想学摄影', priority: 72, key: 'knowledge:long-term'}];
  const seen = [];
  const b = roleContextBudget({onSelection: r => seen.push(r), plan: input => ({reason: 'r', order: input.candidates.filter(c => /长期知识/.test(c.excerpt)).map(c => c.id), allocations: {life: {tokens: 500, reason: 'r'}, inner: {tokens: 0, reason: 'r'}, agency: {tokens: 0, reason: 'r'}}})});
  await b.add(base, agent, 'contexts', 'cen-shu-life', parts);
  assert.equal(seen.length, 1); assert.equal(seen[0].sessionId, 'session-a'); assert.equal(seen[0].decided, true);
  assert.ok(seen[0].keys.includes('knowledge:long-term')); assert.ok(!seen[0].keys.includes('weather'));
  const boom = roleContextBudget({onSelection: () => { throw Error('listener failure'); }, plan: () => { throw Error('outage'); }});
  const out = await boom.add(base, agent, 'contexts', 'cen-shu-life', parts);
  assert.match(JSON.stringify(out), /本轮必须保留/, 'a failing listener never breaks assembly');
  const seen2 = [];
  await roleContextBudget({onSelection: r => seen2.push(r), plan: () => { throw Error('outage'); }}).add(base, agent, 'contexts', 'cen-shu-life', parts);
  assert.equal(seen2[0]?.decided, false);
});

test('writeback: Gemini keep decides; the fixed threshold only applies without keep', () => {
  const src = '青枔说她下个月要搬去杭州工作，已经定了。她还说今天午饭吃了面。';
  const m = (over) => ({text: '青枔下个月搬去杭州工作', quote: '下个月要搬去杭州工作', kind: 'fact', importance: 70, confidence: 95, ...over});
  const run = (memories, dynamic, threshold = 75) => approvedMemories({decision: 'proceed', reason: 'r', memories}, src, threshold, {dynamic}).length;
  assert.equal(run([m({keep: true})], true), 1, 'keep=true below the old 75 line is accepted');
  assert.equal(run([m({keep: false, importance: 95})], true), 0, 'keep=false is rejected even when importance is high');
  assert.equal(run([m({keep: true, importance: 10})], true), 1, "the model's keep decides, without a score floor");
  assert.equal(run([m({})], true), 0, 'no keep → fixed threshold (70 < 75)');
  assert.equal(run([m({importance: 80})], true), 1, 'no keep → fixed threshold (80 ≥ 75)');
  assert.equal(run([m({keep: true})], false), 0, 'dynamic off → fixed threshold');
  assert.equal(run([m({keep: true, confidence: 80})], true), 1, 'keep=true is not filtered by confidence');
  assert.equal(run([m({importance: 80, confidence: 80})], true), 0, 'without keep the old confidence rule still applies');
});
