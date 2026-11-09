// 2026-11-07：抖音工作会话不自动绑定生活（插件投递不是青枔的话），以前绑定过的移掉；另外作为“工作会话”挂动态上下文（源码核对）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {interactiveDesktop} from '../lib/desktop-bindings.js';

const agent=id=>({session:{id,header:{cwd:'C:/x'}}});

test('抖音工作会话即使有“用户发言”也不自动绑定；普通桌面会话照常', () => {
  for(const id of ['douyin-censhu','douyin-censhu-202611072000','douyin-dm-202611072000','douyin-revisit-202611072000'])assert.equal(interactiveDesktop(agent(id),new Set(),true),false,id);
  assert.equal(interactiveDesktop(agent('session-abc'),new Set(),true),true);
});

test('工作会话挂上下文：她的生活按预算拼接、记忆与分头处理说明；不观察来信（源码核对）', () => {
  const src=fs.readFileSync(new URL('../lib/host.js',import.meta.url),'utf8');
  const block=src.slice(src.indexOf('抖音的三个工作会话（刷视频 / 社交 / 重看）。不绑定生活'),src.indexOf("workMounted.set(agent,offs)"));
  assert.ok(block.length>200);
  assert.match(block,/assembleHer\(agent,next/);assert.match(block,/engine\.context\(lifeSid/);assert.match(block,/censhu-subagent-policy/);
  assert.ok(!/agent\/inbox\/inserted|observe\(/.test(block),'不观察来信');
  assert.match(src,/servesWorkSessions:true/);
  const bindings=fs.readFileSync(new URL('../lib/desktop-bindings.js',import.meta.url),'utf8');
  // 2026-11-08：B 站的三个工作会话也从自动绑定里移掉；记忆说明按平台写。
  assert.match(bindings,/for\(const k of \[\.\.\.auto\.keys\(\)\]\)if\(\/\^\(\?:douyin-/);
  assert.match(src,/workPlatform\(sid\)==='bili'\?'【角色记忆使用】这是你的 B 站工作会话/);
});
