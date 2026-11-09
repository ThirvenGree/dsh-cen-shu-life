// 2026-11-08 上下文审查后的修改：放宽校验、沿用决定、按会话等待、时间精度、给 Gemini 的只读工具、旧分镜、QQ 专用段。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {roleContextBudget} from '../lib/context-budget.js';
import {budgetReadTools, recentActivity} from '../lib/budget-tools.js';
import {dropJudgedFrames, OMITTED_FRAMES_NOTE} from '../lib/request-media.js';
import {splitQqOnlyBlocks} from '../lib/work-context.js';
import {googlePlanWithTools, resetPlanToolLoop} from '../lib/situation.js';

const fact = (name, text, version = 'v1', key = 'recall:0') => ({name, text, interpolate: false, order: 17, contextBudget: {source: name, version, key, kind: 'history', mode: 'optional'}});
const agentOf = (id = 'review', messages = [{role: 'user', content: '当前问题'}]) => ({session: {id, requestContext: () => ({model: 'm', provider: 'p', contextWindow: 32768}), requestHeader: () => ({config: {model: 'm', provider: 'p', maxTokens: 2048}}), deriveMessages: () => messages}});
const planOf = (input, pick = () => false, extra = {}) => ({reason: '按问题选择', allocations: Object.fromEntries(['life', 'inner', 'agency'].map(s => [s, {tokens: 2000, reason: 'r'}])), sourceAllocations: input.sources.filter(s => s.source.startsWith('external:')).map(s => ({source: s.source, tokens: 2000, reason: 'r'})), order: input.candidates.filter(c => !c.required && pick(c)).map(c => c.id), recall: [], ...extra});
const assemble = (budget, agent, contexts, life = [{text: '必留', required: true}]) => budget.add({contexts, sections: [], tools: []}, agent, 'contexts', 'cen-shu-life', life);
const names = out => out.contexts.map(c => c.name);

test('放宽校验：出错的项去掉，其余照常生效', async () => {
  const budget = roleContextBudget({plan: input => {
    const plan = planOf(input, c => c.origin === 'a');
    plan.order.push(9999, plan.order[0], input.candidates.find(c => c.required).id);
    plan.recall = [{id: 9999, when: 'x'}, {id: input.candidates.find(c => c.origin === 'b').id, when: '长'.repeat(400)}];
    delete plan.allocations.agency; plan.reason = ''; plan.sourceAllocations = [...plan.sourceAllocations.slice(1), {source: 'external:nobody', tokens: 1, reason: 'r'}];
    return plan;
  }});
  try {
    const out = await assemble(budget, agentOf(), [fact('a', '甲'), fact('b', '乙')]);
    const row = budget.status()[0];
    assert.equal(row.mode, 'model'); assert.ok(names(out).includes('a')); assert.ok(!names(out).includes('b'));
    assert.match(row.reason, /模型未说明理由/);
  } finally { budget.dispose(); }
});

test('连 order 都没有才算失败', async () => {
  const budget = roleContextBudget({plan: () => ({reason: 'x'})});
  try { await assemble(budget, agentOf(), [fact('a', '甲')]); assert.equal(budget.status()[0].mode, 'local'); assert.match(budget.status()[0].reason, /未返回资料顺序/); } finally { budget.dispose(); }
});

test('规划失败时沿用上一份决定：上次没选的不放，上次没见过的保留，并写日志', async () => {
  let fail = false; const log = [];
  const budget = roleContextBudget({onDecision: row => log.push(row), plan: input => { if (fail) throw Error('offline'); return planOf(input, c => c.origin === 'a'); }});
  try {
    const agent = agentOf();
    await assemble(budget, agent, [fact('a', '甲'), fact('b', '乙')]);
    fail = true;
    const out = await assemble(budget, agent, [fact('a', '甲'), fact('b', '乙'), fact('c', '新来的', 'v1', 'other')]);
    assert.ok(names(out).includes('a')); assert.ok(!names(out).includes('b')); assert.ok(names(out).includes('c'));
    assert.equal(budget.status()[0].mode, 'previous');
    assert.equal(log[0].mode, 'model'); assert.equal(log[1].mode, 'previous');
    assert.ok(log[0].keptKeys.length > 0); assert.doesNotMatch(JSON.stringify(log), /甲|乙|新来的/, '日志只有名字和数字');
  } finally { budget.dispose(); }
});

test('沿用决定：名字相同的外来资料不会互相算作选过', async () => {
  const inputs = [];
  const budget = roleContextBudget({plan: input => { inputs.push(input); return planOf(input, c => c.origin === 'a'); }});
  try {
    const agent = agentOf();
    await assemble(budget, agent, [fact('a', '甲'), fact('b', '乙')]);
    await assemble(budget, agent, [fact('a', '甲'), fact('b', '乙'), fact('a', '甲新版', 'v2')]);
    const previous = inputs[1].previousOrder.map(id => inputs[1].candidates.find(c => c.id === id));
    assert.equal(previous.length, 1); assert.equal(previous[0].sourceVersion, 'v1');
  } finally { budget.dispose(); }
});

test('普通失败只让这个会话等，额度错误所有会话都等', async () => {
  let error = Object.assign(Error('坏了'), {httpStatus: 500}), calls = 0;
  const budget = roleContextBudget({plan: () => { calls++; throw error; }});
  try {
    await assemble(budget, agentOf('a1'), [fact('a', '甲')]); assert.equal(calls, 1);
    await assemble(budget, agentOf('a1'), [fact('a', '甲'), fact('b', '乙')]); assert.equal(calls, 1, '同一会话在等');
    await assemble(budget, agentOf('a2'), [fact('a', '甲')]); assert.equal(calls, 2, '别的会话不受影响');
    error = Object.assign(Error('额度'), {httpStatus: 429});
    await assemble(budget, agentOf('a3'), [fact('a', '甲')]); assert.equal(calls, 3);
    await assemble(budget, agentOf('a4'), [fact('a', '甲')]); assert.equal(calls, 3, '额度错误全局等待');
  } finally { budget.dispose(); }
});

test('同一回合时间精度以第一次为准，换回合重新定', async () => {
  let grain = 15; const life = t => [{text: '【岑舒生活与行为】2026-11-08 ' + t, required: true, key: 'life:current'}];
  const budget = roleContextBudget({plan: input => planOf(input, () => false, {timeGranularityMinutes: grain})});
  try {
    const agent = agentOf();
    budget.startTurn('review', 't1');
    let out = await assemble(budget, agent, [], [...life('23:38'), {text: '可选'}]);
    assert.match(out.contexts.find(c => c.name === 'cen-shu-life').text, /23:30/);
    grain = 60;
    out = await assemble(budget, agent, [], [...life('23:44'), {text: '可选2'}]);
    assert.match(out.contexts.find(c => c.name === 'cen-shu-life').text, /23:30/, '同一回合不变');
    budget.startTurn('review', 't2');
    out = await assemble(budget, agent, [], [...life('23:44'), {text: '可选3'}]);
    assert.match(out.contexts.find(c => c.name === 'cen-shu-life').text, /23:00/, '新回合重新定');
  } finally { budget.dispose(); }
});

test('规划时把只读工具交给 Gemini', async () => {
  let tools;
  const messages = [{role: 'user', content: '刷视频'}, {role: 'assistant', content: [{type: 'text', text: '好'}, {type: 'tool-call', id: 'c1', name: 'douyin_observe'}]}, {role: 'tool', toolCallId: 'c1', content: [{type: 'text', text: '画面'}, {type: 'image'}]}];
  const budget = roleContextBudget({readState: () => '{"mood":"平静"}', plan: (input, options) => { tools = options.tools; return planOf(input); }});
  try {
    await assemble(budget, agentOf('t', messages), [fact('a', '甲'.repeat(9000))]);
    assert.deepEqual(tools.map(t => t.name), ['read_candidate', 'recent_activity', 'current_state']);
    const read = tools[0].run({id: tools[0] && 1}); assert.equal(read.totalChars, 9000); assert.equal(read.text.length, 4000); assert.equal(read.nextOffset, 4000);
    assert.equal(tools[0].run({id: 9999}).error, '没有这个编号');
    const items = tools[1].run({}).items; assert.deepEqual(items.map(i => i.role), ['user', 'assistant', 'tool']); assert.deepEqual(items[1].calls, ['douyin_observe']); assert.equal(items[2].name, 'douyin_observe'); assert.equal(items[2].media, 1);
    assert.equal(tools[2].run().state, '{"mood":"平静"}');
  } finally { budget.dispose(); }
});

test('recent_activity 不带注入资料，隐去密钥形式的文字', () => {
  const rows = recentActivity([{role: 'system', content: '系统'}, {role: 'user', source: {kind: 'runtime-context'}, content: '快照'}, {role: 'user', content: 'password=abcdef'}]);
  assert.equal(rows.length, 1); assert.doesNotMatch(rows[0].text, /abcdef/);
  assert.deepEqual(budgetReadTools().map(t => t.name), ['read_candidate', 'recent_activity', 'current_state']);
});

const config = {semanticModel: 'gemini-test'}, keyReader = async () => 'test-key';
const reply = body => ({ok: true, status: 200, json: async () => body});

test('工具循环：先看情况再提交，模型的内容原样带回', async () => {
  resetPlanToolLoop();
  const bodies = [], trace = {toolCalls: [], fallback: null};
  const answers = [
    {candidates: [{content: {role: 'model', parts: [{functionCall: {name: 'recent_activity', args: {limit: 3}}, thoughtSignature: 'sig'}]}}]},
    {candidates: [{content: {role: 'model', parts: [{functionCall: {name: 'submit_plan', args: {order: [1], reason: 'ok'}}}]}}]}
  ];
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply(answers.shift()); };
  const tools = [{name: 'recent_activity', description: 'd', parameters: {type: 'object', properties: {}}, run: () => ({items: []})}];
  const result = await googlePlanWithTools('sys', {type: 'object'}, {a: 1}, config, {fetcher, keyReader, tools, trace, toolPrompt: '+工具'});
  assert.deepEqual(result, {order: [1], reason: 'ok'}); assert.deepEqual(trace.toolCalls, ['recent_activity']);
  assert.equal(bodies[0].systemInstruction.parts[0].text, 'sys+工具');
  assert.equal(bodies[1].contents[1].parts[0].thoughtSignature, 'sig');
  assert.deepEqual(bodies[1].contents[2].parts[0].functionResponse.response, {result: {items: []}});
  assert.ok(bodies[0].tools[0].functionDeclarations.some(d => d.name === 'submit_plan'));
});

test('工具循环：到上限后只允许提交', async () => {
  resetPlanToolLoop();
  const bodies = [], call = {candidates: [{content: {parts: [{functionCall: {name: 'x', args: {}}}]}}]}, done = {candidates: [{content: {parts: [{functionCall: {name: 'submit_plan', args: {order: []}}}]}}]};
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply(bodies.length <= 2 ? call : done); };
  await googlePlanWithTools('s', {}, {}, config, {fetcher, keyReader, tools: [{name: 'x', description: 'd', parameters: {}, run: () => 1}]});
  assert.equal(bodies.length, 3); assert.deepEqual(bodies[2].toolConfig.functionCallingConfig.allowedFunctionNames, ['submit_plan']); assert.equal(bodies[1].toolConfig.functionCallingConfig.allowedFunctionNames, undefined);
});

test('接口不接受工具请求时退回结构化调用，一小时内不再尝试', async () => {
  resetPlanToolLoop();
  const bodies = [], trace = {toolCalls: [], fallback: null};
  const fetcher = async (_url, init) => { const body = JSON.parse(init.body); bodies.push(body); if (body.tools) return {ok: false, status: 400, json: async () => ({error: {message: 'bad'}})}; return reply({candidates: [{content: {parts: [{text: '{"order":[]}'}]}}]}); };
  const tools = [{name: 'x', description: 'd', parameters: {}, run: () => 1}];
  assert.deepEqual(await googlePlanWithTools('s', {type: 'object'}, {}, config, {fetcher, keyReader, tools, trace}), {order: []});
  assert.equal(trace.fallback, '400'); assert.equal(bodies.length, 2);
  await googlePlanWithTools('s', {type: 'object'}, {}, config, {fetcher, keyReader, tools});
  assert.equal(bodies.length, 3, '不再发带工具的请求'); assert.equal(bodies[2].tools, undefined);
  resetPlanToolLoop();
});

const observe = (id, images = 2) => [{role: 'assistant', content: [{type: 'tool-call', id, name: 'douyin_observe'}]}, {role: 'tool', toolCallId: id, content: [{type: 'text', text: '第' + id}, ...Array(images).fill({type: 'image'})]}];
const call = (id, name, isError = false) => [{role: 'assistant', content: [{type: 'tool-call', id, name}]}, {role: 'tool', toolCallId: id, isError, content: [{type: 'text', text: 'ok'}]}];

test('翻过去的视频，旧分镜不再发；还在看的保留；原消息不改', () => {
  const messages = Object.freeze([...observe('o1'), ...call('n1', 'douyin_next'), ...observe('o2')]);
  const out = dropJudgedFrames(messages, 'douyin-censhu-202611082140');
  assert.notStrictEqual(out, messages);
  assert.deepEqual(out[1].content.map(p => p.type), ['text', 'text']); assert.equal(out[1].content[1].text, OMITTED_FRAMES_NOTE);
  assert.strictEqual(out.at(-1), messages.at(-1), '当前视频的分镜保留');
  assert.equal(messages[1].content.filter(p => p.type === 'image').length, 2, '原消息不变');
});

test('旧分镜：翻页失败不算翻过去；其他会话不处理', () => {
  const failed = [...observe('o1'), ...call('n1', 'douyin_next', true), ...observe('o2')];
  assert.strictEqual(dropJudgedFrames(failed, 'douyin-censhu-1'), failed);
  const ok = [...observe('o1'), ...call('n1', 'douyin_next'), ...observe('o2')];
  for (const id of ['douyin-dm-1', 'desktop-1', 'bili-watch-1', undefined]) assert.strictEqual(dropJudgedFrames(ok, id), ok, String(id));
  assert.notStrictEqual(dropJudgedFrames(ok, 'douyin-revisit-1'), ok);
});

test('工作会话的 QQ 专用段改成候选，其他段不动', () => {
  const text = '【你这个人】\n较真\n【QQ 空间发布联动】\n可以发空间\n第二行\n【语气】\n自然\n【QQ 自主表达与发送】\n多种形式';
  const assembly = {sections: [{name: 'cosplay', text}, {name: 'other', text: '无关'}], contexts: []};
  const {assembly: out, removed} = splitQqOnlyBlocks(assembly);
  assert.equal(out.sections[0].text.trim(), '【你这个人】\n较真\n【语气】\n自然');
  assert.strictEqual(out.sections[1], assembly.sections[1]);
  assert.equal(removed.length, 2); assert.equal(removed[0].text, '【QQ 空间发布联动】\n可以发空间\n第二行'); assert.ok(removed.every(p => !p.required));
  const none = {sections: [{name: 'x', text: '普通'}]}; assert.strictEqual(splitQqOnlyBlocks(none).assembly, none);
});

test('host：跨插件接口的参数位置不变；工作会话接上 QQ 段；预算日志落盘', () => {
  const host = fs.readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
  assert.match(host, /budgetContext:\(assembly,agent,field,name,parts,_hint,onAccepted,options\)=>budget\.add\(assembly,agent,field,name,parts,onAccepted,options\)/);
  assert.match(host, /parts\.push\(\.\.\.qqOnly\.removed\)/); assert.match(host, /context-budget-log\.jsonl/); assert.match(host, /googlePlanWithTools\(planPrompt/);
  assert.equal(host.split('budget.add(assembly,agent,\'contexts\',').length - 1, 3);
});
