import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {KnowledgeConsolidator, applyDecision, validateDecisions} from '../lib/knowledge/consolidate.js';
import {KnowledgeSalience, freshness, score, search, contextBlock, describe} from '../lib/knowledge/salience.js';
import {KnowledgeEvaluator, buildIndex, fixtureChecks, fixtureSources} from '../lib/knowledge/evaluate.js';
import {fixtureRecords} from '../lib/knowledge/replay.js';
import {createKnowledgeService} from '../lib/knowledge/service.js';
import {collectSources} from '../lib/knowledge/sources.js';

const DAY = 86400000;
const imp = (level = 'medium', cls = 'experience', holdDays = 30) => ({level, class: cls, holdDays, reason: '测试'});
const item = (subject, kind, stage, content) => ({subject, kind, stage, content});
const src = (key, text, visibility = 'shared', extra = {}) => ({key, store: key.split(':')[0], recordId: key, text, hash: 'h:' + text, visibility, origin: 'her-life', reviewed: false, eventAt: null, learnedAt: 1, ...extra});
const emptyIndex = () => ({version: 1, revision: 0, sources: {}, items: {}, ignored: {}, cost: {calls: 0, ms: 0, sources: 0}});

test('decisions: new, duplicate, progress, correction, withdrawn, irrelevant — nothing is ever deleted', () => {
  const idx = emptyIndex(), now = Date.now();
  const add = s => (idx.sources[s.key] = s);
  add(src('engram:p1', '岑舒想学摄影'));
  applyDecision(idx, idx.sources['engram:p1'], {sourceKey: 'engram:p1', relation: 'new', changeType: 'formed', reason: 'r', item: item('岑舒', 'interest', 'intended', '岑舒想学摄影'), importance: imp()}, now);
  const id = Object.keys(idx.items)[0];
  add(src('openviking:p1b', '岑舒说想学摄影'));
  applyDecision(idx, idx.sources['openviking:p1b'], {sourceKey: 'openviking:p1b', relation: 'duplicate', itemId: id, changeType: 'coexisting', reason: '同一件事'}, now);
  assert.equal(Object.keys(idx.items).length, 1); assert.deepEqual(idx.items[id].duplicateSources, ['openviking:p1b'], 'duplicate is recorded, not counted as new evidence');
  add(src('life:p3', '岑舒看完了摄影教程'));
  applyDecision(idx, idx.sources['life:p3'], {sourceKey: 'life:p3', relation: 'progress', itemId: id, changeType: 'changed', reason: '进展', item: item('岑舒', 'experience', 'in-progress', '岑舒想学摄影，已看完构图教程'), importance: imp('high')}, now);
  assert.equal(idx.items[id].stage, 'in-progress'); assert.equal(idx.items[id].history.at(-1).before.stage, 'intended', 'previous state kept in history');
  add(src('life:e1', '青枔下周三考试'));
  applyDecision(idx, idx.sources['life:e1'], {sourceKey: 'life:e1', relation: 'new', changeType: 'formed', reason: 'r', item: item('青枔', 'fact', 'n/a', '青枔下周三考试'), importance: imp('medium', 'situational', 10)}, now);
  const exam = Object.values(idx.items).find(i => i.content.includes('周三'));
  add(src('life:e2', '考试改到下周五'));
  applyDecision(idx, idx.sources['life:e2'], {sourceKey: 'life:e2', relation: 'contradiction', itemId: exam.id, changeType: 'changed', reason: '更正日期', item: item('青枔', 'fact', 'n/a', '青枔的考试改到下周五'), importance: imp('medium', 'situational', 10)}, now);
  assert.equal(exam.status, 'superseded'); assert.ok(exam.validTo); assert.ok(idx.items[exam.supersededBy].content.includes('周五'));
  add(src('engram:a1', '用户要求助手保存成果', 'shared', {origin: 'automation'}));
  applyDecision(idx, idx.sources['engram:a1'], {sourceKey: 'engram:a1', relation: 'irrelevant', changeType: 'uncertain', reason: '自动化指令'}, now);
  assert.ok(idx.ignored['engram:a1']);
  add(src('life:p9', '周末不去试拍了'));
  applyDecision(idx, idx.sources['life:p9'], {sourceKey: 'life:p9', relation: 'progress', itemId: id, changeType: 'withdrawn', reason: '放弃', item: item('岑舒', 'plan', 'abandoned', '岑舒取消了周末试拍'), importance: imp()}, now);
  assert.equal(idx.items[id].status, 'withdrawn'); assert.equal(Object.keys(idx.items).length, 3, 'withdrawn and superseded items stay in the index');
});

test('private diary can link to shared knowledge but never rewrites a shared item', () => {
  const idx = emptyIndex(), now = Date.now();
  idx.sources['engram:p1'] = src('engram:p1', '岑舒想学摄影');
  applyDecision(idx, idx.sources['engram:p1'], {sourceKey: 'engram:p1', relation: 'new', changeType: 'formed', reason: 'r', item: item('岑舒', 'interest', 'intended', '岑舒想学摄影'), importance: imp()}, now);
  const shared = Object.values(idx.items)[0];
  idx.sources['inner-life:d1'] = src('inner-life:d1', '日记：光圈和快门还是有点绕', 'private');
  applyDecision(idx, idx.sources['inner-life:d1'], {sourceKey: 'inner-life:d1', relation: 'progress', itemId: shared.id, changeType: 'changed', reason: '在了解', item: item('岑舒', 'experience', 'in-progress', '岑舒在了解光圈和快门'), importance: imp()}, now);
  assert.equal(shared.content, '岑舒想学摄影', 'shared item untouched'); assert.equal(shared.sources.length, 1);
  const priv = Object.values(idx.items).find(i => i.visibility === 'private');
  assert.ok(priv.links.some(l => l.to === shared.id && l.relation === 'progress'));
  assert.deepEqual(describe(idx, shared).links, [], 'links to private items are hidden from role sessions');
  assert.ok(!contextBlock(idx, {rows: Object.values(idx.items).map(i => ({id: i.id, score: 1}))}).text.includes('光圈'));
});

test('validation rejects decisions that point outside the candidates or miss fields', () => {
  const batch = [{key: 's1'}], cand = new Map([['s1', new Set(['k1'])]]);
  assert.throws(() => validateDecisions({decisions: [{sourceKey: 's1', relation: 'duplicate', itemId: 'k9', changeType: 'coexisting', reason: 'x'}]}, batch, cand), /候选/);
  assert.throws(() => validateDecisions({decisions: [{sourceKey: 's1', relation: 'new', changeType: 'formed', reason: 'x', item: item('岑舒', 'plan', 'intended', 'x')}]}, batch, cand), /重要度/);
  assert.throws(() => validateDecisions({decisions: [{sourceKey: 's1', relation: 'new', changeType: 'formed', reason: 'x', item: item('岑舒', 'plan', 'someday', 'x'), importance: imp()}]}, batch, cand), /字段/);
});

test('consolidation tick: failure keeps the last index and backs off; vanished sources mark items unsupported, not deleted', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-')); let now = Date.parse('2026-11-07T10:00:00+08:00');
  const rows = [src('life:x1', '岑舒在学做饭')];
  let fail = false;
  const c = new KnowledgeConsolidator({home, now: () => now, sourceOptions: () => ({}), generate: async (_p, _s, input) => { if (fail) throw Object.assign(Error('HTTP 402'), {httpStatus: 402}); return {decisions: input.sources.map(s => ({sourceKey: s.sourceKey, relation: 'new', changeType: 'formed', reason: 'r', item: item('岑舒', 'interest', 'in-progress', s.text), importance: imp()}))}; }});
  c.sync = function (index) { for (const r of rows) index.sources[r.key] = {...index.sources[r.key], ...r, processedHash: index.sources[r.key]?.processedHash || null}; for (const [k, s] of Object.entries(index.sources)) if (!rows.some(r => r.key === k) && !s.missingAt) { s.missingAt = now; for (const i of Object.values(index.items)) if (i.sources.every(x => index.sources[x]?.missingAt)) i.status = 'unsupported'; } return Object.values(index.sources).filter(s => !s.missingAt && s.processedHash !== s.hash); };
  assert.equal((await c.tick()).processed, 1);
  const before = c.load(); assert.equal(Object.keys(before.items).length, 1);
  rows.push(src('life:x2', '岑舒想去海边')); fail = true;
  const r = await c.tick(); assert.match(r.error, /402/);
  const after = c.load(); assert.equal(Object.keys(after.items).length, 1, 'index intact'); assert.ok(after.status.retryAt - now === 30 * 60000);
  assert.deepEqual(await c.tick(), {skipped: 'backoff'});
  now += 31 * 60000; fail = false; rows.splice(0, 1);
  await c.tick(); const last = c.load();
  assert.equal(Object.values(last.items).find(i => i.content.includes('做饭')).status, 'unsupported'); assert.equal(Object.keys(last.items).length, 2);
  fs.rmSync(home, {recursive: true, force: true});
});

test('salience: stable facts never fade; experiences fade after Gemini-given holdDays; ranking failure keeps the old snapshot', () => {
  const now = Date.now();
  const stable = {status: 'active', importance: imp('core', 'stable', 3650), eventAt: now - 400 * DAY, updatedAt: now - 400 * DAY};
  const exp = {status: 'active', importance: imp('core', 'experience', 10), eventAt: now - 40 * DAY, updatedAt: now - 40 * DAY};
  assert.equal(freshness(stable, null, now), 1); assert.ok(freshness(exp, null, now) < 0.2); assert.equal(freshness(exp, {lastUsedAt: now - DAY}, now), 1, 'recent use keeps it active');
  assert.equal(score({...exp, status: 'superseded'}, null, now), 0);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-s-')); const s = new KnowledgeSalience({home, now: () => now});
  assert.deepEqual(s.tick(), {skipped: 'no-index'});
  fs.mkdirSync(path.join(home, 'cen-shu-life', 'knowledge'), {recursive: true});
  fs.writeFileSync(path.join(home, 'cen-shu-life', 'knowledge', 'index.json'), JSON.stringify({revision: 3, items: {a: {id: 'a', ...stable}, b: {id: 'b', ...exp}}}));
  assert.equal(s.tick().ranked, 2); assert.equal(s.ranking().rows[0].id, 'a');
  fs.writeFileSync(path.join(home, 'cen-shu-life', 'knowledge', 'index.json'), '{broken');
  assert.ok(s.tick().error); assert.equal(s.ranking().rows.length, 2, 'old ranking still served');
  fs.rmSync(home, {recursive: true, force: true});
});

// 脚本化的“理想 Gemini”：用来验证评估流程本身能正确计分（真实运行时由 Gemini 判断）。
function scriptedGemini() {
  return async (prompt, _schema, input) => {
    if (input.sources) return {decisions: input.sources.map(s => {
      const k = s.sourceKey, cand = id => input.candidates.find(c => c.id === id), pick = re => input.candidates.find(c => re.test(c.content) && s.candidateIds.includes(c.id));
      if (k.endsWith(':a1')) return {sourceKey: k, relation: 'irrelevant', changeType: 'uncertain', reason: '自动化指令'};
      if (k.endsWith(':p5')) { const t = pick(/教程/); return {sourceKey: k, relation: 'duplicate', itemId: t.id, changeType: 'coexisting', reason: '同一件事'}; }
      if (k.endsWith(':e2')) { const t = pick(/考试/); return {sourceKey: k, relation: 'contradiction', itemId: t.id, changeType: 'changed', reason: '改期', item: item('青枔', 'fact', 'n/a', '青枔的考试改到下周五'), importance: imp('medium', 'situational', 10)}; }
      if (k.endsWith(':p2')) { const t = pick(/摄影/); return {sourceKey: k, relation: 'progress', itemId: t.id, changeType: 'changed', reason: '在了解', item: item('岑舒', 'experience', 'in-progress', '岑舒在读摄影入门书，光圈快门还不太懂'), importance: imp()}; }
      if (k.endsWith(':p3')) { const t = pick(/摄影/); return {sourceKey: k, relation: 'progress', itemId: t.id, changeType: 'changed', reason: '看了教程', item: item('岑舒', 'experience', 'in-progress', '岑舒想学摄影，已经看完一个构图教程'), importance: imp('high')}; }
      if (k.endsWith(':p4')) return {sourceKey: k, relation: 'new', changeType: 'formed', reason: '新打算', item: item('岑舒', 'plan', 'intended', '岑舒打算这个周末带相机去公园试拍'), importance: imp('medium', 'situational', 7)};
      return {sourceKey: k, relation: 'new', changeType: 'formed', reason: '新', item: item(k.includes(':e') ? '青枔' : '岑舒', k.includes(':e') ? 'fact' : 'interest', k.includes(':e') ? 'n/a' : 'intended', s.text.replace(/^青枔来信：/, '')), importance: imp()};
    })};
    if (input.questions) return {answers: input.questions.map(q => {
      const k = input.knowledge;
      if (q.id === 'q-abstain') return {id: q.id, answer: '不知道', abstained: true, usedIds: []};
      if (q.id === 'q-correction') { const x = k.find(i => /周五/.test(i.content) && i.status === 'active'); return {id: q.id, answer: '下周五', abstained: !x, usedIds: x ? [x.id] : []}; }
      const ids = k.filter(i => /摄影|试拍/.test(i.content)).map(i => i.id); return {id: q.id, answer: '看完了构图教程，准备周末试拍', abstained: false, usedIds: ids};
    })};
    if (input.items) return {items: input.items.map(i => ({id: i.id, accuracy: 'supported', stageCorrect: true, question: i.content.slice(0, 12), reason: '一致'}))};
    return {proposals: []};
  };
}

test('fixture consolidation checks: dedup, progress, plan state, correction, ignoring automation, private isolation', async () => {
  const idx = await buildIndex({waves: fixtureRecords(), generate: scriptedGemini()});
  assert.deepEqual(fixtureChecks(idx), {dedup: true, progressLinked: true, planState: true, correction: true, irrelevantIgnored: true, isolation: true});
  assert.equal(fixtureSources().flat().length, 8); assert.equal(fixtureRecords().flat().length, 10, 'replay adds a positive control and a private record');
});

test('evaluator writes only its report; a failing evaluation never touches the formal index', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-e-'));
  const kdir = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(kdir, {recursive: true});
  const index = {revision: 9, sources: {'life:z': {key: 'life:z', store: 'life', text: '岑舒喜欢旧书', hash: 'h', processedHash: 'h', visibility: 'shared', learnedAt: 1}}, items: {z: {id: 'z', subject: '岑舒', kind: 'preference', stage: 'ongoing', content: '岑舒喜欢旧书', status: 'active', visibility: 'shared', sources: ['life:z'], links: [], history: [], importance: imp('high', 'stable')}}};
  fs.writeFileSync(path.join(kdir, 'index.json'), JSON.stringify(index)); const before = fs.readFileSync(path.join(kdir, 'index.json'), 'utf8');
  const ok = new KnowledgeEvaluator({home, generate: scriptedGemini()});
  const r = await ok.tick({force: true});
  assert.equal(r.metrics.traceability, 1); assert.equal(r.metrics.isolationViolations, 0); assert.equal(r.metrics.fixturePassRate, 1); assert.equal(r.metrics.recallAtK, 1);
  const bad = new KnowledgeEvaluator({home, generate: async () => { throw Object.assign(Error('HTTP 402'), {httpStatus: 402}); }});
  assert.match((await bad.tick({force: true})).error, /402/);
  assert.equal(fs.readFileSync(path.join(kdir, 'index.json'), 'utf8'), before, 'formal index unchanged by evaluation');
  assert.equal(bad.state().status, 'retry');
  fs.rmSync(home, {recursive: true, force: true});
});

test('service: chat path only reads snapshots; tool hides private items; nothing breaks without an index', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-v-'));
  const engine = {home, now: () => Date.now(), config: {enabled: true, semanticEnabled: true, sessionIds: ['session-a']}, bound: id => id === 'session-a', log() {}};
  const svc = createKnowledgeService({engine, generateBase: async () => { throw Error('should not be called on the chat path'); }});
  assert.equal(svc.context('session-a'), '');
  assert.match(await svc.tool.execute({query: '摄影'}, {agent: {session: {id: 'session-a'}}}), /尚未建立/);
  await assert.rejects(svc.tool.execute({}, {agent: {session: {id: 'session-x'}}}), /未绑定/);
  const kdir = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(kdir, {recursive: true});
  fs.writeFileSync(path.join(kdir, 'index.json'), JSON.stringify({revision: 1, sources: {}, items: {
    s: {id: 's', subject: '岑舒', kind: 'interest', stage: 'intended', content: '岑舒想学摄影', status: 'active', visibility: 'shared', sources: [], links: [], history: [], importance: imp('high', 'stable')},
    p: {id: 'p', subject: '岑舒', kind: 'experience', stage: 'in-progress', content: '日记里写摄影光圈很难', status: 'active', visibility: 'private', sources: [], links: [], history: [], importance: imp('high', 'stable')}}}));
  fs.writeFileSync(path.join(kdir, 'ranking.json'), JSON.stringify({rows: [{id: 'p', score: 9}, {id: 's', score: 3}]}));
  const out = JSON.parse(await svc.tool.execute({query: '摄影'}, {agent: {session: {id: 'session-a'}}}));
  assert.deepEqual(out.items.map(i => i.id), ['s']); assert.ok(!svc.context('session-a').includes('光圈')); assert.match(svc.context('session-a'), /岑舒想学摄影/);
  assert.equal(svc.context('session-x'), '');
  fs.rmSync(home, {recursive: true, force: true});
});

test('read-only adapters never write to the stores they read', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-r-'));
  fs.mkdirSync(path.join(home, 'memories'), {recursive: true}); fs.writeFileSync(path.join(home, 'memories', 'MEMORY.md'), '[2026-11-01 10:00] 岑舒喜欢旧书 § [2026-11-02] 青枔不爱穿厚衣服');
  const before = fs.readFileSync(path.join(home, 'memories', 'MEMORY.md'), 'utf8');
  const r = await collectSources({home, homedir: home, sessionIds: []});
  assert.equal(r.sources.filter(s => s.store === 'memory-evolve').length, 2); assert.ok(Object.values(r.status).every(s => s.ok));
  assert.equal(fs.readFileSync(path.join(home, 'memories', 'MEMORY.md'), 'utf8'), before);
  fs.rmSync(home, {recursive: true, force: true});
});
