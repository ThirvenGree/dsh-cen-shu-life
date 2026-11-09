// 2026-11-08：固定规则，其余交给 Gemini；后台暂停和超期事件要说清楚。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shapeWorkParts, pinQqStyle, backgroundPausedNote} from '../lib/work-context.js';
import {roundLifeTime, planSchema, planPrompt} from '../lib/context-budget.js';

const parts = () => [
  {text: '生活', key: 'life:current'}, {text: '心情', key: 'mood:current'}, {text: '事件', key: 'life:event:1:a'},
  {text: '结束', key: 'life:ended'}, {text: '打算', key: 'life:intentions'}, {text: '活动', key: 'agency:current'},
  {text: '内在', key: 'inner:state', priority: 80, owner: 'inner'}, {text: '想法', key: 'inner:thoughts', priority: 51, owner: 'inner'},
  {text: '兴趣', key: 'inner:interests', priority: 50, owner: 'inner'}, {text: 'QQ', key: 'life:style'}, {text: '工具联动', required: true},
];
const by = (list, text) => list.find(p => p.text === text);

test('工作会话：状态按名字固定；内在状态、想法、兴趣、QQ 表达规则交给 Gemini；工具联动不去掉', () => {
  const out = shapeWorkParts(parts());
  assert.equal(out.length, parts().length, '不删任何段落');
  for (const t of ['生活', '心情', '事件', '结束', '打算', '活动', '工具联动']) assert.equal(by(out, t).required, true, t);
  for (const t of ['内在', '想法', '兴趣', 'QQ']) assert.notEqual(by(out, t).required, true, t);
});

test('QQ 表达规则只在 QQ 聊天会话固定', () => {
  assert.equal(by(pinQqStyle(parts(), true), 'QQ').required, true);
  assert.notEqual(by(pinQqStyle(parts(), false), 'QQ').required, true);
});

test('后台暂停时有说明；没暂停时为空', () => {
  assert.equal(backgroundPausedNote({pending: false}), '');
  assert.match(backgroundPausedNote({pending: true, manualPause: {at: 1793877746000}}, () => '那时'), /后台运行暂停中（自 那时 起）.*可能是旧的/);
});

test('时间精度由 Gemini 决定：取整只动生活行的时间；不给或 1 分钟不变', () => {
  const t = '【岑舒生活与行为】2026-11-08 21:47 Sun 其他 10:33';
  assert.equal(roundLifeTime(t, 15), '【岑舒生活与行为】2026-11-08 21:45 Sun 其他 10:33');
  assert.equal(roundLifeTime(t, 60), '【岑舒生活与行为】2026-11-08 21:00 Sun 其他 10:33');
  assert.equal(roundLifeTime(t, undefined), t); assert.equal(roundLifeTime(t, 1), t);
  assert.ok(planSchema.properties.timeGranularityMinutes); assert.match(planPrompt, /previousOrder/); assert.match(planPrompt, /order 的先后就是本轮的优先级/);
});

test('源码核对：工作做法固定、其他会话作候选、工作会话刷新状态、超期事件标明、内在状态有名字', () => {
  const host = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
  assert.match(host, /guideParts\.push\(\{\.\.\.p,owner:'work',required:true\}\)/);
  assert.match(host, /parts\.push\(\.\.\.workGuideCandidates\(\)\)/);
  assert.match(host, /refreshForWork\(sid,lifeSid\);/);
  assert.match(host, /if\(recoveryRuntime\.state\?\.pending\)return;/);
  assert.match(fs.readFileSync(new URL('../lib/engine.js', import.meta.url), 'utf8'), /已超过预计结束时间/);
  assert.match(fs.readFileSync(new URL('../lib/request-context.js', import.meta.url), 'utf8'), /contextOnly=new Set\(\[[^\]]*'repeat-tool-reminder'\]\)/);
  assert.match(fs.readFileSync(new URL('../../dsh-censhu-inner-life/lib/core.js', import.meta.url), 'utf8'), /key:'inner:state'/);
});
