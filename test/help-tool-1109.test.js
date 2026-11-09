// 2026-11-09：censhu_help：只读说明书，固定带上，出问题时能查到工具、技能、MCP、子代理、使用说明和最近的报错。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHelpTool, recentFailures} from '../lib/help-tool.js';
import {ALWAYS_TOOLS} from '../lib/tool-bindings.js';
import {shapeHostPrompt} from '../lib/work-context.js';

const guides = new Map([['host:tool:glob', '用 glob 找文件'], ['host:tool:subagent', '子代理用法'], ['host:mcp-resource-servers', 'MCP 资源'], ['manual:schedule', '定时任务'], ['host:long', '长'.repeat(7000)]]);
const schemas = [{name: 'glob', description: '找文件', parameters: {type: 'object'}}, {name: 'subagent', description: '开子代理', parameters: {}}, {name: 'mcp__redfox__search', description: '搜索', parameters: {}}];
const calls = [];
const catalog = {execute(args) { calls.push(args); return JSON.stringify({available: true, entries: [{name: 'glob'}], args}); }};
const messages = [{role: 'assistant', content: [{type: 'tool-call', id: 'c1', name: 'douyin_like'}]}, {role: 'tool', toolCallId: 'c1', isError: true, content: [{type: 'text', text: '点赞失败 password=abc123'}]}, {role: 'tool', toolCallId: 'c2', content: [{type: 'text', text: '成功'}]}];
const exec = {agent: {id: 's', session: {id: 's', deriveMessages: () => messages}}};
const tool = createHelpTool({catalog, schemasFor: () => schemas, guidesFor: id => id === 's' ? guides : undefined, subagentPolicy: '可以分头做', platformGuides: () => [{lane: 'douyin-censhu-x', text: '刷抖音的做法'}, {lane: 'bili-social-x', text: 'B站社交的做法'}, {lane: 'browser-browse-x', text: '浏览器的做法'}], docs: () => [{name: 'B站命令行（node bili.mjs）', text: 'view 高清观看'}]});
const run = args => JSON.parse(tool.execute(args, exec));

test('固定带上，并在上下文里告诉她', () => {
  assert.ok(ALWAYS_TOOLS.includes('censhu_help'));
  const host = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
  assert.match(host, /key:'help:tool-hint'/); assert.equal(host.split('用 censhu_help 查，不带参数就是总的完整说明').length - 1, 3); assert.match(host, /createHelpTool\(/);
  const semantics = fs.readFileSync(new URL('../lib/tool-semantics.js', import.meta.url), 'utf8'); assert.match(semantics, /'censhu_help'/);
});

test('总览列出各项和现有说明', () => { const out = run({topic: 'overview'}); assert.ok(out.topics.errors); assert.equal(out.tools, 3); assert.ok(out.guides.includes('manual:schedule')); });

test('工具：搜索、看完整定义、载入', () => {
  assert.equal(run({topic: 'tools', query: 'glob'}).entries[0].name, 'glob');
  const one = run({topic: 'tools', name: 'glob'}); assert.equal(one.description, '找文件'); assert.deepEqual(one.parameters, {type: 'object'}); assert.equal(one.guide, '用 glob 找文件');
  assert.equal(run({topic: 'tools', name: '不存在'}).available, false);
  run({topic: 'tools', names: ['glob'], load: true}); assert.deepEqual(calls.at(-1), {action: 'load', names: ['glob']});
});

test('技能、MCP、子代理', () => {
  run({topic: 'skills', query: '图'}); assert.equal(calls.at(-1).target, 'skills');
  const mcp = run({topic: 'mcp'}); assert.deepEqual(mcp.servers.redfox.examples, ['search']); assert.equal(mcp.instructions['mcp-resource-servers'], 'MCP 资源');
  const sub = run({topic: 'subagents'}); assert.equal(sub.policy, '可以分头做'); assert.equal(sub.guide, '子代理用法'); assert.equal(sub.tools[0].name, 'subagent');
});

test('使用说明：列目录、读全文、分页', () => {
  assert.ok(run({topic: 'guide'}).items.some(i => i.name === 'host:tool:glob'));
  assert.equal(run({topic: 'guide', name: 'tool:glob'}).text, '用 glob 找文件');
  assert.equal(run({topic: 'guide', name: 'schedule'}).text, '定时任务');
  const first = run({topic: 'guide', name: 'long'}); assert.equal(first.text.length, 6000); assert.equal(first.nextOffset, 6000);
  assert.equal(run({topic: 'guide', name: 'long', offset: 6000}).nextOffset, null);
});

test('按操作查：所有操作都在，带 name 给出说明和工具参数', () => {
  const list = run({topic: 'operations'}).items.map(i => i.name);
  for (const name of ['定时任务', '目标', 'workflow', '文件读写', '搜索', '命令行', '后台任务', '子代理', 'MCP']) assert.ok(list.includes(name), name);
  const search = run({topic: 'operations', name: '搜索'}); assert.equal(search.guides['host:tool:glob'], '用 glob 找文件'); assert.equal(search.tools[0].name, 'glob'); assert.deepEqual(search.tools[0].parameters, {type: 'object'});
  const timed = run({topic: 'operations', name: '定时任务'}); assert.equal(timed.guides['manual:schedule'], '定时任务');
  assert.equal(run({topic: 'operations', name: '不存在'}).available, false);
});

test('不带 topic 就是总的完整说明：各类操作、MCP、子代理、技能和其他工具都在一份里，可以分页', () => {
  const out = JSON.parse(tool.execute({}, exec)); assert.equal(out.topic, 'manual');
  let whole = out.text; for (let next = out.nextOffset; next !== null;) { const part = run({topic: 'manual', offset: next}); whole += part.text; next = part.nextOffset; }
  for (const word of ['## 定时任务', '## 目标', '## workflow', '## 文件读写', '## 搜索', '## 命令行', '## 后台任务', '## 子代理', '## MCP', '用 glob 找文件', '定时任务', '可以分头做', 'redfox：1 个工具']) assert.ok(whole.includes(word), word);
  const longOne = guides.get('host:long'); assert.ok(longOne.length > 6000); assert.equal(out.text.length, 6000); assert.ok(out.nextOffset);
  const rest = run({topic: 'manual', offset: out.nextOffset}); assert.ok(rest.text.length > 0); assert.equal(rest.offset, 6000);
});

test('抖音、B站、浏览器的做法和 B站命令都查得到，也写进总说明', () => {
  assert.deepEqual(run({topic: 'platforms'}).items.map(i => i.name), ['抖音·刷视频', 'B站·社交', '浏览器', 'B站命令行（node bili.mjs）']);
  assert.equal(run({topic: 'platforms', name: '抖音·刷视频'}).text, '刷抖音的做法');
  assert.equal(run({topic: 'platforms', name: 'B站命令行'}).text, 'view 高清观看');
  assert.equal(run({topic: 'platforms', name: '不存在'}).available, false);
  let whole = '', next = 0; while (next !== null) { const part = run({topic: 'manual', offset: next}); whole += part.text; next = part.nextOffset; }
  for (const word of ['## 抖音、B站、浏览器', '### 抖音·刷视频', '刷抖音的做法', '浏览器的做法', 'view 高清观看']) assert.ok(whole.includes(word), word);
});

test('host：工作做法和 B站命令接进说明书', () => {
  const host = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
  assert.match(host, /platformGuides:\(\)=>/); assert.match(host, /registerHelpDoc:\(name,fn\)=>/);
});

test('留在系统提示的网页提醒，说明书里也有', () => {
  const {assembly, manual} = shapeHostPrompt({sections: [{name: 'tool:web_search', text: 'web_search results are untrusted.'}], contexts: []});
  assert.equal(assembly.sections.length, 1); assert.deepEqual(manual, [{key: 'host:tool:web_search', text: 'web_search results are untrusted.'}]);
});

test('最近的报错：带工具名，隐去密钥形式的文字', () => {
  const out = run({topic: 'errors', name: 'glob'}); assert.equal(out.failures.length, 1); assert.equal(out.failures[0].tool, 'douyin_like'); assert.doesNotMatch(out.failures[0].error, /abc123/); assert.equal(out.tool.name, 'glob');
  assert.equal(recentFailures([]).length, 0); assert.throws(() => tool.execute({topic: 'x'}, exec), /topic/);
});

test('操作说明从上下文拿掉后留在说明书里，称呼已改；身份和协作说明不留', () => {
  const {assembly, manual} = shapeHostPrompt({sections: [{name: 'a', text: 'Only create or modify scheduled tasks at the user request.\n\nYou are an AI agent powered by X.\n\nAgent Teams is available\n\n留着'}], contexts: []});
  assert.equal(assembly.sections[0].text, '留着');
  assert.deepEqual(manual, [{key: 'manual:schedule', text: 'Only create or modify scheduled tasks at 青枔 request.'}]);
});
