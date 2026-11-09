// 2026-11-08：工作会话的标题按平台分开。原来 B站工作会话也被写成“【抖音工作会话】这里处理插件交给你的抖音的事”。
// 2026-11-08（续）：浏览器也有了专用工作会话 browser-browse-*。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workPlatform, lowMemorySession} from '../lib/memory-writeback.js';

const src = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');

test('平台识别：bili- 是 B站，douyin- 是抖音，browser-browse- 是浏览器', () => {
  assert.equal(workPlatform('bili-social-1'), 'bili');
  assert.equal(workPlatform('douyin-watch-1'), 'douyin');
  assert.equal(workPlatform('browser-browse-202611081200'), 'browser');
  assert.equal(workPlatform('desktop-1'), null);
  assert.equal(lowMemorySession('browser-browse-202611081200'), true, '浏览器工作会话也按工作会话处理（不自动写记忆）');
  assert.equal(lowMemorySession('browser-other'), false);
});

test('拼进工作会话的说明、只读生活查询的标题、日志、记忆规则都按平台写', () => {
  assert.match(src, /browser:\{name:'浏览器',does:'你在主动回合里决定的自主浏览'\}/);
  assert.match(src, /const workLabel=sid=>'【'\+workKind\(sid\)\.name\+'工作会话】';/);
  assert.match(src, /text:workLabel\(sid\)\+'这里处理插件交给你的'\+workKind\(sid\)\.does\+'。/);
  assert.match(src, /return '【'\+workKind\(caller\)\.name\+'工作会话 · 只读】以下是你此刻的生活状态/);
  assert.match(src, /workPlatform\(sid\)==='browser'\?'【角色记忆使用】这是你的浏览器工作会话/);
  assert.match(src, /workPlatform\(sid\)==='browser'\?'browser-lane-guide'/);
  assert.ok(!src.includes("text:'【抖音工作会话】这里处理"), '不再写死成抖音');
  assert.ok(!src.includes("engine.log('抖音工作会话"), '日志也按平台写');
});
