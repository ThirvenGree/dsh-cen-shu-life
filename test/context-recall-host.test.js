import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('host registers exact recall for the shared life/inner/agency assembly and isolates its lifecycle', async () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-context-recall-host-'));
 const bridgeRoot=process.env.QQ_BRIDGE_ROOT;
 process.env.QQ_BRIDGE_ROOT=path.join(home,'empty-bridge');
 let dispose=()=>{};
 try {
  // Import after redirecting bridge discovery: this fixture never reads real QQ
  // conversations and never starts a server, timer or external model request.
  const [{LifeEngine},{createHost}]=await Promise.all([import('../lib/engine.js'),import('../lib/host.js')]);
  const engine=new LifeEngine({home,now:()=>1000,random:()=>1});
  engine.saveConfig({enabled:true,context:true,sessionIds:['recall-host-bound'],semanticEnabled:false,
   probability:0,moodLinked:false,contentEvolutionEnabled:false,weatherAutoEnabled:false,
   personaEvolutionEnabled:false,memoryWritebackEnabled:false,timedEventsEnabled:false});
  const hooks=new Map(),tools=new Map(),services=new Map(),effects=[],rootHooks=new Map();
  const agent={session:{id:'recall-host-bound',
   requestContext:()=>({provider:'fixture',model:'fixture',contextWindow:10000}),
   requestHeader:()=>({config:{provider:'fixture',model:'fixture',maxTokens:2048}}),
   deriveMessages:()=>[{role:'tool',content:'工具结果'.repeat(4000)}]},ctx:{
    systemPrompt:{context:()=>()=>{}},
    on(name,fn){hooks.set(name,fn);return()=>hooks.delete(name);}
   }};
  dispose=()=>effects.splice(0).reverse().forEach(fn=>fn());
  createHost({
   agents:{roots:()=>[agent]},
   tools:{register(spec){assert.equal(tools.has(spec.name),false);tools.set(spec.name,spec);return()=>tools.delete(spec.name);}},
   provide:(name,value)=>services.set(name,value),
   get:()=>undefined,
   webServer:{register:()=>()=>{}},
   effect(fn){const off=fn();if(typeof off==='function')effects.push(off);},
   interval:()=>()=>{},
   on(name,fn){if(!rootHooks.has(name))rootHooks.set(name,new Set());rootHooks.get(name).add(fn);return()=>rootHooks.get(name).delete(fn);}
  },{engine,director:false});
  const recall=tools.get('censhu_context_recall'),shared=services.get('cenShuLifeShared');
  const emit=(name,...args)=>{for(const fn of rootHooks.get(name)||[])fn(...args);};
  emit('session/event',agent.session,{type:'turn/start',data:{turn:1}});
  assert.ok(recall,'the real host must register its public recall tool');
  assert.ok(shared?.budgetContext&&shared?.assembleBudget,'all role plugins must share the host coordinator');
  assert.equal(shared.isReadOnlyTool({name:'censhu_context_recall',arguments:{action:'catalog'}}),true);
  assert.equal(shared.isReadOnlyTool({name:'censhu_agency_method',arguments:{action:'choose'}}),false);
  const innerText='独处原始片段：窗框右下角留着一道铅笔痕。'.repeat(300);
  const agencyText='主动进行原始打算：等装订好旧册，再回顾那张窗台画。';
  const base={contexts:[],sections:[],tools:[]};
  const fullAssembly=()=>hooks.get('system-prompt/assemble')(base,{},()=>
   shared.assembleBudget(agent,()=>
    shared.assembleBudget(agent,async()=>base,assembly=>
     shared.budgetContext(assembly,agent,'sections','censhu-agency-current',
      [{owner:'agency',key:'agency:host-test',text:agencyText}],'')),assembly=>
    shared.budgetContext(assembly,agent,'contexts','censhu-inner-life-observations',
     [{owner:'inner',key:'inner:host-test',text:innerText}],'')));
  const result=await fullAssembly();
  const current=shared.contextBudgetStatus().find(row=>row.sessionId===agent.session.id);
  assert.equal(current.pressure?.state,'awaiting-compaction');
  assert.equal(current.recall.available,true);
  assert.ok(current.byOwner.life.offered>0,'life content must come from the actual LifeEngine context');
  assert.equal(current.byOwner.inner.offered,1);
  assert.equal(current.byOwner.agency.offered,1);
  assert.ok(!(JSON.stringify(result).includes(innerText)||JSON.stringify(result).includes(agencyText)),
   'the oversized history removes optional injection but must not erase its exact recall source');
  const call=async(args,callingAgent=agent)=>JSON.parse(await recall.execute(args,{agent:callingAgent}));
  const entries=[];let offset=0;
  do {
   const page=await call({action:'catalog',snapshotId:current.recall.snapshotId,version:current.recall.version,offset,limit:12});
   assert.equal(page.status,'ready');entries.push(...page.entries);offset=page.nextOffset;
  } while(offset!==null);
  assert.deepEqual(new Set(entries.map(row=>row.owner)),new Set(['life','inner','agency']));
  const inner=entries.find(row=>row.key==='inner:host-test'),agency=entries.find(row=>row.key==='agency:host-test');
  assert.equal(inner.selected,false);assert.equal(agency.selected,false);
  let recovered='',readOffset=0;
  do {
   const page=await call({action:'read',snapshotId:current.recall.snapshotId,version:current.recall.version,itemId:inner.itemId,offset:readOffset,limit:1000});
   assert.equal(page.status,'ready');recovered+=page.text;readOffset=page.nextOffset;
  } while(readOffset!==null);
  assert.equal(recovered,innerText,'registered host tool must recover the exact paged source');
  assert.equal((await call({action:'read',snapshotId:current.recall.snapshotId,version:current.recall.version,itemId:agency.itemId})).text,agencyText);
  const foreign=await call({action:'read',snapshotId:current.recall.snapshotId,version:current.recall.version,itemId:inner.itemId},{session:{id:'other-agent'}});
  assert.equal(foreign.status,'forbidden');assert.equal(foreign.reason,'wrong_session');assert.equal(foreign.text,undefined);
  await fullAssembly();
  const readStatus=shared.contextBudgetStatus().find(row=>row.sessionId===agent.session.id).recall;
  assert.equal(readStatus.read,2);assert.equal(readStatus.completed,2);
  emit('session/event',agent.session,{type:'turn/end',data:{turn:1}});
  emit('session/event',agent.session,{type:'turn/start',data:{turn:2}});
  await fullAssembly();assert.equal(shared.contextBudgetStatus().find(row=>row.sessionId===agent.session.id).recall.read,0);
  const archived=ids=>emit('domain/changed',{domain:'workspace',table:'',operation:'put',value:{archivedSessionIds:ids}});
  const assembleAgain=()=>shared.assembleBudget(agent,async()=>base,assembly=>shared.budgetContext(assembly,agent,'sections','censhu-agency-current',[{owner:'agency',text:agencyText}],''));
  archived([agent.session.id]);
  assert.equal((await call({action:'catalog',snapshotId:current.recall.snapshotId})).available,false);
  assert.equal(shared.contextBudgetStatus().some(row=>row.sessionId===agent.session.id),false);
  await assembleAgain();assert.equal((await call({action:'catalog'})).available,false,'archived agents cannot recreate snapshots');
  archived([]);await assembleAgain();assert.equal((await call({action:'catalog'})).available,true);
  emit('session/disposed',agent.session);assert.equal((await call({action:'catalog'})).available,false);
  assert.equal(shared.contextBudgetStatus().some(row=>row.sessionId===agent.session.id),false);
  await assembleAgain();assert.equal((await call({action:'catalog'})).available,false,'the retired Session cannot resurrect its snapshot');
  const resumed={...agent,session:{...agent.session}};
  await shared.assembleBudget(resumed,async()=>base,assembly=>shared.budgetContext(assembly,resumed,'sections','censhu-agency-current',[{owner:'agency',text:agencyText}],''));
  assert.equal((await call({action:'catalog'},resumed)).available,true,'a fresh Session instance may resume the same identifier');
  assert.equal((await call({action:'catalog'})).reason,'session-inactive','an old Session cannot read the resumed instance snapshot');
  dispose();
  assert.equal(tools.has('censhu_context_recall'),false,'host disposal must unregister the tool');
  const late=await call({action:'catalog',snapshotId:current.recall.snapshotId});
  assert.equal(late.status,'unavailable');assert.equal(late.reason,'disposed');
 } finally {
  dispose();
  if(bridgeRoot===undefined)delete process.env.QQ_BRIDGE_ROOT;else process.env.QQ_BRIDGE_ROOT=bridgeRoot;
  fs.rmSync(home,{recursive:true,force:true});
 }
});
