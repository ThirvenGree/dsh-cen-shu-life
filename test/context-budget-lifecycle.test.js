import test from 'node:test';
import assert from 'node:assert/strict';
import {roleContextBudget} from '../lib/context-budget.js';

const actor=id=>({session:{id,requestContext:()=>({model:'fixture',contextWindow:24000})}});
const plan=input=>({reason:'当前资料',allocations:Object.fromEntries(['life','inner','agency'].map(k=>[k,{tokens:1000,reason:'当前资料'}])),order:input.candidates.filter(r=>!r.required).map(r=>r.id)});
const collect=(budget,agent,assembly)=>budget.add(assembly,agent,'contexts','cen-shu-life',[{text:'本轮精确原文',required:true},{text:'可选资料'}]);
const build=(budget,agent,next=async()=>({contexts:[],sections:[]}))=>budget.assemble(agent,next,assembly=>collect(budget,agent,assembly));
const recall=(budget,agent,args={action:'catalog'})=>JSON.parse(budget.recallTool().execute(args,{agent}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('forget clears all snapshots and status of only that session; a restored session starts fresh',async()=>{
 const budget=roleContextBudget({plan}),a=actor('session-a'),b=actor('session-b');
 await build(budget,a);await build(budget,b);
 const old=recall(budget,a);assert.equal(old.available,true);
 budget.forget('a');
 assert.equal(recall(budget,a).available,false);
 assert.equal(recall(budget,a,{action:'catalog',snapshotId:old.snapshotId}).available,false);
 assert.equal(recall(budget,b).available,true);
 assert.deepEqual(budget.status().map(r=>r.sessionId),['session-b']);
 await build(budget,a);assert.notEqual(recall(budget,a).snapshotId,old.snapshotId);
 budget.dispose();
});

for(const outcome of ['success','failure'])test('forget during an awaited planner prevents late '+outcome+' from restoring state',async()=>{
 const entered=deferred(),pending=deferred(),agent=actor('session-race');
 let delay=true;
 const budget=roleContextBudget({plan:async input=>{if(delay){entered.resolve();await pending.promise;}return plan(input);}});
 const task=build(budget,agent);await entered.promise;budget.forget('race');
 if(outcome==='failure')pending.reject(Error('late planner failure'));else pending.resolve();
 const result=await task;
 assert.deepEqual(result,{contexts:[],sections:[]});
 assert.equal(recall(budget,agent).available,false);assert.deepEqual(budget.status(),[]);
 delay=false;await build(budget,agent);assert.equal(budget.status()[0].mode,'model','late failure must not arm a new backoff');
 budget.dispose();
});

test('forget while collecting downstream content prevents late publication',async()=>{
 const budget=roleContextBudget({plan}),agent=actor('session-collect'),pending=deferred();
 const task=build(budget,agent,()=>pending.promise);budget.forget('collect');pending.resolve({contexts:[],sections:[]});
 assert.deepEqual(await task,{contexts:[],sections:[]});assert.equal(recall(budget,agent).available,false);
 assert.deepEqual(budget.status(),[]);budget.dispose();
});

test('archive blocks new assemblies until restored, and dispose invalidates an outstanding window lookup',async()=>{
 const archived=new Set(['closed']);let plans=0;
 const budget=roleContextBudget({isSessionArchived:id=>archived.has(id),plan:input=>{plans++;return plan(input);}}),agent=actor('session-closed');
 await build(budget,agent);assert.equal(plans,0);assert.equal(recall(budget,agent).available,false);
 archived.clear();await build(budget,agent);assert.equal(plans,1);budget.dispose();
 const pending=deferred(),entered=deferred(),unresolved={session:{id:'session-window'}};
 const late=roleContextBudget({resolveWindow:async()=>{entered.resolve();return pending.promise;},plan});
 const task=build(late,unresolved);await entered.promise;late.dispose();pending.resolve(24000);
 assert.deepEqual(await task,{contexts:[],sections:[]});assert.deepEqual(late.status(),[]);
 assert.equal(recall(late,unresolved).reason,'disposed');
});

for(const stage of ['basis','planner','window','downstream','collector'])test('host abort promptly wakes the '+stage+' wait and preserves its exact abort reason',{timeout:1500},async()=>{
 const entered=deferred(),never=deferred(),controller=new AbortController(),agent=actor('session-abort-'+stage),base={contexts:[],sections:[]};
 if(stage==='window')agent.session.requestContext=()=>({model:'fixture'});
 const wait=()=>{entered.resolve();return never.promise;};
 const budget=roleContextBudget({prepareBasis:stage==='basis'?({request})=>{assert.ok(request.signal);return wait();}:undefined,resolveWindow:stage==='window'?wait:undefined,plan:stage==='planner'?wait:plan});
 try{
  const task=budget.assemble(agent,stage==='downstream'?wait:()=>base,stage==='collector'?wait:out=>collect(budget,agent,out),{signal:controller.signal,assembly:base});
  await entered.promise;const reason=Object.assign(Error('original host cancelled'),{name:'AbortError'});controller.abort(reason);
  await assert.rejects(task,error=>error===reason);assert.deepEqual(budget.status(),[]);assert.equal(recall(budget,agent).available,false);
 }finally{budget.dispose();}
});

for(const action of ['forget','endTurn','dispose'])test(action+' wakes an awaited planner without waiting for the underlying job',{timeout:1500},async()=>{
 const entered=deferred(),late=deferred(),agent=actor('session-lifecycle-'+action),base={contexts:[],sections:[]};
 const budget=roleContextBudget({plan:async input=>{entered.resolve();await late.promise;return plan(input);}});
 const task=build(budget,agent,()=>base);await entered.promise;budget[action](agent.session.id);
 assert.strictEqual(await task,base);assert.deepEqual(budget.status(),[]);assert.equal(recall(budget,agent).available,false);
 late.resolve();await Promise.resolve();assert.deepEqual(budget.status(),[]);budget.dispose();
});

test('a configuration change during planning cannot relabel an old decision with the new scope',{timeout:1500},async()=>{
 let scope='enabled';const entered=deferred(),late=deferred(),agent=actor('session-scope'),base={contexts:[],sections:[]};
 const budget=roleContextBudget({planScope:()=>scope,plan:async input=>{entered.resolve();await late.promise;return plan(input);}});
 try{
  const task=build(budget,agent,()=>base);await entered.promise;scope='disabled';late.resolve();
  assert.strictEqual(await task,base);assert.deepEqual(budget.status(),[]);assert.equal(recall(budget,agent).available,false);
  const request={sessionId:agent.session.id,model:'fixture',messages:[]};assert.strictEqual(budget.prepareRequest(request),request);
 }finally{budget.dispose();}
});
