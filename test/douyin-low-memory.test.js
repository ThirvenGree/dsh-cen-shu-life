// 2026-11-07：抖音刷视频 / 私信会话的内容不自动送去记忆审核；她自己写的记录（带 watchId）照常审核（临时目录）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeEngine} from '../lib/engine.js';
import {MemoryWriteback,lowMemorySession,writebackThreshold} from '../lib/memory-writeback.js';

test('只认抖音和 B 站插件建的三类工作会话', () => {
  // 2026-11-08：B 站也照抖音分成三个工作会话；旧的固定会话 bili-whale 一并算作工作会话。
  for (const id of ['bili-whale', 'bili-watch-202611080100', 'bili-social-202611080100', 'bili-revisit-202611080100']) assert.equal(lowMemorySession(id), true, id);
  for (const id of ['douyin-censhu', 'douyin-censhu-202611071200', 'douyin-dm-202611071200', 'douyin-revisit-202611071200']) assert.equal(lowMemorySession(id), true, id);
  for (const id of ['session-abc', 'bili-other', 'douyin-other', 'target']) assert.equal(lowMemorySession(id), false, id);
  assert.equal(writebackThreshold('douyin-dm-202611071200', 75), 90);
  assert.equal(writebackThreshold('session-abc', 75), 75);
});

test('抖音会话内容不送审；她写的观看记录与普通会话照常送审', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'life-douyin-low-'));
  try {
    const e = new LifeEngine({ home });
    const dm = 'douyin-dm-202611071200', watch = 'douyin-censhu-202611071200';
    e.saveConfig({ sessionIds: [dm, watch, 'target'] });
    const w = new MemoryWriteback(e, { tools: { get: () => false }, agents: () => [], generate: async () => ({ memories: [] }) });
    w.observe(watch, '【刷抖音】现在是你可以刷抖音的时间（20:00-22:00），你决定去看一会儿。');
    w.observe(dm, '【抖音来信】「小林」给你发来私信：我下周搬去杭州了');
    assert.equal(w.record.sources.length, 0, '抖音会话内容不送审');
    w.observe(watch, '看完那条做饭视频，想以后自己试试番茄炖牛腩', 'watch-1');
    w.observe('target', '我下周搬去杭州了');
    assert.deepEqual(w.record.sources.map(s => s.watchId || s.sessionId), ['watch-1', 'target']);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
