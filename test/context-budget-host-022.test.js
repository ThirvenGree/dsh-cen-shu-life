// 2026-11-07: DSH 0.2.2 removed `tools` from the system-prompt/assemble waterfall (tool declarations are
// provider-owned). The budget must still count tool definitions, reading them from the host via toolsFor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget} from '../lib/context-budget.js';

const agent = (window = 32768) => ({session: {id: 'fixture', requestContext: () => ({contextWindow: window, model: 'model'}), requestHeader: () => ({config: {model: 'model', maxTokens: 2048}}), deriveMessages: () => [{role: 'user', content: '在吗'}]}});
const big = {name: 'big_tool', description: 'x'.repeat(40000), parameters: {type: 'object', properties: {}}};
const parts = [{text: '本轮必须保留', required: true}, {text: '可选生活资料'.repeat(50), priority: 50}];
const plan = input => ({reason: 'r', order: input.candidates.filter(c => !c.required).map(c => c.id), allocations: {life: {tokens: 20000, reason: 'r'}, inner: {tokens: 0, reason: 'r'}, agency: {tokens: 0, reason: 'r'}}});

test('tools absent from the assembly (DSH 0.2.2) are read through toolsFor and counted', async () => {
  const withHost = roleContextBudget({plan, toolsFor: () => [big]});
  const base = {sections: [{name: 'cosplay', text: '身份'}], contexts: [], variables: {}};
  await withHost.add(base, agent(), 'contexts', 'cen-shu-life', parts);
  const a = withHost.status()[0];
  const without = roleContextBudget({plan});
  await without.add(base, agent(), 'contexts', 'cen-shu-life', parts);
  const b = without.status()[0];
  assert.ok(a.available < b.available - 5000, 'host tool schemas are counted against the window (' + a.available + ' vs ' + b.available + ')');
});

test('tools present in the assembly (DSH 0.2.1) still win; a throwing toolsFor never breaks assembly', async () => {
  const base = {sections: [{name: 'cosplay', text: '身份'}], contexts: [], tools: [big]};
  const b = roleContextBudget({plan, toolsFor: () => { throw Error('host lookup failed'); }});
  const out = await b.add(base, agent(), 'contexts', 'cen-shu-life', parts);
  assert.match(JSON.stringify(out), /本轮必须保留/);
  const c = roleContextBudget({plan, toolsFor: () => { throw Error('x'); }});
  const out2 = await c.add({sections: [], contexts: []}, agent(), 'contexts', 'cen-shu-life', parts);
  assert.match(JSON.stringify(out2), /本轮必须保留/);
});
