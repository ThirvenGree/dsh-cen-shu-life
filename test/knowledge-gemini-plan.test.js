// 2026-11-06：逐条交给预算挑选；下一次质量评估由 Gemini 安排。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {validateConfig} from '../lib/engine.js';
import {createKnowledgeService} from '../lib/knowledge/service.js';
import {contextItems} from '../lib/knowledge/salience.js';
import {KnowledgeEvaluator} from '../lib/knowledge/evaluate.js';

const H = 3600000, DAY = 24 * H, T = 1793800000000;
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const mk = (id, over = {}) => ({id, subject: '岑舒', kind: 'interest', stage: 'intended', content: '岑舒的事 ' + id, status: 'active', visibility: 'shared', sources: [], links: [], history: [], importance: {level: 'medium', class: 'experience', holdDays: 30, reason: 'r'}, ...over});

function fixture() {
  const home = tmp('kplan-'), k = path.join(home, 'cen-shu-life', 'knowledge'); fs.mkdirSync(k, {recursive: true});
  const items = {a: mk('a'), b: mk('b'), c: mk('c'), p: mk('p', {visibility: 'private'})};
  fs.writeFileSync(path.join(k, 'index.json'), JSON.stringify({revision: 1, sources: {}, items}));
  fs.writeFileSync(path.join(k, 'ranking.json'), JSON.stringify({rows: ['p', 'a', 'b', 'c'].map((id, n) => ({id, score: 9 - n}))}));
  const config = {...validateConfig({}), enabled: true, semanticEnabled: true, sessionIds: ['session-a']};
  const engine = {home, now: () => T, config, bound: id => id === 'session-a', log() {}};
  return {home, config, svc: createKnowledgeService({engine, generateBase: async () => { throw Error('no model'); }})};
}

test('context parts: one self-contained part per shared item, keyed for the budget', () => {
  const {home, svc, config} = fixture();
  const parts = svc.contextParts('session-a');
  assert.deepEqual(parts.map(p => p.key), ['knowledge:item:a', 'knowledge:item:b', 'knowledge:item:c'], 'private item never offered to the role session');
  assert.ok(parts.every(p => p.text.startsWith('【长期知识') && p.text.includes('censhu_knowledge_recall')), 'each part stands alone');
  config.knowledgeContextLimit = 2; assert.equal(svc.contextParts('session-a').length, 2, 'the setting is the candidate ceiling');
  assert.deepEqual(svc.contextParts('session-x'), []);
  assert.equal(contextItems({items: {}}, {rows: []}).length, 0);
  fs.rmSync(home, {recursive: true, force: true});
});

test('per-item selection: chosen items count as selected, the rest as passed', () => {
  const {home, svc} = fixture();
  svc.contextParts('session-a');
  svc.selected({sessionId: 'session-a', decided: true, keys: ['weather', 'knowledge:item:b']});
  const act = svc.salience.activity().items;
  assert.equal(act.b.selected, 1); assert.equal(act.b.passed || 0, 0);
  assert.equal(act.a.passed, 1); assert.equal(act.c.passed, 1); assert.equal(act.a.selected || 0, 0);
  fs.rmSync(home, {recursive: true, force: true});
});

test('evaluation plan: Gemini schedules within the setting limits; failures fall back to the settings', async () => {
  const home = tmp('kplan-e-'); let t = T;
  let days = 7, cases = 6;
  const ev = new KnowledgeEvaluator({home, generate: async () => ({}), intervalDays: () => days, replayCases: () => cases, now: () => t});
  const plan = v => ev.planNext({gemini: async () => v, metrics: {replayLossRate: 0.2, cost: {}}, replay: {status: 'done', cases: [{diagnosis: 'consolidation-loss', real: true}]}, learnedNow: [], index: {revision: 30, items: {a: 1}, sources: {}}, st: {indexRevision: 10}});
  const p = await plan({nextDays: 2.5, earlyAfterChanges: 40, realCases: 3, reason: '还有整理丢失，早点复查'});
  assert.deepEqual([p.nextDays, p.earlyAfterChanges, p.realCases], [2.5, 40, 3]); assert.match(p.nextAtText, /北京时间/);
  const wild = await plan({nextDays: 400, earlyAfterChanges: 1, realCases: 99, reason: '太大了'});
  assert.deepEqual([wild.nextDays, wild.earlyAfterChanges, wild.realCases], [7, 5, 6], 'clamped to the setting limits');
  assert.equal(await plan({nextDays: 'soon'}), null, 'invalid → null');
  assert.equal(await ev.planNext({gemini: async () => { throw Error('402'); }, metrics: {}, replay: {}, index: null, st: {}}), null, 'failure → null');

  const state = {at: T, indexRevision: 10, plan: {nextDays: 2, earlyAfterChanges: 40}};
  const idx = r => ({revision: r, items: {a: 1}});
  t = T + 1.5 * DAY; assert.equal(ev.due(state, idx(20)), false);
  t = T + 2.1 * DAY; assert.equal(ev.due(state, idx(20)), true, 'Gemini’s shorter interval');
  t = T + 1 * DAY; assert.equal(ev.due(state, idx(50)), true, 'Gemini’s change threshold');
  days = 1; t = T + 1.1 * DAY; assert.equal(ev.due({...state, plan: {nextDays: 5, earlyAfterChanges: 40}}, idx(11)), true, 'the setting stays the ceiling');
  days = 7; t = T + 3 * DAY; assert.equal(ev.due({at: T, indexRevision: 10}, idx(20)), false, 'no plan → setting interval'); assert.equal(ev.due({at: T, indexRevision: 10}, idx(60)), true, 'no plan → 50 changes');
  fs.rmSync(home, {recursive: true, force: true});
});
