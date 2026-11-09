// 2026-11-07: DSH 0.2.2 made tool execution provider-owned and batch-shaped. Plugin-side calls must work on both hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeHostTool,usesToolBatchExecution} from '../lib/host-tools.js';
import {auditedWrite,isAuditedWrite} from '../lib/reviewed-write.js';

const ok = text => ({content: [{type: 'text', text}], isError: false});
// Mirrors 0.2.2 dsh-tools executeToolBatch: arguments arrive as JSON text and are parsed before guards run.
const batchHost = (run, seen = []) => ({
  setExecutor() {},
  async execute(input) {
    if (!Array.isArray(input.calls)) throw new Error('Tool batch execution failed');
    seen.push(input);
    const results = [];
    for (const call of input.calls) {
      const exec = {callId: call.id, name: call.name, arguments: JSON.parse(call.arguments || '{}'), agent: input.agent, signal: input.signal};
      results.push({callId: call.id, result: await run(exec)});
    }
    return {results, additionalContexts: [], concluded: false};
  },
});

test('old host (no setExecutor) receives the single-call input unchanged', async () => {
  const calls = [];
  const tools = {execute: async input => { calls.push(input); return ok('old'); }};
  const agent = {id: 'a'};
  const input = {name: 'engram_stats', arguments: {}, agent, callId: 'c1', signal: AbortSignal.timeout(1000)};
  assert.equal(usesToolBatchExecution(tools), false);
  assert.deepEqual(await executeHostTool(tools, input), ok('old'));
  assert.equal(calls[0], input);
});

test('batch host gets one tool-call with JSON arguments and returns that call result', async () => {
  const seen = [], agent = {id: 'a'};
  const tools = batchHost(async exec => ok(exec.name + ':' + JSON.stringify(exec.arguments)), seen);
  const r = await executeHostTool(tools, {name: 'memory', arguments: {action: 'list', target: 'project'}, agent, callId: 'c2', signal: AbortSignal.timeout(1000)});
  assert.deepEqual(r, ok('memory:{"action":"list","target":"project"}'));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].calls, [{type: 'tool-call', id: 'c2', name: 'memory', arguments: '{"action":"list","target":"project"}'}]);
  assert.equal(seen[0].agent, agent);
});

test('batch host: an outcome for another call is rejected instead of being used', async () => {
  const tools = {setExecutor() {}, execute: async () => ({results: [{callId: 'other', result: ok('x')}]})};
  await assert.rejects(executeHostTool(tools, {name: 'x', arguments: {}, callId: 'mine'}), /没有返回这次调用的结果/);
});

test('reviewed memory writes keep their host permit on the batch host', async () => {
  const agent = {id: 'role'};
  let permitted = null;
  const tools = batchHost(async exec => { permitted = isAuditedWrite(exec); return ok('saved'); });
  const r = await auditedWrite(tools, {name: 'engram_remember', arguments: {content: '青枔喜欢晚上散步', scope: 'user'}, agent, signal: AbortSignal.timeout(1000)});
  assert.deepEqual(r, ok('saved'));
  assert.equal(permitted, true);
  // The permit is released after the call.
  assert.equal(isAuditedWrite({callId: 'censhu-reviewed-x', name: 'engram_remember', agent, arguments: {}}), false);
});
