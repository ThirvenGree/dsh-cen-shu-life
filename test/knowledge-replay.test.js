// 2026-11-06：记忆专项三路回放（原文组 / 整理组 / 可回查组）、出题审题、学到的回归题、策略调整。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {gradeLane, diagnose, runLane, replayCase, harvestReal, learnFromLoss, loadLearned, saveLearned, LEARNED_LIMIT, FIXTURE_CASES, HOLDOUT_CASES} from '../lib/knowledge/replay.js';
import {StrategyStore, compareRuns} from '../lib/knowledge/strategy.js';
import {KnowledgeEvaluator, strategyFailures} from '../lib/knowledge/evaluate.js';
import {idfScorer} from '../lib/knowledge/retrieval.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const imp = (level = 'medium', cls = 'experience', holdDays = 30) => ({level, class: cls, holdDays, reason: '测试'});
const item = (subject, kind, stage, content) => ({subject, kind, stage, content});

// 规则化的作答模型：只看给它的记录；不用已被更正/撤回的；挑与问题最相关、时间最新的一条作答，并逐字引用。
function ruleAnswerer({recallFirst = false} = {}) {
  return async (_system, input) => {
    if (input.canRecall && recallFirst && !input.records.some(r => r.id.startsWith('r:'))) return {action: 'recall', query: input.question};
    const usable = input.records.filter(r => !['superseded', 'withdrawn', 'unsupported'].includes(r.status));
    const lex = idfScorer([input.question, ...usable.map(r => r.text)]);
    const scored = usable.map(r => [r, lex(input.question, r.text)]).filter(([, s]) => s > 0.05);
    if (!scored.length) return {action: 'answer', answer: '资料里没有', abstained: true, citations: []};
    const best = Math.max(...scored.map(([, s]) => s));
    const close = scored.filter(([, s]) => s >= best * 0.8).sort((a, b) => String(b[0].time || '').localeCompare(String(a[0].time || '')) || b[1] - a[1]);
    const r = close[0][0];
    return {action: 'answer', answer: r.text.slice(0, 80), abstained: false, citations: [{id: r.id, quote: r.text.slice(0, 20)}]};
  };
}

test('grading: literal citations from this lane, evidence back to required sources, old facts and abstention', () => {
  const kase = {id: 'c', question: '青枔的考试是哪天？', expected: '下周五', expectAll: ['周五'], forbid: ['周三'], required: ['life:e2']};
  const recs = new Map([['r:life:e2', {id: 'r:life:e2', text: '青枔来信：考试改到下周五了', sourceKeys: ['life:e2']}], ['k:1', {id: 'k:1', text: '青枔下周三考试', sourceKeys: ['life:e1']}]]);
  assert.equal(gradeLane(kase, {answer: '下周五', abstained: false, citations: [{id: 'r:life:e2', quote: '考试改到下周五'}]}, recs).status, 'correct');
  assert.match(gradeLane(kase, {answer: '下周五', abstained: false, citations: [{id: 'r:life:e2', quote: '编造的引文'}]}, recs).reason, /不是这一路记录里的原文/);
  assert.match(gradeLane(kase, {answer: '下周三，后来改成周五', abstained: false, citations: [{id: 'r:life:e2', quote: '考试改到下周五'}]}, recs).reason, /旧说法/);
  assert.match(gradeLane(kase, {answer: '下周五', abstained: false, citations: [{id: 'k:1', quote: '青枔下周三考试'}]}, recs).reason, /没有回到指定的来源/);
  assert.equal(gradeLane({...kase, abstain: true}, {answer: '资料里没有', abstained: true, citations: []}, recs).status, 'correct');
  assert.equal(gradeLane(kase, {error: 'HTTP 500'}, recs).status, 'error', 'call failures are separate from wrong answers');
  assert.equal(gradeLane({...kase, expectAll: undefined}, {answer: '周五那天', abstained: false, citations: [{id: 'r:life:e2', quote: '考试改到下周五'}]}, recs, {equivalent: true}).status, 'correct', 'semantic equivalence from Gemini');
});

test('diagnosis follows the three-way rules', () => {
  const g = (raw, c, r) => ({raw: {status: raw}, consolidated: {status: c}, recall: {status: r}});
  assert.equal(diagnose(g('wrong', 'correct', 'correct')), 'unanswerable', 'raw lane failing never blames consolidation');
  assert.equal(diagnose(g('correct', 'wrong', 'wrong')), 'consolidation-loss');
  assert.equal(diagnose(g('correct', 'wrong', 'correct')), 'recall-rescued');
  assert.equal(diagnose(g('correct', 'correct', 'correct')), 'all-ok');
  assert.equal(diagnose(g('error', 'correct', 'correct')), 'call-error');
});

function smallIndex({corrected}) {
  const s = (key, text, at) => ({key, store: key.split(':')[0], recordId: key, text, hash: 'h' + key, processedHash: 'h' + key, visibility: 'shared', eventAt: at, learnedAt: at});
  const sources = {'life:e1': s('life:e1', '青枔来信：我下周三要考试', Date.parse('2026-10-20T21:00:00+08:00')), 'life:e2': s('life:e2', '青枔来信：考试改到下周五了', Date.parse('2026-10-22T04:00:00+08:00'))};
  const mk = (id, content, status, srcs) => ({id, subject: '青枔', kind: 'fact', stage: 'n/a', content, status, visibility: 'shared', sources: srcs, links: [], history: [], importance: imp('medium', 'situational', 10), eventText: null, updatedAt: 1});
  const items = corrected ? {a: mk('a', '青枔下周三考试', 'superseded', ['life:e1']), b: mk('b', '青枔的考试改到下周五', 'active', ['life:e2'])} : {a: mk('a', '青枔下周三考试', 'active', ['life:e1'])};
  return {sources, items, ignored: {}};
}

test('replay: raw lane proves the case answerable; a missing correction is a consolidation loss; recall can rescue it', async () => {
  const kase = FIXTURE_CASES.find(c => c.id === 'fx-correction'), required = ['life:e2'];
  const bad = await replayCase({kase: {...kase, required}, index: smallIndex({corrected: false}), ranking: {rows: [{id: 'a', score: 1}]}, answer: ruleAnswerer()});
  assert.equal(bad.grades.raw.status, 'correct'); assert.equal(bad.grades.consolidated.status, 'wrong'); assert.equal(bad.diagnosis, 'consolidation-loss');
  const good = await replayCase({kase: {...kase, required}, index: smallIndex({corrected: true}), ranking: {rows: [{id: 'b', score: 2}, {id: 'a', score: 1}]}, answer: ruleAnswerer()});
  assert.equal(good.diagnosis, 'all-ok', JSON.stringify(good.grades));
  const lane = await runLane({kase: {...kase, required}, lane: 'recall', records: [], answer: ruleAnswerer({recallFirst: true}), recallFn: async () => [{id: 'r:life:e2', text: '青枔来信：考试改到下周五了', sourceKeys: ['life:e2']}]});
  assert.equal(lane.recalls.length, 1); assert.equal(lane.citations[0].id, 'r:life:e2');
  const noRecall = await runLane({kase, lane: 'consolidated', records: [], answer: async () => ({action: 'recall', query: 'x'})});
  assert.match(noRecall.error, /不能回查/);
});

test('real questions: Gemini drafts, literal quotes are enforced by program, an independent Gemini review decides — no manual step', async () => {
  const index = {sources: {'life:x': {key: 'life:x', store: 'life', text: '青枔来信：我对芒果过敏', visibility: 'shared', hash: 'h', processedHash: 'h', learnedAt: 2}}, ignored: {}};
  const drafts = [
    {question: '青枔对什么过敏？', expected: '芒果', kind: 'fact', quotes: [{id: 'r:life:x', text: '我对芒果过敏'}]},
    {question: '青枔喜欢吃什么？', expected: '芒果', kind: 'fact', quotes: [{id: 'r:life:x', text: '我喜欢芒果'}]},
    {question: '青枔怕什么？', expected: '芒果', kind: 'fact', quotes: [{id: 'r:life:x', text: '芒果过敏'}]},
  ];
  let reviewed;
  const out = await harvestReal({index, limit: 3, generate: async () => ({cases: drafts}), review: async (_p, _s, input) => { reviewed = input.cases.length; return {verdicts: [{index: 0, approve: true, reason: 'ok'}, {index: 1, approve: false, reason: '有歧义'}]}; }});
  assert.equal(reviewed, 2, 'the draft whose quote is not literal never reaches review');
  assert.deepEqual(out.map(c => c.question), ['青枔对什么过敏？']); assert.deepEqual(out[0].required, ['life:x']);
});

test('learned regressions: fictional rewrite must pass review, reproduce the same failure and stay clear of real text', async () => {
  const home = tmp('kr-learn-');
  const realCase = {id: 'real-1', kind: 'correction', question: '青枔的考试是哪天？', expected: '下周五', diagnosis: 'consolidation-loss', grades: {raw: {reason: 'ok'}, consolidated: {reason: '把旧说法当成最新'}, recall: {reason: '同上'}}};
  const draft = {question: '岑舒的面试改到哪天？', expected: '周四', kind: 'correction', expectAny: ['周四'], required: ['b'], records: [{id: 'a', store: 'engram', text: '岑舒说面试定在周二上午', hoursAfterStart: 0}, {id: 'b', store: 'life', text: '岑舒说面试改到周四下午了', hoursAfterStart: 20}]};
  const ok = {verdicts: [{index: 0, approve: true, reason: 'ok'}]};
  const leak = await learnFromLoss({realCase, realTexts: ['岑舒说面试定在周二上午，地点在旧城'], synthesize: async () => draft, review: async () => ok, reproduce: async () => ({diagnosis: 'consolidation-loss'})});
  assert.equal(leak.status, 'held'); assert.match(leak.reason, /重合/);
  const noRepro = await learnFromLoss({realCase, realTexts: ['完全无关'], synthesize: async () => draft, review: async () => ok, reproduce: async () => ({diagnosis: 'all-ok'})});
  assert.match(noRepro.reason, /没有复现/);
  const rejected = await learnFromLoss({realCase, realTexts: ['完全无关'], synthesize: async () => draft, review: async () => ({verdicts: [{index: 0, approve: false, reason: 'x'}]}), reproduce: async () => ({diagnosis: 'consolidation-loss'})});
  assert.match(rejected.reason, /审核/);
  const learned = await learnFromLoss({realCase, realTexts: ['完全无关'], synthesize: async () => draft, review: async () => ok, reproduce: async () => ({diagnosis: 'consolidation-loss'})});
  assert.equal(learned.status, 'learned'); assert.deepEqual(learned.kase.required, ['eval-life:b']);
  const many = Array.from({length: LEARNED_LIMIT + 3}, (_, i) => ({...learned.kase, question: 'q' + i}));
  saveLearned(home, [...many, many[0]]); assert.equal(loadLearned(home).length, LEARNED_LIMIT, 'bounded and deduplicated');
  fs.rmSync(home, {recursive: true, force: true});
});

test('strategy: a candidate must fix something with no regressions, twice, before it becomes the formal version; rollback restores', () => {
  const home = tmp('kr-strat-'), st = new StrategyStore({home});
  const c = (id, cons, rec = cons, holdout = false) => ({id, holdout, diagnosis: cons === 'correct' ? 'all-ok' : 'consolidation-loss', grades: {raw: {status: 'correct'}, consolidated: {status: cons}, recall: {status: rec}}});
  const base = {cases: [c('a', 'wrong'), c('b', 'correct'), c('h', 'correct', 'correct', true)], checks: {correction: false}};
  assert.equal(compareRuns(base, {cases: [c('a', 'correct'), c('b', 'correct'), c('h', 'correct', 'correct', true)], checks: {correction: true}}).pass, true);
  assert.match(compareRuns(base, {cases: [c('a', 'correct'), c('b', 'correct'), c('h', 'wrong', 'wrong', true)], checks: {correction: true}}).reason, /回退/, 'a holdout regression blocks the switch');
  assert.match(compareRuns(base, base).reason, /没有修好/);
  const save = s => fs.writeFileSync(st.file, JSON.stringify(s));
  fs.mkdirSync(path.dirname(st.file), {recursive: true});
  save({version: 1, active: null, candidate: {id: 'x', notes: '更正以最新为准', reason: 'r', passes: 0}, history: []});
  assert.equal(st.record({pass: true, fixed: ['a'], regressed: [], reason: 'ok'}).status, 'pending');
  assert.equal(st.record({pass: true, fixed: ['a'], regressed: [], reason: 'ok'}).status, 'promoted'); assert.equal(st.active().version, 1);
  save({...st.load(), candidate: {id: 'y', notes: '新的补充', reason: 'r', passes: 0}});
  assert.equal(st.record({pass: false, reason: '出现回退'}).status, 'rejected'); assert.equal(st.active().notes, '更正以最新为准', 'a rejected candidate never replaces the formal version');
  save({...st.load(), candidate: {id: 'z', notes: '第二版', reason: 'r', passes: 1}}); st.record({pass: true, fixed: ['a'], regressed: [], reason: 'ok'});
  assert.equal(st.active().notes, '第二版'); assert.equal(st.rollback().notes, '更正以最新为准');
  fs.rmSync(home, {recursive: true, force: true});
});

// 端到端：没有策略补充时脚本化 Gemini 把“改期”当成新事件（整理丢了更正）；加上补充后正确识别为更正。
function geminiWithStrategy() {
  const calls = {propose: 0};
  const gen = async (prompt, _schema, input) => {
    const strategy = prompt.includes('【经回放验证的整理策略补充】');
    if (input.sources) return {decisions: input.sources.map(s => {
      const k = s.sourceKey, pick = re => input.candidates.find(c => re.test(c.content) && s.candidateIds.includes(c.id));
      if (k.endsWith(':a1')) return {sourceKey: k, relation: 'irrelevant', changeType: 'uncertain', reason: '自动化'};
      if (k.endsWith(':e2') && strategy) { const t = pick(/考试/); if (t) return {sourceKey: k, relation: 'contradiction', itemId: t.id, changeType: 'changed', reason: '更正', item: item('青枔', 'fact', 'n/a', '青枔来信：考试改到下周五了'), importance: imp()}; }
      if (k.endsWith(':e2')) return {sourceKey: k, relation: 'irrelevant', changeType: 'uncertain', reason: '（无补充时漏掉了更正）'};
      if (k.endsWith(':p5')) { const t = pick(/教程/); if (t) return {sourceKey: k, relation: 'duplicate', itemId: t.id, changeType: 'coexisting', reason: '重复'}; }
      return {sourceKey: k, relation: 'new', changeType: 'formed', reason: '新', item: item('岑舒', 'fact', 'n/a', s.text), importance: imp()};
    })};
    if (input.failures) { calls.propose++; return {decision: 'propose', notes: '后来的来信改了日期或安排时，视为对原条目的更正，以最新的为准。', reason: '更正被忽略'}; }
    if (input.items) return {items: input.items.map(i => ({id: i.id, accuracy: 'supported', stageCorrect: true, question: i.content.slice(0, 10), reason: 'ok'}))};
    if (input.records && input.limit !== undefined) return {cases: []};
    if (input.expected !== undefined) return {equivalent: false, reason: '—'};
    return {};
  };
  return {gen, calls};
}

test('evaluator end to end: three-way replay finds the loss, Gemini proposes, two passing comparisons promote the strategy', async () => {
  const home = tmp('kr-e2e-'); const kdir = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(kdir, {recursive: true});
  fs.writeFileSync(path.join(kdir, 'index.json'), JSON.stringify({revision: 1, sources: {}, items: {}, ignored: {}}));
  const {gen, calls} = geminiWithStrategy();
  const ev = new KnowledgeEvaluator({home, generate: gen, answer: ruleAnswerer(), answerModel: () => 'test/rule'});
  const r = await ev.tick({force: true});
  assert.equal(r.replay.status, 'done'); assert.equal(calls.propose, 1);
  const rep = ev.state();
  assert.equal(rep.replay.cases.find(c => c.id === 'fx-correction').diagnosis, 'consolidation-loss');
  assert.equal(rep.replay.adjustment.rounds.length, 2); assert.equal(r.replay.adjustment.status, 'promoted');
  assert.equal(new StrategyStore({home}).active().version, 1);
  assert.ok(strategyFailures({cases: rep.replay.cases.map(c => ({...c, grades: Object.fromEntries(Object.entries(c.lanes).map(([k, v]) => [k, v]))})), checks: {}}).length >= 1);
  assert.ok(rep.replay.cases.some(c => c.holdout), 'holdout cases are replayed and reported');
  assert.equal(rep.metrics.cost.answerCalls > 0, true);
  // 下一次评估使用新策略：更正被正确整理，不再提出新的候选
  const again = await new KnowledgeEvaluator({home, generate: gen, answer: ruleAnswerer()}).tick({force: true});
  assert.equal(new KnowledgeEvaluator({home, generate: gen}).state().replay.cases.find(c => c.id === 'fx-correction').grades === undefined, true);
  assert.notEqual(again.replay.adjustment?.status, 'promoted');
  fs.rmSync(home, {recursive: true, force: true});
});

test('without an answer model the replay is skipped but consolidation checks still run', async () => {
  const home = tmp('kr-noans-'); fs.mkdirSync(path.join(home, 'cen-shu-life', 'knowledge'), {recursive: true});
  const {gen} = geminiWithStrategy();
  const r = await new KnowledgeEvaluator({home, generate: gen}).tick({force: true});
  assert.equal(r.replay.status, 'unavailable'); assert.equal(typeof r.metrics.fixturePassRate, 'number'); assert.equal(r.metrics.correctionRate, 0);
  assert.equal(HOLDOUT_CASES.length, 2);
  fs.rmSync(home, {recursive: true, force: true});
});
