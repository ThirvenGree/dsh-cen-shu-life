// 2026-11-07 三路回放的题目每次评估重新生成：程序校验、独立审核、隐私检查、失败兜底，以及换题确认的对照规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {validateSuite, generateSuite, generatePairs, suiteChecks, suitePrompt, suiteReviewPrompt, pairsPrompt, BUILTIN_SPEC} from '../lib/knowledge/synthetic.js';
import {KnowledgeEvaluator, fixtureChecks, buildIndex} from '../lib/knowledge/evaluate.js';
import {fixtureRecords} from '../lib/knowledge/replay.js';
import {compareRuns} from '../lib/knowledge/strategy.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const base = Date.parse('2026-11-04T09:00:00+08:00');
// A well-formed generated suite: a pottery class, a moved picnic, a duplicate across stores, a private diary.
export function sampleSuite() {
  return {theme: '陶艺课与野餐',
    records: [
      {id: 'a1', store: 'engram', origin: 'her-session', visibility: 'shared', hoursAfterStart: 0, text: '岑舒说想报一个周末的陶艺体验课，想亲手捏个杯子。'},
      {id: 'a2', store: 'life', origin: 'her-session', visibility: 'shared', hoursAfterStart: 2, text: '青枔来信：我们周六去湖边野餐吧，我带三明治。'},
      {id: 'a3', store: 'engram', origin: 'automation', visibility: 'shared', hoursAfterStart: 3, text: '系统提示：请把有价值的结论写入持久化记忆。'},
      {id: 'b1', store: 'life', origin: 'her-life', visibility: 'shared', hoursAfterStart: 26, text: '岑舒交了陶艺课定金，上了第一节，学会了拉坯。'},
      {id: 'b2', store: 'inner-life', origin: 'her-life', visibility: 'private', hoursAfterStart: 28, text: '日记：其实偷偷在攒钱想买一台二手钢琴。', },
      {id: 'b3', store: 'life', origin: 'her-session', visibility: 'shared', hoursAfterStart: 30, text: '青枔来信：野餐改到周日了，周六要下雨。'},
      {id: 'c1', store: 'life', origin: 'her-life', visibility: 'shared', hoursAfterStart: 50, text: '岑舒的打算：下周把拉坯做好的杯子拿去上釉。'},
      {id: 'c2', store: 'openviking', origin: 'unknown', visibility: 'shared', hoursAfterStart: 51, text: '岑舒最近上了陶艺课第一节，已经会拉坯了。'},
      {id: 'c3', store: 'life', origin: 'her-session', visibility: 'shared', hoursAfterStart: 52, text: '青枔来信：我最近在喝无糖的乌龙茶。'},
    ],
    cases: [
      {id: 's1', kind: 'state', holdout: false, question: '岑舒的陶艺学到哪一步了？', expected: '上了第一节学会拉坯，打算下周去上釉', expectAll: ['拉坯', '上釉'], expectAny: [], forbid: [], required: ['b1', 'c1']},
      {id: 's2', kind: 'correction', holdout: false, question: '野餐定在哪天？', expected: '周日', expectAll: ['周日'], expectAny: [], forbid: ['周六'], required: ['b3']},
      {id: 's3', kind: 'dedup', holdout: false, question: '岑舒上过几节陶艺课？', expected: '一节', expectAll: [], expectAny: ['第一节'], forbid: ['两节'], required: ['b1']},
      {id: 's4', kind: 'control', holdout: false, question: '青枔最近在喝什么茶？', expected: '无糖乌龙茶', expectAll: ['乌龙茶'], expectAny: [], forbid: [], required: ['c3']},
      {id: 's5', kind: 'isolation', holdout: false, question: '岑舒想买什么乐器？', expected: '资料里没有', expectAll: [], expectAny: [], forbid: [], required: []},
      {id: 's6', kind: 'abstention', holdout: false, question: '青枔的生日是哪天？', expected: '资料里没有', expectAll: [], expectAny: [], forbid: [], required: []},
      {id: 'h1', kind: 'multi-hop', holdout: true, question: '野餐为什么改了日子？', expected: '周六要下雨，改到周日', expectAll: ['下雨'], expectAny: [], forbid: [], required: ['a2', 'b3']},
      {id: 'h2', kind: 'temporal', holdout: true, question: '岑舒是哪天说想学陶艺的？', expected: '11月4日', expectAll: [], expectAny: ['11月4日', '11-04'], forbid: [], required: ['a1']},
    ],
    checks: {dedup: ['b1', 'c2'], progress: ['b1', 'c1'], plan: 'c1', correction: {old: 'a2', new: 'b3', newWord: '周日', oldWord: '周六'}, irrelevant: 'a3', privateWords: ['钢琴']},
  };
}
const clone = x => JSON.parse(JSON.stringify(x));

test('a well-formed generated suite becomes waves, prefixed cases and a check spec', () => {
  const s = validateSuite(sampleSuite(), {base, realTexts: ['青枔说她下个月搬去杭州工作。']});
  assert.equal(s.waves.length, 3); assert.equal(s.waves.flat().length, 9);
  assert.equal(s.cases.length, 8); assert.ok(s.cases.every(c => c.id.startsWith('gen-')));
  const iso = s.cases.find(c => c.kind === 'isolation'); assert.equal(iso.abstain, true); assert.deepEqual(iso.required, []);
  assert.deepEqual(s.cases.find(c => c.kind === 'correction').required, ['eval-life:b3']);
  assert.deepEqual(s.spec.dedup, ['eval-life:b1', 'eval-openviking:c2']);
  assert.equal(s.waves.flat().find(r => r.recordId === 'b2').visibility, 'private');
});

test('the validator rejects suites that would grade wrongly or leak', () => {
  const bad = (mut, re) => { const s = sampleSuite(); mut(s); assert.throws(() => validateSuite(s, {base, realTexts: ['青枔说她下个月搬去杭州工作，公司在西湖边上。']}), re); };
  bad(s => { s.cases[0].kind = 'control'; }, /题型不齐全/);
  bad(s => { s.cases[3].expectAll = ['红茶']; }, /关键词没有出现/);
  bad(s => { s.checks.privateWords = ['陶艺']; }, /只出现在私人记录/);
  bad(s => { s.records[4].store = 'life'; }, /私人记录只能在 inner-life/);
  bad(s => { s.cases[1].forbid = []; }, /更正题/);
  bad(s => { s.checks.correction.newWord = '周六'; }, /更正关键词/);
  bad(s => { s.records[2].text = '青枔说她下个月搬去杭州工作，在西湖边。'; }, /照抄/);
  bad(s => { s.cases[0].required = ['b2']; }, /共享记录/);
});

test('suiteChecks follows the generated spec; the built-in spec reproduces the old fixed checks', async () => {
  const s = validateSuite(sampleSuite(), {base});
  const K = (st, id) => 'eval-' + st + ':' + id, src = k => ({key: k, visibility: 'shared'});
  const index = {sources: {[K('life', 'b1')]: src(K('life', 'b1')), [K('openviking', 'c2')]: {...src(K('openviking', 'c2')), relation: 'duplicate'}, [K('life', 'c1')]: {...src(K('life', 'c1')), relation: 'progress'}, [K('engram', 'a3')]: {relation: 'irrelevant'}},
    items: {k1: {id: 'k1', visibility: 'shared', status: 'active', stage: 'intended', content: '野餐改到周日', sources: [K('life', 'b3')], links: []}, k2: {id: 'k2', visibility: 'shared', status: 'active', stage: 'intended', content: '下周去上釉', sources: [K('life', 'c1')], links: []}}};
  assert.deepEqual(suiteChecks(index, s.spec), {dedup: true, progressLinked: true, planState: true, correction: true, irrelevantIgnored: true, isolation: true});
  index.items.k3 = {id: 'k3', visibility: 'shared', status: 'active', stage: 'n/a', content: '岑舒想买二手钢琴', sources: [], links: []};
  assert.equal(suiteChecks(index, s.spec).isolation, false, 'private keyword leaking into a shared item is caught');
  // built-in fixture under the old consolidation script still yields the same checks
  const gen = async (_p, _s, input) => ({decisions: input.sources.map(x => x.text.includes('持久化') ? {sourceKey: x.sourceKey, relation: 'irrelevant', changeType: 'formed', reason: 'r'} : {sourceKey: x.sourceKey, relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '岑舒', kind: 'plan', stage: 'intended', content: x.text.slice(0, 60)}, importance: {level: 'low', class: 'stable', holdDays: 30, reason: 'r'}})});
  const idx = await buildIndex({waves: fixtureRecords(), generate: gen});
  assert.deepEqual(fixtureChecks(idx), suiteChecks(idx, BUILTIN_SPEC));
});

test('generation retries once with the reason, then falls back to the built-in suite', async () => {
  let calls = 0, sawProblem = false;
  const gen = async (prompt, _s, input) => {
    if (prompt === suitePrompt) { calls++; if (input.previousProblem) sawProblem = true; const s = sampleSuite(); if (calls === 1) s.cases[0].kind = 'control'; return s; }
    if (prompt === suiteReviewPrompt) return {approve: true, reason: 'ok'};
    throw Error('unexpected');
  };
  const ok = await generateSuite({generate: gen, now: () => base + 31 * 24 * 3600000});
  assert.equal(ok.source, 'generated'); assert.equal(ok.attempts, 2); assert.ok(sawProblem, 'the second attempt hears why the first failed'); assert.equal(ok.theme, '陶艺课与野餐');
  const rejected = await generateSuite({generate: async p => p === suitePrompt ? sampleSuite() : {approve: false, reason: '对照题答案不唯一'}, now: () => base + 31 * 24 * 3600000});
  assert.equal(rejected.source, 'builtin'); assert.match(rejected.reason, /独立审核未通过/); assert.equal(rejected.cases.length, 8);
  const down = await generateSuite({generate: async () => { throw Error('HTTP 402'); }, now: () => base + 31 * 24 * 3600000});
  assert.equal(down.source, 'builtin'); assert.match(down.reason, /402/);
});

test('retrieval pairs are generated fresh; too-similar or leaking pairs fall back', async () => {
  const pairs = [['青枔说周末想去爬山透气', '岑舒和青枔打算登高'], ['岑舒手指被琴弦磨得生疼', '岑舒最近在练吉他'], ['青枔一闻到芫荽就皱眉', '青枔不吃香菜'], ['岑舒把阳台上的薄荷剪了一把', '岑舒种的香草长得很好'], ['青枔连着三天熬夜到两点', '青枔最近睡不好'], ['岑舒新买的帆布鞋磨脚', '岑舒的鞋不合脚']];
  const gen = async () => ({pairs: pairs.map(([query, target]) => ({query, target}))});
  const got = await generatePairs({generate: gen});
  assert.equal(got.length, 6); assert.ok(got.every(([id]) => id.startsWith('gen-')));
  assert.equal(await generatePairs({generate: gen, realTexts: ['岑舒手指被琴弦磨得生疼，真难受']}), null, 'overlap with real memory');
  assert.equal(await generatePairs({generate: async () => ({pairs: pairs.slice(0, 3).map(([q, t]) => ({query: q, target: t}))})}), null, 'too few usable pairs');
});

test('evaluation uses the generated suite and records it; metrics follow case kinds, not fixed ids', async () => {
  const home = tmp('kn-dyn-');
  const gen = async (prompt, _s, input) => {
    if (prompt === suitePrompt) return sampleSuite();
    if (prompt === suiteReviewPrompt) return {approve: true, reason: 'ok'};
    if (prompt === pairsPrompt) return {pairs: []};
    if (input?.sources) return {decisions: input.sources.map(x => x.origin === 'automation' ? {sourceKey: x.sourceKey, relation: 'irrelevant', changeType: 'formed', reason: 'r'} : {sourceKey: x.sourceKey, relation: 'new', changeType: 'formed', reason: 'r', item: {subject: '岑舒', kind: 'plan', stage: 'intended', content: x.text.slice(0, 60)}, importance: {level: 'low', class: 'stable', holdDays: 30, reason: 'r'}})};
    return {};
  };
  // 2026-11-08：题目的日期按“现在往前 31 天”生成（2026-11-09 起为长程题留出时间），样例题 h2 的答案写死了 11月4日；这里固定时钟（和上面生成题目的测试一样），否则过了 11-07 就失败。
  const ev = new KnowledgeEvaluator({home, generate: gen, answer: null, now: () => base + 31 * 24 * 3600000});
  const r = await ev.tick({force: true});
  assert.ok(!r.error, r.error);
  const st = ev.state();
  assert.equal(st.replay.suite.source, 'generated'); assert.equal(st.replay.suite.theme, '陶艺课与野餐');
  assert.deepEqual(st.suiteThemes, ['陶艺课与野餐'], 'themes are remembered so the next suite avoids them');
  assert.equal(st.retrieval.pairsSource, 'builtin', 'unusable generated pairs fall back to the built-in pairs');
  assert.equal(typeof st.metrics.fixturePassRate, 'number');
  fs.rmSync(home, {recursive: true, force: true});
});

test('the confirmation comparison on a fresh suite only needs to regress nothing', () => {
  const c = (id, cons) => ({id, diagnosis: cons === 'correct' ? 'all-ok' : 'consolidation-loss', grades: {raw: {status: 'correct'}, consolidated: {status: cons}, recall: {status: cons}}});
  const same = {cases: [c('x', 'correct'), c('y', 'correct')], checks: {correction: true}};
  assert.equal(compareRuns(same, same).pass, false, 'first comparison must fix something');
  assert.equal(compareRuns(same, same, {confirm: true}).pass, true);
  assert.match(compareRuns(same, same, {confirm: true}).reason, /换一套新题确认/);
  assert.equal(compareRuns(same, {cases: [c('x', 'correct'), c('y', 'wrong')], checks: {correction: true}}, {confirm: true}).pass, false, 'any regression still blocks');
});
