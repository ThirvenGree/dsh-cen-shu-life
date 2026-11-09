// 2026-11-06：活跃度强弱交给 Gemini 判断。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {ActivityReviewer, LIMITS} from '../lib/knowledge/activity-review.js';
import {KnowledgeSalience, score, freshness} from '../lib/knowledge/salience.js';
import {createKnowledgeService} from '../lib/knowledge/service.js';
import {validateConfig} from '../lib/engine.js';

const DAY = 86400000, T = 1793800000000;
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const mk = (id, over = {}) => ({id, subject: '岑舒', kind: 'interest', stage: 'intended', content: '岑舒想学摄影 ' + id, status: 'active', visibility: 'shared', sources: [], links: [], history: [], eventAt: T - 100 * DAY, updatedAt: T - 100 * DAY, importance: {level: 'medium', class: 'experience', holdDays: 30, reason: 'r'}, ...over});
function home(items, activity) {
  const h = tmp('kact-'), k = path.join(h, 'cen-shu-life', 'knowledge'); fs.mkdirSync(k, {recursive: true});
  fs.writeFileSync(path.join(k, 'index.json'), JSON.stringify({revision: 1, sources: {}, items}));
  fs.writeFileSync(path.join(k, 'activity.json'), JSON.stringify({version: 1, items: activity}));
  return h;
}

test('scoring: a Gemini judgment replaces the fallback rule (weight, fade anchor, hold days)', () => {
  const item = mk('a'), act = {recalled: 3, lastUsedAt: T - 50 * DAY, selected: 9, lastSelectedAt: T - 2 * DAY};
  const fallback = score(item, act, T);
  assert.ok(score(item, act, T, {weight: 1.8, fadeFrom: 'last-use', holdDays: 30}) > fallback, 'selection counts as fresh when Gemini says so');
  assert.equal(freshness(item, act, T, {fadeFrom: 'last-use', holdDays: 30}), 1);
  assert.ok(freshness(item, act, T, {fadeFrom: 'last-recall', holdDays: 30}) < 1, 'only the recall resets the clock');
  assert.ok(freshness(item, act, T, {fadeFrom: 'event', holdDays: 30}) < freshness(item, act, T, {fadeFrom: 'last-recall', holdDays: 30}), 'event: usage never refreshes');
  assert.equal(freshness(item, act, T, {fadeFrom: 'event', holdDays: 200}), 1, 'Gemini hold days override the consolidation default');
  assert.equal(score(item, act, T, {weight: 50, fadeFrom: 'last-use', holdDays: 30}), score(item, act, T, {weight: 2, fadeFrom: 'last-use', holdDays: 30}), 'weight is clamped');
  assert.equal(freshness(mk('s', {importance: {level: 'high', class: 'stable'}}), null, T, {fadeFrom: 'event', holdDays: 1}), 1, 'stable facts never fade');
});

test('reviewer: asks Gemini only about used items, validates, clamps, and the ranking uses the result', async () => {
  const items = {a: mk('a'), b: mk('b'), c: mk('c'), gone: mk('gone', {status: 'superseded'})};
  const h = home(items, {a: {recalled: 2, lastUsedAt: T - DAY}, b: {selected: 0, passed: 6, lastPassedAt: T - DAY}, gone: {recalled: 1, lastUsedAt: T}});
  let asked = null;
  const generate = async (prompt, schema, input) => { asked = input; return {items: [
    {id: 'a', weight: 1.6, fadeFrom: 'last-recall', holdDays: 999, reviewAfterDays: 0, reason: '最近常被问起'},
    {id: 'b', weight: 0.2, fadeFrom: 'event', holdDays: 10, reviewAfterDays: 14, reason: '总被略过'},
    {id: 'zzz', weight: 1, fadeFrom: 'event', holdDays: 10, reviewAfterDays: 3, reason: '不在题目里'},
  ]}; };
  const r = new ActivityReviewer({home: h, generate, now: () => T});
  assert.deepEqual(await r.tick(), {reviewed: 2});
  assert.deepEqual(asked.items.map(i => i.id).sort(), ['a', 'b'], 'unused (c) and inactive (gone) items are not asked');
  assert.match(asked.now, /北京时间/); assert.match(asked.items.find(i => i.id === 'a').usage.lastRecalled, /北京时间/);
  const j = r.judgments();
  assert.equal(j.a.holdDays, LIMITS.holdDays[1]); assert.equal(j.a.reviewAt, T + LIMITS.reviewAfterDays[0] * DAY); assert.equal(j.b.weight, LIMITS.weight[0]); assert.equal(j.zzz, undefined);
  assert.deepEqual(await r.tick(), {reviewed: 0}, 'nothing due until reviewAt or a new recall');
  const sal = new KnowledgeSalience({home: h, now: () => T, judgments: () => r.judgments()});
  sal.tick(); const rows = sal.ranking().rows;
  assert.ok(rows.findIndex(x => x.id === 'a') < rows.findIndex(x => x.id === 'c'), 'judged-active item ranks above an unused one');
  assert.ok(rows.find(x => x.id === 'a').judged);
  sal.recordUse(['a'], 'recalled');
  let again = null; const r2 = new ActivityReviewer({home: h, generate: async (p, s, input) => { again = input; return {items: []}; }, now: () => T + 1000});
  const res = await r2.tick();
  assert.deepEqual(again.items.map(i => i.id), ['a'], 'a new recall makes the item due again'); assert.ok(again.items[0].previous, 'previous judgment is shown');
  assert.match(res.error, /格式无效/); assert.equal(r2.judgments().a.weight, 1.6, 'a failed review keeps the last judgment');
  fs.rmSync(h, {recursive: true, force: true});
});

test('reviewer: Gemini failure backs off and never touches judgments or memories', async () => {
  const h = home({a: mk('a')}, {a: {recalled: 1, lastUsedAt: T}});
  const indexBefore = fs.readFileSync(path.join(h, 'cen-shu-life', 'knowledge', 'index.json'), 'utf8');
  const r = new ActivityReviewer({home: h, generate: async () => { throw Object.assign(Error('HTTP 402'), {httpStatus: 402}); }, now: () => T});
  const out = await r.tick();
  assert.match(out.error, /402/); assert.equal(r.status().state, 'retry'); assert.ok(r.status().retryAt >= T + 30 * 60000);
  assert.deepEqual(await r.tick(), {skipped: 'backoff'});
  assert.deepEqual(r.judgments(), {});
  assert.equal(fs.readFileSync(path.join(h, 'cen-shu-life', 'knowledge', 'index.json'), 'utf8'), indexBefore, 'index untouched');
  fs.rmSync(h, {recursive: true, force: true});
});

test('service: setting turns Gemini activity judgments on/off; items and view expose them', async () => {
  const h = home({a: mk('a'), b: mk('b')}, {a: {recalled: 1, lastUsedAt: T}});
  const config = {...validateConfig({}), enabled: true, semanticEnabled: true, sessionIds: ['session-a']};
  assert.equal(config.knowledgeActivityReview, true);
  assert.throws(() => validateConfig({knowledgeActivityReview: 1}), /布尔值/);
  const engine = {home: h, now: () => T, config, bound: id => id === 'session-a', log() {}};
  const svc = createKnowledgeService({engine, generateBase: async () => ({items: [{id: 'a', weight: 1.4, fadeFrom: 'last-use', holdDays: 40, reviewAfterDays: 7, reason: '常被调出'}]})});
  await svc.reviewer.tick();
  const a = svc.items({}).items.find(i => i.id === 'a').activity;
  assert.equal(a.recalled, 1); assert.equal(a.judgment.weight, 1.4); assert.match(a.judgment.reviewAt, /北京时间/);
  assert.equal(svc.items({}).items.find(i => i.id === 'b').activity, null);
  const v = svc.view(); assert.equal(v.activityReview.enabled, true); assert.equal(v.activityReview.judged, 1); assert.equal(v.config.knowledgeActivityReview, true);
  config.knowledgeActivityReview = false;
  assert.equal(svc.items({}).items.find(i => i.id === 'a').activity.judgment, null, 'off → fallback rule, judgment not applied');
  assert.equal(svc.view().activityReview.enabled, false);
  fs.rmSync(h, {recursive: true, force: true});
});
