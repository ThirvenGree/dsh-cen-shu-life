import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LAYERS, CONTROL_LAYER, comparePairs, pairStats, signTest, judgeAgreement, modelVerdict, verdictReport, callEstimate, layerEffects, runsDir} from '../lib/probes/harness.js';
import {prioritiesReport, hasRunData, applyReview, validateRanking, STANDING, priorityPrompt} from '../lib/reports/priorities.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seven-'));
const put = (home, file, value) => { const p = path.join(home, file); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); };
const row = (probe, layer, reply, score = 4) => ({probe, layer, attempt: 0, category: 'daily', question: '问' + probe, reply, judgments: {gemini: {knowledge: score, style: score, inCharacter: score}, terra: {knowledge: score, style: score, inCharacter: score}}});

test('the control layer is the full context and costs nothing to describe as a layer', () => {
  const parts = [{text: 'a', key: 'x'}];
  assert.deepEqual(LAYERS[CONTROL_LAYER](parts), parts); assert.equal(layerEffects(parts)[CONTROL_LAYER], 0);
  assert.deepEqual(callEstimate({probes: 10, layers: 3, judges: 2, comparisons: true}), {replies: 30, judgments: 60, comparisons: 40, verdicts: 2});
});
test('judges see only a and b in random order, and the answer is mapped back', async () => {
  const rows = [row('p', 'full', '完整'), row('p', 'no-thoughts', '去掉')], seen = [];
  const pick = letter => async (_s, _sc, input) => { seen.push(input); return {choice: letter, reason: 'r'}; };
  const first = await comparePairs({rows, profile: {}, models: {g: pick('a')}, random: () => 0.1});
  assert.equal(first[0].choices.g, 'full'); assert.equal(seen[0].a, '完整'); assert.ok(!JSON.stringify(seen[0]).includes('no-thoughts'), 'the layer name never reaches the judge');
  const second = await comparePairs({rows, profile: {}, models: {g: pick('a')}, random: () => 0.9});
  assert.equal(second[0].choices.g, 'layer'); assert.equal(seen[1].a, '去掉');
  const failed = await comparePairs({rows, profile: {}, models: {g: async () => { throw Error('x'); }}});
  assert.equal(failed[0].choices.g, 'error');
});
test('rows without a reply or a full counterpart are not compared', async () => {
  const pairs = await comparePairs({rows: [row('p', 'no-thoughts', 'x'), {...row('q', 'full', 'y')}, {...row('q', 'no-thoughts', ''), reply: ''}], profile: {}, models: {g: async () => ({choice: 'a', reason: ''})}});
  assert.equal(pairs.length, 0);
});
const pair = (layer, a, b, n = 0) => ({probe: 'p' + n, category: 'daily', layer, attempt: 0, choices: {g: a, t: b}});
test('a difference counts only beyond what the control group shows', () => {
  const pairs = [...Array(8).keys()].map(n => pair('no-thoughts', 'full', 'full', n)).concat([...Array(8).keys()].map(n => pair('no-mood', n < 5 ? 'full' : 'layer', n < 5 ? 'full' : 'layer', n)), [...Array(8).keys()].map(n => pair(CONTROL_LAYER, n < 5 ? 'full' : 'layer', n < 5 ? 'full' : 'layer', n)));
  const s = pairStats(pairs);
  assert.equal(s.noise, 0.25); assert.equal(s.layers['no-thoughts'].preference, 1); assert.equal(s.layers['no-thoughts'].beyondNoise, true); assert.equal(s.layers['no-mood'].beyondNoise, false);
  assert.equal(s.layers['no-thoughts'].p, 0.0078);
  assert.equal(signTest(0, 0), 1); assert.equal(signTest(4, 8), 1);
  const split = pairStats([pair('x', 'full', 'layer')]); assert.equal(split.layers.x.even, 1, 'judges cancelling out is not a win'); assert.equal(split.noise, null); assert.equal(split.layers.x.beyondNoise, null);
});
test('agreement needs two judges and ignores failed calls', () => {
  const rows = [row('a', 'full', 'x', 5), row('b', 'full', 'y', 2), {...row('c', 'full', 'z'), judgments: {gemini: {knowledge: 3, style: 3, inCharacter: 3}, terra: {error: 'x'}}}];
  const a = judgeAgreement(rows, [{choices: {gemini: 'full', terra: 'full'}}, {choices: {gemini: 'full', terra: 'layer'}}, {choices: {gemini: 'error', terra: 'layer'}}]);
  assert.equal(a.kappa.style, 1); assert.equal(a.sameChoice, 0.5); assert.equal(a.pairs, 2);
  assert.equal(judgeAgreement([{judgments: {gemini: {style: 3}}}]), null);
});

const runRows = [row('p', 'full', '完整'), row('p', 'no-thoughts', '去掉'), row('p', 'no-mood', '去掉2'), row('p', CONTROL_LAYER, '再来')];
const runPairs = [pair('no-thoughts', 'full', 'full'), pair('no-mood', 'layer', 'layer'), pair(CONTROL_LAYER, 'tie', 'tie')].map(p => ({...p, probe: 'p'}));
const says = map => async () => ({summary: 's', items: Object.entries(map).map(([layer, decision]) => ({layer, decision, reason: 'r'}))});
test('only agreement between the two models is a conclusion', async () => {
  let input; const models = {gemini: async (_p, _s, i) => { input = i; return says({'no-thoughts': 'keep', 'no-mood': 'simplify'})(); }, terra: says({'no-thoughts': 'keep', 'no-mood': 'keep'})};
  const v = await modelVerdict({rows: runRows, pairs: runPairs, summary: {layers: {}}, models});
  const of = l => v.items.find(i => i.layer === l);
  assert.equal(of('no-thoughts').decision, 'keep'); assert.equal(of('no-thoughts').agreed, true);
  assert.equal(of('no-mood').decision, 'unclear', 'disagreement is unclear'); assert.equal(of('no-mood').agreed, false);
  assert.equal(of(CONTROL_LAYER), undefined, 'the control is not a layer to keep or drop');
  assert.deepEqual(input.layers.map(l => l.layer).sort(), ['no-mood', 'no-thoughts']); assert.ok(input.control.pairs); assert.ok(input.samples['no-mood'][0].full);
});
test('one model alone, a failed model or a missing layer never produces a conclusion', async () => {
  const one = await modelVerdict({rows: runRows, pairs: runPairs, summary: {}, models: {gemini: says({'no-thoughts': 'keep', 'no-mood': 'keep'})}});
  assert.ok(one.items.every(i => i.decision === 'unclear')); assert.match(one.note, /少于两家/);
  const broken = await modelVerdict({rows: runRows, pairs: runPairs, summary: {}, models: {gemini: says({'no-thoughts': 'keep'}), terra: async () => { throw Error('down'); }}});
  assert.ok(broken.items.every(i => i.decision === 'unclear')); assert.ok(broken.errors.terra);
  const partial = await modelVerdict({rows: runRows, pairs: runPairs, summary: {}, models: {gemini: says({'no-thoughts': 'keep'}), terra: says({'no-thoughts': 'keep', 'no-mood': 'keep'})}});
  assert.equal(partial.items.find(i => i.layer === 'no-mood').decision, 'unclear');
});
test('a verdict needs a saved run with comparisons', async () => {
  const home = tmp(), generate = says({});
  await assert.rejects(verdictReport({home, generate}), /还没有探针运行记录/);
  put(home, path.relative(home, path.join(runsDir(home), 'run-1.json')), {rows: runRows, summary: {}});
  await assert.rejects(verdictReport({home, generate}), /没有盲选对比/);
  put(home, path.relative(home, path.join(runsDir(home), 'run-2.json')), {rows: runRows, pairs: runPairs, summary: {}});
  const v = await verdictReport({home, generate: says({'no-thoughts': 'simplify', 'no-mood': 'keep'}), review: says({'no-thoughts': 'simplify', 'no-mood': 'keep'})});
  assert.equal(v.run, 'run-2.json'); assert.equal(v.items.find(i => i.layer === 'no-thoughts').decision, 'simplify');
});

const withData = () => { const home = tmp(); put(home, 'censhu-agency/state.json', {awaitingReplies: [{observed: {kind: 'brief', latencyMs: 60000}}]}); return home; };
const files = () => { const dir = tmp(), r = path.join(dir, 'r.md'), m = path.join(dir, 'm.md'); fs.writeFileSync(r, '报告正文'); fs.writeFileSync(m, '改动记录'); return {reportFiles: [r], readmes: [m]}; };
test('no ranking without real data, and no model call either', async () => {
  const out = await prioritiesReport({home: tmp(), generate: async () => { throw Error('不应调用'); }, ...files()});
  assert.match(out.skipped, /还没有真实运行数据/);
  assert.equal(hasRunData({data: {contacts: {sent: 0}, writeback: {facts: {total: 0}, knowledge: null}}, verdict: null}), false);
  assert.equal(hasRunData({data: {contacts: {sent: 0}, writeback: {facts: {total: 0}, knowledge: {items: 3}}}, verdict: null}), true);
});
const ranked = {summary: 's', items: [{title: '修 A', why: 'w', evidence: 'e', effort: 'small'}, {title: '解除后台暂停', why: 'w', evidence: 'e', effort: 'small'}]};
test('the ranking sees what was decided and the review can strike items', async () => {
  let asked, reviewed; const out = await prioritiesReport({home: withData(), ...files(), generate: async (_p, _s, input) => { asked = input; return ranked; }, review: async (_p, _s, input) => { reviewed = input; return {items: [{index: 0, ok: true, note: ''}, {index: 1, ok: false, note: '违反已定的事'}]}; }});
  assert.deepEqual(asked.standing, STANDING); assert.ok(asked.reports[0].includes('报告正文')); assert.ok(asked.changes[0].includes('改动记录')); assert.equal(asked.data.contacts.sent, 1);
  assert.equal(reviewed.ranking.length, 2); assert.equal(reviewed.reports, undefined);
  assert.equal(out.reviewed, true); assert.deepEqual(out.items.map(i => i.title), ['修 A']); assert.equal(out.rejected[0].note, '违反已定的事');
  assert.match(priorityPrompt, /精简优先/); assert.ok(STANDING.some(s => s.includes('后台暂停')));
});
test('without a working reviewer the ranking says so', async () => {
  const none = await prioritiesReport({home: withData(), ...files(), generate: async () => ranked, review: null}); assert.equal(none.reviewed, false); assert.match(none.note, /没有配置/);
  const failed = await prioritiesReport({home: withData(), ...files(), generate: async () => ranked, review: async () => { throw Error('down'); }}); assert.equal(failed.reviewed, false); assert.match(failed.note, /复核失败/); assert.equal(failed.items.length, 2);
  assert.throws(() => validateRanking({}));
  assert.equal(applyReview({summary: 's', items: [{title: 'a'}]}, {}).items.length, 1);
});
