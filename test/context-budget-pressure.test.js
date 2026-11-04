import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget,estimateText} from '../lib/context-budget.js';

// Ordering checked against the installed DSH agent-loop preStep(): assemble
// precedes agent/pre-step, then request preparation and llm/stream. The local
// billion-context adapter owns compaction at llm/stream; native compaction stays
// disabled. These are isolated contract regressions, not live provider tests.
const required='【本轮要求】先回答青枔的问题，岑舒的当前身份保持不变。';
const optional='【可选旧日记】今天又想起旧书里的窗台。';
const identity='【角色身份】岑舒';
function fixture({large=true,tools=[]}={}){
 let history=[{role:'user',content:'分析刚才的资料'},
  {role:'assistant',content:[{type:'tool-call',id:'call-fixture',name:'read',arguments:{path:'synthetic.txt'}}]},
  {role:'tool',toolCallId:'call-fixture',content:large?'资料'.repeat(7000):'小段资料'}];
 let model='fixture-model';
 const agent={session:{id:'budget-pressure-fixture',requestContext:()=>({contextWindow:10000,model}),
  requestHeader:()=>({config:{model,maxTokens:2048}}),deriveMessages:()=>history}};
 const base={sections:[{name:'cosplay',text:identity}],contexts:[],tools};
 const parts=[{required:true,owner:'life',key:'required:focus',text:required},{owner:'inner',key:'diary:optional',text:optional}];
 return {agent,base,parts,history:()=>history,replace:next=>{history=next;},setModel:next=>{model=next;}};
}
function allocation(input){return {reason:'按当前问题选择',order:input.candidates.filter(r=>!r.required).map(r=>r.id),
 allocations:Object.fromEntries(['life','inner','agency'].map(owner=>[owner,{tokens:2000,reason:'本轮相关'}]))};}
async function hostStep(budget,f,{preStep=async()=>{},stream=async()=>{}}={}){
 const trace=[];
 const assembly=await budget.assemble(f.agent,async()=>f.base,
  out=>budget.add(out,f.agent,'contexts','cen-shu-life',f.parts));
 trace.push('assembled');
 await preStep({assembly,agent:f.agent});trace.push('pre-step');
 const result=await stream({assembly,messages:f.history(),agent:f.agent});trace.push('llm/stream');
 return {trace,assembly,result};
}

test('oversized tool output reaches the existing single compaction path with required context intact',async()=>{
 const f=fixture(),budget=roleContextBudget({plan:allocation});
 let preSteps=0,compressions=0,requests=0;
 const result=await hostStep(budget,f,{preStep:async()=>{preSteps++;},stream:async request=>{
  const context=request.assembly.contexts.map(row=>row.text).join('\n');
  assert.ok(context.includes(required));assert.ok(!context.includes(optional));
  assert.equal(request.assembly.sections[0].text,identity);
  assert.strictEqual(request.messages,f.history(),'budget must not mutate the host history');
  assert.equal(request.messages.at(-1).toolCallId,'call-fixture');
  assert.ok(estimateText(request.messages.at(-1).content)>10000);
  // One registered engine reduces a whole balanced tool interaction; the
  // budget layer does not perform its own concurrent session replacement.
  compressions++;f.replace([{role:'user',content:'【已有引擎摘要】已完整读取合成资料；尚待解释结论。'}]);
  assert.ok(estimateText(context)+estimateText(f.history()[0].content)+2048<10000);
  requests++;return 'reply after compaction';
 }});
 assert.deepEqual(result.trace,['assembled','pre-step','llm/stream']);
 assert.equal(preSteps,1);assert.equal(compressions,1);assert.equal(requests,1);
 const pressure=budget.status()[0];assert.equal(pressure.blocked,false);
 assert.equal(pressure.pressure.state,'awaiting-compaction');assert.equal(pressure.pressure.cause,'history');
 assert.ok(pressure.pressure.overBudgetTokens>0);assert.ok(pressure.byOwner.life.kept>=1);
 const next=await hostStep(budget,f);
 assert.ok(next.assembly.contexts.some(row=>row.text.includes(optional)),'next assembly can use the recovered space');
});

test('non-compressible tool definitions retain the original host capacity error instead of an assembly dead end',async()=>{
 const tools=[{name:'synthetic',description:'定义'.repeat(7000)}],f=fixture({large:false,tools});
 const budget=roleContextBudget({plan:allocation}),hostError=Object.assign(Error('host context window exceeded'),{code:'CONTEXT_WINDOW_EXCEEDED'});
 let preSteps=0,requests=0;
 await assert.rejects(()=>hostStep(budget,f,{preStep:async()=>{preSteps++;},stream:async({assembly})=>{
  requests++;assert.deepEqual(assembly.tools,tools);
  assert.ok(assembly.contexts.some(row=>row.text.includes(required)));throw hostError;
 }}),error=>error===hostError);
 assert.equal(preSteps,1);assert.equal(requests,1);
 const row=budget.status()[0];assert.equal(row.blocked,false);assert.equal(row.pressure.cause,'non-compressible');
 assert.equal(row.pressure.state,'awaiting-compaction');
});

test('history growing while the planner awaits also yields to downstream compaction',async()=>{
 const f=fixture({large:false});let calls=0,preSteps=0,streams=0;
 const budget=roleContextBudget({plan:async input=>{
  calls++;f.replace([...f.history(),{role:'tool',toolCallId:'arrived-during-plan',content:'突增'.repeat(7000)}]);
  return allocation(input);
 }});
 const result=await hostStep(budget,f,{preStep:async()=>{preSteps++;},stream:async({assembly})=>{
  streams++;assert.ok(assembly.contexts.some(row=>row.text.includes(required)));
  assert.ok(!assembly.contexts.some(row=>row.text.includes(optional)));return 'existing engine receives pressure';
 }});
 assert.equal(calls,1);assert.equal(preSteps,1);assert.equal(streams,1);
 assert.equal(result.result,'existing engine receives pressure');
 assert.equal(budget.status()[0].pressure.cause,'history');
});

test('capacity cooperation does not swallow downstream assembly failures or an incompatible model switch',async()=>{
 const f=fixture({large:false}),budget=roleContextBudget({plan:allocation}),failure=Error('other plugin assembly failure');
 await assert.rejects(()=>budget.assemble(f.agent,async()=>{throw failure;},out=>out),error=>error===failure);
 let preSteps=0;
 const switching=roleContextBudget({plan:async input=>{f.setModel('changed-model');return allocation(input);}});
 await assert.rejects(()=>hostStep(switching,f,{preStep:async()=>{preSteps++;}}),/模型已切换/);
 assert.equal(preSteps,0);
});
