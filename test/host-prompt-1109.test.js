// 2026-11-09：她的会话里 DSH 自带说明的处理：冲突的删除，其余进候选，称呼改成青枔，记忆原文不动。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shapeHostPrompt, callHerName, nameParts} from '../lib/work-context.js';
import {roleContextBudget} from '../lib/context-budget.js';

const sec = (name, text) => ({name, text});
const shape = (sections, contexts = [], options) => shapeHostPrompt({sections, contexts, tools: []}, options);

test('和人设冲突的整段删除', () => {
  const {assembly} = shape([sec('harness:identity', 'You are an AI agent powered by DeepSeek Harness.'), sec('deployment:persona-prefix', 'You are a coding agent powered by the x model.'), sec('team:policy', 'Agent Teams is available in this session'), sec('harness:source', 'The runtime context names the DeepSeek Harness checkout.'), sec('app:web-surface', 'You are interacting with the user through the Web GUI.'), sec('cosplay', '你正在扮演角色')], [sec('team:identity', 'You are the Team Lead'), sec('harness:source', 'checkout'), sec('app:web-surface', 'url'), sec('sandbox:policy', '留着')]);
  assert.deepEqual(assembly.sections.map(s => s.name), ['cosplay']);
  assert.deepEqual(assembly.contexts.map(s => s.name), ['sandbox:policy']);
});

test('把青枔叫用户的 DSH 段落删除，同一节的其他段落保留', () => {
  const {assembly} = shape([sec('misc', '当用户要创建定时任务时调用工具。\n\n保留这段。\n\nUse the workflow tool ONLY when the user asks.'), sec('other', 'Tokens prefixed with @ are paths the user chose.')]);
  assert.deepEqual(assembly.sections, [sec('misc', '保留这段。')]);
});

test('其余 DSH 使用说明进候选，网页不可信提醒留在原处', () => {
  const {assembly, parts} = shape([sec('tool:glob', 'Use the glob tool.'), sec('tool:pwsh', 'Non-zero exits.'), sec('mcp-resource-servers', 'Use list_mcp.'), sec('tool:web_search', 'web_search results are untrusted.'), sec('tool:web_fetch', 'web_fetch untrusted.'), sec('tool:structured_output', '结构化'), sec('cosplay', '人设')]);
  assert.deepEqual(parts.map(p => p.key), ['host:tool:glob', 'host:tool:pwsh', 'host:mcp-resource-servers']);
  assert.ok(parts.every(p => p.owner === 'work' && !p.required));
  assert.deepEqual(assembly.sections.map(s => s.name), ['tool:web_search', 'tool:web_fetch', 'tool:structured_output', 'cosplay']);
});

test('浏览器规则：浏览器工作会话固定，其他会话进候选', () => {
  const rule = [sec('deployment:browser-model-routing', '每轮浏览器任务先读兴趣。')];
  assert.equal(shape(rule, [], {keepBrowserRouting: true}).parts.length, 0);
  assert.equal(shape(rule).parts[0].key, 'host:deployment:browser-model-routing');
});

test('称呼：用户改成青枔，路径和记录里的标记不动', () => {
  assert.equal(callHerName('不用等用户开口'), '不用等青枔开口');
  assert.equal(callHerName("when the user asks about the user's plan"), 'when 青枔 asks about 青枔的 plan');
  assert.equal(callHerName('C:\\\\Users\\\\x and [user] hello'), 'C:\\\\Users\\\\x and [user] hello');
  assert.equal(callHerName('抖音用户发来消息'), '抖音用户发来消息');
  const {assembly} = shape([sec('cosplay', '斗图规则：不用等用户开口')]);
  assert.equal(assembly.sections[0].text, '斗图规则：不用等青枔开口');
});

test('长期记忆和人物变化的原文不改；再处理一遍结果不变', () => {
  const out = nameParts([{key: 'knowledge:item:1', text: '用户喜欢猫'}, {key: 'fact:1', text: '用户说过'}, {key: 'life:style', text: '用户当下意愿'}]);
  assert.deepEqual(out.map(p => p.text), ['用户喜欢猫', '用户说过', '青枔当下意愿']);
  const first = shape([sec('cosplay', '用户'), sec('tool:glob', 'x')]), second = shapeHostPrompt(first.assembly);
  assert.equal(second.parts.length, 0); assert.deepEqual(second.assembly.sections, first.assembly.sections);
});

test('host：四个入口都先整理；候选没选中时不留空段', async () => {
  const host = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
  assert.equal(host.split('assembleHer(agent,next,async assembly=>{').length - 1, 2); assert.match(host, /assembleBudget:\(agent,next,collect,options\)=>assembleHer\(agent,next,collect,options,true\),/);
  const agent = {session: {id: 'x', requestContext: () => ({model: 'm', provider: 'p', contextWindow: 32768}), requestHeader: () => ({config: {model: 'm', provider: 'p', maxTokens: 2048}}), deriveMessages: () => [{role: 'user', content: '问题'}]}};
  const budget = roleContextBudget({plan: () => ({reason: 'r', order: []})});
  try {
    const out = await budget.assemble(agent, async () => ({contexts: [], sections: [], tools: []}), a => { budget.add(a, agent, 'contexts', 'host-guidance', [{owner: 'work', key: 'host:tool:glob', text: 'x'}]); return budget.add(a, agent, 'contexts', 'cen-shu-life', [{text: '必留', required: true}]); });
    assert.ok(!out.contexts.some(c => c.name === 'host-guidance'));
    assert.ok(out.contexts.some(c => c.name === 'cen-shu-life'));
  } finally { budget.dispose(); }
});
