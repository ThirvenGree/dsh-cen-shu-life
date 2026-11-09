// 2026-11-08：补的伴随工具；B站工作会话固定带命令行工具。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyToolBindings, WORK_SESSION_TOOLS} from '../lib/tool-bindings.js';

const OFFERED = new Set(['pwsh', 'bash', 'douyin_chat_send', 'douyin_chat_contacts', 'douyin_chat_read', 'douyin_chat_reply', 'douyin_chat_offers', 'douyin_media_browse', 'douyin_comment', 'douyin_read_comments', 'douyin_notice_reply', 'douyin_notice_list', 'douyin_social_note', 'douyin_revisit_start', 'douyin_saved_videos', 'douyin_watch_react', 'douyin_watch_note', 'douyin_observe', 'douyin_chat_stop', 'douyin_chat_start', 'douyin_chat_status', 'bili_media_save', 'bili_dm_view']);
const bind = (names, sessionId) => { const set = new Set(names); applyToolBindings(set, OFFERED, {sessionId}); return set; };

test('抖音：选中这些工具时，离不开的工具自动跟来', () => {
  assert.ok(bind(['douyin_chat_send']).has('douyin_chat_contacts'), '主动私信的 recipientId 来自联系人列表');
  assert.ok(bind(['douyin_chat_read']).has('douyin_chat_contacts'));
  for (const t of ['douyin_chat_reply', 'douyin_chat_send', 'douyin_comment']) assert.ok(bind([t]).has('douyin_media_browse'), t + ' 配图要先在表情库看过');
  for (const t of ['douyin_chat_reply', 'douyin_notice_reply']) assert.ok(bind([t]).has('douyin_social_note'), t + ' 之后可以自己记笔记');
  assert.ok(bind(['douyin_chat_offers']).has('douyin_social_note'), '待答 → 回复 → 笔记，一路带上');
  assert.ok(bind(['douyin_revisit_start']).has('douyin_saved_videos'));
  assert.ok(bind(['douyin_watch_react']).has('douyin_observe'));
  assert.ok(bind(['douyin_chat_stop']).has('douyin_chat_start'));
});

test('B站：收表情带上 bili_dm_view；B站工作会话固定带命令行工具，其他会话不带', () => {
  assert.ok(bind(['bili_media_save']).has('bili_dm_view'));
  assert.deepEqual([...WORK_SESSION_TOOLS.bili], ['pwsh', 'bash']);
  for (const id of ['bili-watch-1', 'bili-social-abc', 'bili-revisit-2', 'bili-whale', 'session-bili-social-9']) {
    const set = bind([], id); assert.ok(set.has('pwsh') && set.has('bash'), id);
  }
  for (const id of [undefined, 'douyin-censhu-1', 'desktop-1', 'bili-other-1']) assert.ok(!bind([], id).has('pwsh'), String(id));
  const only = new Set(); applyToolBindings(only, new Set(['bash']), {sessionId: 'bili-watch-1'});
  assert.ok(only.has('bash') && !only.has('pwsh'), '没提供的工具不会加');
});

test('浏览器工作会话固定带浏览器工具（提供了才带）', () => {
  const offered = new Set(['browser_interest', 'browser_handoff', 'browser_progress', 'browser_task', 'browser_direct_session', 'pwsh']);
  const set = new Set(); applyToolBindings(set, offered, {sessionId: 'browser-browse-202611081200'});
  for (const t of ['browser_interest', 'browser_handoff', 'browser_progress', 'browser_task', 'browser_direct_session']) assert.ok(set.has(t), t);
  assert.ok(!set.has('pwsh'), '浏览器会话不带命令行');
  const other = new Set(); applyToolBindings(other, offered, {sessionId: 'desktop-1'});
  assert.ok(!other.has('browser_handoff'), '其他会话不固定带');
});

test('抖音社交会话固定带打开浏览器的工具，刷视频、重看和其他会话不带', () => {
  const offered = new Set(['douyin_browser_open']);
  for (const id of ['douyin-dm-202611081200', 'session-douyin-dm-202611081200-ab12']) { const set = new Set(); applyToolBindings(set, offered, {sessionId: id}); assert.ok(set.has('douyin_browser_open'), id); }
  for (const id of ['douyin-censhu-202611081200', 'douyin-revisit-202611081200', 'desktop-1', undefined]) { const set = new Set(); applyToolBindings(set, offered, {sessionId: id}); assert.ok(!set.has('douyin_browser_open'), String(id)); }
});

test('三组伴随：选中 A 时 B 才跟着来，没选中不带', () => {
  const names = new Set(['douyin_browser_open', 'douyin_browser_close', 'douyin_media_browse', 'douyin_media_save', 'douyin_media_remove', 'bili_media_browse', 'bili_media_save', 'bili_media_remove', 'bili_dm_view']);
  const pick = chosen => { const set = new Set(chosen); applyToolBindings(set, names); return set; };
  assert.ok(pick(['douyin_browser_open']).has('douyin_browser_close'));
  const m = pick(['douyin_media_browse']); assert.ok(m.has('douyin_media_save') && m.has('douyin_media_remove'));
  const b = pick(['bili_media_browse']); assert.ok(b.has('bili_media_save') && b.has('bili_media_remove'));
  const none = pick([]);
  for (const t of ['douyin_browser_close', 'douyin_media_save', 'bili_media_remove']) assert.ok(!none.has(t), t);
});

test('请求投影把会话编号交给绑定', () => {
  const src = fs.readFileSync(new URL('../lib/request-context.js', import.meta.url), 'utf8');
  assert.match(src, /boundTools=applyToolBindings\(chosen,catalog,\{sessionId:id\}\)/);
});

test('再加的 5 组伴随：选中 A 才带 B', () => {
  const names = new Set(['douyin_media_save', 'douyin_notice_view', 'douyin_chat_read', 'douyin_chat_contacts', 'douyin_notice_list', 'douyin_notice_reply', 'douyin_read_comments', 'douyin_chat_reply', 'douyin_chat_send', 'douyin_chat_offers', 'douyin_media_browse', 'douyin_media_remove', 'douyin_social_note', 'douyin_observe', 'browser_interest', 'browser_task', 'browser_handoff', 'browser_progress', 'browser_steer', 'browser_executor_advice', 'censhu_parallel_decide', 'subagent']);
  const pick = chosen => { const set = new Set(chosen); applyToolBindings(set, names); return set; };
  const save = pick(['douyin_media_save']); assert.ok(save.has('douyin_notice_view') && save.has('douyin_chat_read'), '收图要的 noticeId、messageId 从这两个工具来');
  assert.ok(pick(['douyin_notice_list']).has('douyin_notice_view'), '通知里的图要能看');
  assert.ok(pick(['douyin_chat_reply']).has('douyin_chat_send'), '先发图再补一句');
  const interest = pick(['browser_interest']); assert.ok(interest.has('browser_task') && interest.has('browser_handoff'), 'Terra 两种决定都走得下去');
  assert.ok(pick(['browser_task']).has('browser_handoff')); assert.ok(pick(['browser_handoff']).has('browser_task'));
  assert.ok(pick(['browser_task']).has('browser_executor_advice')); assert.ok(pick(['browser_handoff']).has('browser_executor_advice'));
  assert.ok(pick(['censhu_parallel_decide']).has('subagent'));
  const none = pick([]);
  for (const x of ['douyin_notice_view', 'douyin_chat_send', 'browser_task', 'browser_executor_advice', 'subagent']) assert.ok(!none.has(x), x);
});

test('私信回复不会连带评论通知那一串工具', () => {
  const names = new Set(['douyin_chat_reply', 'douyin_chat_send', 'douyin_chat_offers', 'douyin_chat_read', 'douyin_chat_contacts', 'douyin_media_browse', 'douyin_media_save', 'douyin_media_remove', 'douyin_social_note', 'douyin_notice_view', 'douyin_notice_list', 'douyin_notice_reply', 'douyin_read_comments']);
  const set = new Set(['douyin_chat_reply']); applyToolBindings(set, names);
  assert.ok(set.has('douyin_notice_view'), '收图需要它');
  for (const x of ['douyin_notice_list', 'douyin_notice_reply', 'douyin_read_comments']) assert.ok(!set.has(x), x);
});
