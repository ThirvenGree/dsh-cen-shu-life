import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const drain=async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(chunk);return chunks;};
const prefix='Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n';
const snapshot=(id,sections)=>({id,role:'user',source:{kind:'runtime-context',form:'snapshot',sections},content:[{type:'text',text:prefix+sections.map(s=>s.text).join('\n\n')}]});
const schema=tool=>({name:tool.name,description:tool.description,parameters:tool.parameters});

for(const toolUpdate of [undefined,'in-history','addition-only'])test('real host and installed DSH: frozen life history, refreshed context, tool discovery, exact result recall and final accounting compose ('+(toolUpdate||'replace')+')',{skip:!process.env.DSH_RUNTIME_ROOT},async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-request-host-')),oldBridge=process.env.QQ_BRIDGE_ROOT;
 process.env.QQ_BRIDGE_ROOT=path.join(home,'empty-bridge');
 const effects=[],nativeOffs=[];let dispose=()=>{};
 try{
   const load=name=>import(pathToFileURL(path.join(process.env.DSH_RUNTIME_ROOT,'node_modules/@deepseek-ai',name,'lib/index.js')));
   const [{Context},{LlmRuntime,LlmAdapter,freezeMessage,markAgentLoopRequest,isAgentLoopRequest},{LifeEngine},{createHost},agencyHistory,agencyProjection]=await Promise.all([
     load('cordis'),load('dsh-llm'),import('../lib/engine.js'),import('../lib/host.js'),
     import(pathToFileURL(path.resolve(process.env.AGENCY_PLUGIN_ROOT||'../dsh-censhu-agency','request-history.js'))),
     import(pathToFileURL(path.resolve(process.env.AGENCY_PLUGIN_ROOT||'../dsh-censhu-agency','request-projection.js')))
   ]);
   const native=new Context(),runtime=new LlmRuntime(native),originalBoundary=runtime.adapterStream,received=[],downstream=[];
   class Adapter extends LlmAdapter{
     resolveModel(provider,model){return Promise.resolve({provider,id:model,name:model,context:{contextWindow:262144},...(toolUpdate?{toolUpdate}:{})});}
     async *stream(options){received.push(options);yield {type:'usage',usage:{inputTokens:4321,outputTokens:17,cacheReadTokens:123}};yield {type:'finish',reason:{kind:'stop'}};}
   }
   nativeOffs.push(native.llm.registerAdapter(['fixture'],new Adapter()));
   nativeOffs.push(native.on('llm/stream',(options,next)=>{downstream.push(options);assert.ok(Object.isFrozen(options));assert.ok(isAgentLoopRequest(options));return next();}));
   const engine=new LifeEngine({home,now:()=>1000,random:()=>1});
   engine.saveConfig({enabled:true,context:false,sessionIds:['session-life'],semanticEnabled:false,probability:0,moodLinked:false,
     contentEvolutionEnabled:false,weatherAutoEnabled:false,personaEvolutionEnabled:false,memoryWritebackEnabled:false,timedEventsEnabled:false});
   const hooks=new Map(),rootHooks=new Map(),tools=new Map(),services=new Map(),guards=[],sourceCalls=[];
   const addTool=spec=>{assert.equal(tools.has(spec.name),false);tools.set(spec.name,spec);return()=>tools.delete(spec.name);};
   const makeTool=name=>({name,description:'Complete original schema for '+name,parameters:{type:'object',required:['path'],properties:{path:{type:'string',description:'具体参数说明'.repeat(1100)}}},execute(args){sourceCalls.push({name,args});return 'executed';}});
   const readTool=makeTool('read_report'),nextTool=makeTool('search_next'),hiddenTool=makeTool('unrelated_write');
   for(const tool of [readTool,nextTool,hiddenTool])addTool(tool);
   const guard=exec=>exec.name==='unrelated_write'?'fixture permission denied':undefined;guards.push(guard);
   const execute=async(name,args,agent)=>{const exec={name,arguments:args,agent};for(const check of guards){const denial=await check(exec);if(denial)throw Error(denial);}return tools.get(name).execute(args,exec);};
   const optional={name:'memory-record',text:'外来资料原文：原始票根日期尚未核验。'.repeat(260),contextBudget:{mode:'optional',source:'memory-fixture',kind:'history',key:'entry-1',version:'v1'}};
   const protectedContext={name:'runtime-permissions',text:'执行权限：原 guard 必须继续判断。'};
   const resultText='报告原文。'.repeat(1700);
   const rawMessages=[
     {id:'display',role:'user',source:{kind:'censhu-inner-life',displayEntryId:'d'},content:[{type:'text',text:'内部展示摘要'.repeat(60000)}]},
     {id:'display-rendered',role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'text',text:'展示正文'}]},
     {id:'tools-update',role:'developer',source:{kind:'tool-registry'},content:[{type:'tool-addition',toolName:'unrelated_write'}]},
     snapshot('old-runtime',[{name:'old-state',text:'已经被新快照取代的旧状态'}]),
     {id:'user',role:'user',source:{kind:'user'},content:[{type:'text',text:'核对这次报告，然后决定下一步'}]},
     {id:'call',role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'tool-call',id:'call-report',name:'read_report',arguments:{path:'report'}}]},
     {id:'result',role:'tool',toolCallId:'call-report',source:{kind:'tool',callId:'call-report'},isError:false,content:[{type:'text',text:resultText},{type:'image',attachment:{attachmentId:'image-fixture',mediaType:'image/png',bytes:64}}]},
     snapshot('current-runtime',[optional,protectedContext])
   ];
   const messages=Object.freeze(rawMessages.map(freezeMessage)),durable=structuredClone(messages),events=[{type:'turn/start'},{type:'user/message',data:messages[0]},{type:'assistant/message',data:{message:messages[1]}},{type:'turn/end'}];
   const agent={session:{id:'session-life',requestContext:()=>({provider:'fixture',model:'fixture',contextWindow:262144}),
     requestHeader:()=>({config:{provider:'fixture',model:'fixture',maxTokens:2048}}),deriveMessages:()=>messages},ctx:{systemPrompt:{context:()=>()=>{}},on(name,fn){hooks.set(name,fn);return()=>hooks.delete(name);}}};
   const root={llm:native.llm,agents:{roots:()=>[agent]},workspaceRegistry:{archivedSessionIds:[]},
     tools:{register:addTool,get:name=>tools.get(name),guard(fn){guards.push(fn);return()=>guards.splice(guards.indexOf(fn),1);}},
     provide:(name,value)=>services.set(name,value),get:()=>undefined,webServer:{register:()=>()=>{}},interval:()=>()=>{},
     effect(fn){const off=fn();if(typeof off==='function')effects.push(off);},
     on(name,fn){if(!rootHooks.has(name))rootHooks.set(name,new Set());rootHooks.get(name).add(fn);return()=>rootHooks.get(name).delete(fn);}};
   let requestPlans=0,budgetPlans=0;
   createHost(root,{engine,director:false,
     requestPlanner:input=>{requestPlans++;return {keepTools:input.toolsSelectionNeeded?['search_next']:[],results:input.results.map(row=>({id:row.id,mode:'reference',outcome:'data',ranges:[],criticalRanges:[],reason:'按需核对原文'})),reason:'根据当前任务选工具和证据'};},
     budgetPlanner:input=>{budgetPlans++;return {allocations:Object.fromEntries(['life','inner','agency'].map(owner=>[owner,{tokens:3000,reason:'保留本轮必需资料'}])),
       sourceAllocations:input.sources.filter(row=>row.source.startsWith('external:')).map(row=>({source:row.source,tokens:0,reason:'本轮按需取回'})),order:[],recall:[],reason:'外来历史资料本轮不用展开'};}
   });
   dispose=()=>effects.splice(0).reverse().forEach(off=>off());
   const shared=services.get('cenShuLifeShared'),emit=(name,...args)=>{for(const fn of rootHooks.get(name)||[])fn(...args);};
   assert.equal(shared.requestContextStatus().projection.ready,true);
   emit('session/event',agent.session,{type:'turn/start',data:{turn:1}});
   const allTools=[...tools.values()].map(schema),base={sections:[{name:'cosplay',text:'身份与行为规则'}],contexts:[optional,protectedContext],tools:allTools};
   const displayIds=agencyHistory.displayMessageIds(events),offHistory=agencyProjection.installRequestProjector(root.llm,{id:'agency-integration',priority:10,project:request=>{
     if(request.sessionId!==agent.session.id)return request;
     return {...request,messages:agencyHistory.agencyRequestHistory(request.messages,displayIds)};
   }});effects.push(offHistory);
   const assembly=await shared.assembleBudget(agent,()=>base,value=>shared.budgetContext(value,agent,'sections','censhu-agency-current',[{required:true,text:'本轮由角色自己决定'}],''));
   assert.equal(budgetPlans,1,'huge display-only history must be filtered before computing the budget');assert.ok(!assembly.contexts.some(row=>row.name===optional.name));assert.ok(assembly.contexts.includes(protectedContext));
   assert.ok(shared.contextBudgetStatus()[0].available>10000);assert.equal(received.length,0);assert.ok(agencyProjection.requestProjectorStatus(root.llm).projectors.every(row=>row.calls===0));
   assert.deepEqual(agencyProjection.requestProjectorStatus(root.llm).projectors.map(row=>row.priority),[10,30]);
   const toolHistory=Object.freeze({tools:Object.freeze(allTools.filter(tool=>tool.name!=='unrelated_write')),updates:Object.freeze([Object.freeze({messageId:'tools-update',additions:Object.freeze([allTools.find(tool=>tool.name==='unrelated_write')])})])});
   const originalToolHistory=structuredClone(toolHistory);
   const options=markAgentLoopRequest(Object.freeze({sessionId:agent.session.id,provider:'fixture',model:'fixture',maxTokens:2048,messages,tools:Object.freeze(allTools),toolHistory}));
   const call=async()=>{const prepared=await root.llm.prepareCall({provider:'fixture',model:'fixture',maxTokens:2048});const chunks=await drain(prepared.stream(options));const usage=chunks.find(chunk=>chunk.type==='usage')?.usage;emit('session/event',agent.session,{type:'assistant/message',data:{usage}});return received.at(-1);};
   const first=await call();assert.equal(requestPlans,1);assert.equal(downstream.length,1);assert.equal(downstream[0],options);assert.deepEqual(messages,durable);
   assert.ok(!first.messages.some(row=>['display','display-rendered','old-runtime'].includes(row.id)));
   const current=first.messages.find(row=>row.id==='current-runtime');assert.deepEqual(current.source.sections.map(row=>row.name),['runtime-permissions']);assert.ok(current.content[0].text.includes(protectedContext.text));
   assert.equal(first.messages.find(row=>row.id==='call'),messages.find(row=>row.id==='call'));
   const result=first.messages.find(row=>row.id==='result');assert.equal(result.toolCallId,'call-report');assert.equal(result.content[1],messages.find(row=>row.id==='result').content[1]);assert.ok(result.content[0].text.length<resultText.length);
   assert.ok(first.tools.some(tool=>tool.name==='read_report'));assert.ok(first.tools.some(tool=>tool.name==='search_next'));assert.ok(!first.tools.some(tool=>tool.name==='unrelated_write'));
   assert.equal(tools.get(hiddenTool.name),hiddenTool);assert.deepEqual(sourceCalls,[]);
   const catalog=JSON.parse(await execute('censhu_tool_catalog',{action:'catalog'},agent));assert.ok(catalog.entries.some(row=>row.name==='unrelated_write'));
   const loaded=JSON.parse(await execute('censhu_tool_catalog',{action:'load',names:['unrelated_write']},agent));assert.equal(loaded.available,true);assert.deepEqual(sourceCalls,[]);
   const second=await call();assert.deepEqual(second.tools.find(tool=>tool.name==='unrelated_write'),schema(hiddenTool));assert.equal(requestPlans,1);
   await assert.rejects(()=>execute('unrelated_write',{path:'denied'},agent),/fixture permission denied/);assert.deepEqual(sourceCalls,[]);
   const pointer=JSON.parse(result.content[0].text.split('【工具结果原文】').at(-1));let recovered='',offset=0;
   do{const page=JSON.parse(await execute('censhu_tool_result_read',{...pointer,offset,limit:997},agent));assert.equal(page.available,true);recovered+=page.text;offset=page.nextOffset;}while(offset!==null);
   assert.equal(recovered,resultText);assert.equal(requestPlans,1);
   const foreign=JSON.parse(await execute('censhu_tool_result_read',pointer,{session:{id:'foreign'}}));assert.equal(foreign.available,false);
   const contextStatus=shared.contextBudgetStatus().find(row=>row.sessionId===agent.session.id),requestStatus=shared.requestContextStatus();
   assert.equal(contextStatus.runtimeProjection.snapshotsOmitted,1);assert.equal(contextStatus.runtimeProjection.sectionsOmitted,1);
   assert.deepEqual(Object.keys(contextStatus.request.sections),['runtime-permissions']);assert.ok(contextStatus.request.total>0);
   assert.deepEqual(contextStatus.request.reported,{inputTokens:4321,outputTokens:17,cacheReadTokens:123,cacheWriteTokens:undefined});
   assert.equal(requestStatus.sessions[0].toolsSelected,second.tools.length);assert.ok(requestStatus.sessions[0].resultCharsAfter<requestStatus.sessions[0].resultCharsBefore);
   assert.equal(requestStatus.projection.code,'ready');assert.deepEqual(messages,durable);assert.deepEqual(toolHistory,originalToolHistory);assert.equal(downstream.length,2);
   dispose();assert.equal(runtime.adapterStream,originalBoundary);assert.equal(tools.get('censhu_tool_catalog'),undefined);
 }finally{
   dispose();for(const off of nativeOffs.reverse())off();
   if(oldBridge===undefined)delete process.env.QQ_BRIDGE_ROOT;else process.env.QQ_BRIDGE_ROOT=oldBridge;
   fs.rmSync(home,{recursive:true,force:true});
 }
});

for(const lookup of ['get','list'])test('all live session scopes use task tool selection without inheriting role data or changing execution permissions ('+lookup+')',{skip:!process.env.DSH_RUNTIME_ROOT},async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'life-request-scopes-')),oldBridge=process.env.QQ_BRIDGE_ROOT;
 process.env.QQ_BRIDGE_ROOT=path.join(home,'empty-bridge');
 const effects=[],nativeOffs=[];
 const dispose=()=>effects.splice(0).reverse().forEach(off=>off());
 try{
  const load=name=>import(pathToFileURL(path.join(process.env.DSH_RUNTIME_ROOT,'node_modules/@deepseek-ai',name,'lib/index.js')));
  const [{Context},{LlmRuntime,LlmAdapter,freezeMessage,markAgentLoopRequest},{LifeEngine},{createHost}]=await Promise.all([
   load('cordis'),load('dsh-llm'),import('../lib/engine.js'),import('../lib/host.js')
  ]);
  const native=new Context(),runtime=new LlmRuntime(native),originalBoundary=runtime.adapterStream,received=[];
  class Adapter extends LlmAdapter{
   resolveModel(provider,model){return Promise.resolve({provider,id:model,name:model,context:{contextWindow:262144},toolUpdate:'in-history'});}
   async *stream(options){received.push(options);yield {type:'finish',reason:{kind:'stop'}};}
  }
  nativeOffs.push(native.llm.registerAdapter(['fixture'],new Adapter()));
  const engine=new LifeEngine({home,now:()=>1000,random:()=>1});
  engine.saveConfig({enabled:true,context:false,sessionIds:['session-qq-bound'],semanticEnabled:false,probability:0,moodLinked:false,
   contentEvolutionEnabled:false,weatherAutoEnabled:false,personaEvolutionEnabled:false,memoryWritebackEnabled:false,timedEventsEnabled:false});
  fs.mkdirSync(path.join(home,'censhu-inner-life'),{recursive:true});
  fs.writeFileSync(path.join(home,'censhu-inner-life','display-session.json'),JSON.stringify({sessionId:'session-private-life'}));
  const roles=['desktop-default','qq-bound','private-life','child-agent'],mounts=new Map(),hooks=new Map(),services=new Map(),tools=new Map(),guards=[],executed=[];
  const agents=roles.map(role=>({session:{id:'session-'+role,...(role==='child-agent'?{header:{parentSession:'session-desktop-default'}}:{})},ctx:{
   systemPrompt:{context(spec){mounts.set(role,[...(mounts.get(role)||[]),spec.name]);return()=>{};}},
   on(){return()=>{};}
  }}));
  const addTool=spec=>{assert.equal(tools.has(spec.name),false);tools.set(spec.name,spec);return()=>tools.delete(spec.name);};
  const makeTool=name=>({name,description:name,parameters:{type:'object',properties:{input:{type:'string',description:'原参数保持不变。'.repeat(1000)}}},execute(args){executed.push({name,args});return 'ok';}});
  const read=makeTool('read_report'),hidden=makeTool('unrelated_write');addTool(read);addTool(hidden);
  guards.push(exec=>exec.name==='unrelated_write'?'scope fixture permission denied':undefined);
  const execute=async(name,args,agent)=>{const exec={name,arguments:args,agent};for(const guard of guards){const deny=await guard(exec);if(deny)throw Error(deny);}return tools.get(name).execute(args,exec);};
  const roots=agents.filter(agent=>!agent.session.header?.parentSession);
  const root={llm:native.llm,agents:{roots:()=>roots,list:()=>agents,...(lookup==='get'?{get:id=>agents.find(agent=>agent.session.id===id)}:{})},workspaceRegistry:{archivedSessionIds:[]},
   tools:{register:addTool,get:name=>tools.get(name),guard(fn){guards.push(fn);return()=>guards.splice(guards.indexOf(fn),1);}},
   provide:(name,value)=>services.set(name,value),get:()=>undefined,webServer:{register:()=>()=>{}},interval:()=>()=>{},
   effect(fn){const off=fn();if(typeof off==='function')effects.push(off);},
   on(name,fn){if(!hooks.has(name))hooks.set(name,new Set());hooks.get(name).add(fn);return()=>hooks.get(name).delete(fn);}
  };
  let plans=0,budgetPlans=0;
  createHost(root,{engine,director:false,requestPlanner:input=>{plans++;return {keepTools:input.toolsSelectionNeeded?['read_report']:[],keepSkills:[],results:[],reason:'This task needs only the report reader; other capabilities remain discoverable.'};},budgetPlanner:()=>{budgetPlans++;throw Error('No role data was requested by this fixture');}});
  const shared=services.get('cenShuLifeShared');
  const allTools=Object.freeze([...tools.values()].map(schema));
  const dispatch=async request=>{const prepared=await root.llm.prepareCall({provider:'fixture',model:'fixture',maxTokens:2048});return drain(prepared.stream(request));};
  for(const agent of agents){
   const messages=Object.freeze([
    freezeMessage({id:'request-'+agent.session.id,role:'user',source:{kind:'user'},content:[{type:'text',text:'Read this report.'}]}),
    freezeMessage(snapshot('runtime-'+agent.session.id,[{name:'existing-permissions',text:'The original permission guard applies.'}]))
   ]);
   const before=structuredClone(messages),toolHistory=Object.freeze({tools:allTools,updates:Object.freeze([])});
   const request=markAgentLoopRequest(Object.freeze({sessionId:agent.session.id,provider:'fixture',model:'fixture',maxTokens:2048,messages,tools:allTools,toolHistory}));
   await dispatch(request);const projected=received.at(-1);
   assert.ok(projected.tools.some(tool=>tool.name==='read_report'),agent.session.id);
   assert.ok(!projected.tools.some(tool=>tool.name==='unrelated_write'),agent.session.id+' must dynamically reduce definitions');
   assert.deepEqual(projected.messages,before,'selection must not inject role data into a session');
   assert.deepEqual(messages,before,'committed history stays unchanged');
   assert.equal(tools.get(hidden.name),hidden,'original tools remain registered');
   const catalog=JSON.parse(await execute('censhu_tool_catalog',{action:'catalog'},agent));
   assert.ok(catalog.entries.some(tool=>tool.name===hidden.name),'omitted capability remains discoverable');
   assert.equal(JSON.parse(await execute('censhu_tool_catalog',{action:'load',names:[hidden.name]},agent)).available,true);
   await dispatch(request);
   assert.deepEqual(received.at(-1).tools.find(tool=>tool.name===hidden.name),schema(hidden),'load restores the exact original schema');
   await assert.rejects(()=>execute(hidden.name,{input:'denied'},agent),/scope fixture permission denied/);
  }
  assert.equal(plans,4,'one task plan per scope; loading a capability reuses it');
  assert.equal(budgetPlans,0,'global capability selection does not run character budgeting');
  assert.equal(mounts.has('desktop-default'),false,'default desktop session receives no life context hook');
  assert.equal(mounts.has('child-agent'),false,'child agent receives no life context hook');
  assert.ok(mounts.get('qq-bound')?.includes('cen-shu-life'),'bound QQ still retains its existing life context hook');
  assert.deepEqual(executed,[],'directory reads/loads cannot execute omitted tools or bypass guards');
  assert.deepEqual(new Set(shared.requestContextStatus().sessions.map(row=>row.sessionId)),new Set(roles));
  dispose();assert.equal(runtime.adapterStream,originalBoundary);
 }finally{
  dispose();for(const off of nativeOffs.reverse())off();
  if(oldBridge===undefined)delete process.env.QQ_BRIDGE_ROOT;else process.env.QQ_BRIDGE_ROOT=oldBridge;
  fs.rmSync(home,{recursive:true,force:true});
 }
});
