// 2026-11-08：censhu_current_state：只读，内容齐全，后台暂停和超期事件标明；固定带上，并在上下文里告诉她。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {currentStateView} from '../lib/current-state.js';
import {ALWAYS_TOOLS} from '../lib/tool-bindings.js';

function engine(home, now) {
  return {home, now: () => now, config: {timezone: 'Asia/Shanghai', moodLinked: true, sessionIds: ['s']},
    life: () => ({date: '2026-11-08', hour: 22, minute: 5, weekday: 'Sun', season: '秋', activity: '看书'}),
    state: {mode: {id: 'normal', reason: '平常'}, active: [{name: '旧书', stageText: '翻书', startedAt: now - 7200000, endsAt: now - 3600000}, {name: '煮汤', stageText: '小火', startedAt: now - 60000, endsAt: now + 3600000}]},
    history: {events: [{name: '散步', endedAt: now - 1000}]},
    profile: {personalityDevelopment: [{text: '慢热', expiresAt: now + 1000}, {text: '过期的', expiresAt: now - 1}]},
    innerLifePlanning: () => ({innerState: {summary: '平静'}, thoughts: [{subject: '书', summary: '喜欢'}], interests: ['旧物'], records: [{intention: '周末去书店'}]}),
    read: () => ({}), intentions: {}, allTemplates: () => [], weatherSummary: () => ({summary: '小雨'})};
}

test('内容齐全；超期事件标明；后台暂停有说明；不写任何文件', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'state-view-')); t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const now = Date.parse('2026-11-08T14:05:00Z'), e = engine(home, now); e.intentionsOverride = true;
  const before = fs.readdirSync(home).length;
  const v = currentStateView(e, {sessionId: 's', recovery: {pending: true, manualPause: {at: now - 86400000}}});
  assert.equal(fs.readdirSync(home).length, before, '不写文件');
  assert.equal(v.background.paused, true); assert.match(v.background.note, /可能是旧的/);
  assert.equal(v.activeEvents[0].overdue, true); assert.equal(v.activeEvents[1].overdue, undefined);
  assert.equal(v.schedule, '看书'); assert.equal(v.innerState.summary, '平静'); assert.deepEqual(v.interests, ['旧物']); assert.deepEqual(v.privatePlans, ['周末去书店']);
  assert.deepEqual(v.personality, ['慢热']); assert.equal(v.weather, '小雨'); assert.equal(v.mood.available, false);
});

test('固定带上；上下文里告诉她；只有她的会话能用', () => {
  assert.ok(ALWAYS_TOOLS.includes('censhu_current_state'));
  const host = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
  assert.equal(host.split("key:'state:tool-hint'").length - 1, 2, '主会话和工作会话都告诉她');
  assert.match(host, /name:'censhu_current_state'/);
  assert.match(host, /if\(!lifeReadSession\(caller\)&&!workSession\(exec\.agent\)&&!engine\.readonlyTestSession\(exec\.agent\)\)throw Error/);
});
